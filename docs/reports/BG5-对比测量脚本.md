# BG5 对比测量脚本（dry-run 报告）

> 会话：BG5（worktree `.worktrees/BG5`，分支 `sess/BG5`）。交付 `scripts/bg-eval/measure.mjs` 与本报告。
> 范围：本机 web 端（headless Edge）的「相对开销」采集链路；真机（微信）内存与视频解码不在本会话范围。
> 本次为 **dry-run**：被测构建尚未包含 `?bg` 模式（BG1 合并前），三种模式表现相同属预期，目的是验证采集链路。

## 1. 交付物与用法

`scripts/bg-eval/measure.mjs`：Node ESM，单文件、无第三方依赖（Node >= 21 自带全局 `WebSocket`；本机实测 v24.19.0）。

### 参数（CLI 优先，可回退同名环境变量）

| 参数 | 环境变量 | 默认 | 说明 |
| --- | --- | --- | --- |
| `--url <url>` | `BG_EVAL_URL` | `http://127.0.0.1:8934/` | 页面地址（内置服务的监听端口取自该 URL） |
| `--serve <dir>` | `BG_EVAL_SERVE` | `build/web-desktop` | 内置迷你静态服务根目录；相对路径按当前工作目录解析 |
| `--no-serve` | `BG_EVAL_NO_SERVE=1` | 关 | 关闭内置静态服务（已有外部服务时） |
| `--modes <list>` | `BG_EVAL_MODES` | `static,parallax,video` | 逗号分隔，按顺序逐个测量 |
| `--out <dir>` | `BG_EVAL_OUT` | `temp/bg-eval` | 输出目录（JSON、截图、临时 profile） |
| `--timeout <sec>` | `BG_EVAL_TIMEOUT` | `90` | 单模式总超时秒数 |

### 示例

```bash
# dry-run 用法：对主工作区现有构建（绝对路径，只读）
node scripts/bg-eval/measure.mjs --serve "F:\OpenCode Projects\雷霆酷跑\build\web-desktop"

# 只测一个模式 / 已有外部服务
node scripts/bg-eval/measure.mjs --serve "..." --modes static
node scripts/bg-eval/measure.mjs --url http://127.0.0.1:8934/ --no-serve
```

### 输出

- `temp/bg-eval/measure-report.json`：每完成一个模式即落盘（中断不丢已完成数据）
- `temp/bg-eval/shots/<mode>.png`：每模式主界面截图
- 终端对齐表格（便于贴报告）

## 2. 每模式流程（独立执行，失败不中断整体）

1. 启动 headless Edge：临时 user-data-dir（`<out>/profiles/profile-<mode>`）、动态空闲 CDP 端口；软渲染与尺寸沿用 S11（`--headless=new --enable-unsafe-swiftshader --use-angle=swiftshader --window-size=800,1400`，CDP 端 `375x812@2x mobile`），追加 `--autoplay-policy=no-user-gesture-required --disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows`，另加 `--enable-precise-memory-info` 提高 `performance.memory` 精度
2. 打开 `<url>/?bg=<mode>`；等待 `cc.game._inited` 与 `Main` 场景就绪（沿用 S11 等待表达式）
3. 注入 `__smoke` 辅助对象，轮询隐私门禁（`已阅读` / `同意并继续`）直到 `Panel_MainMenu` + `StartButton`；出现「启动失败」面板则记错误
4. 静置 3s 后注入 rAF 计数器采样 **8s**：`avg = (帧数-1)/首末时间差`，`min = 按 1s 桶的最小帧数`（排除末尾不完整桶），另记录 `maxFrameMs` 与每桶计数
5. `cc.profiler.showStats()` → 读取统计文本 → `cc.profiler.hideStats()`（顺序同提示词）
6. 读取 `performance.memory.usedJSHeapSize`（不可用记 null）
7. `Page.captureScreenshot` 写 `shots/<mode>.png`
8. 统计本模式期间的 CDP console error / warning 与未捕获异常（console-api 与 Log 域去重）

健壮性：单模式 90s 总上限（所有等待/求值/采样统一按剩余时间竞速）；退出与异常路径均清理 Edge 进程（`taskkill /PID /T /F` + 进程退出钩子）；失败模式仍尽力补截图与 console 计数；所有字段解析容错，缺失一律 null；`static/parallax/video` 互不影响，整体退出码仅在全部成功时为 0。

## 3. dry-run 结果

