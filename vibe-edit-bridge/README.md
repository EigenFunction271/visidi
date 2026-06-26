# visidi-bridge

Local WebSocket bridge for the Visidi browser extension. Receives element
captures from the extension and appends agent-ready edit prompts to
`.vibe-edits/queue.md` in your project.

## Usage

From your project root (the directory you want `.vibe-edits/queue.md`
created in, and where source files live for auto-apply):

```
npx visidi-bridge
```

You should see:

```
[visidi-bridge] Running on ws://localhost:4017
[visidi-bridge] Queue file: /path/to/project/.vibe-edits/queue.md
```

Leave it running while you use the Visidi extension. Stop it any time with
`Ctrl+C`.

## Run bridge + dev server together (`--dev`)

Instead of two terminals, start your dev server alongside the bridge:

```
npx visidi-bridge --dev -- npm run dev
```

Everything after `--` is run as your dev command (output prefixed `[dev]`).
`Ctrl+C` stops both. If your dev server crashes unexpectedly, the bridge
shuts down too — restart `npx visidi-bridge --dev -- ...` to bring both back.

Drop the `-- <command>` part to auto-detect from `package.json`'s `"dev"`
script (falling back to `"start"`):

```
npx visidi-bridge --dev
```

If neither script exists, the bridge exits with an error listing the
scripts it found — pass an explicit `-- <command>` in that case.

## Queue-only (default) — use with Claude Code

Capture an element in the extension and send **without** checking
**Apply automatically**. The bridge appends a formatted prompt to
`.vibe-edits/queue.md`.

In a Claude Code session started from the same project root:

```
Read .vibe-edits/queue.md and apply the most recent edit request.
```

The live page does not change until Claude edits source files and you refresh.

See the root [README](../README.md#using-visidi-with-claude-code) for a full walkthrough.

## Auto-apply (opt-in)

Check **Apply automatically** in the extension before sending. The bridge
still writes `queue.md` (audit trail), then spawns the local `claude` CLI:

```
claude -p "<prompt>" --permission-mode acceptEdits
```

Requirements:

- `claude` must be on your `PATH` (Claude Code CLI installed and authenticated)
- Run the bridge from the **project root** you want edited (same `cwd` as queue file)
- Only one auto-apply runs at a time; a second request while busy is rejected

Watch the bridge terminal for `[claude]` output and a `git diff --stat`
summary after each run. Refresh your browser to see changes.

### Source-location hints (component frameworks)

On React pages, the extension makes a best-effort attempt to read dev-mode
source metadata directly off the clicked element (React's fiber debug
source, component name, or attributes from inspector plugins like
`vite-plugin-vue-inspector`/`react-dev-inspector` if installed) — see
`documentation/source-mapping-plan.md`. When found, the prompt includes a
`**Likely source location:**` or `**Likely component:**` line. When
nothing is found (`sourceConfidence: "none"`), **auto-apply is skipped
automatically** — the edit is still queued to `queue.md`, but the bridge
won't blind-edit an unfamiliar codebase on a pure text-grep guess. The
extension toast will say "Auto-apply skipped" rather than "Failed" in
that case.

## Publishing (maintainers)

From the **repo root**, not `examples/mock-landing/`:

```bash
cd vibe-edit-bridge
npm pack --dry-run    # confirm applyEdit.js is in the tarball
npm publish           # requires npm login; ships version from package.json
```

Then verify:

```bash
npx visidi-bridge@latest
```

Current published version: **0.2.0** (includes auto-apply).

## Troubleshooting

**"Could not bind any port in range 4017-4020"**
Something else on your machine is already using all four ports. Find and
stop whatever's bound to port 4017 (`lsof -i :4017` on macOS/Linux), then
restart the bridge. The extension only looks for the bridge on port 4017
in this version, so it won't find it on a fallback port even if one binds.

**Extension says "Copied to clipboard (bridge not running)" even though
the bridge is running**
Confirm the terminal output says it bound to port `4017` specifically (see
above) — if it fell back to 4018+, the extension won't see it.

**Auto-apply fails immediately (`spawn claude ENOENT`)**
Install Claude Code CLI and ensure `claude` is available in the same shell
environment where you run `npx visidi-bridge`.

**Permission errors creating `.vibe-edits/`**
Make sure you're running the bridge from a directory you have write access
to, and that there isn't a file (not a directory) already named
`.vibe-edits` in that folder.

**Bridge exits right after starting with `--dev`**
The dev process crashed (or failed to start, e.g. command not found) and
the bridge shut itself down with it — check the `[dev]`-prefixed output
just above the shutdown message for the actual error.

**`--dev` says "No dev or start script in package.json"**
Auto-detect only looks for `scripts.dev` / `scripts.start`. Use an
explicit command instead: `npx visidi-bridge --dev -- <your command>`.
