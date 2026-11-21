# CloudBase：权威档案、跑局、福利与确定性商店

当前交付为**独立可构建的普通事件云函数** `thunder-api`，没有登录云、创建资源或部署。AppID 权限、目标云环境、预算与设备仍待确认；本地替身事务/SDK 包装器测试不代表真实云 IO 验收。

## 构建与本地测试

```sh
# 仓库根目录；构建共享 core 的现有 TS 产物
npm run build
# SDK 依赖和锁独立于根 package/锁；首次验证版本为 wx-server-sdk 4.0.2
npm ci --prefix cloudfunctions/thunder-api --workspaces=false --ignore-scripts --no-audit --no-fund
node tools/build-wx-cloud.mjs
node --test tests/wx-cloud-profile.test.mjs tests/wx-cloud-runs.test.mjs tests/wx-cloud-welfare.test.mjs tests/wx-cloud-commerce.test.mjs
```

生成目录是 `apps/wx/cloud-dist/thunder-api`，**上传该生成目录，不是源码目录**。它与小游戏 `apps/wx/dist` 分离；构建不会修改客户端包。

- 白名单复制入口、业务/CloudBase store 模块、函数自身 `package.json` / `package-lock.json`。
- esbuild 将已编译的纯 core `RunnerSim`、flow 的 v3 `leaderboardRulesId`、北京时间周期模块及八份同源配置打成 `simulation.cjs`；运行时不导入仓库外路径，不包含 Three.js/renderer。规则身份绑定当前模拟构建与玩法配置（含 themes）；构建工具同时注入客户端同源构建身份。默认拥有角色与主题配置精简为 `initial-content.json`。构建同时校验确定性商品目录。
- 只清理固定的 `cloud-dist/thunder-api` 且必须具有本工具所有权标记；空目录可首次取得所有权。拒绝删除非空未知目录或符号链接。不会清理父目录。
- profile 测试保留；runs 测试使用真实 RunnerSim 录制死亡局，回放与模拟结果比较，存储/并发/失败路径全部走隔离内存事务替身。安装独立 SDK 后还执行其实际事务包装器测试（无网络）；未安装时仅该 SDK 用例明确跳过。

## 协议

全部动作通过原生 `wx.cloud.callFunction({name:'thunder-api',data:request})`，结果位于调用响应的 `result` 字段。每次调用使用 SDK 的 `getWXContext()` 获取可信 OPENID/APPID，并与服务端非空 `TR_APP_ID` 完全匹配；客户端自报身份不参与认证。没有任意存档/钱包/成绩更新接口。

