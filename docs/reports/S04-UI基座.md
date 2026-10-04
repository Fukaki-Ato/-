# S04 UI 基座 完成报告

## 改动清单

### 新增（`assets/scripts/ui/framework/`，19 个文件）

| 文件 | 用途 |
| --- | --- |
| `Theme.ts` | 色板/字号/间距/圆角/品质色/层级 Z/时长；通用资源路径常量 `Theme.assets`；`qualityColor(q)` |
| `Assets.ts` | `loadSprite/loadAudio`（缓存、同路径仅 warn 一次、不抛异常）、`applySprite`（失败/加载中绘制 Graphics 圆角占位块+首字，素材到位自动替换）、`clearAssetCache` |
| `UIKit.ts` | 工厂：`node/label/button/sprite/panelBg/overlay/progressBar/toggle/tabs/grid/scrollView/divider/stretch/preloadSprites`；按钮按下缩放 + 点击音效；Label 溢出防护 |
| `UIRoot.ts` | 750×1624 设计分辨率（FIXED_WIDTH）、Canvas 查找/兜底创建、六个逻辑层（scene/panel/popup/toast/loading/debug）、Widget 拉伸、`getSafeArea()`、静态单例可 `reset()` |
| `PanelManager.ts` | 注册/打开/关闭/`closeAll`/`getOpened`；面板栈（同一面板不重复打开、实例复用、`onCreate` 一次）；弹窗 Promise 串行队列；打开/关闭动画；BlockInputEvents；排队弹窗可取消，队列可被 `closeAll` 清空 |
| `BasePanel.ts` | 生命周期 `onCreate/onOpen(data)/onClose/onCover`；`close()`；`waitClosed()`（节点销毁也能复位） |
| `BasePopup.ts` | 弹窗基类：默认遮罩 + 输入拦截；`onBackdrop()` 钩子 |
| `Toast.ts` | 2s 自动消失、队列上限 3、Toast 层；`init(ctx)` 桥接 `'toast'` 事件 |
| `ConfirmDialog.ts` | `show(opts): Promise<boolean>`；标题/内容/按钮文案可配，`cancelText:null` 单按钮 |
| `RewardPopup.ts` | `RewardDisplay[]` 图标+数量+名称；可选「双倍领取」回调；12 项截断；占位图兜底 |
| `LoadingMask.ts` | `show(text?)/hide()` 计数配对；Loading 层拦截输入；菊花动画 |
| `TextDialog.ts` | 长文本滚动弹窗（ScrollView + Mask） |
| `GridList.ts` | 数据驱动网格（≤120 单元，超出截断 + warn）；`setData(items, render)`；空态 + `onEmpty` 回调 |
| `RowList.ts` | 单列行列表（GridList `columns=1` 特化） |
| `RedDots.ts` | `setup(ctx)` 订阅红点；`bind(node,key)` 节点销毁自动解绑；`unbind/unbindAll/refresh` |
| `CurrencyBar.ts` | 金币/钻石显示 + 加号按钮（回调可配，默认 Toast 占位）；订阅 `currency.changed`，销毁自动解绑；`formatNumber` |
| `EmptyState.ts` | 占位插画 + 文案 |
| `AudioService.ts` | BGM/SFX（`AudioSource`）；`playBgm/playSfx/setMusic/setSfx`；开关写 `ctx.save.settings` + `markDirty()`；资源缺失静默 |
| `Modal.ts`（内部） | 弹窗外壳：遮罩+居中面板+缩放/透明动画，供三个对话框共用 |

### 新增（其它）

- `assets/scripts/ui/panels/index.ts`：`registerAllPanels()` 空注册表 + `PANEL_NAMES` 常量（S05+ 登记）。
- `assets/scripts/ui/dev/S04Smoke.ts`：临时自检组件（`@ccclass('S04Smoke')`），验证 UIRoot/PanelManager/Toast/ConfirmDialog/RewardPopup/CurrencyBar/ProgressBar，S05 后可删除。
- 全部新目录/TS 文件均附 Cocos `.meta`（uuid 已生成）。

### 修改

- `tsconfig.cc.json`：新增 `"experimentalDecorators": true`。原因：`@ccclass` 组件脚本（S04Smoke、S05 Boot 等）需要装饰器编译；原配置缺失会导致 `typecheck:cc` 误报 TS1219。不影响 core 检查。

## 集成指引（S05 启动顺序）

