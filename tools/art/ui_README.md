# 共享自绘 UI：离线像素观察

这三个独立工具用于核对现有共享页面布局、字体、肖像和滚动裁剪；不是 Web 测试站。
无需端口、HTTP、浏览器、外部发布、云服务或收费模型。所有样例均为 **offline/sample**，
不是实际玩家或云确认结果，也不构成微信开发者工具、真机或性能验收。

## 使用

运行目录为仓库根目录；使用仓库已有 esbuild/Three，不增加 npm 依赖，不读 dist/build。
Python 环境需要免费 `moderngl glcontext Pillow numpy`，Linux EGL/Mesa 软件渲染库。
本次任务的隔离环境（临时目录可能被清理）：

```sh
D=/tmp/opencode/thunder-ui-KpLhky
source "$D/env.sh"
P="$D/venv/bin/python"

# 所有输出必须是不存在的新路径，父目录需已存在。
node tools/art/ui_snapshot.mjs --page lobby --width 320 --height 620 --out "$D/new-lobby.json"
"$P" tools/art/ui_render.py "$D/new-lobby.json" "$D/new-lobby.png"

# 一次真实 UiInput down/move/up，将内容拖到末尾，再推进布局/物理。
node tools/art/ui_snapshot.mjs --page result-failed --width 390 --height 760 --scroll --out "$D/new-result-bottom.json"
"$P" tools/art/ui_render.py "$D/new-result-bottom.json" "$D/new-result-bottom.png"

# 针对存在肖像、标题和裁剪溢出的首屏做真实像素检查。
"$P" tools/art/ui_probe.py "$D/new-lobby.json" "$D/new-lobby.png" --out "$D/new-pixel-check.json"
```

页面：`boot` / `lobby` / `result-pending` / `result-failed` / `leaderboard` / `roles` / `shop` / `inventory` / `settings`。
另支持 `tasks-*` / `handbook-*` 的 `ready/loading/load-failed/claiming/claimed/failed/missing` 状态、`tasks-weekly`，
以及 `hud-ready/hud-cooldown/hud-charge/hud-buffs`。`ui_states.mjs` 使用项目纯福利规则生成offline/sample快照和模拟领奖，
pending/failed经实际按钮的UiInput路径触发；没有SDK上下文、云身份或真实钱包写入。`--fixture` 还可传`welfare`和`hud`样例。
默认 390×760，支持 320×620、430×860 等逻辑尺寸，均视为 WX **已经扣除安全区**，dpr=1。
默认字体与WX一致为`assets/fonts/noto`；可用`--font-dir assets/fonts`观察保留的旧字体，或传独立候选目录作切换前比较。
`--character char_ama` 可切换真实肖像；`--scroll` 需要该尺寸下确有可滚动内容。
拖动是单次合成 raw-pointer 事件，其终点可能在视口外；它检查页面输入/裁剪链，不模拟真人手势可达范围。

可传 `--fixture /absolute/new-sample.json` 提供明确的观察数据，键为：

- `wallet: {coins, diamonds}`：大厅样例余额。
- `summary`：结算样例统计；pending/failed 状态仍由页面参数决定。
- `leaderboard`：真实 `LeaderboardData` 形状的离线样例。
- `commerce`：真实 `CommerceSnapshot` 形状的离线样例。

`roles/shop` 调用当前 `mountCommercePage` 第五参数 `{portraits, content}`，
`leaderboard` 调用 `mountLeaderboardPage` 可选第四参数 `{portraits}`。
回调为空操作，样例 `load/list` 只返回内存对象，没有云请求、上传、购买、出战或主题写入。
商店页面现有“已同步服务器记录”文案来自源码对样例协议回包的显示，截图 JSON 的
`offline/sample` 标记才是此观察的实际来源；这不是一次真实服务器同步。

## 捕获的内容

`ui_snapshot.mjs` 内存 bundle **包内 TS 源码**，alias `@tr/framework`/`@tr/game` 到各自 `src`。
注入本地真实字体 PNG/metrics 和肖像 PNG，建立真实 `UiHost`、页面并 tick；空 renderer
仅让宿主完成布局/paint，后续离线 GPU 才负责生成像素，不导入 Web DOM 入口。

JSON 包含实际正交相机、visible 祖先筛选后的 mesh、drawRange/材质组、紧凑 geometry/index/UV、
matrixWorld、renderOrder、原始 shader/uniform、纹理来源与 PNG SHA256。未使用的字形容量和隐藏网格不导出。
DataTexture 导出实际 RGBA8；文件纹理由 Pillow 解码，捕获时校验仍是同一文件。

`ui_render.py` 使用 EGL/ModernGL 实际编译这些 GLSL：补 Three 的 position/uv/matrix 前缀，
将 varying/texture2D/gl_FragColor 改为 GLSL330 对应语法，保留原裁剪循环、SDF derivative/fwidth、
海湾计算、纹理采样与颜色输出。没有重新排版、系统字体替换、设计稿替代或 shader 色彩近似。
NoColorSpace 直通颜色、原 flipY、filter/mipmap、alpha blend、renderOrder 保持共享 UI 约定；
PNG 顶行直接对应 flipY=false 的 uv.y=0。只有 scene.background 按 Three 原约定 linear→sRGB。
默认 4×MSAA，可用 `--samples 0` 关闭用于像素诊断。另生成 `<name>.png.json` 捕获元信息。

