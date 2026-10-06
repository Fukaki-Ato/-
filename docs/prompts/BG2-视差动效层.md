# BG2 视差动效层（并行实验会话开场提示词）

> 实验背景：本次任务用于「主界面动态背景方案对比」。BG1–BG5 五个会话并行开发，主会话统一合并、构建、校准与验收。本会话负责分层视差的核心实现。

## 1. 目标

把 `assets/scripts/ui/panels/ParallaxLayers.ts` 的**占位实现替换为真实实现**：从一张源纹理上裁剪若干条带，做水平无缝镜像平铺滚动（示例：云带向右慢速、海浪带向左稍快），用于主界面背景的「动起来」效果。

- **不得更改该文件已导出的类型与函数签名**（BG1 会话依赖）
- 允许调整 `DEFAULT_PARALLAX_CROPS` 数值

## 2. 工作目录与 git 规则（强制）

- 工作目录：`F:\OpenCode Projects\雷霆酷跑\.worktrees\BG2`（分支 `sess/BG2`，用户已创建）
- 只在本 worktree 内改动；禁止 `checkout / merge / rebase / push`；不要碰其他 worktree 与主目录的文件
- 在 worktree 内先执行 `npm install`，提交前 `npm run check` 必须全绿
- 完成后只提交你新增/修改的文件，提交信息以 `BG2: ` 开头；**不要 push**
- 禁止运行 Cocos 构建（`npm run build:web` 等），不要修改 `build/`、`dist/`

## 3. 开工先读

- 冻结接口文件本身（`ParallaxLayers.ts` 的类型注释即规格）
- `assets/scripts/ui/framework/UIKit.ts`（`node`/层级工具）、`Assets.ts`（资源加载行为）
- Cocos 3.8 API 要点（主会话已核实，实现时以类型检查为准）：
  - 运行时裁剪：`const sf = new SpriteFrame(); sf.texture = tex; sf.rect = new Rect(px, py, pw, ph); sf.originalSize = new Size(pw, ph);`
  - **顺序必须先 texture 后 rect**（texture setter 会把 rect 重置为整图）
  - `rect` 为像素单位、**左上角原点、y 向下**（与 `ParallaxCropSpec` 归一化口径一致，直接乘 textureSize 即可，无需翻转）
  - `rect` setter 会自动重算 UV；但挂到 Sprite 后不要再改 rect（SIMPLE 模式不会刷新），且必须整体赋 `new Rect`，不能改 getter 返回对象的字段
  - `rect` **不校验越界**（可能 UV 越界、边缘拉伸），务必自行 clamp 到纹理范围
  - 多个 SpriteFrame 共享同一张 texture 不额外占显存；`SpriteFrame.destroy()` 不会销毁贴图
  - 镜像：节点 `scale.x = -1`；透明度：节点 `UIOpacity`

## 4. 实现要求

1. 对 `crops` 中每一条带：
   - 屏幕宽度 = `screenHeight × (源裁剪像素宽 / 源裁剪像素高)`；条带中心 Y = `screenY`（相对屏幕中心）
   - `mirror = true`：按「原块 / 水平镜像块」交替平铺，覆盖 `designWidth` 并**至少多铺一块**（保证回绕无缝）
   - `opacity` → 节点 `UIOpacity`
2. `update(dt)`：每层水平位移 `x += speed * dt`（speed 正值为向右）；当位移超过一个回绕周期（= 单块宽度，或镜像对的基础周期）时按周期回绕，保证视觉连续
3. `dispose()`：销毁自建节点（不销毁传入的 texture/SpriteFrame）
4. 鲁棒性：
   - `texture` 无效、裁剪换算后宽或高 ≤ 0、rect 越界 → 跳过该条带（不抛错）
   - `crops` 为空 → 完全 no-op
5. 性能：每条带节点数 ≤ 4；不得在 `update` 中创建/销毁节点；不逐帧修改纹理或重新计算 UV

## 5. 参数校准

- `DEFAULT_PARALLAX_CROPS` 当前是主会话给的临时估值（源图是 1007×1562 的带 UI mock）
- 若 `temp/bg-eval/crops.json` 已存在（BG3 会话产出，时间上可能滞后于你），则采用其中的 `recommended` 值；不存在则保持现状并在报告中说明
- 报告需给出最终每条带的「源裁剪矩形 + 屏幕参数 + 速度」清单，供主会话集成核对

## 6. 自检

- `npm run check` 全绿（该文件会参与 `typecheck:cc`）
- 建议将「裁剪换算 / 周期回绕」抽成纯函数并在报告里给出关键算式；本次不强制新增单测（如成本低可加，位于 `tests/` 下需自行判断测试范围是否合适）

## 7. 报告

写 `docs/reports/BG2-视差动效层.md`：实现说明（含每层参数清单）、验证结果、遗留与风险（如：真实视觉效果需主会话合并构建后目测；mock 图内容会被重复叠加属预期，待美术分层图后自然解决）。
