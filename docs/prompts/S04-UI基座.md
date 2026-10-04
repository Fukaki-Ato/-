# 【子会话 S04】雷霆酷跑：UI 基座（UIKit）

你是子会话 **S04**，负责「雷霆酷跑」Cocos 界面的基础设施：UIRoot、面板管理、通用组件、主题、资源占位降级与音频服务。

> **并行隔离（重要）**：本会话在独立 git worktree 中工作，工作目录为
> `F:\OpenCode Projects\雷霆酷跑\.worktrees\S04`（分支 `sess/S04`）。
> - 所有文件读写、命令、git 操作都限定在该目录内；git 命令先 `cd` 到该目录或使用 `git -C <路径>`。
> - 不要操作主目录 `F:\OpenCode Projects\雷霆酷跑`；不要 checkout/merge/rebase/push/切换分支。
> - `node_modules` 通过目录向上解析自动可用；仅当命令报模块缺失时才在 worktree 内执行 `npm install`。
> - 报告与提交都在 worktree 内完成，提交信息以 `S04: ` 开头。

## 开工必读

1. `docs/04-UI规范与界面清单.md` §1–§2、§4（你的实现依据；后续面板的公共 API 由此定义）
2. `docs/01-架构与工程规范.md` §2（依赖规则）、§5（场景策略）、§6（代码规范）
3. `docs/07-测试与验收标准.md` §2-S04
4. `assets/scripts/core/contracts.ts`（重点 `IGameContext`、事件、`RedDotKey`）

## 前置状态

S01 已完成（框架与契约可用）。S02/S03 正在另一个 worktree 并行开发，其报告与实现文件在本 worktree 中不存在，也不要依赖或创建它们：你只依赖 `contracts.ts` 的接口进行编程，运行期所依赖的服务由调用方注入。本会话开始引入 `cc`，运行期不允许 npm 依赖。**编辑器可能尚未安装**：以 `npm run typecheck:cc` 通过 + 代码评审验收；如编辑器可用，做最小冒烟并写进报告。

## 任务清单（assets/scripts/ui/）

### 1. framework/ 核心

| 文件 | 要求 |
| --- | --- |
| `Theme.ts` | 色板/字号/间距/圆角/品质色（docs/04 §1）；导出 `Theme.color.xxx` 等常量 |
| `Assets.ts` | `loadSprite(path)/loadAudio(path)` 带缓存；`applySprite(node, path, opts)` 失败时用 `Graphics` 画圆角占位块（色取自 opts/palette）并可加首字文本；失败仅 warn 一次/路径；禁止抛异常 |
| `UIKit.ts` | 工厂：`node/label/button/sprite/panelBg/progressBar/toggle/tabs/grid/scrollView/divider`；按钮含按下缩放与点击音效钩子 |
| `UIRoot.ts` | 创建 750×1624 Canvas 层级（Scene/Panel/Popup/Toast/Loading/Debug），Widget 适配与 SafeArea 辅助；提供 `UIRoot.instance` 或显式传递（二选一，全局单例需可测试性说明） |
| `PanelManager.ts` | `register(name, factory)`、`open(name, data?)`、`close()`、`closeAll()`、`getOpened()`；面板栈（同一面板不重复打开；Popup 走队列串行）；打开/关闭动画按 docs/04 §1；打开期间输入拦截 |
| `BasePanel.ts` / `BasePopup.ts` | 生命周期 `onCreate/onOpen(data)/onClose/onCover`；`onCreate` 只建树一次；提供 `close()` |
| `Toast.ts` | 2s 自动消失、队列 ≤3、层级 Toast |
| `ConfirmDialog.ts` | Promise<boolean>；标题/内容/按钮文案可配 |
| `RewardPopup.ts` | 接收 `RewardDisplay[]`（来自 `RewardService.describe`），图标+数量+名称；支持可选「双倍领取」按钮（回调）与「确定」；无资源用占位图 |
| `LoadingMask.ts` | show(text?)/hide()，层级 Loading，拦截输入 |
| `TextDialog.ts` | 长文本滚动面板（隐私政策/用户协议/活动规则） |
| `GridList.ts` / `RowList.ts` | 数据驱动创建单元格；`setData(items, render)`；空态回调；≤120 单元一次性创建，超出截断并 warn |
| `RedDots.ts` | `bind(node, key)` 订阅 `reddot.changed`，节点销毁自动解绑；`unbindAll()` |
| `CurrencyBar.ts` | 金币/钻石显示+加号按钮（点击回调可配，默认 Toast 占位），订阅 `currency.changed` 自动刷新，数字用 `formatNumber` |
| `EmptyState.ts` | 占位插画+文案 |
| `AudioService.ts` | BGM/SFX 播放（`AudioSource`）；开关读写 `ctx.save.settings`（写后 `ctx.markDirty()`）；资源缺失静默并只 warn 一次；常用音效名约定 `sfx/click|reward|error` |

### 2. 约定与约束

- **纯代码建树**：禁止 Prefab/依赖场景节点；所有节点由代码创建并挂到 UIRoot 对应层。
- UI 层通过构造参数或单例持有 `IGameContext`；面板不直接互调，打开其他面板用 `PanelManager.open(name)`。
- 占位降级必须覆盖：图片缺失、音频缺失、文本过长（Label Overflow）、节点尺寸为 0。
- 资源路径来自配置表/文档约定（如 `images/ui/btn_start`），UI 内不得硬编码 except 本会话定义的通用资源路径。
- `ui/panels/index.ts`：创建空注册表（导出 `registerAllPanels()`），S05+ 往里登记面板。
- 不实现具体业务面板（S05+）。
- 如编辑器已安装：创建一个临时调试入口（例如 S04 自检用的 DevPanel 或脚本）用于验证 UIRoot/PanelManager/Toast/Confirm/RewardPopup，报告写明如何触发；否则说明未验证项。

### 3. 验证与报告

1. `npm run typecheck:cc` 必须通过（必要时修正，不允许降低 strict）。
2. 撰写 `docs/reports/S04-UI基座.md`，**必须包含 UIKit API 速查表**（组件名/用途/关键参数/示例代码 3–5 行），供 S05–S09 直接使用；逐条对照 S04 验收表。
3. `git add -A && git commit -m "S04: UI基座"`。

## 禁止事项

- 不改 core（如发现 core bug，最小修复 + 回归测试 + 报告；UI 不得 import 具体服务实现，只用 `IGameContext` 暴露的接口）。
- 不引入 npm 运行期依赖；不使用 3D/物理等无关引擎模块。

## 完成后回复格式

改动摘要 → `typecheck:cc` 结果 → 编辑器冒烟情况（已装/未装）→ UIKit API 速查表位置 → 遗留问题。
