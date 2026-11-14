# Replay Format

Replay fixtures make the deterministic simulation reviewable. V1 records a seed, character, fixed timestep, frame limit, and normalized input events. V2 additionally carries the theme and initial equipment. These are offline diagnostic files, not online ranking or mission tickets.

```json
{
  "version": 1,
  "seed": 777,
  "charId": "char_volt",
  "dtMs": 16.666666666666668,
  "maxFrames": 1800,
  "inputs": [{ "frame": 24, "type": "swipe", "payload": { "dir": "left" } }]
}
```

`version: 1` requires `dtMs = 1000 / 60`. Inputs are ordered by nondecreasing frame and use platform-normalized event types: `swipe`, `doubleTap`, `tap`, and `key`.

## Context-aware v2

```json
{
  "version": 2,
  "seed": 777,
  "charId": "char_volt",
  "dtMs": 16.666666666666668,
  "maxFrames": 1200,
  "themeId": "theme_library",
  "initialItems": ["item_helmet"],
  "inputs": [{ "frame": 24, "type": "swipe", "payload": { "dir": "left" } }]
}
```

- V1 的旧默认行为保留：默认主题、无开局道具；未知顶层字段仍忽略。因此不能把上下文塞进 v1 后期待旧工具正确复跑。
- V2 的 `themeId` 若提供须为非空字符串，`initialItems` 若提供须为非空字符串组成的数组（数组可空）。省略分别使用引擎默认主题及空装备，与 v1 默认玩法相同。
- 主题解析、道具效果过滤及前三个有效道具的规则复用 `RunnerSim`，不另建离线规则。V2 结果的 `context` 与人读摘要显示**实际生效**的主题和道具，便于发现配置解析/过滤差异。
- `makeReplay(seed, charId, opts)` 不带上下文时仍生成 v1；提供 `opts.themeId` 或 `opts.initialItems` 时生成 v2。输入 RNG 编排不变，便于隔离上下文差异。
- `REPLAY_VERSION` 保留为默认格式 1，`CONTEXT_REPLAY_VERSION` 为 2；读取器接受两者，拒绝未来未知版本。v2 文件会被旧 v1 工具明确拒绝，而不是悄悄忽略主题和装备。
- 相同输入的 `inputsSha256` 不包含主题/装备，不能当作整个对局的唯一标识。复现还需要对应配置与模拟代码；本文没有承诺跨发布版本的结果兼容。

## Input mapping

`swipe up/down/left/right` → jump/slide/laneL/laneR；`doubleTap` → skill；键盘使用 `KeyboardEvent.code`，包括方向键、Space、KeyE 与两侧 Shift。合法 tap 和未映射按键不驱动模拟。同帧输入保持原数组顺序，随后 step 并把 drain 的事件归属该帧；死亡或帧数上限停止。

## Commands and golden compatibility

```bash
npm run build
node tools/replay/runner.mjs tools/replay/examples/example-v1.json
node tools/replay/runner.mjs tools/replay/examples/example-v2.json --json
node tools/replay/recorder.mjs --seed=777 --theme=theme_library --items=item_helmet --frames=1200
node tools/replay/golden-gen.mjs
node tools/replay/golden-gen.mjs --update
```

Only use `--update` after reviewing an intentional gameplay/configuration diff. Golden fixtures under `tests/golden/` are part of the gameplay contract and should change in the same pull request as the behavior that caused the change.

本次 v2 扩展不改变既有 15 个 v1 golden、生成器默认路径或模拟规则；默认 v1 复跑结果逐字段保持不变，不运行 `--update` 来掩盖差异。在线票据的持久化、发布规则及旧局兼容属于独立服务契约，不能由离线文件格式推断。
