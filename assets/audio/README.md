# Runtime Audio

Background music and one-shot cues live here:

- `bgm/` — looping tracks, referenced from `game.json → params.audio.bgm` (for example `bgm/run.mp3` → `"assets/audio/bgm/run.mp3"`). A scene theme can override the run track via `themes.json → <theme>.music` (for example `bgm/run_rain.mp3` for 雨夜便利店); themes without that field keep playing `params.audio.bgm.run`.
- `sfx/` — one-shot cues, referenced from `game.json → params.audio.sfx` (for example `"assets/audio/sfx/death.mp3"`)

Both builds copy this directory (Web bundle and the WX `pkg-assets` subpackage), so every file counts toward the WX package budget — `npm run check` prints the sizes and fails if the budget is exceeded.

Guidelines:

- Ship MP3 at 96–128 kbps (mono is enough) for Web + WX compatibility. Avoid OGG/M4A as the only copy of a required track.
- Keep the run BGM loop-friendly (trim silence at both ends) and each file ≤ ~1.5 MB; death cue 1–2 s, ≤ ~300 KB.
- Paths in config are stable content ids. Renaming a file is a breaking change for configuration — add a new file instead.

Licensing: only add audio you have the right to redistribute (owned or properly licensed, with the license recorded in the pull request). Do not ship placeholder audio as final content.

## Character cues

`params.audio.characters.<charId>.sfx` maps three events per character, and the runtime reads
**only these three plus the optional `intro`** (`audioDirector.parseCharacters`) — any other
event name in config is never played:

```
sfx/char/<char_id>/cast.mp3      技能释放
sfx/char/<char_id>/pickup.mp3    道具拾取
sfx/char/<char_id>/death.mp3     该角色死亡
sfx/char/<char_id>/intro.mp3     登场动画（可选，配 characters.json 的 <id>.intro 视频用）
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

> 2026-10-11：`char_pony` 已删除，其 `pony.glb` 建模与净空数据并入 `char_mambo`。
> 音频路径按角色 id 不变，仍使用 `char_mambo` 的 cast/pickup；未新增或替换音频文件。

> 2026-10-11（登场动画 + 场景 BGM 批次）：`char_frog` 另有 `intro.mp3`（登场音效，走 `sfx.intro`
> 可选键）；`char_niu/cast.mp3` 换成用户给的「拼接 v4」母带（裁掉尾部 0.24 秒静音、响度对齐旧版
> −18.2 LUFS，路径与文件名不变）。`bgm/run_rain.mp3` 是「雨夜便利店」主题专属 BGM，由
> `themes.json → theme_rain_konbini.music` 引用，不进 `params.audio.bgm`。

## License record

- **2026-10-05 (issue #17)** — `sfx/char/char_frog/cast.mp3`, `sfx/char/char_mambo/{cast,pickup}.mp3`,
  `sfx/char/char_niu/cast.mp3`: supplied by the project owner as a local asset pack
  (`D:\音频素材`), transcode-only (no editing, no trimming). The owner confirmed redistribution
  rights for this repository. Original filenames recorded in the commit message.
- **2026-10-11 (登场动画 + 场景 BGM)** — `bgm/run_rain.mp3`、`sfx/char/char_frog/intro.mp3`、
  替换后的 `sfx/char/char_niu/cast.mp3`，以及仓库外的 `assets/video/frog_intro.mp4`：均由项目本人
  从本地素材包（`D:\音频素材`）提供并确认可随本 public 仓再分发；处理仅限转码/裁边/响度对齐，
  未做二次创作。源文件名：`游戏背景音乐/雨声空灵版_前11秒.wav`、
  `奶娃的音效/奶娃的登场动画/video_261011_220428.mp4`（音轨同源）、
  `阿牛的音效/阿牛技能释放音效/阿牛技能音效_拼接v4.mp3`。
- Earlier batches (run BGM, death BGM, global death pool, start cue, `char_volt` cues): rights
  asserted in their pull-request descriptions, per the rule above.