入口会剥离微信事件附带的 `userInfo` 传输元数据，再执行业务字段校验；即使该字段被伪造也不用于身份判断。依据：[CloudBase 普通云函数调用](https://docs.cloudbase.net/cloud-function/how-use)。

| 请求 | 成功响应 |
| --- | --- |
| `{action:'profile.get'}` | `{ok:true,profile}` |
| `{action:'run.begin',charId,rulesId,themeId?}` | `{ok:true,ticket:{runId,seed,rulesId,themeId}}` |
| `{action:'run.finish',runId,frames,inputs:[{frame,action}]}` | `{ok:true,profile,accepted:true}` |
| 同上并增加 `finishReason:'quit'` | `{ok:true,profile,accepted:false}`（收入成功，但不入榜） |
| `{action:'run.cancel',runId}` | `{ok:true}` |
| `{action:'leaderboard.list'}` | `{ok:true,leaderboard:{entries,personal,playerName}}` |
| `{action:'welfare.get'}` | `{ok:true,welfare}` |
| `{action:'mission.claim',period:'daily'|'weekly',periodId,missionId}` | `{ok:true,welfare}` |
| `{action:'handbook.claim',chapterId}` | `{ok:true,welfare}` |
| `{action:'market.get'}` | `{ok:true,market}` |
| `{action:'market.buy',offerId,requestId,catalogVersion}` | `{ok:true,market}` |
| `{action:'character.equip',characterId}` | `{ok:true,market}` |
| `{action:'theme.select',themeId}` | `{ok:true,market}` |

所有失败是 `{ok:false,error:{code,message}}`，不返回底层数据库/凭据信息。`profile.get` 保留已有错误码；跑局常见码为 `INVALID_REQUEST`、`INVALID_REPLAY`、`RULES_MISMATCH`、`INVALID_CHARACTER`、`CHARACTER_NOT_OWNED`、`RUN_UNAVAILABLE`、`RUN_EXPIRED`、`RUN_TOO_FAST`、`RUN_CONFLICT`、`REPLAY_REJECTED`、`PROFILE_LIMIT`。跑局请求严格校验字段，客户端 summary、币数、seed、timestamp 等额外字段被拒绝。

### 档案与权威收入

`profile` 保留 `schemaVersion:1`、不含明文 OpenID 的稳定 `playerId`、`wallet:{coin,diamond}`、`inventory:{characters,items}`、`preferences:{characterId,themeId}` 和 ISO 字符串 `createdAt/updatedAt`。事务版本 `revision` 初始为0，每次已存在档案的实际持久变更加1；一局的收入、任务与手册进度合并只加1，领取重试/纯读取不增加。初始化新档案时一并加入福利状态仍为初始版本0；旧档案首次初始化福利或补齐新免费角色会增加版本，同一事务最多加1。客户端据此判断快照新旧。整档写回剥离 SDK 的 `_id`。首次创建钱包为零，拥有免费 live 角色及首个 live 默认主题；已有档案只补免费角色，不覆盖钱包、库存或选择。

首次合法入账后增加：

```js
stats: { runs, distanceM, coins, bestScore }
firstCoinBest: { rulesId, distance, score, charId, stoppedByCoin, achievedAt, order }
```

`stats` 为真实已接受跑局的累计次数/里程/金币及全局最高完整局分数；没有顶层 `bestScore`。`firstCoinBest` 保存当前规则榜单最佳首次金币前记录。UTC ISO 时间与排序序号均由服务器生成。纯读取不会修改更新时间；免费角色迁移只在首次缺失时写入。重复 finish 不累计统计或入账，返回当前持久档案（期间有另一局入账时，响应档案会包含较新余额）。

### 票据、回放与原子性

- `run.begin` 检查角色 live 且档案拥有，事务持久化服务器密码学随机 runId/uint32 seed、玩家绑定、charId、themeId、规则版本、状态和发放/过期时间。rulesId 与共享 flow 的 `first-coin-v3:<构建SHA>:<配置摘要>` 一致，不接受客户端规则替代。themeId 只接受 live/draft；省略时使用默认主题，回放使用票据绑定主题，finish 不能替换。
- 采用既有榜单边界：**108000 帧、20000 输入、1860 秒票据窗口、2000 毫秒上传时差容忍**。输入必须按帧非降序，动作只允许 jump/slide/laneL/laneR/skill；每帧先输入后 step。
- 回放使用实际 RunnerSim（保留新手保护）。默认**死亡必须恰好发生在最后一帧**；显式 `finishReason:'quit'` 可在活着时结束，但仍拒绝死亡后的额外帧。过快上传、过期、取消或跨身份均拒绝。收入取完整局 `summary.coins`，榜单取 `firstCoinRecord.snapshot(summary)`；quit 不写榜单。两者收入均不依赖任务的十秒有效局门槛。
- CPU 回放在事务外；事务内重新检查票据玩家、状态、规则、有效期与输入摘要，随后原子写入档案钱包/统计、榜单最佳记录、持久排序序号及票据消费状态。部分写入或提交失败不会报告成功。
- 写回档案排除数据库读取附带的 `_id`，保留业务数据。回归测试保留实际 SDK 两层 DocumentReference 与 EJSON 序列化，仅替换最终传输；事务替身也模拟读回 `_id` 和禁止写回 `_id` 的行为。
- 相同规范化 frames/inputs/可选 finishReason 摘要的 finish 重试成功但不再入账或累计进度；更换 payload 拒绝。消费票据持久保存 `rankEligible`，重试返回相同入榜结果。已成功票据的同 payload 重试可超过原过期时间，但必须仍匹配当前规则。cancel 仅能取消自己的 open 票据，不改变经济数据；已取消票据不能 finish。
- 榜单按首次金币前 `distance DESC, score DESC, order ASC`。事务中的每榜单持久递增序号表示接受改进记录的先后次序，同分不覆盖旧纪录；跨实例依赖数据库冲突重试，不使用本机锁或 Map 持久化。
- `entries` 最多 50 条，字段为 `{rank,playerName,distance,score,charId}`。`personal` 独立查询并计算全榜名次，榜外玩家也有记录；无记录为 null。名字为服务端 playerId 派生的匿名 `跑者-<12位hash>`，不引入 UGC。榜单按 AppID 与当前 rulesId 隔离。list 的 top / personal / count 是分立只读查询，并非数据库快照；并发更新期间单次响应可能反映相邻读取时刻。

## 每日/每周任务与免费福利手册

`welfare` 为 `{profile,serverTime,minRunSeconds,daily,weekly,handbook}`。`serverTime/resetsAt` 是服务器 Unix 毫秒；日/周组为共享 `MissionGroup` 的 `{periodId,resetsAt,missions:[{id,title,metric,target,progress,reward,claimed}]}`。手册章节为 `{id,title,description,metric,target,progress,reward,claimed,unlocked}`。

- 复用 `apps/server/src/periods.mjs`：北京时间每日00:00、周一00:00刷新。按玩家/周期 SHA-256 稳定选择 easy/mid/hard 各一项，周任务为配置现有四项；第一次生成的定义、条件与奖励持久固化在档案内，本周期配置更新不改变已产生的任务。
- `run.begin` 持久保存开始时 dailyId/weeklyId；有效对局（真实模拟时长达到 economy.missions.minRunSeconds，当前10秒）才累计任务和手册。score 取最佳、角色去重、其他指标累加并封顶。完成时只更新与开始周期仍一致的日/周组；跨日/周仍累计手册。短局仍有权威收入与普通 stats，但不能用 stats 绕过福利有效局门槛。
- 手册四章条件/奖励全在 `economy.params.handbook.chapters`：初次出发1有效局→coin200；海岸探索累计1000米→coin500；金币收藏累计100币→key1；跑酷达人10有效局→diamond10。所有章节提前累计有效进度，但必须先领上一章才能领取下一章；稳定 chapterId 一次领取，不随日周刷新。首次产生的手册定义随档案固化。
- profile 内仅保存当前 daily/weekly 组、受目标上限约束的进度/角色集合及一次性手册；公开 profile 投影不泄露内部定义/领取表。无需新增集合、索引或 cookie 服务。福利读请求可能初始化/刷新周期，所以也走真实数据库事务；普通 profile.get 不隐式刷新福利。
- 领取资格、领取标记与奖励发放在同一 profile 事务；coin/diamond 进入统一 wallet，key/shard 等进入 inventory.items。相同领取重试成功且不重复发奖；旧日周 periodId 返回 `PERIOD_EXPIRED`，未达目标 `REWARD_NOT_READY`，章节未解锁 `CHAPTER_LOCKED`，无此奖励 `REWARD_UNAVAILABLE`。客户端金额、进度、身份等额外业务字段拒绝；平台附带 userInfo 只剥离元数据，身份仍读取 getWXContext。
- 新福利测试包括真实死亡/主动结束回放、十秒边界、跨日/跨周、定义固化、同一结算重复提交、任务/手册并发领奖、库存归属、版本/_id 回归及故障回滚；数据库全为测试替身，没有向真实云写进度或发奖。

## 确定性商店、仓库与出战

`market` 严格采用 `packages/game/src/core/commerce.ts` 的 `CommerceSnapshot`：`{profile,catalogVersion,offers,characters,items,themes}`。商品为 `{id,category,title,description,price,priceText,grants,remaining,owned,canPurchase,unavailableReason}`；grant 为 `{item,amount,name}`。`remaining:null` 表示没有次数上限，`unavailableReason:null` 表示可购买。角色阵容只列 live 角色并带拥有/出战状态；库存只显示实际非零的 items，币种和碎片使用可读名称；主题显示所有配置的非 retired 项，保留雨夜 draft 主题可选的既有行为。

- `unlock_coin_<charId>` 从 live 角色 `unlock.type:'coin'` 的 cost 生成一次性购买；`unlock_shard_<charId>` 从 economy.shards 的 `need['1']` 生成一次性兑换。已有角色不能再次扣款，免费初始角色不丢失。
- 保留已接通的 `offer_refill_coin`（钥匙换金币）和 `offer_shard_volt` 等确定性交换，price/give/once/perDay 均来自服务器配置。没有使用功能的 XP 卡、未接皮肤/活动商品明确 `canPurchase:false`，原因来自实际未实现功能，不销售占位品。
- `recycle_<shardId>` 按 `shop.shardRecycling` 回收碎片，当前每5片换300金币、每日每种5次；已拥有角色后的任务碎片仍有用途。买5个牢大碎片再回收会净消耗金币，不构成套利。
- 免费手册产出的钻石可通过 `offer_diamond_coin` 兑换金币，价格/数量/每日次数来自配置；不存在充值或现金支付入口。
- 当前十角色统一 `unlock.type:'free'`，旧档案在事务内幂等补齐免费角色，保留钱包、库存及选择；已有角色商品不可购买、不扣费。历史角色商品报价保留给后续配置使用，没有抽奖、支付、广告或付费试用。
- `catalogVersion` 是规范化实际目录（报价、授予、限购、可用性与可读名称）的服务器 SHA-256 版本。新购买的过期版本拒绝 `CATALOG_CHANGED`，不能由客户端提交价格、币数或授予覆盖报价。economy 名义版本变化而实际目录不变时，不无谓作废同价报价；规则哈希仍与经济配置分离。
- 客户端确认后固定并持久重试同一 `{offerId,requestId,catalogVersion}`。requestId 接受1–128位 `[A-Za-z0-9_-]`，可用 UUID；每次新的购买意图使用新 id。回执主键 SHA256(JSON([playerId,requestId])) 绑定可信玩家，**先匹配已有回执，再检查当前报价/拥有/限购**。相同请求重试返回当前 market 快照且不再扣款，即使后来改价或下架；同 id 换 offerId 或 catalogVersion 拒绝 `PURCHASE_CONFLICT`。不能把已确认重试自动换成新版本/新 id。
- WX客户端将未确认的已确认购买意图按环境/函数/玩家隔离存入严格存储；首次保存失败返回本地 `PURCHASE_NOT_SAVED` 且不发送购买。响应丢失后重进商店沿原三元组重交；确定拒绝会清除待重试记录，网络/未知结果保留，不使用循环重试。
- 事务内读取 profile 与 receipt，复核拥有、余额、once 和北京时间日限购，随后同一事务扣款、授予、增加一次 revision 并写 receipt；任何阶段失败无部分写。coin/diamond 归 wallet，key/shards 归 inventory.items，char_ 归 characters。整档写回剥离 `_id`，保留福利/跑局私有状态；这些状态不随公开 profile 泄露。
- 限购只保存一个 daily `{periodId,counts}` 桶，下次交易替换旧日桶；无历史日期无限累积。市场只读快照按服务器当前北京时间计算 remaining，不为日刷新强行增加 revision。once 标记长期保留，幂等 receipt 也持久保留，不可按日限购周期删除回执。
- `character.equip` 只允许 live 且已拥有角色；`theme.select` 只允许非 retired 配置主题。只修改对应 preference，并返回持久快照；同一选择不写档、不增加 revision，不能借选择 API 改余额或拥有状态。
- 清晰业务错误码包括 `INSUFFICIENT_FUNDS`、`ALREADY_OWNED`、`PURCHASE_LIMIT`、`OFFER_UNAVAILABLE`、`CATALOG_CHANGED`、`PURCHASE_CONFLICT`、`CHARACTER_NOT_OWNED`、`INVALID_CHARACTER`、`INVALID_THEME`、`INVALID_REQUEST`、`PROFILE_LIMIT`。非确定性内部失败统一 `MARKET_UNAVAILABLE`，不暴露底层错误。

商店测试使用隔离内存事务及实际 wx-server-sdk 包装器（替换底层 transport，无云 IO），覆盖扣款/兑换/回执、余额/限购、跨玩家、失败回滚、选择持久化/无操作，以及购买与领取/真实 quit 结算竞争时不丢增量。真实云端的事务冲突、集合权限与并发性能仍待验证。

## 待授权后的云配置与部署

1. 核实小游戏 AppID 的云开发权限、已有环境、地域/套餐和预算；本实现需要支持事务的**传统文档型数据库**，不适配 PostgreSQL/PG 模式。开发/体验与正式环境分开。SDK 使用 `DYNAMIC_CURRENT_ENV`，不注入管理员密钥。
2. 函数类型为普通事件函数；名称 `thunder-api`，入口 `index.main`，Node.js **>=20.19**，选择账号实际可用的受支持 Nodejs20.19 或经验证的新 LTS。设置函数服务端环境变量 `TR_APP_ID=<已授权小游戏AppID>`。缺配置/可信身份时拒绝。
3. 平台“云端安装依赖”必须启用受支持的 Node 运行时并从生成目录的 package 安装。若平台安装器不保证使用锁，在生成目录本地/受控 Linux 构建环境执行 `npm ci --omit=dev --ignore-scripts --no-audit --no-fund` 后全量上传带依赖目录，确保采用独立锁；不上传根 node_modules。
4. 预建下面五个集合；函数不会在请求中执行 DDL。**五个集合均配置客户端安全规则** `{"read":false,"write":false}`，所有读取也经过函数。服务端管理身份不受客户端规则保护，所以必须保留函数的身份/AppID检查。

| 集合 | 文档键与用途 |
| --- | --- |
| `thunder_profiles` | `p_` + SHA256(JSON([APPID,OPENID]))；持久钱包、库存、出战、统计、最佳纪录、福利及有界商店限购状态 |
| `thunder_runs` | 43 字符随机 runId；持久票据、消费摘要和权威结果；不存原始输入数组 |
| `thunder_first_coin` | SHA256(JSON([boardId,playerId]))；每玩家、每榜单一个最佳纪录 |
| `thunder_rank_order` | SHA256(JSON([APPID,rulesId]))，即 boardId；持久 sequence |
| `thunder_purchases` | SHA256(JSON([playerId,requestId]))；持久购买回执，保存原 offerId/catalogVersion、可信玩家、请求 id 与服务器时间 |

5. 预建 `thunder_first_coin` 的非唯一复合索引：`boardId ASC, distance DESC, score DESC, order ASC`。用于 top50 及个人前方记录 count，主键索引用于个人记录/事务。实际控制台索引能力与 OR 查询执行计划仍须在目标环境验证；若平台为各 OR 分支要求附加索引，应按该执行计划补足后验收。其余集合仅按主键操作；新增 purchases 不需要额外复合索引。
6. 不开启 HTTP 网关或开放客户端数据库权限。部署后从真实小游戏身份执行初始化、死亡局提交、重试、并发及重进读回；在云库观察一次收入和持久票据状态，验证客户端直读写拒绝、跨 App/玩家拒绝和榜外个人名次。

### 费用与运行时限制

最长合法回放的 CPU、内存、冷启动与整体超时尚未在目标云实测；同步重放不会在事务内运行，但仍占用函数执行时间。不能据本机短局测试认定体验套餐的 3 秒窗口足够。持久排序计数器会形成同榜单改进提交的写热点，需实际测量 SDK 重试与负载；不自动扩容、开通付费或降级为信任客户端成绩。

本切片未增加全局限流/自动票据清理/监控服务，需在获准环境结合实际流量确认调用配额、预算告警和保留策略；保留已完成票据摘要和购买回执以维持幂等性，不能直接按过期时间删除后重新开放消费。付费/广告手册、抽奖与其他经济发放不在本次范围。

## 官方 API 依据

- [getWXContext](https://developers.weixin.qq.com/minigame/dev/wxcloud/reference-sdk-api/utils/Cloud.getWXContext.html)、[wx-server-sdk](https://developers.weixin.qq.com/minigame/dev/wxcloud/guide/functions/wx-server-sdk.html)
- [事务](https://developers.weixin.qq.com/minigame/dev/wxcloud/guide/database/transaction.html)、[runTransaction](https://developers.weixin.qq.com/minigame/dev/wxcloud/reference-sdk-api/database/Database.runTransaction.html)、[Document.get](https://developers.weixin.qq.com/minigame/dev/wxcloud/reference-sdk-api/database/document/Document.get.html)：`throwOnNotFound:false` 读空为 null，只有空文档初始化；回调结束后自动提交，SDK 返回回调值本身。
- [and / or 查询组合](https://developers.weixin.qq.com/minigame/dev/wxcloud/reference-sdk-api/database/command/Command.and.html)、[安全规则](https://developers.weixin.qq.com/minigame/dev/wxcloud/guide/database/security-rules.html)
- [运行时](https://docs.cloudbase.net/cloud-function/runtime-support)、[函数配置与依赖安装](https://docs.cloudbase.net/cli-v1/functions/configs)、[CloudBase 事务限制](https://docs.cloudbase.net/database/transaction)

API 资料查询日期 2026-11-06；实际 SDK 包装器与 `@cloudbase/database` 实现也已本地核对。账号权限、地域、索引、费用及真实云 IO 仍待核实。
