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

## Character cues

`params.audio.characters.<charId>.sfx` maps three events per character, and the runtime reads
**only these three keys** (`audioDirector.parseCharacters`) — a fourth event name in config is
never played:

```
sfx/char/<char_id>/cast.mp3      技能释放
sfx/char/<char_id>/pickup.mp3    道具拾取
sfx/char/<char_id>/death.mp3     该角色死亡
```

Paths are case-sensitive and must match the character id exactly. Missing events are fine: the
cue is skipped and only the global layer plays (global death pool + BGM), so partial coverage is
safe to land incrementally.

House encoding spec (what `npm run check` and the WX decoder expect): **MP3, 44.1 kHz, mono,
128 kbps**. Convert with the bundled ffmpeg, e.g.
`ffmpeg -i in.m4a -vn -ac 1 -ar 44100 -b:a 128k out.mp3`.

Coverage as of 2026-10-05 (issue #17, first batch):

| 角色 | cast | pickup | death |
| --- | --- | --- | --- |
| `char_volt` | ✅ | ✅ | ✅ |
| `char_mambo` | ✅ | ✅ | ⬜ |
| `char_frog` | ✅ | ⬜ | ⬜ |
| `char_niu` | ✅ | ⬜ | ⬜ |
| `char_ama` / `char_kaze` / `char_rina` / `char_bolt` | ⬜ | ⬜ | ⬜ |

## License record

- **2026-10-05 (issue #17)** — `sfx/char/char_frog/cast.mp3`, `sfx/char/char_mambo/{cast,pickup}.mp3`,
  `sfx/char/char_niu/cast.mp3`: supplied by the project owner as a local asset pack
  (`D:\音频素材`), transcode-only (no editing, no trimming). The owner confirmed redistribution
  rights for this repository. Original filenames recorded in the commit message.
- Earlier batches (run BGM, death BGM, global death pool, start cue, `char_volt` cues): rights
  asserted in their pull-request descriptions, per the rule above.
