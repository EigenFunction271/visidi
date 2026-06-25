# Mock landing — local Visidi test page

Self-contained HTML page for testing the Visidi extension and `visidi-bridge`
without a real app.

## 1. Load the extension

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → select `vibe-edit-extension/` from this repo
4. Pin **Visidi** to the toolbar

## 2. Start the bridge (optional but recommended)

From the **repo root** (or any project where you want `.vibe-edits/queue.md`):

```bash
npx visidi-bridge
```

Leave this terminal open.

## 3. Serve this page

From this directory:

```bash
npx --yes serve -p 3000 .
```

Then open **http://localhost:3000** in Chrome.

Alternative without a server (requires file URL permission on the extension):

```bash
open index.html   # macOS
```

## 4. Run through the checklist

On the page, use the Visidi popup → **Pick an element**, then try:

| Target | What to verify |
|--------|----------------|
| **Get Started** button | Pick mode blocks click; prompt captures button text |
| **Docs** nav link | Page does not navigate away |
| Feature card `<h2>` | Selector + classes appear in prompt |
| **Join waitlist** submit | Form does not fire `alert` |
| Bridge running | Toast says "Sent to bridge"; `queue.md` grows |
| Bridge stopped | Toast says clipboard fallback; paste works |

Press **Esc** to cancel pick mode without capturing.

## Troubleshooting

- **Nothing happens when I click Pick** — confirm the tab URL is `localhost` or `127.0.0.1`, not `file://` on a blocked path.
- **Bridge not found** — bridge must bind port **4017** (`lsof -i :4017`).
- **Clipboard denied** — grant clipboard permission when Chrome prompts.