```ts
// GameRoot（挂在场景节点）
const root = UIRoot.initialize(this.node);          // 1. 建层（场景已有 Canvas 时复用）
PanelManager.init(ctx, root);                        // 2. 注入 ctx；内部自动完成 Toast 事件桥接 + AudioService(ctx)
RedDots.setup(ctx);                                  // 3. 红点订阅（CurrencyBar/RedDots 依赖）
registerAllPanels();                                 // 4. ui/panels/index.ts
PanelManager.open(PANEL_NAMES.mainMenu);             // 5. 打开主界面
AudioService.playBgm(Theme.assets.bgmMain);          // 6. 主界面 BGM（素材缺失静默）
```

- 未注册面板：`PanelManager.has(name)` 判断后自行 Toast「开发中」，`open` 对未注册名返回 `null` 且仅 warn，不崩溃。
- 面板工厂签名：`PanelManager.register(name, (ctx) => new XxxPanel(ctx))`。
- 生命周期覆盖需带 `override`（`noImplicitOverride`），如 `protected override onOpen(data?: unknown): void`。

## UIKit API 速查表

> 导入：`import { UIKit, UIRoot, PanelManager, BasePanel, BasePopup, Theme, Assets } from '../framework/...';`（或具名导入各工厂函数）。
> 所有工厂 `parent` 缺省表示不挂载；`size` 可传 `number`（正方形）或 `{width,height}`；返回 Node 的工厂返回的节点已带 `UITransform` 且在 `UI_2D` 层。