当前支持这些页面实际使用的 ShaderMaterial、NormalBlending、RGBA8 DataTexture 与本地 PNG；
其他材质/纹理契约显式报错。不是完整 Three/WebGLRenderer 的离线替代。
桌面 Mesa 编译器、采样模式和 mipmap 实现与目标 WebGL 可能存在细微像素差异。

## 本次证据

环境：`/tmp/opencode/thunder-ui-KpLhky/venv`；库：`libs/usr/lib/x86_64-linux-gnu`；
`env.sh` 配置进程内 LD_LIBRARY_PATH、GL 驱动路径、glcontext libGL/libEGL、Mesa vendor JSON。
实际 renderer：**llvmpipe (LLVM 17.0.6, 256 bits)**，OpenGL 4.5 / Mesa 24.0.5。

最初 `python3 -m venv` 因系统缺 ensurepip 失败；从官方 Ubuntu deb 提取 pip wheel 到任务目录，
再由该 wheel 在隔离 venv 安装依赖。apt 缓存的 Mesa 25.2.8 `.3` 下载 404，改用同一缓存可用的
Ubuntu 基础版 Mesa 24.0.5；所有 deb 按 `apt-cache show` 的 Filename/SHA256 从
`https://archive.ubuntu.com/ubuntu/` 下载、校验、仅解压。补齐缺失 EGL/DRI 依赖后成功。
未安装系统包；完整成功下载校验记录见任务目录 `packages.log`，Python 安装记录见 `pip.log`。

输出均在该任务目录：

| 图像 | 实际内容 |
| --- | --- |
| `lobby-320.png` | 320×620 首屏，38 draw calls，3 shader programs，7,848 种 RGB |
| `lobby-430.png` | 430×860 首屏，38 draw calls，3 shader programs |
| `lobby-320-bottom.png` | UiInput 拖到底部；offset=maxOffset=83.70834 |
| `result-pending-390.png` | 390×760 等待确认，43 draw calls，3 shader programs |
| `result-failed-320-bottom-v2.png` | 320×620 失败/重试区域，offset=maxOffset=494.89344 |
| `leaderboard-390.png` | 离线样例榜单，51 draw calls；真实肖像 |
| `roles-390.png` / `shop-390.png` | 第五参数美术与内容接口已接通的样例首屏 |

每张同名 `.json` 为场景快照，`.png.json` 为软件 GPU 捕获信息。
旧 `result-failed-320-bottom.png` 是修正拖动距离前的中间位置（offset 400.71），以 `-v2` 为底部证据。
最初拖动超出 maxOffset，物理回弹+布局 clamp 使大厅回到顶部，工具已改为拖动恰好 maxOffset 并重验。

`pixel-check.json`：真实标题 1,702 个 alpha 像素；opaque 字体 RGB 与 uniform 完全相等；
368 个稳定肖像采样点直接匹配原 `char_volt.png`（最大 RGB 差 2，平均 0.351，倒置比较平均差 50.870）；
这些点也匹配整页 PNG；真实裁剪将原本越界的 9,324 像素降为 0。不是仅凭文件存在判成功。
已读图检查 320/430 大厅及结算失败底部；320 大厅英雄区副文案落在海色上的低对比是现有页面问题，
工具不改变页面。以上均为离线 UI 观察，不包含真实云或微信目标端验收。

主代理随后为大厅角色副文案添加纸色信息底，已实读修正后320/430图；最新软件GPU捕获在
`/tmp/opencode/thunder-ui-checked-35gkNK/`，含配置启动页、结算等待/失败底部与首币前独立纪录，
各页新文案无缺字。最新`pixel-check.json`仍通过标题原色、portrait正向采样和滚动裁剪检查。
角色/商店/仓库/主题设置/榜单的窄屏图位于`/tmp/opencode/thunder-ui-final-4SmDep/`。

2026-11-07补充状态观察：旧手机HUD固定560px导致多增益在320px越界，基线在
`/tmp/opencode/thunder-welfare-before-wCO2yH/`。修正后在`/tmp/opencode/thunder-welfare-after-gQNTHJ/`，
含任务/手册加载、可领、领取中、已领、领取/加载失败，以及HUD就绪/冷却/积攒/多增益和430px对照。
主代理实际读图确认320px增益完整换行、430px可以一行显示；旧HUD默认分支保留，WX使用新的自适应布局。
HUD截图透明区域显示为黑色观察底，不是跑局/目标端背景证据；所有新状态缺字检查通过。

2026-11-07许可字体切换：候选对比在`/tmp/opencode/thunder-font-candidate-jrggp9/observations/`，
正式路径复拍在`/tmp/opencode/thunder-noto-final-wcVpug/`。新像素检查确认字体原色误差0、
363个肖像稳定采样最大RGB误差2、真实裁剪越界6234→0，字体来源为新Noto目录。
这些新结果替代旧字体下的具体像素数，不把两个字体版本的数字混用；仍是offline/sample。
