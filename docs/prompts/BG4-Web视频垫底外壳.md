# BG4 Web 视频垫底外壳（并行实验会话开场提示词）

> 实验背景：本次任务用于「主界面动态背景方案对比」。BG4 负责 Web 侧的「视频垫底」通道：DOM 视频在游戏画布下方播放，游戏 UI 绘制在其上（透明画布）。

## 1. 目标

让 web 构建支持 `?bg=video`：页面里用 DOM `<video>` 作为条幅背景层（位置与游戏画布一致），配合引擎透明画布宏，实现「视频垫底、UI 在上」的效果，供对比实验使用。

## 2. 工作目录与 git 规则（强制）

- 工作目录：`F:\OpenCode Projects\雷霆酷跑\.worktrees\BG4`（分支 `sess/BG4`，用户已创建）
- 只在本 worktree 内改动；禁止 `checkout / merge / rebase / push`；不要碰其他 worktree 与主目录的文件
- 本次改动为模板/脚本，不在 tsconfig/vitest 范围，可不装依赖、不跑 `npm run check`；脚本需 `node --check` 通过
- 完成后提交你新增/修改的文件，提交信息以 `BG4: ` 开头；**不要 push**
- 禁止运行 Cocos 构建，不要修改 `build/`、`dist/`（**注意：本会话只改 `build-templates/`**，主会话构建时会自动套用）

## 3. 开工先读

- `build-templates/web-desktop/index.html`（已含竖屏适配 fit 脚本）与 `build-templates/web-desktop/style.css`
- `docs/11-Web构建与溯源.md`（了解构建产物结构，不要执行构建）
- 已核实事实：`settings.json` 的 `engine.macros.ENABLE_TRANSPARENT_CANVAS` 会在引擎初始化时被应用（`macro.init` 读取），WebGL 上下文以 `alpha` 创建 → 画布可透明

## 4. 改动

1. `build-templates/web-desktop/index.html`：
   - 在现有 `fit()` 中维护背景视频：当 `location.search` 含 `bg=video` 时，确保存在 `<video id="bgVideo" src="./bg-test.webm" muted loop playsinline autoplay></video>`
   - `#bgVideo` 与 `#GameDiv` 同矩形：fit() 同步 left/top/width/height（相对页面，absolute 定位），`object-fit: cover`
   - 层级：视频必须**在游戏画布之下**（如 `#bgVideo { z-index: 0 }`、`#GameDiv { position: relative; z-index: 1 }`）
   - 视频文件缺失/播放失败要静默降级（catch/onerror 不抛错；页面照常运行）
2. `build-templates/web-desktop/style.css`：`#bgVideo` 基础样式（`pointer-events: none`、初始 `display: none`，由脚本按模式显示）
3. 新增 `scripts/bg-eval/patch-transparent-canvas.mjs`：
   - 读取 `build/web-desktop/src/settings.json`，将 `engine.macros.ENABLE_TRANSPARENT_CANVAS` 置为 `true`（幂等；找不到文件则非 0 退出并提示「请先构建」；打印修改前后值）
4. 报告 `docs/reports/BG4-Web视频垫底外壳.md`：
   - 使用说明：构建 → `node scripts/bg-eval/patch-transparent-canvas.mjs` → 把 `temp/bg-eval/bg-test.webm` 拷到 `build/web-desktop/` → 打开 `?bg=video`
   - 风险与回退：若实测画布仍不透明（宏未生效），在报告中记录观察到的现象与已排查项，供主会话决策

## 5. 验收

- `node --check scripts/bg-eval/patch-transparent-canvas.mjs` 通过；HTML/CSS 人工审阅无误
- 不改 `assets/`、不跑构建、不改 `build/`
