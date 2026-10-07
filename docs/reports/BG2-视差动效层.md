# BG2 视差动效层 完成报告

## 结论摘要

- `assets/scripts/ui/panels/ParallaxLayers.ts` 的占位实现已替换为真实实现：从源纹理裁剪条带，镜像交替平铺并水平无缝滚动。
- 导出类型与函数签名未动（BG1 依赖的 `ParallaxCropSpec / ParallaxOptions / ParallaxHandle / DEFAULT_PARALLAX_CROPS / createParallaxLayers` 原样保留）。
- `temp/bg-eval/crops.json` 在本 worktree 不存在（BG3 未产出），按提示词 §5 保持主会话临时估值。
- `npm run check` 全绿：`typecheck:core` ✓、`typecheck:cc` ✓、vitest 32 文件 / 211 用例全过（含新增 12 用例）。
- 未运行任何 Cocos 构建，未改动 `build/`、`dist/`。

## 改动清单

| 文件 | 类型 | 说明 |
| --- | --- | --- |
| `assets/scripts/ui/panels/ParallaxLayers.ts` | 修改 | 占位 → 真实实现（接口区未动） |
| `assets/scripts/ui/panels/parallaxMath.ts` | 新增 | 纯函数：裁剪换算、块数、周期回绕（不依赖 cc，可单测） |
| `assets/scripts/ui/panels/parallaxMath.ts.meta` | 新增 | Cocos 资源 meta（uuid `08438a66-…`） |
| `tests/ui/ParallaxMath.test.ts` | 新增 | 12 个用例 |
| `docs/reports/BG2-视差动效层.md` | 新增 | 本报告 |

## 实现说明

### 节点结构（每带 ≤ 4 节点）

- 每条带 = `blockCount`（2–4）个块节点，直接挂在传入的 `parent` 下；**没有额外容器节点**，满足「每条带节点数 ≤ 4」。
- 每个块节点：`UIKit.node`（UI_2D 层 + UITransform，尺寸 = 单块屏幕宽 × `screenHeight`）+ `Sprite`（`sizeMode = CUSTOM`，`trim = false`）+ 需要时 `UIOpacity`。
- 同一条带的所有块共享一个自建裁剪 `SpriteFrame`（多个 SpriteFrame 共享同一 texture 不额外占显存；本实现更进一步只建 1 个）。
- 镜像块：`node.scale.x = -1`（第 1、3… 块），位置不变。
- `opacity < 255` 时给块节点挂 `UIOpacity`；缺省 255 不挂组件。

### 关键算式

1. **像素裁剪**（左上原点、y 向下，直接对应 `SpriteFrame.rect`）：
   `rect.x = round(x × texW)……`，取整后按纹理范围 clamp（四舍五入最多溢出 1 px，必须兜底）。
2. **单块屏幕宽**：`blockWidth = screenHeight × (rect.width / rect.height)`。
3. **块数**：`N = max(2, ceil(designWidth / blockWidth) + 1)`（覆盖 `designWidth` 并至少多铺一块）；
   镜像时若 N 为奇数则 +1（偶数是「原块 / 镜像块」交替回绕后朝向一致的必要条件）；最后封顶 4。
4. **初始摆放**：第 i 块左边界 `x_i = wrapLeft + i × blockWidth`，`wrapLeft = -designWidth / 2 - blockWidth`（屏幕左缘外预留一整块）。
5. **回绕**：`update` 中每块 `left += speed × dt`，随后取模回绕到 `[wrapLeft, wrapLeft + wrapSpan)`，
   `wrapSpan = N × blockWidth`（镜像时必为镜像对基础周期 2W 的整数倍）。
   不变量：任意时刻位置集合 = `{ wrapLeft + r + i × blockWidth | r ∈ [0, blockWidth) }`，即一个连续窗口；
   每块的取模跳跃都发生在视口外（左跳时整块已移出左缘，右跳时整块已在右缘外），任意 dt 尖峰下均无跳变/空隙。
6. **视口覆盖条件**：`N × blockWidth ≥ designWidth + blockWidth`；默认两条带均满足（见下表右缘值）。

### 逐层参数清单（当前 `DEFAULT_PARALLAX_CROPS`，供主会话核对）

| 条带 | 源裁剪（归一化 x,y,w,h） | 源裁剪像素（x,y,w,h） | 显示高 | 单块屏幕宽 | 中心 Y | 速度（px/s） | 镜像 | 块数 | 回绕周期 | wrapLeft | 初始右缘 | 不透明度 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 云带 | 0.15, 0.18, 0.7, 0.2 | 151, 281, 705, 312 | 350 | 790.87 | 313 | +8（向右） | 是 | 2 | 1581.73 | -1165.87 | 415.87 | 255（不挂组件） |
| 海浪带 | 0, 0.66, 0.35, 0.24 | 0, 1031, 352, 375 | 380 | 356.69 | -482 | -14（向左） | 是 | 4 | 1426.77 | -731.69 | 695.08 | 255（不挂组件） |

