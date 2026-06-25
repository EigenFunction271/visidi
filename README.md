# Visidi

**VIbey SIte DIrector** — click any element on your local dev site, describe
what you want changed, and get a structured edit prompt for AI coding agents
(Claude Code, Codex, Cursor, etc.).

Visidi has two parts that run **entirely on your machine**:

| Part | Install | What it does |
|------|---------|----------------|
| **Chrome extension** | [Chrome Web Store](https://chromewebstore.google.com/) (search **Visidi**) | Pick elements on `localhost` pages and capture edit instructions |
| **Bridge CLI** | `npx visidi-bridge` — [npm](https://www.npmjs.com/package/visidi-bridge) | Receives captures and writes `.vibe-edits/queue.md` (optional auto-apply via `claude`) |

The extension only works on **local dev sites** — `localhost`, `127.0.0.1`,
and `file://` HTML files. It does not run on deployed production URLs.

**Current release:** extension `0.2.0` · bridge [`visidi-bridge@0.2.0`](https://www.npmjs.com/package/visidi-bridge)

---

## Quick start (production users)

You do **not** need to clone this repo.

### 1. Install the Chrome extension

Install **Visidi** from the [Chrome Web Store](https://chromewebstore.google.com/)
(search for “Visidi” by Brendan Beh / EigenFunction271).

Then pin it to your toolbar (puzzle icon → pin).

If you use local HTML files (`file://`), open `chrome://extensions`, find
Visidi, and enable **Allow access to file URLs**.

### 2. Start the bridge

In a terminal, `cd` to the **project you want to edit** (your app’s repo root):

```bash
cd /path/to/your/project
npx visidi-bridge
```

Leave this running. You should see:

```
[visidi-bridge] Running on ws://localhost:4017
[visidi-bridge] Queue file: /path/to/your/project/.vibe-edits/queue.md
```

> Run the bridge from your **app’s project root** — that’s where `queue.md`
> is created and where auto-apply edits source files.

Optional: pin the bridge version in a project:

```bash
npm install --save-dev visidi-bridge
# package.json → "scripts": { "visidi": "visidi-bridge" }
```

### 3. Open your local dev site

```bash
npm run dev   # Next.js, Vite, etc.
```

Open the `localhost` URL your dev server prints in Chrome.

### 4. Capture an edit

1. Click **Visidi** in the toolbar → **Pick an element**
2. Click any element (blue hover outline)
3. Describe the change in the composer → **Send**

| Mode | What happens |
|------|----------------|
| **Queue-only** (default) | Prompt appended to `.vibe-edits/queue.md` — tell your agent to read and apply it |
| **Apply automatically** (checkbox) | Bridge queues the edit **and** runs `claude` locally — refresh the page to see changes |

Auto-apply requires [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) on your `PATH`.

---

## Prerequisites

- Google Chrome
- Node.js 18+
- A site served on `localhost` / `127.0.0.1` (or local `file://` HTML)
- *(Auto-apply only)* `claude` CLI installed and authenticated

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| “Copied to clipboard (bridge not running)” | Run `npx visidi-bridge` from your project root; confirm port **4017** is free (`lsof -i :4017`) |
| Pick does nothing | Tab must be `localhost` / `127.0.0.1` / `file://` |
| `queue.md` in wrong folder | Start the bridge from your **project root**, not a subdirectory |
| Auto-apply fails (`spawn claude ENOENT`) | Install Claude Code CLI; run `claude --version` in the same terminal |
| “Applied ✓” but page unchanged | Expected — edits land in **source files**. Refresh the browser |
| Extension + bridge version mismatch | Use bridge `npx visidi-bridge@latest` (0.2.0+) for auto-apply |

Add `.vibe-edits/` to your app’s `.gitignore` — it’s local scratch, not source.

More detail: [`vibe-edit-bridge/README.md`](vibe-edit-bridge/README.md)

---

## Developers & contributors

Clone the repo to work on the extension, run tests, or load an unpacked build:

```bash
git clone https://github.com/EigenFunction271/visidi.git
cd visidi
```

**Load unpacked extension** (instead of the Store build):

1. `chrome://extensions` → Developer mode → **Load unpacked**
2. Select `vibe-edit-extension/`

**Mock landing page** for local QA:

```bash
cd examples/mock-landing && npx --yes serve --listen 3000 .
node scripts/check-setup.js http://localhost:3000   # from repo root
```

### Project layout

```
visidi/
├── vibe-edit-extension/   Chrome extension source
├── vibe-edit-bridge/      npm package (visidi-bridge)
├── examples/mock-landing/ Test page
├── documentation/         PRD and design docs
└── scripts/               check-setup.js, bridge smoke tests
```

---

## Privacy

See [PRIVACY.md](PRIVACY.md). Capture data stays on your machine unless you
opt in to auto-apply, which invokes the local `claude` CLI (and Anthropic’s
API per your Claude Code setup).

---

## License

MIT — see [LICENSE](vibe-edit-bridge/LICENSE).
