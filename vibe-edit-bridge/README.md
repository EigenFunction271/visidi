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

## Queue-only (default)

Capture an element in the extension and send **without** checking
**Apply automatically**. The bridge appends a formatted prompt to
`.vibe-edits/queue.md`. Then ask your coding agent:

> Check `.vibe-edits/queue.md` and apply the pending edit.

The live page does not change until you edit source files and refresh.

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
