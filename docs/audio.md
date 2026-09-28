# Audio

BGM and one-shot cues are configuration-driven. The runtime side already exists; content
authors supply assets and the `game.json` entries.

## Interface

`PlatformAdapter.audio?: AudioService` (`packages/framework/src/platform/audio.ts`):

- `playMusic(url, { loop, volume })` — same URL is idempotent; a new URL switches tracks
- `stopMusic()`
- `playSfx(url, { loop, volume })`
- `dispose()`

Implementations: Web `apps/web/src/platform/webAudio.ts` (HTMLAudioElement), WX
`apps/wx/src/platform/audio.ts` (InnerAudioContext). Both swallow failures by contract —
audio never blocks gameplay.

The game wires it through `packages/game/src/core/audio/audioDirector.ts`, created after
config load in `packages/game/src/flow/mainFlow.ts`.

## Configuration

`config/game.json → params.audio` (all optional; a missing section means silence):

```json
"audio": {
  "volume": { "music": 0.7, "sfx": 1 },
  "bgm": { "run": "assets/audio/bgm/run.mp3" },
  "sfx": { "death": "assets/audio/sfx/death.mp3" }
}
```

Defaults: `volume.music` = 0.7, `volume.sfx` = 1; values are clamped to 0..1. Paths are
host-relative to the repository root (`assets/...`), matching other content references.

## Behavior matrix

| Trigger | Sound |
| --- | --- |
| Enter `run` | `bgm.run` loops |
| Death event | BGM stops, `sfx.death` plays once |
| Exit `run` (death → result, Esc → menu) | BGM stops (defensive) |
| Login / menu / result | silent (no menu BGM yet) |

Retry or revive re-enters `run` and restarts the BGM.

## Asset rules

See `assets/audio/README.md` (formats, budget, licensing).

## Platform notes

- Web autoplay policy: the first sound must follow a user gesture. In practice the BGM starts
  right after tapping "start", so it plays; do not add load-time autoplay audio.
- WX: use local package-relative paths (`assets/audio/...`) or https URLs; `apps/wx/src/platform`
  remains the only place allowed to call `wx.*`. Audio files count toward the WX package budget
  printed by `npm run check`.
- Visibility: Web BGM keeps playing while the page is hidden; WX suspends audio when the
  minigame is backgrounded. Pausing via `onVisibility` is deliberately not wired yet.

## Verification

```bash
npm run check   # 编译 + 测试 + 配置校验 + 架构检查 + WX bundle（含体积）
npm run dev     # 手动：开始一局听 BGM；死亡听一次性死亡乐；Esc/结算后无残留
```

`tests/audioDirector.test.mjs` covers the config → call mapping with a fake adapter.
