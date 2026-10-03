# Mobile App Resources

Source images and fonts for the boop mobile app icons and splash screens.

## Pipeline

Three source images under `resources/` feed `@capacitor/assets`, which produces
every size iOS and Android need and installs them into the native projects:

- `icon.png` (1024×1024) — cream tile + violet completed-item dot
- `splash.png` (2732×2732) — cream + centred violet dot (light)
- `splash-dark.png` (2732×2732) — ink + centred violet dot (dark)

`scripts/generate-icons.mjs` regenerates the three source images using
`@napi-rs/canvas`.

## Regenerating

```bash
bun run generate:assets
```

This runs the generator and then `npx capacitor-assets generate --ios --android`.

## Brand tokens

- Violet `#6b3cff` — accent and icon background
- Cream `#fafaf7` — light-mode surface
- Ink `#0c0b10` — dark-mode surface

These match `src/pages/Landing.css` and the `<meta name="theme-color">` in
`index.html`.
