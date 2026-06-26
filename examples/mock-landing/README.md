# Mock landing — local Visidi test page

Self-contained HTML page for testing the Visidi extension and `visidi-bridge`
without a real app.

## 1. Load the extension

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → select `vibe-edit-extension/` from this repo
4. Pin **Visidi** to the toolbar

## 2. Start the bridge + this page together (optional but recommended)

From the **repo root**:

```bash
npx visidi-bridge --dev -- npx --yes serve -p 3000 examples/mock-landing
```

Leave this terminal open, then open **http://localhost:3000** in Chrome.
`Ctrl+C` stops both the bridge and the mock server.

Prefer two separate terminals? Run them individually instead:

## 3. Serve this page (separate-terminal alternative)

From the repo root:

```bash
npx visidi-bridge
```

From this directory, in a second terminal:

```bash
npx --yes serve -p 3000 .
```

Then open **http://localhost:3000** in Chrome.

If `serve` picks a different port (e.g. `59696` because 3000 is busy), that is
fine — the page port does **not** need to match the bridge. The extension page
runs on whatever HTTP port `serve` uses; the bridge always listens on
**WebSocket port 4017**.

Verify both are up:

```bash
node scripts/check-setup.js http://localhost:59696
```

(Replace the URL with whatever port your mock site is using.)

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
| Bridge running (queue-only) | Toast says "Sent to bridge"; `queue.md` grows |
| **Apply automatically** checked | Toast "Applying…" then "Applied ✓"; bridge runs `claude`; refresh page to see change |
| Bridge stopped | Toast says clipboard fallback; paste works |

Press **Esc** to cancel pick mode without capturing.

## Troubleshooting

- **Nothing happens when I click Pick** — confirm the tab URL is `localhost` or `127.0.0.1`, not `file://` on a blocked path.
- **Bridge not found** — bridge must bind port **4017** (`lsof -i :4017`).
- **Auto-apply fails** — `claude` must be on PATH; run bridge from repo root so it edits `examples/mock-landing/index.html`.
