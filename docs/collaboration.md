# 内容与修复接口

人员、分支、评审规则只维护在 [CONTRIBUTING.md](../CONTRIBUTING.md)；架构边界见 [architecture.md](architecture.md)。
`.github/CODEOWNERS` 声明评审所有者；远程分支保护是否启用需在 GitHub 核实，文件本身不保证已启用。

## 用户推送约定

2026-11-11：后续更新中，用户明确说“推送”即授权将当次更新提交（如需）并推送到远程仓库 `origin`，无需再次确认同一推送意图；分支与 PR 仍按 [CONTRIBUTING.md](../CONTRIBUTING.md) 执行。

当前待推送批次（2026-11-11）：协作者 PR #55/#56 及集成修正位于本地 `feature/integrate-collaborators-20261111`，集成基线 `7d179fa`，独立工作树 `/tmp/opencode/thunder-run-integrate-collaborators-20261111`；详细记录见该树的 `docs/collaborator-integration-2026-11-11.md`。803 项测试及 Web 构建通过，尚未推送；末次远程复核遇到 TLS/EOF，推送前需 fetch 核对新增提交。原目录的微信/美术在制改动不属于此批次。

本轮界面更新：同一待推送分支已推进至 `38ae32c`，第 1 项「档案入口从角色页移至设置」已完成；记录见该树的 `docs/pending-ui-updates-2026-11-11.md`。805 项测试、Web 构建及 320/390px 手机页面交互核对通过；尚未推送，正式部署见下条记录。

正式发布记录（2026-11-11）：按用户本次「直接发布正式站」指令，Web、排行榜和任务后端已直接部署本地 `38ae32c`；165 个服务文件、正式接口与手机档案入口复核通过，原榜单/钱包数据保留。备份在 `/opt/thunder-run-web-backups/38ae32c-20261111/`，详细回执在 `/tmp/opencode/thunder-run-publish-38ae32c-20261111/RELEASE.md`。远程仓库尚未推送，独立测试站未更新。

最新更新（2026-11-11）：第 2 项「先将全部角色解锁」已完成，当前十个角色统一免费开放，保留解锁机制以后再加门槛。待推送分支及正式站均推进至 `38d5116`；808 项检查、手机十角色选角与实际跑局、正式十角色票据检查通过。数据备份在 `/opt/thunder-run-web-backups/open-roster-38d5116-20261111/`，回执在 `/tmp/opencode/thunder-run-open-roster-20261111/RELEASE.md`；尚未推送远程。

## 内容改动

2026-11-13 本地整合：`integration/collaborators-local-20261113-gRBgr7` 已继承上述协作者/优化成果并合入原目录 WX、美术、云函数在制快照。审核修正、验证与历史分支处置见 [整合记录](collaborator-local-integration-2026-11-13.md)。本地 `main` 和原目录工作状态保留；远程最新提交因 TLS/EOF 待复核，候选尚未推送或发布。

- `config/` 有 `game`、`characters`、`skills`、`items`、`obstacles`、`themes`、`events`、`economy` 八份配置，带版本 envelope 和 `$schema`。
- 类型：`packages/game/src/core/config/configTypes.ts`；编辑器/envelope 与 primitive 枚举：`schema/config.schema.json`；运行时 ID、引用、范围规则：`configValidator.ts`。
- Catalog 使用稳定 `id`、i18n `name/desc`、`status` 与 `versions`；`game` 等特殊结构按类型和现有条目维护，不能把所有文件都当 `items` 列表。
- 新 primitive 同时修改 `core/effects/primitives.ts`、schema 枚举和 `tests/effects.test.mjs`。按 timed/instant/cyclic 补齐 `FxState`、`EffectWorld` 或 `buffEngine` 生命周期。
- 音频已接入 `core/audio/audioDirector.ts`，内容在 `game.json → params.audio` 和 `assets/audio`，见 [audio.md](audio.md)。
- 修改自绘 UI 中文（包括 `apps/web/src` 的文字）需核对字体；生成器要单独安装依赖并提供字体，见 [字体说明](../assets/fonts/README.md)。不同源字体不保证只有新增 glyph 的 diff。

先 `npm run build && npm run validate-config`，再 `npm run check`。模拟结果有意改变时，核对 [golden 回放](replay.md) 的差异后才更新。
源码提到的旧设计文档 `docs/03` 不在本仓；以现有类型、schema、validator 和配置为准。

## Bug 修复

1. 从模拟 `core/sim`、渲染 `render`、流程 `flow`、页面 `ui` 或 app 平台层定位；先读调用方和对应测试。
2. 优先使用确定性复现：Web `?debug` 在开局后可取 `__trSeed()`；按 [replay.md](replay.md) 构造输入文件，然后用回放工具复跑。
3. 加回归测试，修复后跑 `npm run check`。测试只编译/跑 Node；浏览器/WebGL 或 WX 运行时问题还需实际目标环境验证。
4. PR 写明复现、预期/实际、覆盖范围；框架公共 API 改动单独说明兼容影响。

共享包不调用宿主 API；源码不超过 300 行；不夹带无关框架改动。环境与命令见 [development.md](development.md)。
