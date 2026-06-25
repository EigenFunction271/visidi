# Implementation Plan: Auto-Apply via Claude CLI

**Status:** Draft
**Relation to PRD:** Extends v1 (`documentation/PRD.md`). PRD §3 explicitly
lists "No direct CLI invocation of `claude`/`codex`" as a v1 non-goal — this
plan is the v2 follow-up that lifts that restriction, opt-in only.
**Scope:** Target `claude` CLI only. No multi-agent abstraction yet (see
"Out of scope" below).

---

## 1. Goal

Today: bridge appends a formatted prompt to `.vibe-edits/queue.md` and the
user manually tells Claude Code to read it. This plan adds an opt-in mode
where the bridge invokes the `claude` CLI directly to apply the edit,
with a confirmation step in the extension before anything runs.

## 2. Flow (target state)

```
Extension click → capture element → show "Auto-apply?" confirm in toast
   → user confirms → WS send (payload.autoApply = true)
   → bridge: write to queue.md (audit trail, unchanged)
   → bridge: spawn `claude -p "<prompt>" --permission-mode acceptEdits`
       in project cwd
   → bridge: stream stdout/stderr to bridge terminal
   → bridge: on exit, run `git diff --stat` and print it
   → bridge: send WS result message back to extension (success/failure)
   → extension: toast shows "Applied ✓" or "Failed — see bridge terminal"
```

If the bridge is unreachable, fall back exactly as today (clipboard copy) —
auto-apply has no meaning without the bridge, so no separate fallback path
needed there.

## 3. Changes by file

### `vibe-edit-extension/content.js`
- New confirm step before `dispatchPayload`: when pick mode captures an
  element, the existing instruction toast (`promptForInstructionThenSend`)
  gains a checkbox or second button — "Apply automatically" — alongside the
  current "Send" button. Plain "Send" keeps today's behavior (queue only).
- `payload.autoApply: boolean` added to the capture payload.
- `dispatchPayload` unchanged structurally; just passes the new field
  through. WS message shape gains `autoApply`.
- New listener for a result message coming back from the bridge
  (`{ type: "apply_result", ok, message }`) to update the toast from
  "Applying…" to "Applied ✓" / "Failed".

### `vibe-edit-bridge/src/server.js`
- `isValidPayload` allows the new optional `autoApply` boolean field.
- After `appendEditToQueue` resolves, if `payload.autoApply`, call new
  `applyEditViaClaude(payload, cwd)` (see below) instead of just logging
  "next step: tell your agent...".
- Send a WS response back to the *same client connection* with the result
  (extension keeps the socket open slightly longer for auto-apply instead
  of the current fire-and-forget close-after-send).

### `vibe-edit-bridge/src/applyEdit.js` (new)
```js
const { spawn } = require("child_process");
const { formatPrompt } = require("./formatPrompt");

function applyEditViaClaude(payload, cwd, { timeoutMs = 60_000 } = {}) {
  const prompt = formatPrompt(payload);
  return new Promise((resolve) => {
    const child = spawn(
      "claude",
      ["-p", prompt, "--permission-mode", "acceptEdits"],
      { cwd, stdio: ["ignore", "pipe", "pipe"] }
    );

    const timer = setTimeout(() => {
      child.kill();
      resolve({ ok: false, error: "timeout" });
    }, timeoutMs);

    child.stdout.on("data", (d) => process.stdout.write(`[claude] ${d}`));
    child.stderr.on("data", (d) => process.stderr.write(`[claude] ${d}`));

    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0 });
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ ok: false, error: err.message });
    });
  });
}

module.exports = { applyEditViaClaude };
```
- One run at a time: server.js holds a module-level `applyInFlight` flag/
  promise; a second auto-apply request while one is running is rejected
  immediately with `{ ok: false, error: "busy" }` rather than queued or
  run concurrently.
- After exit, run `git diff --stat` (best-effort, swallow errors if not a
  git repo) and log it — passive review surface even though edits already
  landed.

### `vibe-edit-bridge/cli.js`
- No new flag needed if auto-apply is per-request (driven by
  `payload.autoApply` from the extension) rather than a global bridge
  mode. This is simpler than a `--auto-apply` startup flag because it lets
  the user choose per-click instead of an all-or-nothing session.
  **Decision needed (§6).**

## 4. Safety controls

- **Confirm before send**, not just before apply — the extension checkbox
  is the only gate; no second confirmation in the bridge (keep one clear
  point of consent).
- **`--permission-mode acceptEdits`** (or equivalent restrictive flag) —
  edits only, no shell/bash tool use, no network tool use. Needs
  verifying against current `claude` CLI flag names before implementation.
- **Serialized execution** — never run two auto-applies concurrently in
  the same project.
- **Timeout** — kill the subprocess after 60s default, configurable later
  if needed.
- **Audit trail preserved** — `queue.md` entry is still written even when
  auto-apply succeeds, so there's always a record of what was requested.
- **Visible diff** — `git diff --stat` printed to the bridge terminal
  after every auto-apply run.

## 5. Out of scope (this plan)

- `--agent=codex` or any multi-agent abstraction — hardcode `claude` CLI
  invocation; revisit only if Codex support is actually needed.
- Undo/rollback UI — relying on the user's own git workflow to revert if
  an auto-applied edit is wrong.
- Auto-apply when the bridge falls back to clipboard mode — no bridge
  means no subprocess to spawn; clipboard fallback behavior is unchanged.

## 6. Open questions before coding

1. Per-click toggle (extension checkbox, payload field) vs. a bridge
   startup flag (`--auto-apply`, applies to every capture in the
   session)? Per-click is more granular and safer by default; a startup
   flag is simpler to implement. **Leaning per-click.**
2. Exact `claude` CLI non-interactive flags to use for permission
   scoping — needs checking against the installed CLI version rather than
   assumed.
3. What the extension should show while waiting for the result message
   (auto-apply could take much longer than the WS round-trip the toast
   timing currently assumes).