| 组件 | 用途 | 关键参数 | 示例 |
| --- | --- | --- | --- |
| `UIKit.node(name, opts)` | 空容器节点 | `parent/size/anchor/position/active` | `const box = UIKit.node('Box', { parent, size: 400, position: [0, 120] });` |
| `UIKit.label(text, opts)` | 文本 | `fontSize/color/bold/align/valign/maxWidth/overflow/outline` | `UIKit.label('金币不足', { parent, size: {width: 500, height: 60}, maxWidth: 500, align: 'center', color: Theme.color.textSub });` |
| `UIKit.button(opts)` | 按钮（按下缩放+点击音） | `text/variant('primary'\|'secondary'\|'green'\|'ghost'\|'danger')/icon/onClick/sound/size` | `const b = UIKit.button({ parent, size: {width: 300, height: 88}, text: '领取', variant: 'green', onClick: () => claim() }); b.setInteractable(false);` |
| `UIKit.sprite(path, opts)` | 图片（失败占位） | `path/size/radius/color/placeholderText` | `UIKit.sprite('images/items/magnet', { parent, size: 96, placeholderText: '磁' });` |
| `Assets.applySprite(node, path, opts)` | 给已有节点贴图并拿句柄 | `opts.size/radius/placeholderText`；句柄 `setSize/setColor/loaded` | `const h = Assets.applySprite(iconNode, item.icon, { size: {width:100,height:100}, placeholderText: item.name[0] }); h.setSize(80, 80);` |
| `UIKit.panelBg(opts)` | 通用面板底 | `size/color/radius` | `UIKit.panelBg({ parent: this.node, size: {width: 660, height: 900} });` |
| `UIKit.progressBar(opts)` | 进度条 | `width/height/trackColor/fillColor`；`setProgress(0..1)` | `const bar = UIKit.progressBar({ parent, width: 400 }); bar.setProgress(task.progress / task.target);` |
| `UIKit.toggle(opts)` | 开关 | `label/value/onChange/width`；`setValue(v, notify?)` | `UIKit.toggle({ parent, label: '音乐', value: AudioService.isMusicOn(), onChange: (v) => AudioService.setMusic(v) });` |
| `UIKit.tabs(opts)` | 页签 | `items/index/onChange/width/gap`；`setActive(i, notify?)` | `const t = UIKit.tabs({ parent, items: ['金币','钻石','道具'], onChange: (i) => reload(i) });` |
| `UIKit.grid(opts)` | Layout 网格容器 | `cellWidth/cellHeight/columns/gapX/gapY/padding` | `UIKit.grid({ parent, cellWidth: 160, cellHeight: 160, columns: 4 });` |
| `UIKit.scrollView(opts)` | 滚动容器 | `width/height/vertical/horizontal`；返回 `{node,view,content,scrollView}` | `const sv = UIKit.scrollView({ parent, width: 640, height: 800 }); sv.content.anchorPoint;` |
| `UIKit.divider(opts)` | 分割线 | `width/color/thickness` | `UIKit.divider({ parent, width: 600 });` |
| `UIKit.overlay(opts)` | 全屏遮罩（默认拦截） | `color/block` | `UIKit.overlay({ parent: UIRoot.getLayer('popup') });` |
| `UIKit.stretch(node)` | 四边拉伸 Widget | - | `UIKit.stretch(panelRoot);` |
| `UIRoot` | 层与适配 | `initialize(host?)/getLayer(layer)/getSafeArea()/reset()` | `UIRoot.getLayer('debug').addChild(debugBtn); const top = UIRoot.instance!.getSafeArea();` |
| `PanelManager` | 面板/弹窗管理 | `init/register/open/close/closeAll/getOpened/has/getPanel` | `await PanelManager.open(PANEL_NAMES.shop); PanelManager.close();` |
| `BasePanel` | 面板基类 | 覆写 `onCreate/onOpen/onClose/onCover` | `class ShopPanel extends BasePanel { protected override onCreate(): void { /* 纯代码建树 */ } protected override onOpen(data?: unknown): void { /* 刷新 */ } }` |
| `BasePopup` | 弹窗基类 | `modal=true`；覆写 `onBackdrop` | `class ItemDetailPopup extends BasePopup { protected override onCreate(): void { UIKit.panelBg({ parent: this.node, size: {width:600,height:700} }); } }` |
| `Toast` | 轻提示 | `show(text)`；队列 3 | `Toast.show('商店开发中');` |
| `ConfirmDialog` | 确认框 | `{title,content,okText,cancelText\|null}` → `Promise<boolean>` | `if (await ConfirmDialog.show({ content: '花费 100 金币?' })) buy();` |
| `RewardPopup` | 奖励弹窗 | `show(rewards, {doubleText,onDouble,confirmText})` → `'confirm'\|'double'` | `const r = await RewardPopup.show(ctx.reward.describe(bundle), { doubleText: '双倍领取', onDouble: () => showAd() });` |
| `LoadingMask` | 加载遮罩 | `show(text?)/hide()` 配对 | `LoadingMask.show('结算中...'); try { ... } finally { LoadingMask.hide(); }` |
| `TextDialog` | 长文本弹窗 | `{title,text,closeText}` → `Promise<void>` | `await TextDialog.show({ title: '隐私政策', text: ctx.config.app().privacyPolicy });` |
| `GridList` / `RowList` | 数据列表 | `new GridList({parent,width,height,cellWidth,cellHeight,columns,onEmpty})`；`setData(items,render)` | `const list = new RowList<TaskView>({ parent, width: 640, height: 900, rowHeight: 140 }); list.setData(ctx.task.list('daily'), (t, cell) => renderTask(t, cell));` |
| `RedDots` | 红点绑定 | `bind(node, key, {size,offset})`；`unbindAll()` | `RedDots.bind(shopBtn, 'menu.shop');` |
| `CurrencyBar` | 货币条 | `new CurrencyBar(parent, ctx, {goldPlus,diamondPlus})` | `new CurrencyBar(topBar, ctx, { goldPlus: () => PanelManager.open(PANEL_NAMES.shop) }).node.setPosition(0, 0, 0);` |
| `EmptyState` | 空态 | `show(parent, text, {icon,width,height,offsetY})` | `EmptyState.show(list.node, '暂无任务');` |
| `AudioService` | 音频 | `playBgm/playSfx/setMusic/setSfx/isMusicOn/isSfxOn` | `AudioService.playSfx(Theme.assets.sfxReward); AudioService.setMusic(false);` |
| `Theme` | 视觉 tokens | `Theme.color/fontSize/space/radius/duration/size/assets`；`qualityColor(3)` | `label.color = Theme.color.gold;` |
| `Assets` | 资源与降级 | `loadSprite/loadAudio/applySprite/clearAssetCache` | `Assets.loadSprite(path, (sf) => { /* 可选前置 */ });` |

## 验证结果

- `npm run check`：**通过**。
  - `typecheck:core`：通过。
  - `typecheck:cc`：通过（19 个 framework + dev + panels 文件，strict，无 any 滥用）。
  - `vitest run`：10 个文件 / 50 个用例全部通过（未改动 core）。
- 代码评审：由独立 reviewer 子代理复核 cc 3.8.8 API 签名与运行期路径，发现的问题已修复（占位文本层级、弹窗队列悬挂/取消、UIRoot 场景切换失效、BGM 过期回调、Toast 重复绑定、对话框 Promise 悬挂、applySprite 幂等性、按钮音效注册等）。
- 编辑器冒烟：**未执行**。编辑器已安装（`F:\Cocos\Editor\3.8.8`），但本 worktree 尚无场景（S05 负责生成 `Main.scene`），且本会话无法驱动图形界面预览。已提供 `S04Smoke` 手动步骤（见下）。
- 静态检查：`assets/scripts/ui/**` 无 `from 'cc'` 之外的宿主 API；core 未被修改。

