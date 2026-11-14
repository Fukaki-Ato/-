# 成就后端

成就接口与任务后端同进程同库（`apps/server`，`POST /api/missions/session` 的同一游客会话），无独立服务与端口；启动与部署、HTTPS 反向代理、限流与错误响应约定见 `docs/missions-backend.md`，本文只记成就的差异部分。

## 新增配置的部署顺序

`config/achievements.json` 是第 9 个内容配置，运行时与服务端都按全量清单要求齐备，**必须先发配置再重启服务**，顺序错一处即启动失败或页面白屏：

1. **静态宿主（web CDN / wx 包）**：客户端 `configLoader` 按 `CONTENT_NAMES`（`configTypes.ts`）加载，缺 `achievements.json` 时 boot 直接失败停在启动页；wx 构建整目录拷贝 `config/` 自动携带。
2. **服务宿主两处**：任务/成就宿主 `apps/server`（`content.mjs` 的 `CONFIG_NAMES`）与排行榜宿主 `server/`（`tools/replay/runner.mjs → loadContent`，含 `replay-worker.mjs`）共用同一 `CONTENT_NAMES` 清单直读 `config/`。同一份仓库部署两处时，任一处缺文件该进程起不来；成就配置坏了则任务宿主启动即抛（`validateAchievementsConfig`），带病运行不可能发生。

服务端 stat 白名单（`achievement-service.mjs` 导出的 `RUN_SUPPLIED`/`LOCAL_STATS`）与客户端 `ACH_RUN_STATS`/`ACH_LOCAL_STATS`（`configTypes.ts`）是两份同值拷贝，schema（`schema/config.schema.json` 的 `$defs.achievement`）的 stat enum 是第三份；三方由 `tests/achievementsConfig.test.mjs` 两两比对兜底，改 stat 全集要三处同改。

条目生命周期 `status`（draft/live/retired，schema 可选、缺省按 live）是下线口径，与 items 的 availability 同款：draft/retired 条目服务端不进快照、不建写入器（无 live 条目共用的 stat 即停止累计）、claim 按 404 拒绝（`achievement-service.mjs` 构造器过滤），客户端不进页面、claim 视同不存在（`achievementsValidator.ts` 的 `achievementLive`）；双端校验器与 CI schema 走查都会拦非法值。

## API

会话复用 `tr_mission_session` 游客 cookie，成就无自有 `/session`：客户端经 `MissionApiCore.ensureConnected()`（幂等缓存）引导，端点鉴权/限流/同源/body 约束与 missions 端点同构。

- `GET /api/achievements`：返回成就快照 `serverTime`、`rewardLedgerId`、`achievements[]`、`wallet`。形状与任务快照同构：`rewardLedgerId` 是同一持久游客用户 id，`wallet` 是同一累计奖励账本（不是可消费余额），客户端按高水位幂等导入（`wallet.syncRewards`，两快照共用同一游标）。数组只含 `source=run` 条目：`id/name/desc/stat/target/tier/group/reward/progress/claimed`，`progress` 已按 `target` 截断并保留两位小数。`source=local` 条目（角色解锁）服务端不可见，客户端本机记账自发。
- `POST /api/achievements/claim`：JSON `{"achievementId":"ach_..."}`。SQLite 事务内：定义存在（404）→ 已领幂等跳过 → 进度未达标 409 → 记领 → 奖励逐条入 `wallets`。返回最新快照。

客户端页面语义：进页 GET 一次，失败＝离线本地预览（本机 totals 镜像 + run 类领取置灰，状态行显示失败真实原因而非统一「网络未连接」——本机钱包损坏等非网络故障不误报，恢复后重进自动取数）；领取 local 条目走本机经济即时发货，run 条目乐观受理即置灰防连点、走服务端并整页重绘。

## 表结构

- `achievement_stats(user_id, stat, value)`：终身进度，`CHECK(value >= 0)`，主键 `(user_id, stat)`。`stat` 即配置的 stat 名；`itemOf` 分道具以 `itemOf:<itemId>` 为键。score 类单局最佳走 `MAX`（bestStat），其余累加（addStat）；同 stat 多档成就共享一次 upsert。
- `achievement_claims(user_id, achievement_id, claimed_at)`：领取记录，主键 `(user_id, achievement_id)`。

两表与全库口径一致带 `users ON DELETE CASCADE`；定期清理（`store.purge`）的 `purgeRunlessUsers` 保留条件已含 `achievement_stats`——有成就进度的游客不会被当空号回收，claims 依赖用户行传递保留。

## 进度口径（run 类）

run 类进度**只来自服务端重放**，客户端上报的计数一概不信任：`finishRun` 在 validRun 事务块内把重放 metrics 转发给 `AchievementService.applyRunMetrics`（`mission-service.mjs`，与任务进度同事务）。metrics 键与配置 stat 名逐一同名（技能释放是 `skillCasts`，重放 `summary.casts` 在两侧各映射一次）；分道具 `itemPickupsById` 来自回放循环内逐帧拾取事件（`replay.mjs`），与客户端观察器（`pickupTally.ts`）在同一事件集上打点。脏值（负数/非有限）直接丢弃，不毒化终身进度也不炸 CHECK。

计入条件（六条，与服务端 validRun / 客户端镜像同口径）：

1. **开局装备不计**：ticket 注入的开局道具清单不进统计；只数局内拾取事件，排位局（开局无道具）与休闲局同口径计入。
2. **短局不计**：死亡结算且 `sim.state.t ≥ minRunSeconds`（config `economy.params.missions.minRunSeconds`，当前 10 秒；服务端还允许 `options.minRunSeconds` 覆盖，测试用 0——显式覆盖的部署客户端预览阈值会偏移，权威进度仍以服务端为准）。
3. **Esc 存活中退不计**：`sim.state.alive` 为真时收口直接返回。
4. **纯演示局不计**：`?anim` / `?ui=demo` 置 qa 位，与任务门同源（`debugMode.ts` qa=debug||test||qa），观察器根本不安装。
5. **`?debug`/`?test` 调试局不计**：同上门。
6. **死亡动画期间 Esc 仍按死亡局计**：死后 `alive` 已为 false，收口按正常死亡结算；服务端回放本就以死亡帧收尾。

## local 类（本机口径）

`source=local` 条目（当前仅 `charactersUnlocked`）服务端不参与：进度与领取都在客户端（`achievementTracker.ts`，存储键 `thunderrun:ach-stats-v1` / `thunderrun:ach-claimed-v1`，与钱包重定向键空间隔离），领取经本机经济发货（`localEconomy.grant`，奖励校验与服务端同正则）。可信边界同本机经济：清存储即清进度，换设备不同步——它是单机 MVP 的口径，不是账号资产。

## 验证与安全边界

```sh
node --test tests/achievements-server.test.mjs
```

run 类防伪与任务同源：重放权威 + 死亡收尾 + 最短局 + 限流，但不阻止自动化脚本（见 missions-backend「验证与安全边界」）。local 类是客户端自记口径，服务端永远不为其发奖，伪造只能骗到本机展示。
