# Implementation Plan: Source-Location Signals (Tier 0 + Tier 1) and Tier 2 Guidance

**Status:** Draft
**Relation to prior docs:** Extends `documentation/auto-apply-plan.md`.
Addresses the gap noted in PRD §9 ("Source-map-based file:line resolution
for React/Next.js... deliberately deferred") for the OSS case: Visidi runs
against arbitrary third-party codebases we don't control, so we can't
assume any particular build setup. This plan covers what we can infer at
runtime with zero setup burden on the user (Tier 0/1), plus a guardrail so
auto-apply degrades safely instead of blind-editing unfamiliar code, and
documents the opt-in path (Tier 2) for users who want maximum accuracy.

---

## Tier 0 — framework-agnostic prompt enrichment

**Problem:** `content.js` already captures `id`, `attributes.href/src`, and
`boundingRect` on every click ([content.js:147-171](../vibe-edit-extension/content.js)),
but `formatPrompt` discards all three before the agent ever sees them
([formatPrompt.js:10-31](../vibe-edit-bridge/src/formatPrompt.js)). These
fields cost nothing to include and help disambiguate repeated/shared
components even when no source-location signal is found.

**Changes:**
- `vibe-edit-bridge/src/formatPrompt.js` and the duplicate
  `formatPromptText` in `vibe-edit-extension/content.js` (keep both
  byte-identical, per the existing convention noted in both files' header
  comments) — add lines for `id` (if present), `href`/`src` (if present),
  and `boundingRect` (position + size).
- Add a fixed disambiguation instruction to the prompt, always present:
  > "Note: this element may be one of several rendered instances of a
  > shared/looped component. If your search matches more than one
  > location in source, use the bounding rect, attributes, and
  > surrounding text to pick the correct one — don't guess silently."
- No payload schema change — these fields already exist on the payload;
  `isValidPayload` in `server.js` doesn't need updates since they stay
  optional.
- Check `scripts/test-bridge-queue.js` for any exact-string assertions on
  formatted output and update if needed.

This tier is low-risk and worth shipping regardless of Tier 1's outcome.

---

## Tier 1 — zero-config runtime feature detection

**Idea:** at click time, before sending the payload, run a handful of
independent "probes" against the clicked element. Each probe tries to
read source metadata that frameworks *already* expose in dev mode for
their own DevTools/inspector integrations. No setup required from the
end user — if a probe finds nothing, it returns null and we fall back to
Tier 0 only.

### Probes (in `vibe-edit-extension/content.js`)

1. **React Fiber `_debugSource`** — find the `__reactFiber$*`-prefixed key
   on the element, walk up via `.return` to the nearest fiber with a
   `_debugSource` (`fileName`, `lineNumber`, `columnNumber`). Present in
   many webpack/CRA dev builds; often absent under Vite+SWC, where the
   dev JSX transform may not preserve it — confidence: **high** when
   found (exact file:line).

2. **React DevTools global hook** — `window.__REACT_DEVTOOLS_GLOBAL_HOOK__`,
   locate the renderer for the page, get the fiber for the element, walk
   up to the nearest fiber whose `type` has a name (component display
   name). No exact line, but narrows "search the repo" to "search for
   this component" — confidence: **medium**.

3. **Known inspector-plugin attributes** — walk up from the element
   checking ancestor attributes for markers already injected by popular
   click-to-source dev plugins (e.g. `vite-plugin-vue-inspector`-style
   `data-v-inspector="file:line:col"`, or `react-dev-inspector`-style
   `data-inspector-*` attributes). **Exact attribute names/format need to
   be verified against each plugin's current source/docs before coding**
   — don't hardcode from memory. Only relevant if the user already has
   one of these installed — confidence: **high** when found.

4. **Next.js dev overlay markers** — best-effort check for any
   `data-nextjs-*` hints on the element/ancestors. Low expected yield;
   treat as a stretch probe, not a relied-upon source.

5. **Structural fallback (implemented during build)** — if none of the
   above match *and* there's no sign a JS framework is rendering the page
   at all (no React fiber anywhere on the page, no known SPA root marker
   like `[data-reactroot]`/`#__next`/`[data-v-app]`/`[ng-version]`), the
   page is most likely plain static HTML, where the structural selector
   genuinely is the source. Tags this as **medium** confidence rather
   than falling all the way to `"none"`. Without this, the guardrail
   below would skip auto-apply on every plain-HTML page (including the
   `examples/mock-landing` test fixture) — the one case the structural
   selector was always reliable for. Genuinely unknown/undetected
   frameworks still fall through to `"none"`, which is the safe direction
   to be wrong in.

All probes must be wrapped in try/catch and never throw — we're reaching
into framework internals that can change shape between versions, and a
probe failure must never break element picking itself.

### Payload/prompt changes

- Probe results collected into `payload.sourceHints` (only populated
  fields included; omitted entirely if every probe returns null) and a
  `payload.sourceConfidence` of `"high"`, `"medium"`, or `"none"`.
- `formatPrompt` adds a line when hints exist, e.g.:
  - High: `**Likely source location:** src/components/Card.tsx:42 (via React debug source)`
  - Medium: `**Likely component:** <Card /> (via React DevTools — exact file/line not available; search for this component name)`

### Guardrail tied into auto-apply

This is the actual safety property this plan exists for: **never let
auto-apply blind-edit a stranger's unfamiliar codebase on a pure
text-grep guess.**

- In `server.js`, before calling `applyEditViaClaude`: if
  `payload.autoApply === true` and `payload.sourceConfidence === "none"`,
  skip the `claude` spawn entirely. Still write to `queue.md` (unchanged
  audit-trail behavior), then `sendApplyResult(ws, false, "Auto-apply skipped — no reliable source location found for this element; edit queued in .vibe-edits/queue.md for manual review.")`.
- Extension toast should render this distinctly from a real failure
  (e.g. neutral/info styling, not an error red) — it's a policy decision,
  not something broken.
- **Open question:** should `"medium"` confidence (component name only,
  no exact line) also be downgraded, or allowed through with a
  medium-confidence note in the prompt so the agent self-verifies before
  editing? Leaning toward **allow medium through** — a component name is
  a real, useful steer, and the existing Tier 0 disambiguation instruction
  already tells the agent to check rather than guess. Only `"none"`
  forces the downgrade. Confirm before implementing.

### File-by-file changes

- `vibe-edit-extension/content.js` — add probe functions, wire into
  `captureElement`, mirror prompt changes into `formatPromptText`.
- `vibe-edit-bridge/src/formatPrompt.js` — mirror Tier 0 + Tier 1 prompt
  changes exactly (byte-identical, per existing convention).
- `vibe-edit-bridge/src/server.js` — read `payload.sourceConfidence`,
  apply the guardrail before calling `applyEditViaClaude`.
- `vibe-edit-bridge/src/applyEdit.js` — no change; guardrail branching
  stays in `server.js` next to the existing `autoApply` branch, not
  inside `applyEdit.js`.

---

## Tier 2 — documented opt-in integration (no code)

For users who want maximum accuracy and are willing to add a dev
dependency, document (in `vibe-edit-extension/README.md` or the root
`README.md`, under a new "Improving accuracy on component frameworks"
section) that Visidi's Tier 1 probes will pick up attributes from
existing click-to-source tooling if already installed:

- **Vite + Vue:** `vite-plugin-vue-inspector` (or Vue DevTools' inspector
  feature) — injects per-element source attributes that Tier 1 probe #3
  reads.
- **Vite/webpack + React:** `react-dev-inspector` or equivalent — same
  mechanism.
- **Next.js:** newer versions ship a built-in dev overlay with an
  Option/Alt+Click "open in editor" feature. Visidi doesn't need to
  integrate with this directly (it's not a DOM attribute we can read),
  but it's worth telling users it exists as an alternative when Visidi's
  own source detection comes back empty.

Framing for the docs: these plugins are dev-only with no production
impact, Visidi never requires them, and installing one is purely an
accuracy upgrade — the tool keeps working without them, just falling
back to Tier 0's grep-and-disambiguate behavior.

---

## Summary of what ships as code vs. docs

| Tier | Type | Files touched |
|------|------|----------------|
| 0 | Code | `formatPrompt.js`, `content.js` (mirror) |
| 1 | Code | `content.js`, `formatPrompt.js`, `server.js` |
| 2 | Docs only | `vibe-edit-extension/README.md` or root `README.md` |
