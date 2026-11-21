# Thunder Run / 雷霆酷跑

TypeScript + npm workspaces 单仓：Web 已可玩；WX 已接入共享主流程，开发者工具/真机待验收。仓库没有 Cocos Creator 工程。

## 开始工作

要求 Node **>=22.23.0**，推荐 **24**（`.nvmrc` 与 CI 一致）；任务和排行榜后端使用内置 `node:sqlite`。

```bash
npm ci
npm run check
npm run dev
```

本地开发地址：`http://127.0.0.1:8767`。工作约定见 [AGENTS.md](AGENTS.md)，环境细节见 [开发说明](docs/development.md)。

| 命令 | 用途 |
| --- | --- |
| `npm run build` / `npm run watch` | 编译全部 TS 项目引用并构建独立任务回放包 / 持续编译 TS |
| `npm test` | 先编译，再跑 `tests/*.test.mjs` |
| `npm run check` | 编译、测试、配置校验、架构检查、临时 WX 包体检查 |
| `npm run build:web` / `npm run preview:web` | 生产构建到 `apps/web/dist` / 本地预览 |
| `npm run build:wx -- --minify` | 生成可导入开发者工具的 `apps/wx/dist` |

## 工程地图与现状

- `packages/framework/src`：平台契约、自绘 UI；不放游戏规则。
- `packages/game/src`：`core` 模拟/配置/效果/音频，`render` Three.js，`flow` 流程，`ui` 页面。
- `apps/web/src`：浏览器入口、平台适配、移动端 DOM 页面/HUD；`apps/wx/src`：WX 入口与适配。
- `config`：8 个版本化内容文件；`schema`：编辑器契约；`assets`：字体、UI、模型、音频等资源。
- `tests`：Node 单测与 `golden` 回放；`tools`：检查、打包、回放及可选素材工具。

Web 游客直入大厅，支持十角色免费选角、跑酷/HUD/结算、主题/音量设置、本机商店购买及档案；本机经济与微信云账户分开。
已接入第一次吃金币前距离全服排行榜及服务端排名票据/调试隔离保护。
每日/每周任务已接入独立 Node 后端；开发时另开终端执行 `npm run dev:server`，数据库与部署说明见 [任务后端](docs/missions-backend.md)。
局内/死亡音乐和角色音效已接入。WX 已接线大厅、角色、跑局、结算与单 renderer UI；[CloudBase 函数](cloudfunctions/README.md)及客户端已有身份/档案、权威收入、首次金币前榜单、日周任务、免费手册、统一领奖、确定性商店/仓库与角色出战/主题持久选择实现。云环境尚未配置/部署；**尚未完成微信目标端验收**。进度见 [微信上线 Goal](docs/goals/wechat-release-2026-11-06/PROGRESS.md)。

依赖方向：`apps → game → framework`。共享包不得访问宿主 API；跨端边界见 [架构](docs/architecture.md)。

第4轮已接九角色可编辑模型/连续动作、海湾细化和海滨大厅/结算；重建与离线观察见 [美术管线](tools/art/README.md)。原输入素材权利与目标端视觉/性能仍待验收。
续接已补实际掉落补给3D/远距标志、角色/仓库/商店肖像与技能、海滨榜单/启动页；[离线同源UI观察](tools/art/ui_README.md)没有搭建Web站，也不替代微信验收。
任务/手册状态和手机HUD已补离线观察与修正，WX已裁剪未用旧菜单并附带Three许可；当前目录、部署步骤和未验收边界见[首发交付核查](docs/goals/wechat-release-2026-11-06/RELEASE-READINESS.md)。
WX现使用[可重建OFL字体](assets/fonts/noto/README.md)与原创磁铁，旧字体/旧磁铁保留源码但不进入微信包；原5角色派生素材、部分历史音频及真实平台验收仍待确认。
已准备[首发资料候选包](docs/goals/wechat-release-2026-11-06/launch/README.md)，含原创图标/SVG源、玩法审核路径、隐私底稿与负责人配合单；候选未提交，真实部署和验收待授权条件。

## 按任务查阅

- 本轮分支审核与本地在制整合：[整合记录](docs/collaborator-local-integration-2026-11-13.md)。
- 协作/提交：[CONTRIBUTING.md](CONTRIBUTING.md)；内容与修复接口：[collaboration.md](docs/collaboration.md)。
- 确定性复现：[replay.md](docs/replay.md)；音频：[audio.md](docs/audio.md)；字体：[assets/fonts/README.md](assets/fonts/README.md)。
- 主界面：[main-menu-handoff.md](docs/main-menu-handoff.md)；WX 待复测：[wx-runtime-findings.md](docs/wx-runtime-findings.md)。
- Web 移动 UI：[mobile-ui.md](docs/mobile-ui.md)（与共享 canvas 回退页面区分）。
- 任务：[任务玩法与 Web 接入](docs/missions.md)、[后端启动与部署](docs/missions-backend.md)。
- 启动加载约定与历史测量：[loading-performance.md](docs/loading-performance.md)。
- 排行榜：[玩法规则](docs/coinless-leaderboard.md)、[服务端部署](docs/leaderboard-server.md)、[调试与排名保护](docs/debug-ranking-guard.md)。
- 测试站交付：[ui-delivery.md](docs/ui-delivery.md)。
