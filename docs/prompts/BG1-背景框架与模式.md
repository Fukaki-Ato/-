# BG1 背景框架与模式（并行实验会话开场提示词）

> 实验背景：本次任务用于「主界面动态背景方案对比」（static / parallax / video）。BG1–BG5 五个会话并行开发，主会话统一合并、构建、校准与验收。本会话产物是背景结构的框架层。

## 1. 目标

把主界面背景重构为「模式化 + 可切换」结构，修复现有背景层级缺陷，并接入视差/视频方案的挂载点：

- `static`：现有静态背景（色块兜底 + 底图），修复渲染组件冲突
- `parallax`：在静态基础上，委托 `ParallaxLayers.ts` 播放滚动条带（实现由 BG2 会话负责，当前为占位实现）
- `video`：背景全透明（供 Web 外壳的 DOM 视频透出，外壳由 BG4 会话负责）

## 2. 工作目录与 git 规则（强制）

- 工作目录：`F:\OpenCode Projects\雷霆酷跑\.worktrees\BG1`（分支 `sess/BG1`，用户已创建）
- 只在本 worktree 内改动；禁止 `checkout / merge / rebase / push`；不要碰其他 worktree 与主目录的文件
- 在 worktree 内先执行 `npm install`，提交前 `npm run check` 必须全绿
- 完成后只提交你新增/修改的文件，提交信息以 `BG1: ` 开头；**不要 push**
- 禁止运行 Cocos 构建（`npm run build:web` 等），不要修改 `build/`、`dist/`

## 3. 开工先读

- `docs/00-总览与范围.md` §1；`docs/04-UI规范与界面清单.md` 主界面相关节
- 现有代码：`assets/scripts/ui/panels/MainMenuPanel.ts`（重点 `buildBackground` / `onCreate`）、`assets/scripts/ui/framework/Assets.ts`（`applySprite` / `loadSprite` 的行为与占位降级）、`assets/scripts/ui/framework/UIKit.ts`（`node` 等工具）
- 冻结接口文件：`assets/scripts/ui/panels/ParallaxLayers.ts`（**勿修改签名**）
- 素材现状：`assets/resources/images/bg/main.png`（1007×1562）是「带 UI 的 mock」，后续会被纯净底图替换；本会话不处理素材

## 4. 冻结接口（必须按此实现）

```ts
// assets/scripts/ui/panels/MainMenuBackground.ts 必须导出：
export type BackgroundMode = 'static' | 'parallax' | 'video';

/** web 上读取 location.search 的 bg 参数（static|parallax|video）；其它平台/缺省/解析异常一律 'static' */
export function resolveBackgroundMode(): BackgroundMode;

/** 在 parent 下创建背景结构并返回句柄（dispose 时清理自建节点与更新） */
export function createMainMenuBackground(parent: Node, mode: BackgroundMode): { dispose(): void };
```

背景结构要求（务必遵守）：

1. `Background` 根节点下拆两棵子树：
   - `fallback` 子节点：Graphics 三段色块（沿用现 `buildBackground` 的 BG_SKY / BG_SEA / BG_SAND 颜色与矩形参数），**独立节点**
   - `image` 子节点：`applySprite(bgMain)` 全屏，**独立节点**
   - 目的：修复现在 Background 节点同时挂 `Graphics` + `Sprite` 导致引擎告警、底图被色块盖住的问题（底图应在色块之上）
2. `static`：`fallback` + `image` 都创建（图加载成功后自然遮住色块；失败保留色块）
3. `parallax`：同 static，另在底图 SpriteFrame 加载成功后，取 `spriteFrame.texture` 并调用：
   ```ts
   createParallaxLayers(背景根节点, {
     texture, textureSize: { width: texture.width, height: texture.height },
     designSize: { width: 750, height: 1624 },
   })
   ```
   并用 `update(dt)` 持续驱动（建议在 `MainMenuBackground.ts` 内实现一个私有 `Component`（如 `BackgroundTicker`）挂到 Background 根节点驱动；注意组件销毁时停止）
4. `video`：`fallback` 与 `image` 都不创建（背景保持无渲染内容、全透明），仍返回可用的句柄
5. `dispose()`：销毁自建节点、解除更新

## 5. 改动文件

- 新增 `assets/scripts/ui/panels/MainMenuBackground.ts` + `.meta`（meta 可复制 `Theme.ts.meta`，改一个新的 uuid）
- 修改 `assets/scripts/ui/panels/MainMenuPanel.ts`：`buildBackground()` 改为调用 `createMainMenuBackground(this.node, resolveBackgroundMode())` 并保存句柄（面板销毁时 dispose；参考 `BasePanel` 生命周期选择合适位置）
- 不改其他文件

## 6. 自检

- `npm run check` 全绿（typecheck:core + typecheck:cc + 单测）
- 人工核对：`resolveBackgroundMode` 对 `?bg=video`、`?bg=parallax`、缺省、非法值、非 web 环境的返回值行为

## 7. 报告

写 `docs/reports/BG1-背景框架与模式.md`：改动文件清单、模式解析规则、验证结果（check 摘要）、遗留与风险（如：视差真实效果待 BG2 合并且由主会话构建后目测；`video` 模式在微信端暂无对应实现，仅 web 实验用）。
