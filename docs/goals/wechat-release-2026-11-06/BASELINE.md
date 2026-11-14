# 当前工作区基线

截至 2026-11-06。以下“已有”指源码中存在对应逻辑/接线，不表示本轮运行验证成功。

## 1. 工作区与工程

- 工作目录：`/workspace/雷霆酷跑`。
- 分支：`chore/sync-main-preserve-local-20261014-014322`。
- HEAD：`ca6396abc1c1bb018c9926a5ca88b9a6ab9a986e`；**工作区不干净，HEAD 不能完整代表当前文件内容**。
- 已有修改涉及 Web 大厅/UI、README 与多篇文档、包管理/测试命令、CI 等；另有未跟踪的海岸 UI 素材、CSS、测试和工具。
- 根目录另有 `missions-pr/`、若干 `*-leaderboard/`、`server-debug-guard/`、`thunder-run-release-*/` 等目录。没有核验它们的分支和用途；不将它们自动当作当前基线，不清理或覆盖。
- 后续开新分支/工作树时必须保留并正确带入相关未提交成果，不能从 HEAD 新建一份旧版本后丢掉用户已有工作。不要自动 stash/reset/clean。
- npm workspaces + TypeScript；根要求 Node >=22.23.0，推荐 24。依赖安装用 `npm ci`，不为绕过安装问题改锁文件。
- `apps → game → framework`；共享包不接触 DOM/WX 全局，core 不依赖 Three.js，玩法随机使用 `RunRng`。适用 TS 源文件上限 300 行。公共 framework API 修改遵循维护者评审约定。

## 2. 功能矩阵

| 功能 | 已有事实 | 本次长任务要解决的差距 | 主要入口 |
| --- | --- | --- | --- |
| 大厅、选角、开跑 | Web 移动 DOM 页面接入主流程，另有共享 canvas 页面 | WX 无完整接线；两个 UI 实现不能混当同一页面 | `apps/web/src/bootstrap.ts`、`mobileLobby.ts`；`packages/game/src/flow/mainFlow.ts` |
| 跑酷/HUD/结算/重试 | 确定性模拟、角色技能、输入、金币、死亡结算等逻辑已有 | 接入微信并验证输入、视觉、音频和生命周期；保留玩法能力 | `packages/game/src/core/sim/`、`render/runnerScene.ts`、`flow/mainFlow.ts` |
| 每日/每周任务 | Web 页面、录制、服务端重放、周期进度、原子领奖已有 | 微信客户端接入；与其他奖励、钱包统一 | `apps/web/src/missionIntegration.ts`、`missionPanel.ts`；`apps/server/src/` |
| 福利手册 | 大厅显示入口，点击“准备中” | 明确内容与奖励机制，做成可进入、可推进、可领奖的真实功能 | `apps/web/src/mobileLobby.ts:71-77`；`packages/game/src/ui/lobbyView.ts` |
| 商店 | 配置驱动浏览、筛选/分页；文案明确只读 | 首发若支持消费，需真实扣款、授予、拥有状态和余额同步 | `packages/game/src/ui/shopView.ts`、`config/economy.json` |
| 仓库 | 大厅占位入口 | 接入实际道具/角色/皮肤拥有与使用状态，或明确首发范围 | `apps/web/src/mobileLobby.ts` |
| 角色拥有/解锁 | 选角、loadout、技能有实现 | `isCharacterLocked` 只看显式 locked 标记，未按玩家库存或配置 unlock 价格判断；当前可选不等于经济解锁完成 | `packages/game/src/core/sim/character.ts:65-73` |
| 角色档案 | 本机头像/改名/扣钻组件及直接组件测试存在 | 大厅未接通；本机扣钻不能直接成为云端经济方案 | `packages/game/src/ui/profileView.ts` |
| 设置 | 主题切换 | 目标端页面与状态恢复；音量等按实际播放器能力补齐，不做空开关 | `apps/web/src/mobilePanels.ts`、`packages/game/src/flow/mainFlow.ts` |
| 全服排行榜 | 第一次吃金币前距离规则、票据、服务端回放、Web 展示已有 | 微信身份/传输接入；保留现有规则与调试隔离 | `server/`、`packages/game/src/flow/leaderboard.ts`、`docs/coinless-leaderboard.md` |
| 活动/成就 | DOM 大厅入口占位，部分配置为 draft | 基于首发价值选择实现或收起，不能伪装成已上线内容 | `apps/web/src/mobileLobby.ts`、`config/events.json` |

### 三个容易漏掉的数据断点

1. `mainFlow.ts` 把跑局金币累加到本机存储；任务服务有自己的钱包。
2. `missionIntegration.ts:23` 只是将本机金币与任务钱包金币相加展示；这不是统一的可消费权威余额。
3. 任务后端在 `apps/server/src/`，排行榜后端在根 `server/`，是两套服务与身份机制。迁移时不要只找到一套就宣布后端齐全。

### 需要保持的现有玩法语义

- 排行榜记录的是“第一次实际拾取金币前”的距离及分数，不是整局零金币、总里程或金币数榜。磁铁、技能吸取也影响冻结点。参见 `docs/coinless-leaderboard.md`。
- 任务服务按北京时间每日/每周周期结算，跨周期与重复结算已有规则；迁移时保持或明确记录有意变化，见 `docs/missions-backend.md`。
- 角色名称、ID、技能和部分体型来自既有用户定稿，见 `config/characters.json` 的版本说明。优化模型不等于重置角色设定或把所有角色改成同一种身材。