- 源纹理口径：1007 × 1562；设计分辨率：750 × 1624；视口右缘 = `wrapLeft + 回绕周期 ≥ 375`（两带均满足）。

### 鲁棒性

- `texture` 缺失/已销毁、`textureSize`/`designSize` 非法、`crops` 为空或非数组 → 完全 no-op（返回空 `ParallaxHandle`，不抛错）。
- 单条带：任一数值非有限、归一化宽/高 ≤ 0、归一化区越界（x/y < 0 或 x+w / y+h > 1）、换算宽高 ≤ 0 → 跳过该条带。
- 单条带创建过程用 `try/catch` 隔离：失败时销毁已建节点与其 SpriteFrame 后跳过，不影响其它条带（不抛给调用方）。
- `SpriteFrame` 严格按「先 texture、再整体赋 `new Rect`、最后 `originalSize`」顺序；挂载后不再改 rect。
- `update`：dt 非有限或为 0 直接返回；节点已销毁则跳过；节点上无逐帧分配。
- `dispose`：幂等，只销毁自建块节点与自建 SpriteFrame，**不销毁传入的 texture / SpriteFrame**。

### 性能

- 每带 ≤ 4 个节点；`update` 仅做数值运算与 `setPosition`，不创建/销毁节点、不修改纹理、不重算 UV。

## 验证结果

- `npm run check` 全绿：
  - `npm run typecheck:core` ✓（`tests/**` 含新增测试）
  - `npm run typecheck:cc` ✓（`ParallaxLayers.ts`、`parallaxMath.ts` 参与）
  - `npm run test`：32 个测试文件、211 个用例全部通过（`tests/ui/ParallaxMath.test.ts` 新增 12 例：默认两带换算值、镜像取偶、4 块封顶、四舍五入越界 clamp、非法输入 null、回绕边界与 1e6 级大幅位移）。
- 有意未运行 Cocos 构建（提示词 §2 禁止）。

## 参数校准说明

- `temp/bg-eval/crops.json`（BG3 产物）在本 worktree 中不存在，无法采用 `recommended`，故保持主会话临时估值并在本报告公示清单。
- 后续若拿到 BG3 校准值：直接替换 `DEFAULT_PARALLAX_CROPS` 数值，或调用 `createParallaxLayers(parent, { ..., crops })` 传入，无需改接口。

## 遗留与风险

- **真实视觉需主会话合并构建后目测**：本会话只做了类型检查与纯函数单测，无法在 Cocos 中渲染验证。
- **mock 图内容会被重复叠加属预期**：源图是带 UI 的整张 mock，条带滚动时会看到重复的按钮/文字；待美术分层图后自然解决。
- 纹理线性过滤在裁剪边缘可能取到相邻像素（约 1 px 渗色）；若目测明显，可加 1 px 内缩或改用就近过滤，另议。
- 极窄条带（单块宽 < designWidth / 3 ≈ 250 px）在 4 块预算内无法保证全覆盖，会退化为「中心可见、边缘空缺」；当前默认参数不受影响。
- 非镜像模式（`mirror = false`）回绕接缝不保证内容连续（镜像模式才有无缝保证）；当前两条默认带均为镜像。
- 调用约定：`parent` 需为居中、UI_2D 空间的节点（条带以屏幕中心为原点摆放）；`update(dt)` 的 dt 单位为秒；BG1 背景销毁时应调用 `dispose()`。
- 覆盖宽度按传入 `designSize.width`（默认 750）计算；若 BG1 在更宽比例机型上需要额外覆盖，传更大的 `designSize.width` 即可（接口不变）。

## 提交

- 分支：`sess/BG2`；提交信息以 `BG2: ` 开头；**未 push**。

## 集成修复记录（主会话，2026-10-07）

- 集成构建后发现：块节点的 UITransform 尺寸被改写为**裁剪帧的像素尺寸**（云带 312×375、海浪带 191×164），与布局间距（blockWidth 291/443）不一致，表现为相邻块重叠 21px / 中间出现 252px 空隙。
- 根因：`createBlockNode` 中先赋 `sprite.spriteFrame` 后设 `sprite.sizeMode = CUSTOM`；赋帧时默认模式按帧尺寸自动改写节点尺寸。
- 修复：调整顺序（先 CUSTOM 再赋帧）并在赋帧后显式 `setContentSize(blockWidth, screenHeight)` 兜底；提交 `135784f`。修复后经运行期节点检查确认无缝平铺。

