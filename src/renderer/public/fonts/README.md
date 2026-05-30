# fonts/

Hand-drawn fonts served at the site root (used by both the UI and the Pixi overlay).

| File | Role |
| --- | --- |
| `Excalifont-Regular.woff2` | Latin / numbers (Excalidraw's handwriting font) |
| `Xiaolai-Regular.ttf` | Chinese 中文 (小赖手写体) |

The font stack is `Excalifont, Xiaolai, "Patrick Hand", …` (see `tailwind.config.js`
and the overlay's inline `<style>`). Fallback is per-glyph: Latin renders in
Excalifont, Chinese falls back to Xiaolai. If a file is missing the app degrades to
Patrick Hand / Kalam, so it still looks hand-drawn.

Notes:
- `XiaolaiMono-Regular.ttf` is **not** referenced; delete it to save ~22 MB in the
  packaged build, or wire it where you want a monospace hand-drawn look.
- Xiaolai is a full CJK TTF (~22 MB). It loads fine locally, but bloats the installer.
  Later you can subset it (e.g. with `fonttools`/`subset-font`) to just the glyphs you use.
