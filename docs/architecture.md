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
- `flow/`: boot, login, menu, run, and result orchestration.
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
