# PRD: Visual Element Picker → Coding Agent Bridge

**Status:** Draft for implementation
**Owner:** Brendan Beh (AI.SEA)
**Audience:** Implementing engineer / Codex agent
**Last updated:** 2026-06-25

---

## 1. Problem Statement

Workshop participants ("vibe coders") build sites with Claude Code / Codex but get stuck when they want to make a small visual change ("make this button bigger", "change this text"). They don't know how to describe the element in words precisely enough to prompt the agent effectively, and they don't know how to locate it in the codebase.

We want a tool that lets someone **click an element in their running local site** (plain HTML via `file://` or `localhost`, or a Next.js/Vite dev server) and have a well-formed, accurate edit prompt land somewhere the coding agent can act on — without the user needing to write the prompt by hand or know any selector/file-mapping concepts.

## 2. Goals

- User can click any element in their locally-rendered site and capture a structured description of it.
- That description is delivered to a local bridge process over WebSocket.
- The bridge process formats it into an agent-ready prompt and writes it to a queue file in the project directory.
- Works across plain static HTML and React/Next.js/Vite dev servers without needing build-time instrumentation (no source maps, no babel plugin, in v1).
- Graceful degradation: if the bridge isn't running, the extension still works via clipboard copy.

## 3. Non-Goals (v1)

- No drag-to-resize or visual style editing — capture intent, not pixel manipulation.
- No automatic file:line source mapping (would require framework-specific build plugins — out of scope, see §9 Future Work).
- No direct CLI invocation of `claude` / `codex` from the bridge — v1 only writes a file; the user still manually tells their agent to check it.
- No multi-user / remote / hosted scenario — single local user, single local machine only.
- No support for Safari or Firefox in v1 — Chrome (Manifest V3) only.

## 4. Users & Context

Workshop participants are non-engineers or early-career builders. Assume:
- They can install a Chrome extension from an unpacked folder (workshop facilitator walks them through this) or eventually the Chrome Web Store.
- They can run one terminal command to start the bridge.
- They should **never** need to read JSON, edit config, or understand WebSockets.

---

## 5. System Architecture

```
┌─────────────────────┐         ┌──────────────────────┐
│   Browser Extension   │  WS    │   Local Bridge (CLI)   │
│  (content script runs │ <----> │   Node.js process      │
│  on the page itself)  │ :4017  │  ws://localhost:4017   │
└─────────────────────┘         └──────────┬───────────┘
                                              │ writes
                                              ▼
                                  project_root/.vibe-edits/queue.md
                                              │
                                              ▼
                                  User tells Claude Code / Codex:
                                  "check .vibe-edits/queue.md"
```

Two independent deliverables:

1. **`vibe-edit-extension/`** — Chrome Manifest V3 extension
2. **`vibe-edit-bridge/`** — Node.js CLI package (the WebSocket server + file writer)

These ship as separate packages in the same repo. The extension has zero dependency on the bridge at install time — it must function (via clipboard fallback) with the bridge absent.

---

## 6. Component 1: Browser Extension

### 6.1 Manifest

Manifest V3. Key requirements:

- `content_scripts` matching `<all_urls>` is too broad and will prompt scary permission warnings; scope to:
  - `http://localhost/*`
  - `http://127.0.0.1/*`
  - `file:///*` (requires the user to manually enable "Allow access to file URLs" in `chrome://extensions` — there is no manifest flag that grants this automatically; **the extension popup must detect and surface this** — see §6.5)
- `permissions`: `["activeTab", "scripting", "clipboardWrite"]`
- `host_permissions`: `["http://localhost/*", "http://127.0.0.1/*", "file:///*"]`
- No `background` persistent script — use a content-script-resident WebSocket client (rationale: MV3 service workers unload after ~30s idle and will drop the socket; see §6.3).

### 6.2 Activation / "Pick Mode"

