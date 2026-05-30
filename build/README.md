# build/

electron-builder build resources. Place the converted icons here:

- `icon.ico` — Windows
- `icon.icns` — macOS
- `icon.png` — Linux (512×512)

These are generated from `resources/icon-source.png`. This folder is referenced by
`electron-builder.yml` (`directories.buildResources: build`).
