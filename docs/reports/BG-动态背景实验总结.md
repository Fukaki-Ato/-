# BG 动态背景实验总结（待美术素材迭代）

> 状态：**实验完成、未定稿**。static / parallax / video 三种模式均已在本机构建中可用（`?bg=` 切换），等待美术分层图/正式视频素材后进入下一轮迭代与定稿。
> 相关：提示词 `docs/prompts/BG1..BG5`；子会话报告 `docs/reports/BG1..BG5`；代码均已合并至 main（本地）。

## 1. 实验结论（本机 web 测量，SwiftShader 软渲染）

| 模式 | FPS avg/min | 纹理内存 | DrawCall | 三角形 | 备注 |
| --- | --- | --- | --- | --- | --- |
| static | 13.9 / 13.0 | 23.56 MB | 36 | 843 | 基线；mock 底图 + UI 叠画（待纯净底图） |
| parallax | 12.4 / 11.0 | 23.56 MB | 37 | 859 | 成本≈ +1 DrawCall、+2 个四边形填充；Web/微信一套实现 |
| video | 18.8 / 16.0 | 17.56 MB | 34 | 835 | 游戏侧省底图纹理（-6MB）；解码开销不计入（微信需真机另测） |

- FPS 绝对值受软渲染波动大（±10-20%），仅作横向相对参考。
- 测量脚本：`scripts/bg-eval/measure.mjs`（含 video 生效断言）；结果 JSON：`temp/bg-eval/measure-report.json`。

## 2. 资产与实现现状

- 底图：`assets/resources/images/bg/main.png`（1007×1562）为「带 UI 的 mock」，static/parallax 下会全屏拉伸使用（UI 叠画属预期，待纯净底图替换）。
- 视差条带：从 mock 裁出「云带 / 海浪带」两条（校准值见 `ParallaxLayers.DEFAULT_PARALLAX_CROPS`），镜像无缝平铺 + 周期回绕；含覆盖校验。
- 代理视频：`scripts/bg-eval/record-bg-video.mjs` 生成 8 秒循环 webm（正弦往复保证无缝），仅用于 web 端 video 模式验证。

## 3. 下一轮（等美术素材）所需交付物

### 3.1 方案 A：分层动效（推荐起步）

- **纯净底图**（不含任何 UI、无烘焙光斑）：750×1624（或 2x 1500×3248），PNG。
- **可动层**（透明 PNG）：
  - 云带：横向可连续（或镜像可拼）的长条，建议宽度 ≥ 屏幕宽 × 1.5；
  - 海浪/波光带：同上，建议 2 层（远景慢、近景快）；
  - 前景层（可选）：棕榈/沙滩边缘，用于轻微摆动；
  - 点缀小图（可选）：海鸥、花瓣、光斑（粒子用）。
- 或直接提供**分层 PSD/PSB**（天空 / 云 / 海 / 近浪 / 前景 / 点缀），工程侧负责导出 PNG 与接入。
- 路径与命名沿用 `assets/resources/images/bg/`（如 `bg_base.png`、`cloud_strip.png`、`wave_strip.png`…）。

### 3.2 方案 B：视频增强（可选）

- H.264 mp4，竖屏、与设计同比例（建议 720×1558 或 1080×2337，对应 750:1624）；
- 时长 6–10 秒，**首尾帧完全一致**（无缝循环），无音轨；
- 码率 ≤ 4 Mbps、文件尽量 ≤ 5 MB（微信端建议远程 CDN 或分包；主包上限 4M）；
- 交付后先做真机 PoC（`wx.createVideo({ underGameView })` 或 VideoDecoder，DevTools 不支持后者）。

### 3.3 方案 C：Spine（可选升级）

- 分层 PSD + 3–6 秒循环动画，导出 Spine（3.8 或 4.2；4.2 与微信引擎分离插件兼容性需真机实测）。

## 4. 工程侧集成现状（已完成）

- 背景框架：`MainMenuBackground.ts`（`?bg=static|parallax|video`，默认 static；video 模式含相机清屏 alpha 处理与恢复）。
- 视差：`ParallaxLayers.ts` + `parallaxMath.ts`（镜像偶数块、周期回绕、覆盖校验；13 条单测）。
- Web 外壳：`build-templates/web-desktop/`（竖屏条幅适配 + `?bg=video` DOM 视频垫底 + 参数口径与游戏侧一致）。
- 工具链：`scripts/bg-eval/`（切带分析、代理视频录制、透明画布宏补丁、三模式测量）。
- 评审：已通过评审子代理复核，发现项全部修复（`8b9f652`）；整机测试 212 用例全绿。

## 5. 待办（素材到位后）

1. 替换纯净底图 / 接入分层图（用 `analyze-crops.mjs` 重校条带参数）。
2. 重跑 `measure.mjs` 对比效果与开销，选定方案。
3. 定稿后清理实验开关与临时工具、推送正式版本。