## 3. 微信端现状

| 源码 | 事实 |
| --- | --- |
| `apps/wx/project.config.json` | `compileType: game`；已有 AppID；`libVersion: latest`、开发用 `urlCheck: false`，发布时需按实际目标核对 |
| `apps/wx/src/main.ts` | 调用 `bootEmptyMain`，再读资源分包配置，不是完整主流程 |
| `apps/wx/src/platform/` | 画布、网络、触控、存储、音频、生命周期与分包适配已有代码 |
| `apps/wx/src/platform/extras.ts` | `login` 调 `wx.login` 后生成本地 `wx-guest-*`；不是认证 openid；cloud 存档实为本地 storage，函数/成绩接口 reject unsupported |
| `tools/build-wx.mjs` | 打包入口、复制 config/font/PNG UI/音频；非默认角色/皮肤/主题生成占位文件；没有把现有 GLB 和 Web 专属 UI 资源变成完整微信资产链 |
| `docs/wx-runtime-findings.md` | 历史 `iOSHighPerformance` 启动问题、`pkg-assets/config/game.json` 读取问题待目标环境复测；保留名冲突只是猜测 |

不能把“给 WX main 换个函数名”当成完整移植：还涉及 renderer/UI 装配、资源路径与格式、字体、输入焦点、安全区、触控吞吐、音频以及云服务。

## 4. 跑酷场景氛围初步提取

**这是源码与配置层面的初步提取，本轮未观察实际游戏画面。** 重写前仍应在可用微信运行链或既有可靠截图/录屏中确认观感。

主要来源：`config/themes.json`；`packages/game/src/render/trackVisuals.ts`、`runnerScene.ts`、`coast/{palette,coastProps,beach,sea,villa,villaIn}.ts`。

- 主主题：**白日海景，清透、柔和、暖亮，带日式动画/赛璐珞的治愈感**。天空蓝、浅蓝雾、暖沙、奶白建筑与深蓝海面形成对比。
- 空间关系：三车道向前透视；左侧沙滩、浅滩与海面，右侧海景别墅和生活化庭院/休憩设施。
- 识别物：通透大玻璃、双层别墅及室内陈设，遮阳伞、躺椅、椰树、长椅、礁石、花灌木、贝壳、碎浪与海鸥。
- 动态层：水面起伏、细碎波光、水线泡沫、薄雾、玻璃扫光、室内暖光、草花风动与海鸥盘旋；与跑道的速度感形成快慢对比。
- 值得保留的体验约束：植物不侵入跑道；大物件与花草避免重叠；景物逐件循环，避免半屏布景同时消失；海沙基底不因循环跳变。这些比沿用具体旧函数更重要。
- 配色线索：`#fdfaf3` 奶白墙、`#f6e5bd` 暖沙、`#6fc6e3` 浅海、`#1b5f96` 深海、`#ff8d76` 珊瑚伞、`#3b4653` 深框。是参考，不是强制 token。
- 第二主题“雨夜便利店”仍为 draft，不能把配置存在说成首发双场景已完成。

## 5. 角色模型与动作

- 当前 `assets/characters/` 有 `bball.glb`、`frog.glb`、`niu.glb`、`pony.glb`、`whale.glb`。
- `config/characters.json` 对应 `char_volt`、`char_frog`、`char_niu`、`char_mambo`、`char_whale` 已指向上述文件；阿玛拉、风剃、莉娜、时空行者的配置 prefab 在该目录没有对应文件。部分皮肤也只是配置引用。
- `avatarRig.ts` 先用程序化模型，再异步换 GLB；加载失败保留程序化角色。程序化形象已有尖发、围巾、雷核与轻卡通比例，但运行时回退存在不等于每个角色的独立美术已完成。
- `animClips.ts` 核心 10 个动作：`Idle / Run / Slide / Jump / TurnLeft / TurnRight / Fly / Land / Hit / Death`。表演动作按资产分别有 `Laugh / Basketball / Wave`，不能通过随意重命名伪造动作语义。
- `animAvatar.ts` 有步频/幅度适配、混合与脚步反馈。改动作应看连续跑局中的衔接，不只看单独 clip 能播放。
- 显示尺寸、碰撞净空、脚底高度、支撑面与挂骨特效要一起核对。阿牛的 GLB scale 与 fallbackScale 不同；曼波的低净空是既有玩法特性。
- Web 角色插图、局内 GLB、角色技能与名字应一一对应，不能用精美立绘掩盖实际模型缺失。

## 6. 已有验证资产和证据边界

可复用的测试入口包括 `tests/platform-wx.test.mjs`、`missions-server.test.mjs`、`mission-client.test.mjs`、`leaderboard-server.test.mjs`、`first-coin-record.test.mjs`、`renderAnimClips.test.mjs`、`renderAnimAvatar.test.mjs`、`renderNiuScale.test.mjs` 及 golden 回放。执行前检查各文件当前内容与适用范围。

本次没有重跑任何测试，也未确认云服务、开发者工具或真机可用。历史通过数、包体大小、浏览器截图不作为新 Goal 的验收证据。