- 被测构建：`F:\OpenCode Projects\雷霆酷跑\build\web-desktop`（只读访问，未改动）
  - `BUILD-MANIFEST.json`：Creator 3.8.8、debug、source `6029651`（main，dirty=false）、builtAt `2026-10-06T06:55:35Z`
- 命令：`node scripts/bg-eval/measure.mjs --serve "F:\OpenCode Projects\雷霆酷跑\build\web-desktop"`
- 完整日志：`temp/bg-eval/dry-run.log`；完整数据：`temp/bg-eval/measure-report.json`

### 终端输出摘要

```
[bg-eval] 静态服务：F:\OpenCode Projects\雷霆酷跑\build\web-desktop -> http://127.0.0.1:8934/
[bg-eval] 测量模式：static, parallax, video（单模式超时 90s）
[bg-eval] [static] 引擎就绪（10.6s）
[bg-eval] [static] 主界面就绪（隐私门禁已过，16.0s）
[bg-eval] [static] FPS avg=22.63 min=19（182 帧）
[bg-eval] [static] stats source=profiler-counters drawCall=35 textureMem=23.56MB triangle=841
[bg-eval] [static] 完成，耗时 36.2s
...（parallax / video 同流程）

MODE      OK  FPS avg/min  TEXMEM MB  DRAW  TRI  HEAP MB  ERR/WARN  TIME s  SHOT
--------  --  -----------  ---------  ----  ---  -------  --------  ------  ----
static    ok  22.6/19.0    23.56      35    841  40.0     0/8       36.2    yes
parallax  ok  20.6/20.0    23.56      35    841  33.8     0/8       30.4    yes
video     ok  19.3/17.0    23.56      35    841  35.3     0/8       33.1    yes

[bg-eval] 模式完成 3/3
```

### JSON 摘要

| 模式 | ok | fps.avg/min | maxFrameMs | textureMemMB | bufferMemMB | drawCall | triangle | jsHeapMB | err/warn | durationMs | engine/scene/menu/sample (ms) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| static | true | 22.63 / 19 | 83.3 | 23.56 | 22.54 | 35 | 841 | 40.01 | 0 / 8 | 36163 | 10613 / 12930 / 15982 / 7998 |
| parallax | true | 20.63 / 20 | 83.3 | 23.56 | 22.54 | 35 | 841 | 33.75 | 0 / 8 | 30385 | 9723 / 11940 / 14430 / 7997 |
| video | true | 19.26 / 17 | 99.9 | 23.56 | 22.54 | 35 | 841 | 35.27 | 0 / 8 | 33078 | 9923 / 11983 / 15234 / 7997 |

### 观察

- 三模式截图（`shots/static.png` 等）均为正常主界面，隐私门禁自动通过；`static` 模式完整跑通并产出 JSON + 截图，满足验收。
- 三模式 textureMem/drawCall/triangle 完全一致（23.56MB / 35 / 841），FPS 差异（19-23）在软渲染波动范围内，属「构建未含 `?bg`」的预期。
- console 计数 0 error / 0 异常；8 条 warning 为启动期资源占位降级（图片/音频缺失）与一条渲染组件重复警告，三模式一致，与测量模式无关。
- 单模式耗时 30-36s（其中引擎 9.7-10.6s、主界面 14.4-16.0s，SwiftShader 软渲染），90s 上限充裕。
- 采样实际时长 7.997-7.998s（rAF 时间戳口径），与设定 8s 一致。

## 4. 统计面板字段解析说明（实测，重要）

提示词假设面板渲染为「页面 DOM/文本」；**实测 Creator 3.8.8 并非如此**：

- `cc.profiler.showStats()` 创建离屏 `<canvas>`，把统计文字画进 canvas，再以纹理贴到场景节点（`Profiler.generateNode` + `util/profiler` 材质），页面里没有可抓的 DOM 文本。
- 但面板每个字段的显示值就是 `cc.profiler.stats`（内部 `_profileInfo`）里 `Counter.human()` 的返回值，脚本据此重建等价文本，再用同一套正则解析，并保留三层兜底：

1. **DOM 扫描**：查找同时含 `Draw call` 与 `Framerate`/`Frame time` 的元素并取其 innerText（本构建未命中，为未来引擎/面板变化保留）；
2. **profiler 计数器**（本构建实测命中，`source=profiler-counters`）：按 `_profileInfo` 顺序重建 `desc: human` 文本；
3. **GFX 设备计数兜底**：`profilerInited !== true` 时，textureMem/drawCall/triangle/instances 强制改用 `device.memoryStatus.textureSize` / `numDrawCalls` / `numTris` / `numInstances`（本次未触发）。

