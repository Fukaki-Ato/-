# WX App

`apps/wx` produces an importable WX Developer Tools package.

```bash
npm run build:wx
npm run build:wx -- --minify
```

Import `apps/wx/dist` with the WX Developer Tools in tourist mode.

## What It Verifies

- The WX `PlatformAdapter` implementation and canvas shim.
- The Three.js empty scene.
- Loading `pkg-assets`, then reading and validating all configuration files.
- Bundle-size limits: 4 MB main package and 30 MB total package.

## Current Limitation

This is not yet the full playable WX game. `src/main.ts` intentionally starts the empty scene while the Web-only flow uses the full menu, game, HUD, and result views. Moving that flow to a single WX renderer is a separate integration task and must not be mixed into unrelated gameplay changes.
