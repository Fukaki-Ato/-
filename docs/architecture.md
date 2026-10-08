# Architecture

The repository has one directional dependency rule:

```text
apps/web, apps/wx
        |
        v
packages/game ----> packages/framework
```

## Framework

`packages/framework` contains only capabilities that do not know Thunder Run rules:

- `platform/`: the injected platform adapter contract and gesture classifier.
- `ui/`: layout, input routing, rendering primitives, font loading, and `UiHost`.

It cannot import an app or touch browser/WX globals.

## Game

`packages/game` contains Thunder Run-specific behavior:

- `core/`: deterministic simulation, configuration loading, effects, tracks, and replay inputs.
- `render/`: Three.js runner scene, player model, obstacles, coins, and effects.
- `flow/`: boot, menu, shop, run, and result orchestration. The Web entry opens the Cocos-style main menu directly, without login or character selection.
- `ui/`: Thunder Run pages built from framework UI controls.

The game package receives platform services through `PlatformAdapter`; it never selects a browser or WX implementation itself.

## Apps

Each app owns its host integration.

- `apps/web/src/platform/` implements browser canvas, storage, networking, input, and visibility APIs.
- `apps/wx/src/platform/` implements WX canvas adaptation, storage, networking, input, subpackages, and extras.
- App entry points wire their platform adapter to the game and framework packages.

`tools/check-import-rules.mjs` enforces these boundaries and the 300-line source-file limit.

`schema/config.schema.json` is the self-contained editor/envelope contract. The game validator owns the remaining runtime rules, including IDs, references, and configuration ranges.

## Verification

`npm run check` compiles all references, runs tests, validates all eight configuration files, checks architecture boundaries, and creates a disposable WX bundle. Golden replay fixtures make simulation and content changes explicit.

## Web-to-Cocos strategy

Use the Web app as the rapid iteration surface for gameplay feel, pacing, camera, visuals, and UI. Keep simulation, gameplay state/flow, and configuration independent of rendering engines where practical, with engine- and platform-specific rendering, UI, input, assets, audio, and APIs isolated in their runtime layers.

Do not postpone the first Cocos integration until the Web game is fully polished. After the core direction is established, prove a small Cocos vertical slice (start, run, collision or collection, result, restart), then continue broader polish with the target path understood. Reuse engine-independent behavior and data; Three.js rendering and UI should be treated as behavior/design references that may need Cocos-specific implementation.

The Web preview is not final WeChat Mini Game acceptance. Record the Cocos Creator version and validate the target build in Cocos Creator and WeChat Developer Tools; when those tools are unavailable, keep target validation explicitly pending.
