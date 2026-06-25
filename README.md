# Visidi

**VIbey SIte DIrector** — click any element on your local dev site, describe
what you want changed, and get a structured edit prompt for AI coding agents
(Claude Code, Codex, Cursor, etc.).

Visidi has two parts:

| Part | What it does |
|------|----------------|
| **Chrome extension** (`vibe-edit-extension/`) | Pick elements on `localhost` pages and capture edit instructions |
| **Bridge CLI** ([`visidi-bridge`](https://www.npmjs.com/package/visidi-bridge)) | Receives captures over WebSocket and writes `.vibe-edits/queue.md` (optionally runs `claude` to auto-apply) |

The extension does **not** work on production URLs — only `localhost`,
`127.0.0.1`, and local `file://` HTML files.

---

## Prerequisites

- **Google Chrome** (Manifest V3 extension)
- **Node.js 18+** (for the bridge)
- A local dev site (or the included mock landing page)
- *(Optional, for auto-apply)* [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and on your `PATH` (`claude --version`)

---

## Quick start (fresh install)

### 1. Clone the repo

```bash
git clone https://github.com/EigenFunction271/visidi.git
cd visidi
```

### 2. Install the Chrome extension

1. Open **`chrome://extensions`**
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the **`vibe-edit-extension/`** folder from this repo
5. Pin **Visidi** to your toolbar (puzzle icon → pin)

If you will test against local HTML files (`file://`), also enable **Allow
access to file URLs** on the extension card.

### 3. Start the bridge

Open a terminal in the **project you want to edit** (for the mock landing,
use the repo root):

```bash
cd /path/to/your/project
npx visidi-bridge
```

Leave this running. You should see:

```
[visidi-bridge] Running on ws://localhost:4017
[visidi-bridge] Queue file: /path/to/your/project/.vibe-edits/queue.md
```

> **Important:** `queue.md` and auto-apply both use the directory where you
> run `npx visidi-bridge`. Start it from your app’s project root, not from
> inside `vibe-edit-bridge/`.

### 4. Open a local page

**Option A — mock landing (included in this repo)**

```bash
# Terminal 2
cd examples/mock-landing
npx --yes serve --listen 3000 .
```

Open **http://localhost:3000** in Chrome.

**Option B — your own app**

```bash
npm run dev   # or however you start your local server
```

Open the `localhost` URL your dev server prints.

### 5. Capture an edit

1. Click the **Visidi** toolbar icon → **Pick an element**
2. Click any element on the page (hover shows a blue outline)
3. Type what you want changed in the composer at the bottom
4. Click **Send**

**Queue-only (default):** the bridge appends to `.vibe-edits/queue.md`.
Tell your agent:

> Check `.vibe-edits/queue.md` and apply the pending edit.

**Auto-apply (opt-in):** check **Apply automatically** before Send. The
bridge queues the edit and runs `claude` locally. Watch the bridge terminal,
then **refresh the page** to see changes.

### 6. Verify setup (optional)

From the repo root, with the mock site and bridge running:

```bash
node scripts/check-setup.js http://localhost:3000
```

Both lines should show ✓.

---

## Project layout

```
visidi/
├── vibe-edit-extension/   Chrome extension (load unpacked)
├── vibe-edit-bridge/      npm package — npx visidi-bridge
├── examples/mock-landing/ Test page for local QA
├── documentation/         PRD and design docs
└── scripts/               check-setup.js, bridge smoke tests
```

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| “Copied to clipboard (bridge not running)” | Start `npx visidi-bridge` in a terminal; confirm port **4017** (`lsof -i :4017`) |
| Pick does nothing | Tab must be `localhost` / `127.0.0.1` / `file://` — reload extension after code changes |
| `queue.md` in wrong folder | Run the bridge from your **project root**, not `vibe-edit-bridge/` |
| Auto-apply fails (`spawn claude ENOENT`) | Install Claude Code CLI; verify `claude` works in the same terminal |
| Page doesn’t update after “Applied ✓” | Expected — auto-apply edits **source files**. Refresh the browser |
| Port 3000 busy | `serve` will pick another port; use that URL in `check-setup.js` |

More detail: [`vibe-edit-bridge/README.md`](vibe-edit-bridge/README.md),
[`examples/mock-landing/README.md`](examples/mock-landing/README.md).

---

## Privacy

See [PRIVACY.md](PRIVACY.md). All capture data stays on your machine unless
you opt in to auto-apply, which invokes the local `claude` CLI.

---

## License

MIT — see [LICENSE](vibe-edit-bridge/LICENSE).
