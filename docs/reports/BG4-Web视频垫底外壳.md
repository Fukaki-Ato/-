# BG4 Web 视频垫底外壳 完成报告

> 目标：Web 构建支持 `?bg=video`，用 DOM `<video>` 作为游戏画布下方的条幅背景层，配合引擎透明画布宏实现「视频垫底、UI 在上」，供背景方案对比实验使用。

## 改动清单

### 修改

- `build-templates/web-desktop/index.html`：在既有 `fit()` 中维护背景视频。
  - 仅当 `location.search` 含 `bg=video` 时创建 `<video id="bgVideo" src="./bg-test.webm" muted loop playsinline autoplay>` 并插入 `body` 首位；缺省模式不创建任何元素。
  - `fit()` 先按 750:1624 缩放 `#GameDiv`，再把 `#bgVideo` 的 `left/top/width/height` 同步为 `#GameDiv` 的外接矩形（含滚动偏移，absolute 定位相对页面）。
  - 静默降级：视频 404/解码失败触发 `error` 则隐藏视频且不抛错；`play()` 返回的 Promise rejection 一律 catch；失败后 resize 不再反复显示。
- `build-templates/web-desktop/style.css`：
  - 新增 `#bgVideo` 基础样式：`position: absolute; z-index: 0; display: none; object-fit: cover; pointer-events: none`（初始隐藏，由脚本按模式显示）。
  - `#GameDiv` 增加 `z-index: 1`，确保游戏画布始终在视频之上。

### 新增

- `scripts/bg-eval/patch-transparent-canvas.mjs`：把 `build/web-desktop/src/settings.json` 的 `engine.macros.ENABLE_TRANSPARENT_CANVAS` 置为 `true`；幂等、打印前后值；找不到产物时非 0 退出并提示「请先构建」。
- `docs/reports/BG4-Web视频垫底外壳.md`：本报告。

## 使用说明（对比实验）

按顺序执行（**先构建、后 patch**，构建会覆盖 `settings.json`）：

1. 构建（主会话执行，自动套用本模板）：`npm run build:web` → 产物在 `build/web-desktop/`。
2. 打开透明画布宏：`node scripts/bg-eval/patch-transparent-canvas.mjs`
   - 预期输出 `engine.macros.ENABLE_TRANSPARENT_CANVAS: false -> true`（或已是 true 时提示幂等）。
3. 拷贝视频：`temp/bg-eval/bg-test.webm` → `build/web-desktop/bg-test.webm`（BG3 产出，模板按同名相对路径引用）。
4. 以静态服务器打开构建目录（`file://` 下模块加载可能受限），例如 `python -m http.server 8080 --directory build/web-desktop` 或任一静态服务工具，然后访问 `http://localhost:8080/?bg=video`。
5. 验证宏是否生效（控制台/CDP）：

   ```js
   document.querySelector('#GameCanvas').getContext('webgl2')?.getContextAttributes()?.alpha === true
   // 无 webgl2 时改用 getContext('webgl')
   ```

   - `true` 即画布已透明；宏在引擎启动时读取，改动后必须**刷新页面**（不是热更）。
6. 预期现象：视频恰好覆盖 `#GameDiv` 矩形（`object-fit: cover`），位于画布下方；游戏 UI 正常响应当前操作。
7. 回归：去掉 `?bg=video` 打开 → 不创建视频元素，页面行为与改动前一致。

## 验证结果

- `node --check scripts/bg-eval/patch-transparent-canvas.mjs`：通过。
- `index.html` 内联脚本提取后 `node --check`：通过；HTML/CSS 人工审阅：符合需求（同矩形、层级、静默降级）。
- 宏脚本在临时 mock 目录实测：产物缺失 → 退出码 1 且提示「请先构建」；宏缺失 → `undefined -> true` 并写入；重复执行 → 幂等（值不变、不再重写）；坏 JSON → 退出码 1。
- 浏览器冒烟（真实浏览器 + 临时静态服务，模板文件原样拷贝且 SHA-256 一致；**非 Cocos 构建产物**）：
  - `?bg=video`：创建 `#bgVideo` 且为 `body` 首元素；`src/muted/loop/playsinline/autoplay` 属性正确；`left/top/width/height` 与 `#GameDiv` 外接矩形一致；中心点命中测试为 `GameCanvas`（视频确在画布下）；重复 resize 不漂移。
  - 视频缺失：`error code 4` → 自动 `display:none`，页面无脚本异常（静默降级）。
  - 有效 webm（页面内 MediaRecorder 生成后补齐）：`readyState=4`、`display:block`、无 error；后台标签页自动播放被策略拦截时由 catch 静默吞掉，前台静音自动播放正常。
  - 无参数：不创建视频元素，行为与改动前一致。
- **本会话未运行 Cocos 构建，未实测画布透明（宏是否生效）与 BG1 相机清屏 alpha**（验收口径：脚本语法检查 + 人工审阅 + 上述 DOM 冒烟）。

## 风险与回退（供主会话决策）

### 依赖：BG1 相机清屏 alpha

即使宏生效，若场景主相机 `clearColor` 的 alpha 不为 0（当前 `clearFlags=7`、`clearColor=(78,195,247,255)`），画布仍会被清屏色填满、视频透不出来。该改动由 BG1 会话负责，联调时需同时确认。

### 画布仍不透明时的排查清单

1. 顺序是否 构建 → patch（构建会重置 `settings.json`）。
2. `build/web-desktop/src/settings.json` 中 `engine.macros.ENABLE_TRANSPARENT_CANVAS` 实际值是否为 `true`（脚本会打印前后值）。
3. patch 后是否刷新了页面（宏仅在启动时读取一次）。
4. 若文件为 `true` 但 `getContextAttributes().alpha` 仍为 `false`：请记录 `settings.json` 中该宏的实际结构（如键名/层级与 `engine.macros` 不符），交主会话核对引擎构建注入路径。

### 视频不可见但画布已透明

- 确认 `build/web-desktop/bg-test.webm` 存在且为浏览器支持的编码（BG3 优先 VP9、回退 VP8）。
- 控制台检查 `document.getElementById('bgVideo')` 的 `display`（应为 `block`）、`readyState`（≥2 可播）、`error`（应为 null）；若视频元素已因 `error` 被隐藏，即为静默降级路径，页面其余功能不受影响。

### 回退

- 模板对缺省路径零影响：不带 `?bg=video` 时不创建视频元素；重新构建即可把宏恢复为默认 `false`（或手动改回 `false` 并刷新）。
- 如需整体停用：`git revert` 本提交即可，不影响 `assets/` 与构建脚本。
