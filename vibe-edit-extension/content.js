/**
 * Vibe Edit Picker — content script
 *
 * Lives entirely in the content script (not the background service worker).
 * Rationale: MV3 background service workers unload after ~30s idle, which
 * would drop a long-lived WebSocket. Content scripts persist for the life
 * of the page/tab, so the socket lives here instead. See PRD §6.3.
 *
 * This file is intentionally framework-free (no bundler, no React) so it
 * can be loaded directly as a content script with zero build step.
 */

(() => {
  const BRIDGE_URL = "ws://localhost:4017"; // PRD §7.2 — hardcoded in v1, see PRD §9 future work
  const BRIDGE_CONNECT_TIMEOUT_MS = 1000;
  const AUTO_APPLY_TIMEOUT_MS = 65_000;

  let pickModeActive = false;
  let bridgeAvailable = null; // null = unknown yet this session, true/false once tested
  let hoveredEl = null;

  // ---------------------------------------------------------------------
  // Pick mode toggle (triggered by a message from the popup, see popup.js)
  // ---------------------------------------------------------------------

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "TOGGLE_PICK_MODE") {
      setPickMode(!pickModeActive);
    }
  });

  function setPickMode(active) {
    pickModeActive = active;
    if (active) {
      bridgeAvailable = null; // retry WebSocket each pick activation, PRD §6.3
      document.addEventListener("mouseover", onMouseOver, true);
      document.addEventListener("click", onClick, true);
      document.addEventListener("keydown", onKeyDown, true);
      showToast("Pick an element…");
    } else {
      document.removeEventListener("mouseover", onMouseOver, true);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKeyDown, true);
      clearHoverOutline();
    }
  }

  function onKeyDown(e) {
    if (e.key === "Escape") {
      setPickMode(false);
    }
  }

  function onMouseOver(e) {
    clearHoverOutline();
    hoveredEl = e.target;
    hoveredEl.classList.add("vibe-edit-hover-outline");
  }

  function clearHoverOutline() {
    if (hoveredEl) {
      hoveredEl.classList.remove("vibe-edit-hover-outline");
      hoveredEl = null;
    }
  }

  function onClick(e) {
    // Critical: prevent the element's native behavior (navigation, form
    // submit, etc.) from firing while in pick mode. See PRD §6.2 + §8.
    e.preventDefault();
    e.stopPropagation();

    const target = e.target;
    clearHoverOutline();
    setPickMode(false); // one-shot per activation, see PRD §6.2

    const payload = captureElement(target);
    promptForInstructionThenSend(payload);
  }

  // ---------------------------------------------------------------------
  // Element capture — PRD §6.4
  // ---------------------------------------------------------------------

  function buildSelector(el) {
    // Structural nth-child path from el up to body. Deliberately does not
    // lean on class names alone (CSS-module hashes etc. are meaningless to
    // an agent reading the prompt) — nth-child is the reliable fallback.
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== document.body) {
      const tag = node.tagName.toLowerCase();
      const parent = node.parentElement;
      let nth = 1;
      if (parent) {
        const siblings = Array.from(parent.children).filter(
          (c) => c.tagName === node.tagName
        );
        nth = siblings.indexOf(node) + 1;
      }
      const idPart = node.id ? `#${node.id}` : "";
      const classPart =
        !node.id && node.classList.length
          ? `.${Array.from(node.classList).slice(0, 2).join(".")}`
          : "";
      parts.unshift(`${tag}${idPart}${classPart}:nth-child(${nth})`);
      node = parent;
    }
    return parts.join(" > ") || el.tagName.toLowerCase();
  }

  function getCuratedComputedStyle(el) {
    const cs = window.getComputedStyle(el);
    // Curated subset only — pulling the full computed style object is
    // noisy and bloats the prompt. See PRD §6.4.
    return {
      color: cs.color,
      backgroundColor: cs.backgroundColor,
      fontSize: cs.fontSize,
      fontWeight: cs.fontWeight,
      padding: cs.padding,
      margin: cs.margin,
      width: cs.width,
      height: cs.height,
      display: cs.display,
      borderRadius: cs.borderRadius,
    };
  }

  function getTextWithFallback(el) {
    const own = (el.textContent || "").trim();
    if (own.length > 0) return own.slice(0, 200);

    // Fall back to nearest non-empty parent/sibling text to help
    // disambiguate icon-only buttons etc. See PRD §6.4.
    let node = el.parentElement;
    let depth = 0;
    while (node && depth < 3) {
      const t = (node.textContent || "").trim();
      if (t.length > 0) return t.slice(0, 200);
      node = node.parentElement;
      depth += 1;
    }
    return "";
  }

  function captureElement(el) {
    const rect = el.getBoundingClientRect();
    const sourceHints = getSourceHints(el);
    return {
      type: "element_selected",
      selector: buildSelector(el),
      tag: el.tagName.toLowerCase(),
      id: el.id || null,
      classes: Array.from(el.classList),
      text: getTextWithFallback(el),
      attributes: {
        href: el.getAttribute("href") || undefined,
        src: el.getAttribute("src") || undefined,
      },
      computedStyle: getCuratedComputedStyle(el),
      boundingRect: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
      pageUrl: window.location.href,
      timestamp: Date.now(),
      instruction: "", // filled in by promptForInstructionThenSend, see §6.6 revision
      sourceHints: sourceHints || null,
      sourceConfidence: sourceHints ? sourceHints.confidence : "none",
    };
  }

  // ---------------------------------------------------------------------
  // Source-location probes — documentation/source-mapping-plan.md (Tier 1)
  //
  // Zero-config, best-effort detection of dev-mode source metadata that
  // frameworks already expose for their own DevTools/inspector tooling.
  // Each probe only reads DOM nodes/attributes/expando properties — never
  // `window.*` globals — because content scripts run in an isolated JS
  // world and do not share the page's `window` object, only the DOM. DOM
  // elements (and expando properties framework runtimes attach to them,
  // e.g. React's `__reactFiber$...`) ARE shared, so reading those is safe;
  // reading `window.__REACT_DEVTOOLS_GLOBAL_HOOK__` would silently return
  // undefined even when the page itself has it set.
  //
  // Every probe must be wrapped in try/catch and never throw — we're
  // reaching into framework internals that can change shape between
  // versions, and a probe failure must never break element picking.
  // ---------------------------------------------------------------------

  function findReactFiber(el) {
    const key = Object.keys(el).find(
      (k) => k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$")
    );
    return key ? el[key] : null;
  }

  function probeReactFiberDebugSource(el) {
    try {
      let fiber = findReactFiber(el);
      let depth = 0;
      while (fiber && depth < 30) {
        const src = fiber._debugSource;
        if (src && src.fileName) {
          return {
            fileName: src.fileName,
            lineNumber: src.lineNumber,
            columnNumber: src.columnNumber,
            matchedVia: "react-fiber-debug-source",
            confidence: "high",
          };
        }
        fiber = fiber.return;
        depth += 1;
      }
    } catch (_) {
      /* noop — never let a probe break picking */
    }
    return null;
  }

  function probeReactFiberComponentName(el) {
    try {
      let fiber = findReactFiber(el);
      let depth = 0;
      while (fiber && depth < 30) {
        const name =
          typeof fiber.type === "function"
            ? fiber.type.displayName || fiber.type.name
            : null;
        if (name) {
          return {
            componentName: name,
            matchedVia: "react-fiber-component-name",
            confidence: "medium",
          };
        }
        fiber = fiber.return;
        depth += 1;
      }
    } catch (_) {
      /* noop */
    }
    return null;
  }

  function probeInspectorPluginAttributes(el) {
    // Attribute names below are best-effort, based on common conventions
    // used by existing click-to-source dev plugins (react-dev-inspector
    // style `data-inspector-*`, vite-plugin-vue-inspector style
    // `data-v-inspector="file:line:col"`). Not verified against every
    // plugin version — if these don't match, the probe just finds
    // nothing and returns null.
    try {
      let node = el;
      let depth = 0;
      while (node && node.nodeType === 1 && depth < 10) {
        const relPath =
          node.getAttribute && node.getAttribute("data-inspector-relative-path");
        if (relPath) {
          const line = node.getAttribute("data-inspector-line");
          const column = node.getAttribute("data-inspector-column");
          return {
            fileName: relPath,
            lineNumber: line ? Number(line) : undefined,
            columnNumber: column ? Number(column) : undefined,
            matchedVia: "inspector-attribute(data-inspector-*)",
            confidence: "high",
          };
        }

        const vInspector = node.getAttribute && node.getAttribute("data-v-inspector");
        if (vInspector) {
          const parts = vInspector.split(":");
          const fileName = parts.length > 2 ? parts.slice(0, -2).join(":") : parts[0];
          const lineNumber = parts.length >= 2 ? Number(parts[parts.length - 2]) : undefined;
          const columnNumber = parts.length >= 1 ? Number(parts[parts.length - 1]) : undefined;
          return {
            fileName,
            lineNumber,
            columnNumber,
            matchedVia: "inspector-attribute(data-v-inspector)",
            confidence: "high",
          };
        }

        node = node.parentElement;
        depth += 1;
      }
    } catch (_) {
      /* noop */
    }
    return null;
  }

  function probeNextJsDevOverlayMarkers(el) {
    // Best-effort/stretch — Next.js doesn't have a documented stable
    // per-element source attribute, so this is a generic scan for any
    // `data-nextjs*` attribute that looks path-like. Low expected yield.
    try {
      let node = el;
      let depth = 0;
      while (node && node.nodeType === 1 && depth < 10) {
        if (node.attributes) {
          for (const attr of Array.from(node.attributes)) {
            if (attr.name.startsWith("data-nextjs") && attr.value) {
              return {
                fileName: attr.value,
                matchedVia: `inspector-attribute(${attr.name})`,
                confidence: "medium",
              };
            }
          }
        }
        node = node.parentElement;
        depth += 1;
      }
    } catch (_) {
      /* noop */
    }
    return null;
  }

  function probeStructuralFallback(el) {
    // None of the framework-specific probes found anything. If we also
    // can't find any sign that a JS framework is rendering this page at
    // all (no React fiber anywhere, no known SPA root marker), the page
    // is most likely plain static HTML — in which case the structural
    // nth-child selector IS the source (the DOM and the markup are the
    // same file), so it's reasonable to treat that as medium confidence
    // rather than "none". Genuinely unknown frameworks with no detectable
    // marker still fall through to "none" here — that's the safe
    // direction to be wrong in (more conservative, not less).
    try {
      const hasReactFiber = !!findReactFiber(el) || !!findReactFiber(document.body);
      const hasKnownFrameworkRoot = !!document.querySelector(
        "[data-reactroot], #__next, [data-v-app], [data-server-rendered], [ng-version]"
      );
      if (!hasReactFiber && !hasKnownFrameworkRoot) {
        return {
          matchedVia: "no-framework-detected (structural selector likely reliable on plain HTML)",
          confidence: "medium",
        };
      }
    } catch (_) {
      /* noop */
    }
    return null;
  }

  function getSourceHints(el) {
    const probes = [
      probeReactFiberDebugSource,
      probeInspectorPluginAttributes,
      probeReactFiberComponentName,
      probeNextJsDevOverlayMarkers,
      probeStructuralFallback,
    ];
    for (const probe of probes) {
      const result = probe(el);
      if (result) return result;
    }
    return null;
  }

  // ---------------------------------------------------------------------
  // Inline "what do you want to change?" capture — PRD §6.6 revision
  // ---------------------------------------------------------------------

  function promptForInstructionThenSend(payload) {
    removeInstructionComposer();

    const backdrop = document.createElement("div");
    backdrop.className = "vibe-edit-backdrop";

    const composer = document.createElement("div");
    composer.className = "vibe-edit-composer";
    composer.setAttribute("role", "dialog");
    composer.setAttribute("aria-label", "Describe your edit");

    const header = document.createElement("div");
    header.className = "vibe-edit-composer-header";

    const label = document.createElement("span");
    label.className = "vibe-edit-composer-label";
    label.textContent = `Selected <${payload.tag}>`;

    const hint = document.createElement("span");
    hint.className = "vibe-edit-composer-hint";
    hint.textContent = "What do you want to change?";

    header.appendChild(label);
    header.appendChild(hint);

    const input = document.createElement("textarea");
    input.className = "vibe-edit-composer-input";
    input.rows = 3;
    input.placeholder = "e.g. make the background green and increase the padding";

    const footer = document.createElement("div");
    footer.className = "vibe-edit-composer-footer";

    const autoRow = document.createElement("div");
    autoRow.className = "vibe-edit-composer-auto-row";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.id = "vibe-edit-auto-apply";
    checkbox.className = "vibe-edit-composer-checkbox";

    const autoLabel = document.createElement("label");
    autoLabel.htmlFor = "vibe-edit-auto-apply";
    autoLabel.className = "vibe-edit-composer-checkbox-label";
    autoLabel.textContent = "Apply automatically";

    autoRow.appendChild(checkbox);
    autoRow.appendChild(autoLabel);

    const shortcuts = document.createElement("span");
    shortcuts.className = "vibe-edit-composer-shortcuts";
    shortcuts.textContent = "Enter to send · Shift+Enter for new line · Esc to skip";

    const button = document.createElement("button");
    button.className = "vibe-edit-composer-button";
    button.type = "button";
    button.textContent = "Send";

    footer.appendChild(autoRow);
    footer.appendChild(shortcuts);
    footer.appendChild(button);

    composer.appendChild(header);
    composer.appendChild(input);
    composer.appendChild(footer);

    document.body.appendChild(backdrop);
    document.body.appendChild(composer);

    requestAnimationFrame(() => {
      backdrop.classList.add("vibe-edit-backdrop-visible");
      composer.classList.add("vibe-edit-composer-visible");
    });

    const dismiss = (send) => {
      if (send) {
        payload.instruction = input.value.trim();
        payload.autoApply = checkbox.checked;
      } else {
        payload.autoApply = false;
      }
      removeInstructionComposer();
      dispatchPayload(payload);
    };

    const finish = () => dismiss(true);

    button.addEventListener("click", finish);
    backdrop.addEventListener("click", () => dismiss(false));

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        finish();
      }
      if (e.key === "Escape") {
        e.preventDefault();
        dismiss(false);
      }
    });

    input.focus();
  }

  function removeInstructionComposer() {
    document.querySelector(".vibe-edit-backdrop")?.remove();
    document.querySelector(".vibe-edit-composer")?.remove();
  }

  // ---------------------------------------------------------------------
  // WebSocket send with clipboard fallback — PRD §6.3
  // ---------------------------------------------------------------------

  function dispatchPayload(payload) {
    if (bridgeAvailable === false) {
      copyToClipboard(payload);
      return;
    }

    const autoApply = payload.autoApply === true;
    let settled = false;
    const ws = new WebSocket(BRIDGE_URL);

    const failToClipboard = () => {
      bridgeAvailable = false;
      copyToClipboard(payload);
    };

    const connectTimeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        try {
          ws.close();
        } catch (_) {
          /* noop */
        }
        failToClipboard();
      }
    }, BRIDGE_CONNECT_TIMEOUT_MS);

    ws.addEventListener("open", () => {
      if (settled) return;
      clearTimeout(connectTimeout);
      bridgeAvailable = true;
      ws.send(JSON.stringify(payload));

      if (!autoApply) {
        settled = true;
        ws.close();
        showToast("Sent to bridge ✓");
        return;
      }

      showToast("Applying…", { persistent: true, applying: true });

      const applyTimeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        try {
          ws.close();
        } catch (_) {
          /* noop */
        }
        showToast("Failed — see bridge terminal (timeout)");
      }, AUTO_APPLY_TIMEOUT_MS);

      ws.addEventListener("message", (event) => {
        if (settled) return;
        let msg;
        try {
          msg = JSON.parse(event.data);
        } catch (_) {
          return;
        }
        if (msg?.type !== "apply_result") return;

        settled = true;
        clearTimeout(applyTimeout);
        try {
          ws.close();
        } catch (_) {
          /* noop */
        }

        if (msg.ok) {
          showToast("Applied ✓");
        } else if (msg.skipped) {
          showToast(
            msg.message || "Auto-apply skipped — edit queued for manual review"
          );
        } else {
          const detail = msg.message ? `: ${msg.message}` : "";
          showToast(`Failed — see bridge terminal${detail}`);
        }
      });
    });

    ws.addEventListener("error", () => {
      if (settled) return;
      settled = true;
      clearTimeout(connectTimeout);
      failToClipboard();
    });
  }

  function copyToClipboard(payload) {
    const text = formatPromptText(payload);
    navigator.clipboard
      .writeText(text)
      .then(() => {
        showToast("Copied to clipboard (bridge not running)");
      })
      .catch(() => {
        showToast("Could not access clipboard — see console for prompt text");
        // eslint-disable-next-line no-console
        console.log("[vibe-edit] prompt:\n" + text);
      });
  }

  // ---------------------------------------------------------------------
  // Prompt formatting — PRD §6.6
  //
  // IMPORTANT: this function is intentionally duplicated in
  // vibe-edit-bridge/src/formatPrompt.js. The two packages have no shared
  // build step in v1, so keep both copies byte-for-byte identical when
  // editing. See PRD §6.6.
  // ---------------------------------------------------------------------

  function formatPromptText(payload) {
    const classesStr = payload.classes.length
      ? payload.classes.join(" ")
      : "(none)";
    const textPreview = (payload.text || "").slice(0, 80);
    const instruction =
      payload.instruction && payload.instruction.length > 0
        ? payload.instruction
        : "[Edit this line with what you want changed — e.g. \"Make the background green and increase the padding.\"]";

    const lines = [
      `## Edit request — ${payload.tag} element`,
      "",
      `**What it is:** ${payload.tag} element with text "${textPreview}"`,
      `**Location on page:** ${payload.selector}`,
      `**Classes:** ${classesStr}`,
    ];

    if (payload.id) {
      lines.push(`**ID:** ${payload.id}`);
    }

    if (payload.attributes && (payload.attributes.href || payload.attributes.src)) {
      const attrBits = [];
      if (payload.attributes.href) attrBits.push(`href="${payload.attributes.href}"`);
      if (payload.attributes.src) attrBits.push(`src="${payload.attributes.src}"`);
      lines.push(`**Attributes:** ${attrBits.join(", ")}`);
    }

    lines.push(
      `**Current style:** color ${payload.computedStyle.color}, background ${payload.computedStyle.backgroundColor}, font-size ${payload.computedStyle.fontSize}, padding ${payload.computedStyle.padding}`
    );

    if (payload.boundingRect) {
      const r = payload.boundingRect;
      lines.push(
        `**Bounding box:** x=${r.x}, y=${r.y}, width=${r.width}, height=${r.height}`
      );
    }

    if (payload.sourceHints && payload.sourceHints.fileName) {
      const { fileName, lineNumber, columnNumber, matchedVia } = payload.sourceHints;
      const loc = lineNumber
        ? `${fileName}:${lineNumber}${columnNumber ? `:${columnNumber}` : ""}`
        : fileName;
      lines.push(`**Likely source location:** ${loc} (via ${matchedVia})`);
    } else if (payload.sourceHints && payload.sourceHints.componentName) {
      lines.push(
        `**Likely component:** <${payload.sourceHints.componentName} /> (via ${payload.sourceHints.matchedVia} — exact file/line not available; search for this component name)`
      );
    }

    lines.push(`**Page:** ${payload.pageUrl}`);
    lines.push("");
    lines.push(
      "Note: this element may be one of several rendered instances of a shared/looped component. If your search matches more than one location in source, use the bounding box, attributes, and surrounding text to pick the correct one — don't guess silently."
    );
    lines.push("");
    lines.push(`**Instruction:** ${instruction}`);

    return lines.join("\n");
  }

  // ---------------------------------------------------------------------
  // Toast UI — PRD §6.5
  // ---------------------------------------------------------------------

  function showToast(message, opts = {}) {
    const existing = document.querySelector(".vibe-edit-toast");
    if (existing) existing.remove();

    const toast = document.createElement("div");
    toast.className = "vibe-edit-toast";
    if (opts.applying) {
      toast.classList.add("vibe-edit-toast-applying");
    }
    toast.textContent = message;
    document.body.appendChild(toast);

    requestAnimationFrame(() => {
      toast.classList.add("vibe-edit-toast-visible");
    });

    if (!opts.persistent) {
      setTimeout(() => {
        toast.classList.remove("vibe-edit-toast-visible");
        setTimeout(() => toast.remove(), 200);
      }, 2500);
    }

    return toast;
  }
})();
