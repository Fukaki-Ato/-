# BG5 对比测量脚本（并行实验会话开场提示词）

> 实验背景：本次任务用于「主界面动态背景方案对比」。BG5 负责自动化测量脚本：对 `?bg=static|parallax|video` 三种模式自动进入主界面，采样 FPS、纹理内存、Draw call、JS 堆、console 计数并截图，输出 JSON 与终端表格。

## 1. 目标

独立、可重复运行的 headless 测量脚本 `scripts/bg-eval/measure.mjs`。测的是「本机 web 端的相对开销」；真机（微信）内存另测，不在本会话范围。

## 2. 工作目录与 git 规则（强制）

- 工作目录：`F:\OpenCode Projects\雷霆酷跑\.worktrees\BG5`（分支 `sess/BG5`，用户已创建）
- 只在本 worktree 内改动；禁止 `checkout / merge / rebase / push`；不要碰其他 worktree 与主目录的文件
- 本次改动为 Node 脚本（不在 tsconfig/vitest 范围），可不装依赖、不跑 `npm run check`；脚本 `node --check` 通过并完成 dry-run
- 允许**只读**访问主工作区现有构建目录：`F:\OpenCode Projects\雷霆酷跑\build\web-desktop`（dry-run 用；勿修改）
- 完成后提交你新增的文件，提交信息以 `BG5: ` 开头；**不要 push**
- 禁止运行 Cocos 构建，不要修改 `build/`、`dist/`

## 3. 开工先读 / 参考

- `C:\Users\xwzd\AppData\Local\Temp\opencode\s11-smoke.js`：CDP 连接、`__smoke` 页面辅助对象（穿隐私门禁、按标签点击）、截图、静态服务，全套手法可直接借鉴
- 引擎事实：`cc.profiler.showStats()` / `hideStats()` 控制性能统计面板；面板渲染为页面 DOM/文本，可用正则从文本提取 `Framerate (FPS)`、`GFX Texture Mem(M)`、`Draw call`、`Triangle` 等字段（实现时先在你的 dry-run 中确认实际文本格式，做容错解析）
- 本机环境：Node v24（自带全局 `WebSocket`）；Edge 路径参考 s11-smoke.js

## 4. 交付物 `scripts/bg-eval/measure.mjs`

参数（CLI 或环境变量）：`--url`（默认 `http://127.0.0.1:8934/`）、`--serve <dir>`（默认 `build/web-desktop`，脚本内置迷你静态服务；`--no-serve` 可关闭）、`--modes`（默认 `static,parallax,video`）、`--out`（默认 `temp/bg-eval/`）。

每个模式独立执行（单模式失败不中断整体，记录错误继续）：

1. 启动 headless Edge（临时 user-data-dir；软渲染/尺寸参数参考 s11-smoke.js；追加 `--autoplay-policy=no-user-gesture-required --disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows`）
2. 打开 `<url>/?bg=<mode>`；等待引擎与 Main 场景就绪（参考 s11 的等待表达式）
3. 用 `__smoke` 手法穿隐私门禁（新 profile 首启会出现）直到主界面
4. 静置 3 秒稳定后，注入 rAF 计数器采样 **8 秒**：输出 avg / min FPS
5. `cc.profiler.showStats()` 后读取统计文本（纹理内存/Draw call/Triangle），随后 `hideStats()`
6. 读取 `performance.memory.usedJSHeapSize`
7. CDP 截图到 `temp/bg-eval/shots/<mode>.png`
8. 记录本模式期间的 console error / warning 计数

输出：
- `temp/bg-eval/measure-report.json`（每模式一条：fps、textureMem、drawCall、jsHeap、consoleCounts、截图路径、耗时、错误）
- 终端表格（列对齐，便于贴报告）

健壮性要求：每模式超时上限 ~90s；退出时清理 Edge 进程；所有解析做容错（字段缺失记 null）。

## 5. 验收（dry-run）

- 对**主工作区现有构建**（绝对路径）跑一次 dry-run：
  - 当前构建尚未包含 `?bg` 模式（BG1 合并前），三种模式表现会与 static 相同，属预期；目的是验证采集链路
  - 至少 `static` 模式完整跑通并产出 JSON + 截图
- 报告里附 dry-run 的终端输出摘要与观察（如统计文本实际格式、有无字段拿不到）
- 不修改游戏代码、不跑 Creator 构建

## 6. 报告

写 `docs/reports/BG5-对比测量脚本.md`：脚本用法、dry-run 结果、字段解析说明与已知限制（例如 headless 软渲染下 FPS 不代表真机、视频解码开销无法在 web 上等价测量等）。
