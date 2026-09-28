# Contributing

## Ownership

- `packages/framework/**` is maintained by the framework owners. Do not change its public API as part of an unrelated gameplay PR.
- `packages/game/**`, `config/**`, and `assets/**` are the game collaboration surface.
- `apps/web/**` and `apps/wx/**` are integration boundaries. Keep platform-specific code there.

## Workflow

1. Branch from `main` using `feature/<topic>`, `fix/<topic>`, or `content/<topic>`.
2. Keep one concern per pull request.
3. Run `npm run check` before opening the pull request.
4. Describe player-visible behavior, test coverage, and any configuration or golden replay changes.
5. Wait for maintainer review and merge. Do not push directly to `main`.

## Rules

- Do not access `window`, `document`, `localStorage`, `fetch`, or `wx` from `packages/**`.
- Do not import app code from either package. Apps may import packages, never the reverse.
- Source files are limited to 300 lines. Split by responsibility before adding more.
- Add gameplay values to `config/`; simulation code reads configuration rather than embedding balance numbers.
- New effect primitives require the engine registration, in-repo schema enum, and effect test coverage in the same pull request.
- If a gameplay or configuration change changes a golden fixture, inspect the diff before regenerating it with `node tools/replay/golden-gen.mjs --update`.

## Pull Requests

Use the repository template. Framework changes must explain compatibility and migration impact. Gameplay changes should include enough reproduction detail for another collaborator to verify them in the Web build.
