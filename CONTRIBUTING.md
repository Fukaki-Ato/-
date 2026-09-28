# Contributing

## Ownership

- `@Fukaki-Ato` (admin): review and merge manager. Every PR into `main` requires this review; nobody pushes to `main` directly.
- `@kljfg` (write): game content author. Owns `config/**` content and the effect-primitive additions that support it; use `content/<topic>` branches.
- `@mostny` (write): bug fixer. Owns gameplay, rendering, and flow fixes under `packages/game/**` and their tests; use `fix/<topic>` branches.

Repository surfaces:

- `packages/framework/**` public API changes require `@Fukaki-Ato` review and must not ride along in an unrelated gameplay PR.
- `packages/game/**`, `config/**`, and `assets/**` are the game collaboration surface.
- `apps/web/**` and `apps/wx/**` are integration boundaries. Keep platform-specific code there.

See [docs/collaboration.md](docs/collaboration.md) for the role-specific interfaces.

## Workflow

1. Branch from `main` using `feature/<topic>`, `fix/<topic>`, or `content/<topic>`.
2. Keep one concern per pull request.
3. Run `npm run check` before opening the pull request.
4. Describe player-visible behavior, test coverage, and any configuration or golden replay changes.
5. Wait for `@Fukaki-Ato` review and merge. Do not push directly to `main`.

## Rules

- Do not access `window`, `document`, `localStorage`, `fetch`, or `wx` from `packages/**`.
- Do not import app code from either package. Apps may import packages, never the reverse.
- Source files are limited to 300 lines. Split by responsibility before adding more.
- Add gameplay values to `config/`; simulation code reads configuration rather than embedding balance numbers.
- New effect primitives require the engine registration, in-repo schema enum, and effect test coverage in the same pull request.
- If a gameplay or configuration change changes a golden fixture, inspect the diff before regenerating it with `node tools/replay/golden-gen.mjs --update`.

## Pull Requests

Use the repository template. Framework changes must explain compatibility and migration impact. Gameplay changes should include enough reproduction detail for another collaborator to verify them in the Web build.
