# Visidi Privacy Policy

Last updated: June 25, 2026

Visidi is an open-source Chrome extension that helps developers capture
structured edit prompts from elements on locally running websites.

## What Visidi accesses

When you activate pick mode and click an element, Visidi reads from the
page you are viewing:

- HTML tag name, CSS classes, and text content
- A CSS selector path to the element
- A small subset of computed styles (color, font size, padding, etc.)
- The page URL (localhost or file:// only)
- Your typed edit instruction

## Where your data goes

Visidi does not send data to any remote server operated by the developer.

Captured data is either:

1. Sent via WebSocket to `ws://localhost:4017` on your own computer
   (the optional [visidi-bridge](https://www.npmjs.com/package/visidi-bridge)
   CLI you run locally), or
2. Copied to your system clipboard if the local bridge is not running.

No analytics, tracking, or third-party services are used.

## Permissions

- **activeTab** — interact with the tab you are viewing when you click the
  extension
- **scripting** — inject pick-mode UI on local pages
- **clipboardWrite** — copy the formatted prompt when the local bridge is
  unavailable
- **localhost / 127.0.0.1 / file:// access** — limit the extension to local
  development sites only

## Data retention

Visidi does not store data inside the extension. If you use visidi-bridge,
prompts are appended to `.vibe-edits/queue.md` in the directory where you
started the bridge.

## Contact

Open an issue at
[github.com/EigenFunction271/visidi/issues](https://github.com/EigenFunction271/visidi/issues).