- Toolbar icon click toggles pick mode on/off for the active tab (send a message from popup → content script).
- Default state: off. Workshop users should not have hover-highlight running constantly.
- While pick mode is on:
  - `mouseover` listener outlines the hovered element with a fixed 2px outline (use a CSS class injected via a `<style>` tag the content script controls — do not use inline `style` attributes, to avoid mutating the user's actual page state).
  - `click` listener on the highlighted element: `preventDefault()` + `stopPropagation()` (critical — without this, clicking a button in pick mode will also trigger the button's real on-page behavior, e.g. navigation or form submit), then run the capture routine (§6.4), then turn pick mode off automatically after a successful capture (one-shot per activation — re-toggle to pick another element).
- Esc key exits pick mode without capturing.

### 6.3 WebSocket Client (lives in content script, not background)

Rationale documented for whoever implements this: content scripts persist for the lifetime of the page/tab, unlike MV3 background service workers which the browser aggressively suspends. Putting the socket here avoids reconnect-on-every-message complexity.

Behavior:
- On pick-mode activation, attempt `new WebSocket('ws://localhost:4017')`.
- 1 second connection timeout. If it fails or errors, set an internal `bridgeAvailable = false` flag and silently fall back to clipboard for this and all subsequent captures in this tab session (don't retry on every click — retry once per new pick-mode activation, not per element captured).
- If connected, send the JSON payload (§6.4) as a single `ws.send(JSON.stringify(payload))` and close the socket immediately after — no need to keep it open between captures, each capture is a fresh short-lived connection. This sidesteps reconnection-state-management entirely and is simpler than keeping a long-lived socket.
- On successful send: show a toast (§6.5) confirming "Sent to bridge."
- On failure or no bridge: copy the formatted prompt text (§6.4's human-readable rendering, not the raw JSON) to clipboard via `navigator.clipboard.writeText()`, and show a toast "Bridge not running — copied to clipboard instead."

### 6.4 Element Capture — Data Captured & Payload Shape

On click of the selected element, gather:

| Field | How to obtain | Notes |
|---|---|---|
| `selector` | Build a CSS selector path from element up to `body`, using tag + `:nth-child(n)` at each level, only adding class/id if unique enough to shorten the path | Don't rely on auto-generated framework classes alone (e.g. CSS modules hashes) — they're meaningless to the agent reading the prompt. Always include the structural nth-child path as the reliable fallback. |
| `tag` | `element.tagName.toLowerCase()` | |
| `classes` | `Array.from(element.classList)` | |
| `id` | `element.id \|\| null` | |
| `text` | `element.textContent.trim()`, truncate to 200 chars | If empty, fall back to nearest non-empty parent/sibling text for context (helps disambiguate icon-only buttons) |
| `computedStyle` | `getComputedStyle(element)`, but only pull a curated subset: `color`, `backgroundColor`, `fontSize`, `fontWeight`, `padding`, `margin`, `width`, `height`, `display`, `borderRadius` | Pulling the entire computed style object is noisy and will bloat the prompt — curated subset only. |
| `attributes` | `href` and `src` if present (for links/images) | |
| `boundingRect` | `element.getBoundingClientRect()` → `{x, y, width, height}` rounded to integers | For context only, not for pixel-perfect edits in v1 |
| `pageUrl` | `window.location.href` | |
| `timestamp` | `Date.now()` | |
| `screenshot` | **Out of scope for v1** — see §9 Future Work | `chrome.tabs.captureVisibleTab` requires background-script/activeTab coordination that conflicts with the content-script-only architecture in §6.3. Cut for v1 to keep scope tight; revisit if prompt quality without it proves insufficient. |

Payload shape sent over the socket:

```json
{
  "type": "element_selected",
  "selector": "main > section.hero > div:nth-child(2) > button:nth-child(1)",
  "tag": "button",
  "id": null,
  "classes": ["bg-blue-500", "px-4", "py-2", "rounded"],
  "text": "Get Started",
  "attributes": {},
  "computedStyle": {
    "color": "rgb(255, 255, 255)",
    "backgroundColor": "rgb(59, 130, 246)",
    "fontSize": "16px",
    "fontWeight": "600",
    "padding": "8px 16px",
    "margin": "0px",
    "width": "120px",
    "height": "40px",
    "display": "inline-block",
    "borderRadius": "6px"
  },
  "boundingRect": { "x": 480, "y": 320, "width": 120, "height": 40 },
  "pageUrl": "http://localhost:3000/",
  "timestamp": 1719300000000
}
```

### 6.5 UI Feedback (toast + permission nudge)

- Toast: a small fixed-position div injected by the content script (top-right, auto-dismiss after ~2.5s). Do not use `alert()` — it's blocking and breaks the workflow.
- Toast states needed: "Pick an element…" (on activation), "Sent to bridge ✓", "Copied to clipboard (bridge not running)", "Copied to clipboard ✓".
- `file://` permission nudge: on extension load, check `chrome.extension.isAllowedFileSchemeAccess()` (callback-based API). If `false` and the active tab's URL starts with `file://`, show the popup with a message + link to `chrome://extensions/?id=<own-extension-id>` instructing the user to toggle "Allow access to file URLs." This is the single most likely workshop support issue — document it clearly in the extension's own popup, not just in a README.

### 6.6 Prompt Formatting (clipboard fallback path)

When falling back to clipboard, format the payload into human-readable text (not raw JSON) — this is also the template the bridge should use when writing to the queue file, so write this formatting function once and treat it as shared logic between extension and bridge (duplicate the function in both codebases for v1 since they're separate packages with no shared build step; keep them byte-for-byte identical and note this duplication in code comments so future edits update both).

Template:

```
## Edit request — <tag> element

**What it is:** <tag> element with text "<text>" (truncated to ~80 chars in the prompt itself)
**Location on page:** <selector>
**Classes:** <classes joined by space, or "(none)">
**Current style:** color <computedStyle.color>, background <computedStyle.backgroundColor>, font-size <computedStyle.fontSize>, padding <computedStyle.padding>
**Page:** <pageUrl>

**Instruction:** [Edit this line with what you want changed — e.g. "Make the background green and increase the padding."]
```

The `**Instruction:**` line ships with a placeholder — the user is expected to fill in or speak their actual intent. v1 does not capture voice/text intent from the click itself (see §9 Future Work re: a small input box prompt on capture).

**Revision based on usability — this should not ship with a placeholder the user has to dig for.** After capture (whether bridge-sent or clipboard), immediately show a small inline text input in the toast itself ("What do you want to change?") before finalizing the prompt. If the user dismisses without typing, fall back to the placeholder text above. This one input field is the only required UI surface beyond the toast — keep it minimal, no rich text, no modal.

---

## 7. Component 2: Bridge CLI

### 7.1 Distribution & Install

- Node.js package, published as `vibe-edit-bridge` (or run via `npx vibe-edit-bridge` without global install — prefer `npx` for the workshop so there's no install step to forget).
- User runs it from their project root: `npx vibe-edit-bridge`
- On start, prints: `Bridge running on ws://localhost:4017 — writing to .vibe-edits/queue.md in <cwd>`

### 7.2 Responsibilities

1. Start a WebSocket server (use the `ws` npm package — do not hand-roll the WebSocket protocol) on port `4017`.
2. Port handling: if `4017` is taken, try `4018`, `4019`... up to `4020`, and print whichever port it actually bound to. **The extension currently hardcodes `4017` (§6.3) — this is a known v1 limitation.** Document this explicitly as a follow-up (see §9); for v1, if the bridge can't bind `4017` specifically, print a clear error telling the user to free the port rather than silently using a different one the extension can't find.
3. On receiving a message: parse JSON, validate it has `type: "element_selected"` and the expected fields (reject/log malformed payloads rather than crashing).
4. Format the payload using the same template as §6.6 (the instruction line, if the extension sent one via the inline input, will be populated; substitute the placeholder only if missing).
5. Append (not overwrite) the formatted block to `<cwd>/.vibe-edits/queue.md`, creating the directory/file if absent, separated by `---` between entries, most recent entry at the **bottom** (chronological order — easier for the agent to follow "do these in order" if multiple edits queue up before the user checks in).
6. Print a one-line confirmation to the terminal on each received edit, e.g. `[12:04:01] Queued edit: button "Get Started" — .vibe-edits/queue.md`.

### 7.3 Error Handling

- If `.vibe-edits/` can't be created (permissions issue) — print a clear error, don't crash the server (keep listening; user can fix permissions and the next message will retry the write).
- If the process receives `SIGINT` (Ctrl+C), close the WebSocket server cleanly before exiting.
- Malformed JSON from a client → log a warning with the raw payload truncated to 200 chars, don't crash.

### 7.4 Suggested File Layout

```
vibe-edit-bridge/
  package.json       (bin entry pointing to cli.js, deps: "ws")
  cli.js              (entry point — starts server, handles SIGINT)
  src/
    server.js         (WebSocket server setup + message handling)
    formatPrompt.js    (the template from §6.6 — kept in sync with extension's copy)
    writeQueue.js      (append-to-file logic, directory creation)
  README.md           (npx usage, troubleshooting port-in-use)
```

---

## 8. Acceptance Criteria

- [ ] Extension loads unpacked in Chrome, works on a `localhost:3000` Next.js dev server and on a `file:///path/to/index.html` page (after file-URL permission is granted).
- [ ] Clicking the toolbar icon enters pick mode; hovering elements shows a visible outline; clicking one exits pick mode and triggers capture.
- [ ] Clicking a real `<button>` or `<a>` in pick mode does **not** trigger its native behavior (no navigation, no form submit).
- [ ] With the bridge running, a captured element appends a correctly formatted entry to `.vibe-edits/queue.md` in the directory the bridge was started from.
- [ ] With the bridge **not** running, capture still succeeds and copies a correctly formatted prompt to the clipboard, with a toast explicitly telling the user this happened.
- [ ] Bridge survives malformed input, port conflicts (within the 4017–4020 retry range), and Ctrl+C without crashing or corrupting `queue.md`.
- [ ] A user with zero WebSocket/JSON knowledge can go from "click toolbar icon" to "pasted/queued prompt" without seeing any raw JSON or error stack traces.

---

## 9. Future Work (explicitly out of scope for this implementation pass)

- Screenshot capture per element (needs `activeTab` + background-script coordination, cut in §6.4).
- Dynamic port negotiation so the extension doesn't hardcode `4017` (e.g. bridge writes its actual port to a well-known local file or the extension tries a small port range too).
- Direct CLI invocation of `claude`/`codex` from the bridge instead of a queue file the user manually points the agent at. *(Partially delivered in v2: opt-in `claude` auto-apply via `documentation/auto-apply-plan.md`; Codex/multi-agent still out of scope.)*
- Source-map-based file:line resolution for React/Next.js (would require a Babel/SWC plugin injecting `data-source` attributes — a materially larger project, deliberately deferred).
- Drag-based resize/reposition with CSS/Tailwind class inference.
- Packaging the extension for the Chrome Web Store (v1 is unpacked/workshop-distributed only).

---

## 10. Open Questions for Implementer

These were deliberately left for whoever builds this to decide, since they don't affect architecture:

1. Exact visual styling of the hover outline and toast (color, animation) — use AI.SEA brand neutral styling, doesn't need to match brand precisely for an internal workshop tool.
2. Whether the inline "what do you want to change?" input (§6.6 revision) appears as part of the toast itself or a tiny separate floating box — implementer's call based on what's easiest to ship cleanly in a content script without a build pipeline (no React/bundler assumed for the extension — plain JS + DOM APIs is fine and keeps this dependency-free).

---

## 11. Scaffold — Starter Files Provided

A working scaffold for both packages ships alongside this PRD. This is **not** placeholder/pseudocode — the bridge half has been run end-to-end (WebSocket server started, a real client payload sent, `.vibe-edits/queue.md` inspected for correct output, malformed-JSON and wrong-shape payloads sent to confirm the server logs a warning and keeps running rather than crashing). The extension half has been syntax-checked (`node --check`) but **not** loaded in an actual Chrome browser — that verification step is left for the implementer, since it requires a real browser session.

### 11.1 What's implemented and verified

- `vibe-edit-bridge/` — full implementation of §7. `cli.js` starts the server, retries ports 4017–4020, warns clearly if it falls back off 4017, and shuts down cleanly on `Ctrl+C`. `src/server.js` validates incoming payloads and rejects malformed ones without crashing (verified). `src/writeQueue.js` creates `.vibe-edits/` and appends correctly formatted, `---`-separated entries in chronological order (verified). `src/formatPrompt.js` implements the exact template from §6.6.
- `vibe-edit-extension/` — full implementation of §6. `manifest.json` scoped to `localhost`/`127.0.0.1`/`file://` per §6.1. `content.js` implements pick mode, the nth-child selector builder, curated computed-style capture, the WebSocket-with-clipboard-fallback dispatch logic from §6.3, and the inline instruction-capture toast from the §6.6 revision. `popup.js` implements the `file://` permission detection and nudge from §6.5.

### 11.2 What's intentionally left for the implementer

- **Real icon assets** — `icons/` contains a README noting that `icon16.png` / `icon48.png` / `icon128.png` are referenced by `manifest.json` but not provided. Any placeholder square PNGs unblock loading; not a functional issue.
- **Loading and testing in an actual Chrome browser** — confirm pick mode, hover outline, click capture, and the clipboard fallback all behave as expected against a real Next.js dev server and a real `file://` HTML page. This is the main remaining verification gap before workshop use.
- **Confirming `e.preventDefault()` / `e.stopPropagation()` actually suppresses native behavior** on real interactive elements (links navigating, buttons submitting forms) — implemented per §6.2/§8 but only verifiable in a live browser, not via `node --check`.

### 11.3 File tree as delivered

```
vibe-edit-extension/
  manifest.json
  content.js
  content.css
  popup.html
  popup.js
  icons/
    README.txt        (placeholder note — see §11.2)

vibe-edit-bridge/
  package.json
  cli.js
  README.md
  src/
    server.js
    formatPrompt.js
    writeQueue.js
```

### 11.4 Quick verification commands (for the implementer to re-run after any changes)

```bash
# Bridge: install + syntax/runtime smoke test
cd vibe-edit-bridge && npm install
node cli.js   # in one terminal — should print "Running on ws://localhost:4017..."

# Extension: syntax check (does not substitute for loading in Chrome)
cd vibe-edit-extension && node --check content.js && node --check popup.js
```

To load the extension for real browser testing: `chrome://extensions` → enable Developer Mode → "Load unpacked" → select the `vibe-edit-extension/` folder → if testing against a `file://` page, also enable "Allow access to file URLs" for this extension.
