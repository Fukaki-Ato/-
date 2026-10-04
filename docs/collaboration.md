# Collaboration Interfaces

Role-specific work interfaces. Process rules live in [CONTRIBUTING.md](../CONTRIBUTING.md);
architecture boundaries live in [architecture.md](architecture.md).

| GitHub | Role | Primary surface | Branch |
| --- | --- | --- | --- |
| `@Fukaki-Ato` | Review and merge manager | Reviews every PR into `main` | — |
| `@kljfg` | Game content author | `config/**`, effect primitives, content tests | `content/<topic>` |
| `@mostny` | Bug fixer | `packages/game/**` fixes, tests | `fix/<topic>` |

`main` is protected: no direct pushes, and every PR needs the code-owner review declared in
`.github/CODEOWNERS`.

## Content author interface (`@kljfg`)

### Contracts

- `config/` holds the eight content files: `game`, `characters`, `skills`, `items`,
  `obstacles`, `themes`, `events`, and `economy`. Every file is a versioned envelope
  (`configVersion`, `minEngineVersion`, `updatedAt`) and declares `$schema`.
- `packages/game/src/core/config/configTypes.ts` documents the envelopes and special shapes,
  for example the `defs` / `patterns` / `difficultyCurve` / `dropTable` layout of
  `obstacles.json`.
- `schema/config.schema.json` is the editor/envelope contract and the authoritative list of
  effect primitives.
- `packages/game/src/core/config/configValidator.ts` owns the runtime rules: ids, cross-file
  references, and value ranges. `tools/validate-config.mjs` runs the same code for local
  checks and CI.
- `packages/game/src/core/effects/primitives.ts` (`PRIMITIVES`) must stay exactly in sync
  with the schema `primitive` enum. `effectTypes.ts` defines `FxState` (the derived view) and
  `EffectWorld` (the capabilities instant primitives call into); `buffEngine.ts` owns the
  slot lifecycle (`add` / `tick` / `recompute`).
- Audio content (music / one-shot cues) is registered in `game.json → params.audio` with files
  under `assets/audio/`; playback is already wired through
  `packages/game/src/core/audio/audioDirector.ts`. See [audio.md](audio.md).
- Some source comments reference the upstream design spec `docs/03`; that document is not
  part of this repository. The in-repo authorities are the schema, the validator, and the
  existing entries in `config/`.

### Adding or changing content

1. Add the entry to its owning file. Catalogs use an `items` array with a stable `id`, i18n
   `name` / `desc`, `status` (`draft` | `live` | `retired`), and a `versions` history entry.
   Referenced ids (skills, talents, skins, …) must exist in their own file.
2. Keep gameplay values in `config/`; simulation code reads configuration and never embeds
   balance numbers.
3. Validate quickly with `node tools/validate-config.mjs`, then run `npm run check`.
4. If the change moves player-visible simulation results, review the golden diff before
   regenerating it with `node tools/replay/golden-gen.mjs --update` (see
   [replay.md](replay.md)).
5. Open the PR from `content/<topic>` with one concern per PR, the player-visible behavior
   described, and a note on configuration or golden changes (use the repository template).

### Adding an effect primitive

All three parts land in the same PR (see CONTRIBUTING rules):

1. Engine (`primitives.ts`): register the primitive in `PRIMITIVES` as `timed`, `instant` or
   `cyclic`. A `timed` primitive needs a merge rule in `buffEngine.ts` `recompute()` and a
   field in `FxState` when it exposes new derived state; an `instant` primitive needs a branch
   in `castInstant()` that uses `EffectWorld` capabilities implemented by the simulation; a
   `cyclic` primitive (`periodic`) re-applies its `effects` child list every `everyS` seconds.
   Timed state may expire by seconds (`durationS`) and/or by metres travelled (`distanceM`).
2. Schema: add the name to the `primitive` enum in `schema/config.schema.json`.
3. Tests: extend `tests/effects.test.mjs` and cover the configuration entries that use it.

### Adding display text (names, taglines, skill descriptions)

The CJK font atlas is a subset, not a full font: `assets/fonts/cjk.png` only carries the
glyphs that existed in the scanned sources when it was generated. A character whose glyph is
missing occupies width but draws nothing, so new wording silently renders as blanks.

After changing any rendered Chinese string in `config/**` or `packages/game/src/**`, rebuild
the atlas before testing: `node tools/fontgen/charset.mjs` then `node tools/fontgen/gen.mjs
--preset cjk` (needs the system font in `C:/Windows/Fonts`). Both outputs are deterministic,
so the diff should contain only the added glyphs.

## Bug fixer interface (`@mostny`)

### Where fixes go

- Simulation and rules: `packages/game/src/core/**` (for example `core/sim/`,
  `core/effects/`, `core/config/`, `core/scene/`).
- Rendering: `packages/game/src/render/**`. Flow and pages: `packages/game/src/flow/**`,
  `packages/game/src/ui/**`.
- Host integration: the matching app under `apps/`. Keep platform-specific code inside the
  app packages.
- Out of bounds: `window` / `document` / `localStorage` / `fetch` / `wx` inside
  `packages/**`, importing app code from `packages/**`, source files over 300 lines, and
  unrelated `packages/framework/**` public-API changes (coordinate with `@Fukaki-Ato`).

### Reproduce first

1. Prefer a deterministic replay. Open the Web build with `?debug` to capture the seed
   (`__trSeed()` in `apps/web/src/bootstrap.ts`), record inputs in the v1 replay format, and
   reproduce with `node tools/replay/runner.mjs <replay.json>`. See [replay.md](replay.md)
   and `tools/replay/examples/example-v1.json`.
2. Add a failing test under `tests/` (`node:test`). Common homes: `runnerSim.test.mjs`,
   `mainFlow.test.mjs`, `replay.test.mjs`, `golden.test.mjs`, plus the area-specific files.
3. Fix, then run `npm run check`.
4. If deterministic results legitimately change, inspect the golden diff and regenerate the
   fixtures with `node tools/replay/golden-gen.mjs --update` in the same PR.
5. Open the PR from `fix/<topic>` with reproduction steps, the seed or replay file, and
   expected versus actual behavior.

## Verification

`npm run check` runs five steps: TypeScript build, unit tests, configuration validation,
architecture/import rules, and a disposable WX bundle. Run it before every PR; documentation-
only changes do not require it.
