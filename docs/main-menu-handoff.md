# 主界面改版衔接文档（issue #12，2026-10-04）

> 用途：`feature/game-main-menu` 的交接与评审基线。给评审人（@Fukaki-Ato）看「哪些是任务要求、
> 哪些是越界待裁决、哪些坑已经踩过别再踩」；给后续接手主界面板块功能的人看「从哪里接」。
> 相关：任务书 [issue #12]、分工与越界定义见 [collaboration.md](collaboration.md)、
> WX 端基线见 [wx-runtime-findings.md](wx-runtime-findings.md)。

## 一、分支构成

| 分支 | 关系 | 状态 |
| --- | --- | --- |
| `feat/lobby-layout` | 大厅徽标化改版（lucide 矢量图标 → 抠图徽标、四段布局、档案弹层、背景视频） | 本地 10 提交，未推 |
| `feature/game-main-menu` | 从上一条的 tip 开出，加 issue #12 要求的游客直入 + 1024×1536 重排 + 视频背景 | 本地 22 提交，未推 |
| `backup/mainmenu-pre-20261003` | 开分支前的钉点（防丢） | 本地 |

本 PR 的 diff = 两个阶段的全部改动（评审时可按 commit 逐条看，每条都写了「改了什么 + 为什么」）。
`AGENTS.md` 故意不提交（内含本机路径与代理端口）。

## 二、验收对照（issue #12 的验收标准逐条）

| 验收项 | 状态 | 证据 |
| --- | --- | --- |
| 配置加载后直接显示主界面，游客态、不要求登录 | ✅ | `mainFlow.boot()` → `machine.go('select')`；`tests/mainFlow.test.mjs` 断言落 `select` + 入口记 `guest` + `extras.login()` 调用数 0 |
| 参考图主要区域/文案/入口齐全，适配窄高竖屏不变形 | ✅ | `ui/menuLayout.ts` 常量表 + `tests/menu-layout.test.mjs`（390×844 / 412×915 / 360×780 / 800×600 / 320×720 五档，含「不裁出屏」「同列不互压」「侧列贴边」断言） |
| 「开始酷跑」进入现有选角流程 | ✅ | 牌匾 → `onStartRun(chosen)`；选角面板复用现有 `MiniCard`/`List`（`ui/lobbyPanels.ts`），未扩展功能 |
| 未定义入口只有按压反馈，不触发导航/弹窗/登录/API | ✅ | `LobbySlotHandlers` 未注入时是空操作；原先的 `toast「开发中」` 已撤；`tests/pages.test.mjs` 点遍八个入口断言「文案零变化、不新增 toast 胶囊」 |
| 背景动效连续循环、隐藏后停止更新 | ⚠️ 见第三节第 3 条 | Web 端为循环视频；`frame` 钩子随 `mount` 生命周期清空 ⇒ 离开即停 |
| 动画时间/循环逻辑有单测，覆盖循环边界与不同帧间隔 | ✅ | `loopFade(t, P, F)` 纯函数 + `tests/menu-backdrop.test.mjs`（边界连续、60/144/抖动帧率结果一致、参数退化不出 NaN） |
| 更新依赖旧登录页的断言 | ✅ | `mainFlow.test.mjs` boot 用例改写；`pages.test.mjs` 三个 flow 用例改写 |
| `npm run check` / `build:web` / `build:wx` 通过 | ✅ | check 五步全绿（390 用例）；WX 主包 898.6 KB(21.9%)、分包 7.99 MB(26.0%)、整包 8.89 MB(29%) |
| 新增素材路径大小写与 WX 加载格式正确、进对分包、过体积门禁 | ✅ | `tools/build-wx.mjs` 把 `assets/ui/**.png` 拷进 `pkg-assets`；mp4/jpg **有意不进**（微信无 `<video>` 通路） |

## 三、需要维护者裁决的三处偏离

1. **`packages/framework` 公共 API**（任务书写明「不改 framework 公共 API」）
   本分支只留下两处：
   - `LayoutNode.absolute / top / left / right / bottom`（`types.ts` + `layout.ts` + `box.ts`）：
     弹层与「控件叠在背景上」必需。试过用负 margin 伪造叠层 —— 会被 flex 增长吸收，子项落点
     只取决于 outer 尺寸，调不动位置。
   - `host.ts` 的 toast 层改「零宽满高 absolute 锚点 + 胶囊按寿命漂移」：这是**修 bug**，
     旧实现是 in-flow 列 + `padding.bottom:28`，会从页面高度扣掉 28px，屏幕底下永远一条主题底色
     暗带（用户实测反馈的「黑框」）。
   - 原先加的 `NinePatchSource.fit:'cover'` 已随背景方案改动**撤回**（`refactor(framework)` 提交），
     现在背景不走 UI 背景槽。

2. **玩家档案弹层 / 场景切换**（任务书「明确不做角色管理业务逻辑」）
   代码保留在仓（`ui/profileView.ts`、`ui/slideOverlay.ts`、`core/profile/playerProfile.ts`、
   `config params.profile`、10 枚头像素材），但**主界面不接线**——参考图里没有这两个入口。
   档案弹层的测试改成直接挂载 `buildProfileOverlay` 自测，不依赖大厅。
   若维护者接受，入口建议挂到底栏「角色」面板内，而不是新开顶栏头像位。

3. **背景用循环视频**（任务书要的是「云/海/棕榈/海鸟分层循环动效」）
   现状：Web 端 = `assets/ui/menu-bg.mp4`（15.07s / 720×1280 / 无音轨 / 3.0MB）；
   微信端没有 `<video>` 通路 ⇒ 回落同一构图的静态 `assets/ui/menu-bg.png`。
   源片镜头缓慢漂移、**首尾不接** ⇒ 用「起点帧覆盖层淡入淡出」掩盖接缝（`loopFade`，有单测）。
   代价：视频本身不可单测、微信端拿不到动效、多 3.0MB 资源。
   曾做过「云条/浪花带/海鸥」三层程序化动效（three 网格挂宿主场景，零框架 API 改动，带单测），
   按用户决定关闭并删了素材；`loopFade` 与宿主场景挂载这条路径仍在，若要回到分层方案可复用。

## 四、布局与对位原理（改主界面前必读）

- 设计基准 **1024×1536**（参考图实测 1007×1562，按此归一）。运行时
  `s = min(vw/1024, vh/1536)`，所有尺寸 = 设计 px × s；**所有常量集中在 `ui/menuLayout.ts`**，
  页面里不许再出现魔法数字。
- 锚定规则：顶栏贴顶（吃 `params.ui.safeTop`）、底栏贴底（吃 `safeBottom`）、牌匾在底栏之上、
  **左右两列贴屏幕两边**只留 12 设计 px 边距（画面横向伸缩时不跟着舞台往里缩）。
  胶囊/牌匾/底栏/面板按视口居中；底栏四格与分隔线按「栏」定位（按舞台定位会在横屏错位）。
- **单张扁平背景图无法与响应式 UI 在任何比例下保持对位**（试过三种做法，都记在提交里）：
  cover 居中裁切 → 补图痕迹在非标比例下露出；横切分层带各自拉伸 → 这张画椰树贯穿全高，
  没有可拉伸的干净横带；最终背景改成视频 cover 满屏，问题消失。
- 安全区：仓库原本没有任何 safeArea 处理，现按 `config/game.json params.ui.{safeTop,safeBottom}`
  给顶/底栏让位（数值进 config，不写死）。

## 五、素材管线（怎么重跑）

Python 用 `D:/python/python.exe`（cv2 5.0 + numpy + PIL 齐全；**cv2 不吃中文路径**，
脚本内一律 `np.fromfile` + `imdecode`）。

| 步骤 | 命令 | 产物 |
| --- | --- | --- |
| 参考图入库 | 手工放 `tools/badge_matte_src/mainmenu-mockup.png` | — |
| 补出纯背景 | `D:/python/python.exe tools/backdrop_clean.py` | `assets/ui/menu-bg.png` |
| 抠开始牌匾 | `D:/python/python.exe tools/cut_start_plaque.py` | `badges/{normal,glow}/start.png` |
| 抠其余八枚 | `D:/python/python.exe tools/cut_menu_badges.py` | 侧列四枚 + 底栏四枚两帧 |
| 背景视频 | ffmpeg 配方见 `uiShell.loadVideoBackground` 注释 | `assets/ui/menu-bg.mp4` + 起点帧 jpg |

抠图键的选择（踩过的坑，别再试）：
- **像素差键**：合成图与补好的纯背景逐像素相减 = UI 轮廓。侧列/牌匾用这个。
- **色距键**：底栏四枚坐在纯棕条上，与条棕色的距离即掩码，白字标签一并入掩码。
- 侧列要再按「叶绿 / 天蓝」色键剔掉 halo；**绝不能剔亮暖色**——徽标本体就是金/奶油白/红，
  会把喇叭、卷轴、勋章、奖杯啃成骨架。
- 底栏**不要**做形态学开运算和 alpha 硬阈值（那两步是给复杂背景去 halo 用的），
  否则「商」「仓」顶部的细笔画被咬断，字就成了缺笔乱码。
- glow 帧一律不独立抠，走 `badge_matte.synth_glow` 由 normal 轮廓外扩淡黄描边 ⇒ 两帧配准、点击不跳位。

## 六、three 渲染侧的五个坑（背景/任何新素材都会踩）

1. `ImageBitmap` 上传**不吃** `UNPACK_FLIP_Y`（行 0 = 图顶），而 `<video>` 吃 ⇒
   统一按「行 0＝图顶」约定：标准材质用 `repeat.y=-1; offset.y=1` 翻 UV，视频则必须 `flipY=false`。
   两处都翻 = 上下颠倒。
2. three 的 `alphaMap` 取**绿通道**，给 `RedFormat` 数据会整块透明。
3. 1×2 的 `DataTexture` 必须 `minFilter = LinearFilter`（不能生成 mipmap，否则采样失败）。
4. 走标准材质（非 UI 直通 shader）的贴图必须 `colorSpace = SRGBColorSpace`，否则被当线性色洗白。
5. 背景网格挂在 `host.overlay.scene`（origin/main 就公开），时间走 `mount(view, { frame })` 回调
   ⇒ 不需要新 renderer、不需要并行帧循环，页面卸载即停。

## 七、微信端与 issue #6 的衔接点

- `assets/ui` 的 png 已进 `pkg-assets` 分包（徽标两帧 + `menu-bg.png`），路径全小写、格式 png。
- **wx 端目前还没读这些图**：`apps/wx` 仍是集成壳、跑空场景（issue #6 的活）。
  接上时注意：wx 无 `<video>` ⇒ 只能走静态图；`menuBackdrop` 与 `menuLayout` 是跨端代码，可直接复用。
- 包体余量：整包 8.89 MB / 30 MB，主包 898.6 KB / 4 MB，还有很大空间。

## 八、已知瑕疵与待办

- 侧列四枚边缘仍有极淡的叶簇碎边（halo 已压到最低，彻底干净需要设计稿给分层素材）。
- 钻石没有任何获取渠道，顶栏「+」是占位（按任务书只给按压反馈）。
- 板块功能（设置/商店/成就/任务/活动/仓库/福利手册）全部待开发，从 `LobbySlotHandlers` 注入，
  **不要再改布局**。
- 若维护者不接受视频背景：回到分层程序化动效那条路（第五、六节已留完整记录），
  需要重新出云/海/鸟分层素材并解决「补图痕迹与 UI 对位」这个根本问题。
