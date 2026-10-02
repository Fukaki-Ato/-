# Runtime Audio

Background music and one-shot cues live here:

- `bgm/` — looping tracks, referenced from `game.json → params.audio.bgm` (for example `bgm/run.mp3` → `"assets/audio/bgm/run.mp3"`)
- `sfx/` — one-shot cues, referenced from `game.json → params.audio.sfx` (for example `"assets/audio/sfx/death.mp3"`)

Both builds copy this directory (Web bundle and the WX `pkg-assets` subpackage), so every file counts toward the WX package budget — `npm run check` prints the sizes and fails if the budget is exceeded.

Guidelines:

- Ship MP3 at 96–128 kbps (mono is enough) for Web + WX compatibility. Avoid OGG/M4A as the only copy of a required track.
- Keep the run BGM loop-friendly (trim silence at both ends) and each file ≤ ~1.5 MB; death cue 1–2 s, ≤ ~300 KB.
- Paths in config are stable content ids. Renaming a file is a breaking change for configuration — add a new file instead.

Licensing: only add audio you have the right to redistribute (owned or properly licensed, with the license recorded in the pull request). Do not ship placeholder audio as final content.
