# BG3 切带分析与代理视频（并行实验会话开场提示词）

> 实验背景：本次任务用于「主界面动态背景方案对比」。BG3 负责两件事：从参考图里找出「可动的干净条带」，并用同一套参数录制一段代理视频，供视频方案与视差方案做同内容对比。

## 1. 目标

1. **切带分析**：从 `assets/resources/images/bg/main.png`（1007×1562，**带烘焙 UI 的 mock 设计稿**）中找出「纯净、无烘焙 UI」的可用条带区域（上部天空/云、下部海浪、其它你认为可用的），产出人眼可检查的裁剪图 + 建议参数（JSON）
2. **代理视频**：用同一套条带参数，在 canvas 里复刻「云带 + 海浪带」循环滚动动画并录制 8 秒 webm，落盘 `temp/bg-eval/bg-test.webm`

## 2. 工作目录与 git 规则（强制）

- 工作目录：`F:\OpenCode Projects\雷霆酷跑\.worktrees\BG3`（分支 `sess/BG3`，用户已创建）
- 只在本 worktree 内改动；禁止 `checkout / merge / rebase / push`；不要碰其他 worktree 与主目录的文件（**允许只读**访问主工作区路径，用于参考）
- 本次改动仅为 Node 脚本（不在 tsconfig/vitest 范围），可不安装依赖、可不跑 `npm run check`；但脚本必须 `node --check` 通过并实际试跑成功
- 完成后提交你新增的文件，提交信息以 `BG3: ` 开头；**不要 push**
- 禁止运行 Cocos 构建（`npm run build:web` 等），不要修改 `build/`、`dist/`
- 产物目录用 `temp/bg-eval/`（已被 .gitignore 忽略，只提交脚本与报告）

## 3. 开工先读 / 参考实现

- `C:\Users\xwzd\AppData\Local\Temp\opencode\s11-smoke.js`：headless Edge + CDP + 脚本内静态服务 + 页面辅助对象的完整范例（连接、导航、求值、截图都可照抄思路）
- `assets/scripts/ui/panels/ParallaxLayers.ts`：`ParallaxCropSpec` 字段定义（你的 JSON 必须与之一致）
- 本机环境：Node v24（自带全局 `WebSocket`）；Edge 路径见 s11-smoke.js 的查找方式
- 注意：canvas 里加载 `file://` 图片会污染画布导致录制失败，**必须用 HTTP 服务**（脚本内起一个即可）

## 4. 交付物

1. `scripts/bg-eval/analyze-crops.mjs`
   - 自带迷你静态服务（端口自选，避免 8900/8923 等常见占用；可参数化）
   - 用 headless Edge 打开一个页面，在 canvas 中加载 `assets/resources/images/bg/main.png`
   - 按候选区域（归一化 rect）导出 PNG 到 `temp/bg-eval/crops/region-*.png`（文件名带坐标），供人眼检查
   - 输出 `temp/bg-eval/crops.json`：
     ```json
     {
       "source": "assets/resources/images/bg/main.png",
       "sourceSize": [1007, 1562],
       "recommended": [
         { "x": 0.15, "y": 0.18, "w": 0.7, "h": 0.2,
           "screenHeight": 350, "screenY": 313, "speed": 8, "mirror": true, "note": "云带" },
         { "x": 0.0, "y": 0.66, "w": 0.35, "h": 0.24,
           "screenHeight": 380, "screenY": -482, "speed": -14, "mirror": true, "note": "海浪带" }
       ]
     }
     ```
     （x/y/w/h 为源图归一化区域，**y 从图像顶部向下量**，与 `SpriteFrame.rect` 口径一致；`screenHeight/screenY/speed` 为屏幕侧参数：screenY 相对屏幕中心、向上为正；speed 正值向右，设计 750 宽坐标系）
2. `scripts/bg-eval/record-bg-video.mjs`
   - 用 `recommended` 参数在 canvas 复刻滚动动画：云带向右、海浪带向左（速度比例与 JSON 一致）
   - 分辨率建议 540×1170（=750×1624 的 0.72 倍），30fps，8 秒，静音；画面内容 = 条带动画 + 深色底（不要渲染任何 UI）
   - `MediaRecorder` 录制 webm（优先 vp9，`isTypeSupported` 不支持则 vp8）；文件保存到 `temp/bg-eval/bg-test.webm`
   - 落盘方式：页面触发下载 + CDP `Browser.setDownloadBehavior`（或等效可靠方案）；结束打印路径/大小/时长
   - 已知限制：MediaRecorder 产出的 WebM **无时长元数据**（部分播放器显示未知时长），对 `<video loop>` 背景播放无碍；本机未安装 ffmpeg，无法重封装，请在报告中记录
   - Edge 启动参数建议追加 `--disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows`，保证录制期间不被节流
3. 报告 `docs/reports/BG3-切带分析与代理视频.md`
   - 每个候选区域的**纯净度评估**（是否含烘焙 UI、为何可用/不可用）
   - **最终推荐 rect 列表**（主会话将用它校准 ParallaxLayers 与视频）
   - 视频文件规格说明与录制/播放注意事项

## 5. 验收

- 两个脚本可重复运行、可覆盖输出；`node --check` 通过
- `temp/bg-eval/bg-test.webm` 真实存在且可播放（可用浏览器工具打开自验）
- `temp/bg-eval/crops/` 下有可检查的区域图，且你能在报告里说明每一张的取舍理由
- 不修改 `assets/` 下任何游戏代码与资源
