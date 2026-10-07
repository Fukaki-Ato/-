# BG3 切带分析与代理视频 完成报告（主会话接管）

> 背景：BG3 子会话完成切带分析脚本与首轮产物后阻塞在「代理视频录制」环节；主会话于集成阶段接管完成剩余工作。
> 相关提交：`analyze-crops.mjs`（子会话产出，主会话代为提交）+ `record-bg-video.mjs` + `ParallaxLayers.ts` 校准值 + 本报告。

## 交付物

| 产物 | 说明 |
| --- | --- |
| `scripts/bg-eval/analyze-crops.mjs` | 切带分析：迷你静态服务 + headless Edge + canvas 裁剪，导出候选区域 PNG + `crops.json` + `overlay.png`（BG3 子会话产出） |
| `scripts/bg-eval/record-bg-video.mjs` | 代理视频录制：canvas 2D 复刻「云带 + 海浪带」动画，MediaRecorder 录 webm，`Browser.setDownloadBehavior` 落盘（主会话完成） |
| `temp/bg-eval/bg-test.webm` | 代理视频：**540×1170、30fps、8 秒、静音、无缝循环**，vp9、约 1.54 MB（未入库，temp 已忽略） |
| `assets/scripts/ui/panels/ParallaxLayers.ts` | `DEFAULT_PARALLAX_CROPS` 已按最终校准值更新 |

## 切带评估（已目测全部候选图）

| 候选 | 评估 | 结论 |
| --- | --- | --- |
| cloud-a (0.14,0.42,0.44,0.16) | 左侧大片椰叶入画 | 弃用 |
| cloud-b (0.24,0.28,0.34,0.26) | 基本干净，四角有少量椰叶尖 | 备选 |
| **cloud-p1 (0.27,0.29,0.31,0.24)** | 纯天空 + 淡云丝，无杂物 | **采用（云带）** |
| cloud-p2 (0.18,0.40,0.39,0.14) | 云团更多，但左缘有椰叶 | 弃用 |
| wave-a (0,0.675,0.24,0.13) | 右缘椰树入画 | 弃用 |
| wave-b (0.01,0.68,0.21,0.11) | 右缘仍有绿色残留 | 弃用 |
| **wave-p (0,0.687,0.19,0.105)** | 纯海浪 + 海平线，无杂物 | **采用（海浪带）** |
| wave-p-tight (0.02,0.69,0.17,0.10) | 与 wave-p 相近、更窄 | 备选 |
| sea-horizon (0,0.655,0.24,0.06) | 内含一只烘焙海鸥 | 弃用 |
| beach-sand (0.6,0.75,0.18,0.11) | 实为「开始酷跑」横幅 + 海星区域，不可用 | 弃用 |

最终校准值（与 `ParallaxLayers.ts` 一致，y 自顶部向下）：

- 云带：`x 0.27, y 0.29, w 0.31, h 0.24`，screenHeight 350、screenY 313、speed +8、mirror
- 海浪带：`x 0, y 0.687, w 0.19, h 0.105`，screenHeight 380、screenY -482、speed -14、mirror

## 代理视频循环方式（重要说明）

- 为保证金循环无缝，代理片采用**正弦往复漂移**（sin 在 t=0 与 t=8s 完全重合），振幅：云 30px、浪 50px（视频像素）；视差模式为匀速单向滚动。
- 正式视频将由美术按「首尾帧一致」制作，本代理片仅用于本机效果/经济性对比。
- MediaRecorder 产物无时长元数据（已知限制，browser 循环播放不受影响）。

## 遗留与风险

1. 代理片内容是「mock 图切带 + 纯色底」，与视差模式共享同一套条带内容，公平对比；但正式效果依赖美术分层图。
2. 海平线会随海浪带水平移动（真实分层图不会出现此问题）。
3. 录制脚本与 `DEFAULT_PARALLAX_CROPS` 是两份常量（注释互相引用）；若后续调参需同步两处。
