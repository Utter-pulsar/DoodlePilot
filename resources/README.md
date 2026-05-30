# resources/

Source art for the **app/installer icon**.

1. Generate the plane mascot (see `../assets/ASSET_PROMPTS.md` → "1. 应用图标").
2. Save it here as `icon-source.png` (1024×1024, transparent).
3. Tell me, and I'll convert it into the platform icons electron-builder expects:
   - `build/icon.ico` — Windows (multi-size)
   - `build/icon.icns` — macOS
   - `build/icon.png` — Linux (512×512)

electron-builder auto-detects `build/icon.*`, so no config change is needed once
those files exist.
