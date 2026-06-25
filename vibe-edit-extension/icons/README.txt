Visidi extension icons — Chrome Web Store requirements
======================================================

Required files (place in this directory):
  icon16.png   — 16×16 px
  icon32.png   — 32×32 px
  icon48.png   — 48×48 px
  icon128.png  — 128×128 px

Naming convention
-----------------
Use icon{size}.png (e.g. icon16.png) to match manifest.json paths.
Lowercase, no spaces. PNG only.

Format
------
- PNG with transparency (RGBA). This is the only format you should ship.
- Square canvas at each size (width = height).
- Do NOT use SVG or WebP — Chrome does not support them for extension icons.
- JPEG works but looks poor at small sizes; avoid it.

Where each size is used
-----------------------
  16×16   Toolbar button, extension page favicon
  32×32   Windows toolbar / retina fallback for 16px contexts
  48×48   chrome://extensions management page
  128×128 Chrome Web Store listing, install dialog (REQUIRED by Chrome)

Design tips
-----------
- Design each size independently — do not just scale down the 128px asset.
  Fine detail disappears at 16px; use a bold, simple silhouette.
- For the 128px store icon: keep artwork in ~96×96 px centered with ~16px
  transparent padding on each side so it does not look cramped in the store.
- Use a transparent background; do not bake rounded corners into the PNG
  (Chrome applies its own mask in the store UI).
- Limit to 1–2 colors for readability at 16px.

Chrome Web Store listing assets (separate from manifest icons)
--------------------------------------------------------------
These are uploaded in the Chrome Developer Dashboard, not bundled in the zip:

  Store icon        128×128 PNG  (can reuse icon128.png)
  Screenshots       1280×800 or 640×400 PNG/JPEG (at least 1 required)
  Small promo tile  440×280 PNG/JPEG (optional)
  Marquee promo     1400×560 PNG/JPEG (optional)

Until real icons exist, Chrome will show a generic placeholder letter "V"
when loading unpacked — the extension still works for development.

References:
  https://developer.chrome.com/docs/extensions/develop/ui/configure-icons
  https://developer.chrome.com/docs/extensions/reference/manifest/icons
