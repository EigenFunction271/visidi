# VIbey SIte DIrector

Local WebSocket bridge for the VIbey SIte DIrector browser extension. Receives
element captures from the extension and appends agent-ready edit prompts to
`.vibe-edits/queue.md` in your project.

## Usage

From your project root (the directory you want `.vibe-edits/queue.md`
created in):

```
npx visidi-bridge
```

You should see:

```
[vibe-edit-bridge] Running on ws://localhost:4017 — writing to .vibe-edits/queue.md in /path/to/project
```

Leave it running while you use the Visidi extension. Stop it any
time with `Ctrl+C`.

Then, in Claude Code or Codex, ask it to check `.vibe-edits/queue.md` for
pending edits.

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

**Permission errors creating `.vibe-edits/`**
Make sure you're running the bridge from a directory you have write access
to, and that there isn't a file (not a directory) already named
`.vibe-edits` in that folder.
