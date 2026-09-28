# Thunder Run

雷霆酷跑的单仓工程。仓库只保留两类共享代码：可复用框架与具体游戏；Web 和 WX 运行时实现各自在 app 内收口。

## Structure

```text
apps/
  web/          Web entry and browser platform adapter
  wx/           WX entry and WX platform adapter
packages/
  framework/    Platform contracts and custom UI runtime
  game/         Simulation, runner rendering, views, and game flow
config/         Versioned game content and its schema
assets/         Runtime font atlases
tests/          Node test suite and golden replay fixtures
tools/          Build, replay, config, and architecture checks
```

`packages/framework` must not know game rules or host globals. `packages/game` owns every Thunder Run rule and presentation detail, but must also remain host-neutral. Only `apps/web` may use browser APIs and only `apps/wx/src/platform` may use the WX global.

## Quick Start

Requires Node `>=20.19.0`.

```bash
npm install
npm run check
npm run dev
```

Useful commands:

- `npm run build`: compile all project references.
- `npm test`: run deterministic simulation, UI, replay, and platform tests.
- `npm run build:web`: create the Web bundle in `apps/web/dist`.
- `npm run build:wx -- --minify`: create a WX Developer Tools package in `apps/wx/dist`.

## Current Scope

- Web runs the complete menu, runner, HUD, and result flow.
- WX currently validates the platform adapter, empty scene, asset subpackage, and config loading chain. The complete WX game-flow and shared-renderer UI integration remain a planned integration task.
- Audio and telemetry were intentionally not migrated because they were not connected to either runtime.

## Collaboration

Gameplay fixes, content, and balance changes belong in `packages/game`, `config`, and their tests. Framework API changes belong in `packages/framework` and require maintainer review. All changes arrive through pull requests; maintainers own final merge order.

See [docs/architecture.md](docs/architecture.md), [CONTRIBUTING.md](CONTRIBUTING.md), and [docs/replay.md](docs/replay.md).
