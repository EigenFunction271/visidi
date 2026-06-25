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
    };
  }

  // ---------------------------------------------------------------------
  // Inline "what do you want to change?" capture — PRD §6.6 revision
  // ---------------------------------------------------------------------

  function promptForInstructionThenSend(payload) {
    const toast = showToast(`Selected <${payload.tag}> — what should change?`, {
      persistent: true,
    });

    const row = document.createElement("div");
    row.className = "vibe-edit-toast-input-row";

    const input = document.createElement("input");
    input.className = "vibe-edit-toast-input";
    input.type = "text";
    input.placeholder = "e.g. make the background green";

    const button = document.createElement("button");
    button.className = "vibe-edit-toast-button";
    button.textContent = "Send";

    const finish = () => {
      payload.instruction = input.value.trim(); // empty -> bridge/clipboard formatter uses placeholder text
      toast.remove();
      dispatchPayload(payload);
    };

    button.addEventListener("click", finish);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") finish();
      if (e.key === "Escape") {
        toast.remove();
        dispatchPayload(payload); // user dismissed — still send with empty instruction
      }
    });

    row.appendChild(input);
    row.appendChild(button);
    toast.appendChild(row);
    input.focus();
  }

  // ---------------------------------------------------------------------
  // WebSocket send with clipboard fallback — PRD §6.3
  // ---------------------------------------------------------------------

  function dispatchPayload(payload) {
    if (bridgeAvailable === false) {
      copyToClipboard(payload);
      return;
    }

    let settled = false;
    const ws = new WebSocket(BRIDGE_URL);
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        bridgeAvailable = false;
        try {
          ws.close();
        } catch (_) {
          /* noop */
        }
        copyToClipboard(payload);
      }
    }, BRIDGE_CONNECT_TIMEOUT_MS);

    ws.addEventListener("open", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      bridgeAvailable = true;
      ws.send(JSON.stringify(payload));
      ws.close(); // fresh short-lived connection per capture, see PRD §6.3
      showToast("Sent to bridge ✓");
    });

    ws.addEventListener("error", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      bridgeAvailable = false;
      copyToClipboard(payload);
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

    return [
      `## Edit request — ${payload.tag} element`,
      "",
      `**What it is:** ${payload.tag} element with text "${textPreview}"`,
      `**Location on page:** ${payload.selector}`,
      `**Classes:** ${classesStr}`,
      `**Current style:** color ${payload.computedStyle.color}, background ${payload.computedStyle.backgroundColor}, font-size ${payload.computedStyle.fontSize}, padding ${payload.computedStyle.padding}`,
      `**Page:** ${payload.pageUrl}`,
      "",
      `**Instruction:** ${instruction}`,
    ].join("\n");
  }

  // ---------------------------------------------------------------------
  // Toast UI — PRD §6.5
  // ---------------------------------------------------------------------

  function showToast(message, opts = {}) {
    const existing = document.querySelector(".vibe-edit-toast");
    if (existing) existing.remove();

    const toast = document.createElement("div");
    toast.className = "vibe-edit-toast";
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
