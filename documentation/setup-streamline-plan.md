# Implementation Plan: One-Command Activation (`visidi-bridge --dev`)

**Status:** Draft
**Relation to prior docs:** Standalone — doesn't touch auto-apply or
source-mapping behavior, just process orchestration around the existing
bridge. Addresses setup friction noted while reviewing `README.md`'s
walkthroughs (Quick start, Option A, Option B): activating Visidi today
needs 2–3 concurrent terminals.

## 1. Problem

Current required terminals, per the README walkthroughs
([README.md:121-156](../README.md), [README.md:162-181](../README.md)):

| Step | Terminal | Collapsible? |
|------|----------|---------------|
| Install Chrome extension | Browser (Web Store) | No — Chrome blocks programmatic extension install outside the Store flow |
| `npx visidi-bridge` | Terminal 1 | **Yes** — independent long-running process, no inherent reason to be separate from the dev server |
| `npm run dev` (user's app) | Terminal 2 | **Yes** — same as above |
| `claude` interactive session (Option A only) | Terminal 3 | No — this is the deliberate human-review checkpoint; collapsing it would mean either losing manual review or auto-spawning a terminal window, which is fragile across macOS/Linux/Windows and a bad fit for an OSS CLI |

So the only real lever is merging the bridge and the user's dev server
into one process group. For **Option B (auto-apply)** that takes setup to
a genuine one-liner, since `claude` is already invoked headlessly by the
bridge on each capture. For **Option A (queue + review)** it goes from
3 terminals to 2 — terminal 3 stays separate by design.

## 2. Design — `--dev` flag on `visidi-bridge`

```bash
npx visidi-bridge --dev "npm run dev"
```

- Optional, fully backward-compatible: omitting `--dev` behaves exactly
  as today.
- `cli.js` spawns the given command as a child process (`shell: true`,
  same `cwd` as the bridge) alongside the existing WebSocket server.
- Child stdout/stderr are piped and prefixed `[dev]` (mirrors the
  existing `[claude]` prefixing convention already used in
  [applyEdit.js:45-46](../vibe-edit-bridge/src/applyEdit.js)), so both
  processes' output is readable in one terminal.
- The existing `SIGINT` handler in
  [cli.js:62-67](../vibe-edit-bridge/cli.js) is extended to also kill the
  dev child before exiting, so `Ctrl+C` tears down both cleanly.
- If the dev child exits unexpectedly (crash) while the bridge is still
  running, log a clear warning (`[visidi-bridge] dev process exited with code N — bridge is still running, restart your dev server manually`)
  rather than tearing the bridge down too — a flaky dev-server crash
  shouldn't kill your capture queue.

### Optional auto-detect (stretch, confirm before building)

`--dev` with no value could read `cwd/package.json` and prefer
`scripts.dev`, falling back to `scripts.start`, running it via
`npm run <name>`. This needs to **stay opt-in via the explicit flag** —
i.e. you still have to type `--dev`, it just saves you from also typing
the command. If neither script exists, fail with a clear message listing
the scripts that *are* available rather than guessing further. Not
building this until the plain `--dev "<command>"` form is confirmed
useful — avoids speculative complexity for a guess that may not be needed.

## 3. File-by-file changes

- **`vibe-edit-bridge/cli.js`** — minimal manual argv parsing for `--dev`
  (no new dependency; the package's only current dependency is `ws`,
  consistent with keeping this lean). Spawn/track the dev child, wire
  into the existing `SIGINT` handler, prefix output.
- **`vibe-edit-bridge/README.md`** — add a "Run bridge + dev server
  together" section under Usage, with the `--dev` example.
- **Root `README.md`**:
  - Quick start §2–3 merge into one step: `npx visidi-bridge --dev "npm run dev"`.
  - Option A walkthrough: Terminal 1+2 merge; Terminal 3 (`claude`)
    unchanged, explicitly called out as staying separate.
  - Option B walkthrough: collapses to a single terminal — update the
    "Example session" block at [README.md:197-208](../README.md) to show
    one command instead of three.
  - Troubleshooting table: add a row for dev-child-crashed behavior.
- **`examples/mock-landing/README.md`** — update step 2/3 to optionally
  show `npx visidi-bridge --dev "npx --yes serve -p 3000 ."` as the
  one-line alternative to running them separately, keeping the existing
  two-terminal instructions as the explicit/explained version for anyone
  debugging.

## 4. What stays as-is, and why

- **Extension install** — manual, one-time, browser-side. No CLI lever
  exists here; not attempting to work around Chrome's Web Store
  installation restriction.
- **Option A's `claude` terminal** — kept manual. Auto-spawning a new
  terminal window per OS (AppleScript on macOS, Windows Terminal/`wt` on
  Windows, `gnome-terminal`/`x-terminal-emulator` on Linux, with no
  universal fallback) is exactly the kind of platform-specific
  automation that tends to break silently on someone's machine — not
  worth it for what's fundamentally a deliberate review pause, not
  incidental friction.

## 5. Open questions before coding

1. Confirm the flag name/shape: `--dev "npm run dev"` (single quoted
   string, shell-parsed) vs. `--dev -- npm run dev` (explicit separator,
   avoids quoting issues with complex commands). Leaning toward the
   quoted-string form for README readability; the `--` form is more
   robust for commands with their own flags.
2. Whether dev-child-crashed should be a warning (current proposal) or
   should optionally also shut down the bridge — leaning warning-only,
   confirm before building.
3. Whether the auto-detect stretch (§2) is worth building now or only
   after the plain `--dev "<command>"` form ships and gets used.