实测重建文本（即面板显示内容）：

```
Framerate (FPS): 19
Draw call: 35
Frame time (ms): 1.65
Instance Count: 0
Triangle: 841
Game Logic (ms): 0.05
Physics (ms): 0.02
Renderer (ms): 1.52
Present (ms): 0.01
GFX Texture Mem(M): 23.56
GFX Buffer Mem(M): 22.54
```

解析正则（大小写不敏感，冒号中英文容错，千分位逗号容错）：

| 字段 | 正则 | dry-run 实测 |
| --- | --- | --- |
| fps | `Framerate\s*\(?\s*FPS\s*\)?\s*[:：]?\s*([\d.]+)` | 计数器 19（口径见限制 5） |
| textureMemMB | `GFX\s*Texture\s*Mem\s*\(?\s*M(?:B)?\s*\)?\s*[:：]?\s*([\d.]+)` | 23.56 |
| bufferMemMB | `GFX\s*Buffer\s*Mem\s*\(?\s*M(?:B)?\s*\)?\s*[:：]?\s*([\d.]+)` | 22.54 |
| drawCall | `Draw\s*calls?\s*[:：]?\s*([\d.,]+)` | 35 |
| triangle | `Triangles?\s*[:：]?\s*([\d.,]+)` | 841 |
| frameMs | `Frame\s*time\s*\(\s*ms\s*\)\s*[:：]?\s*([\d.]+)` | 1.65 |
| instances | `Instance\s*Count\s*[:：]?\s*([\d.,]+)` | 0 |

另：showStats 后 600ms 检查 `profilerInited=true`（三模式一致），计数器刷新正常；脚本仍保留「未初始化时调用 `generateNode()` 强制建节点」的兜底路径（本次未触发）。JSON 中同时保留 `stats.text / stats.counters / stats.device / stats.derived` 原始数据，便于后续核对；`stats` 里未列出的字段不猜，一律 null。

## 5. 已知限制

1. **软渲染不代表真机**：SwiftShader 下 FPS 绝对值（19-23）远低于真机 GPU；本脚本用于「本机 web 端相对对比」，不能外推微信/真机表现。
2. **BG1 合并前数据无方案含义**：三模式实际都走 static 路径；本报告数字只证明采集链路可用。
3. **video 解码开销无法在 web 上等价测量**：真机（微信）内存与解码另测；静态服务已支持 Range 请求，为后续 `<video>` 资源加载预留。
4. **JS 堆为近似值**：`performance.memory` 为 Chromium 特有且默认量化，已加 `--enable-precise-memory-info`，但仍受 GC 时机影响；适合同机同流程横向比较。
5. **两套 FPS 口径不同**：面板计数器统计渲染帧（含面板自身开销，实测 19）与 rAF 采样（22.63）不完全一致；脚本以 rAF 为唯一 FPS 口径，面板 fps 仅保留在原始数据中。
6. **console 计数口径**：console-api 源不重复计入 Log 域；未捕获异常单列 `exception`；启动期资源缺失 warning 属构建自身，不应算作某模式开销。
7. **首启开销**：每模式新建临时 profile，含首次启动开销；三模式对等，若需排除可后续增加预热模式。
8. **jsHeap 读取时机**：在 `hideStats()` 之后；showStats 短暂创建的 canvas/纹理可能滞留到 GC，三模式对等。
9. **截图为无面板主界面**：统计面板在截图前已隐藏；如需「面板可见」证据可后续加截图开关。
10. **并行会话干扰**：dry-run 期间本机存在其他并行实验会话，绝对数值会波动；相对对比时应保证独占或多次采样。

## 6. 产物与复现

- 脚本：`scripts/bg-eval/measure.mjs`（本次提交）
- dry-run 产物（未入库，`temp/` 已 gitignore）：`temp/bg-eval/measure-report.json`、`temp/bg-eval/shots/*.png`、`temp/bg-eval/dry-run.log`
- 复现：`node scripts/bg-eval/measure.mjs --serve "F:\OpenCode Projects\雷霆酷跑\build\web-desktop"`
- 本次未修改游戏代码、未跑 Creator 构建、未改动主工作区文件（仅只读访问构建目录）；未 push。
