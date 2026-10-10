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
config load in `packages/game/src/flow/mainFlow.ts`. Sim `cast` / `pickup` / `death` events
reach the director through `RunCallbacks.onCast` / `onPickup` / `onDeath` in
`packages/game/src/render/runnerScene.ts` (coin events never trigger character cues).

## Configuration

`config/game.json → params.audio` (all optional; a missing section means silence):

```json
"audio": {
  "volume": { "music": 0.7, "sfx": 1 },
  "bgm": { "run": "assets/audio/bgm/run.mp3", "death": "assets/audio/bgm/death.mp3" },
  "sfx": {
    "start": "assets/audio/sfx/start.mp3",
    "death": ["assets/audio/sfx/death-1.mp3", "assets/audio/sfx/death-2.mp3"]
  },
  "characters": {
    "char_volt": {
      "sfx": {
        "cast": "assets/audio/sfx/char/char_volt/cast.mp3",
        "pickup": "assets/audio/sfx/char/char_volt/pickup.mp3",
        "death": "assets/audio/sfx/char/char_volt/death.mp3"
      }
    }
  }
}
```

- `sfx.death` accepts either a single path (legacy) or a non-empty array (a pool; one entry is
  picked per death).
- `characters.<id>.sfx` keys are optional per character; characters without an entry only get
  the global cues.
- Defaults: `volume.music` = 0.7, `volume.sfx` = 1; values are clamped to 0..1.
- Paths are relative to the repository root (`assets/audio/...`), or `http(s)://` URLs.
  Malformed entries (non-strings, empty, `..` segments, backslashes, control characters,
  non-http schemes, `//host` URLs) are dropped silently; invalid pool items are skipped and
  duplicates removed.

## Lifecycle

| Trigger | Sound |
| --- | --- |
| Enter `run` (selected character) | `bgm.run` loops; `sfx.start` once |
| Sim `cast` event | selected character's `sfx.cast` |
| Sim `pickup` event (item box, not coins) | selected character's `sfx.pickup` |
| Sim `death` event (once per run) | run BGM stops; `bgm.death` plays once (no loop); one `sfx.death` pool entry; selected character's `sfx.death` |
| `run` → `result` | death BGM keeps playing on the result screen |
| Leave `result` (retry / back to main menu) | death BGM stops before the next scene starts |
| Esc during `run` (alive) | run BGM stops |
| Esc after death, before result | death BGM stops on entering the main menu |
| Main menu | silent (no menu BGM yet) |

Retry re-enters `run` only after the death BGM has stopped, so the two tracks never overlap.
Cast/pickup cues are ignored after death.

The death-pool pick uses a dedicated random stream (`AudioDirectorOptions.random`, injected
from `GameFlowDeps.audioRandom`; by default a separate `mulberry32` seed). It never consumes
the gameplay `RunRng`, so seeds still replay identically.

## Asset rules

See `assets/audio/README.md` (formats, budget, licensing).

## Platform notes

- Web autoplay policy: the first sound must follow a user gesture. In practice the BGM starts
  right after tapping "start", so it plays; do not add load-time autoplay audio.
- WX: `tools/build-wx.mjs` recursively copies every audio file (`.mp3/.m4a/.aac/.ogg/.wav`)
  under `assets/audio/` into the `pkg-assets` subpackage at `pkg-assets/assets/audio/...`,
  so all of them count toward the package-size gate printed by `npm run check` (`README.md`
  is not copied). At runtime `resolveWxAudioPath` (`apps/wx/src/platform/audio.ts`) maps
  config paths `assets/audio/...` to `pkg-assets/assets/audio/...`; paths that already start
  with `pkg-assets/` and URLs with a scheme (`https://`, `wxfile://`) are passed through
  unchanged, so the prefix is never applied twice. `apps/wx/src/platform` remains the only
  place allowed to call `wx.*`.
- Visibility: Web BGM keeps playing while the page is hidden; WX suspends audio when the
  minigame is backgrounded. Pausing via `onVisibility` is deliberately not wired yet.

## Verification

```bash
npm run check   # 编译 + 测试 + 配置校验 + 架构检查 + WX bundle（含体积）
npm run dev     # 手动：开局 BGM+开局音效；死亡停 BGM、播死亡乐；结算后重开/返回无残留
```

- `tests/audioDirector.test.mjs` — parsing (legacy/pool/malformed), the lifecycle against the
  real `config/game.json`, and injected randomness.
- `tests/mainFlow.test.mjs` — scene handoff with the real config and a fake scene: character
  selection, cast/pickup/death callbacks, death BGM through result, retry/menu/Esc cleanup.
- `tests/platform-wx.test.mjs` — WX path resolution and `InnerAudioContext.src`.
- `tests/wxbuild.test.mjs` — the real audio files are copied into the subpackage and counted in
  its size.

Not covered automatically: the `runnerScene` event → callback mapping requires WebGL, so it is
verified only by manual play.