### S04Smoke 手动冒烟步骤（编辑器）

1. 打开 worktree 工程（或主工程合并后），任意场景 → 层级管理器 `Canvas` 下新建空节点；
2. 节点添加组件 `S04Smoke`（脚本 `assets/scripts/ui/dev/S04Smoke.ts`）；
3. 点击预览：应看到全屏面板与标题「S04 UI 基座自检」；
4. 依次点击 Toast（2s 消失）、ConfirmDialog（返回已确认/已取消）、RewardPopup（3 个占位奖励、双倍回调 Toast）、关闭面板（0.18s 缩放动画）；货币条/进度条为占位样式（素材缺失属预期）；
5. 验证通过后 S05 可删除 `ui/dev/`。

## 验收自检（docs/07 §2-S04）

- [x] **所有基座组件可用；资源缺失时占位降级不崩溃**
  - 图片缺失：`Assets.applySprite` 绘制与目标同尺寸圆角块（opts/palette 取色）+ 首字，同路径仅 warn 一次；节点 0 尺寸按 96×96 兜底；已有 spriteFrame 的节点不清空。
  - 音频缺失：`loadAudio` 回调 null 并 warn 一次，`AudioService` 静默跳过。
  - 文本过长：`UIKit.label` 支持 `maxWidth`（换行+CLAMP）与 `overflow:'shrink'`（按钮/页签），页签/按钮均走 shrink。
  - 列表超限：>120 截断并 warn。
- [x] **PanelManager 层级、动画、输入拦截符合 docs/04**
  - 层序 scene(0)/panel(100)/popup(200)/toast(400)/loading(500)/debug(900)；面板根与遮罩均挂 `BlockInputEvents`；打开缩放 0.92→1 + 透明度 0→1（0.18s），关闭反向；面板栈 + 弹窗串行队列；同一面板不重复创建。
- [x] **`typecheck:cc` 通过；提供 UIKit 使用说明（本报告速查表）**
- [ ] **（编辑器可用时）空场景挂 Boot 可显示调试面板/提示**：待人工执行上述 S04Smoke 步骤（编辑器已安装；Boot 由 S05 提供，S04Smoke 为对应自检入口）。

## 遗留问题 / 需要人工验证

1. **GUI 冒烟未跑**：请按「S04Smoke 手动冒烟步骤」执行一次，重点确认占位块可见、动画流畅、点击音效在无素材时不报错。
2. **S05 必须调用 `RedDots.setup(ctx)`**（建议 GameRoot 内、打开主界面前）。`Toast` 事件与 `AudioService(ctx)` 已由 `PanelManager.init(ctx)` 自动桥接，无需重复调用。
3. **`UIRoot.instance` 单例说明**：仅缓存节点引用，`initialize` 会检测旧实例节点是否销毁并自动重建；`UIRoot.reset()` 用于编辑器重载/测试。面板逻辑不依赖单例做业务决策。
4. **弹窗队列语义**：`open` 在弹窗被 `closeAll`/`reset` 取消时 resolve `null`（调用方需判空）；排队中的弹窗可用 `PanelManager.close(name)` 取消。`RewardPopup` 被外部销毁时 resolve `'confirm'`（与「默认自动发放基础奖励」一致）。
5. **worktree 环境**：本 worktree 的 `typings/cc.d.ts` 相对引用需要本地 `node_modules`，本会话通过目录联接（junction，未提交）指向主工程 `node_modules`；若其他 worktree 出现 `Cannot find module 'cc'`，同样处理或在 worktree 内 `npm install`。
6. 素材（`images/ui/*`、`audio/sfx/*`）未提供，全部走占位/静默；放入 `assets/resources/` 对应路径后自动生效。
7. `S04Smoke.ts` 与 `ui/dev/` 为临时自检文件，S05 完成后可删除；`experimentalDecorators` 为组件脚本所需，保留。

## 契约偏差

- 无。未修改 `core/contracts.ts`；UI 仅使用 `IGameContext` 暴露的接口。
- 追加约定（不改变契约）：`PanelManager.init(ctx, root?)` 会顺带调用 `Toast.init(ctx)` 与 `AudioService.init(ctx)`；`PanelManager.register` 工厂签名为 `(ctx)=>BasePanel`；`PanelManager.open(name, data?)` 对未注册/被取消返回 `null`。
