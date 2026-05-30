# sprites/

Runtime hand-drawn art (generated via Codex — see `../ASSET_PROMPTS.md`).

Drop the generated PNGs into these subfolders (create them as you go):

```
sprites/
  rocket/    rocket-classic.png, rocket-sheet.png
  car/       car.png
  plane/     plane.png
  banner/    banner-left.png, banner-mid.png, banner-right.png
  firework/  firework-a.png (+ -b, -c variants)
  smoke/     smoke.png
```

Rules:
- Transparent-background PNG, clean cut-out edges, no baked-in shadow.
- Match the shared palette (see `ASSET_PROMPTS.md` / `src/shared/constants.ts`).
- Multi-frame sheets: lay frames on a regular grid and register `grid: [cols, rows]`
  in `manifest.json`.

Until the real art lands, the overlay renders Graphics placeholders, so the app
runs fine with this folder empty.
