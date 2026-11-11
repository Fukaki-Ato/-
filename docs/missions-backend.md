# 任务后端

## 启动与部署

后端是独立 workspace，与根工程一致要求 Node.js >=22.23（推荐 24），使用内置 `node:sqlite`，无外部服务依赖。先在仓库根目录安装/构建：

```sh
npm ci
npm run build
npm run start --workspace @tr/server
```

默认监听 `127.0.0.1:8768`。可用 `HOST`、`PORT`、`MISSIONS_DB_PATH` 覆盖监听地址、端口和 SQLite 文件；生产部署应通过 HTTPS 反向代理把同源 `/api/missions` 路由到此进程，并设置 `PUBLIC_ORIGIN=https://游戏域名`。不要把此服务直接暴露在公网，也不要依赖或信任 `X-Forwarded-*`。HTTPS 外部地址会使游客 cookie 带 `Secure`。

反向代理时还需设置 `TRUSTED_PROXY_IP=127.0.0.1`（实际代理连接地址）。只有连接源严格等于该 IP，服务才读取合法的单个 `X-Real-IP` 作为限流键；否则忽略所有代理头。代理必须**覆盖**这个头，不能透传用户提供的值。例如 Nginx 的最小同源路由：

```nginx
location /api/missions {
    proxy_pass http://127.0.0.1:8768;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
}
```

未配置可信代理时，代理后所有用户共用连接源 IP 限流桶，因此正式部署不要省略该配置；多个代理应在网关统一限流并另行设计可信链，不接收逗号 IP 链。

SQLite 启用 WAL 和外键，适用于**单个服务进程/实例**。使用本地持久盘并纳入备份；不要将同一 SQLite 文件用于多主机写入或横向扩容。进程重启会保留用户、周期任务、进度、领取记录、钱包和 run ticket。

主题回放升级为 `runs` 添加可空 `theme_id`，旧行保留 NULL 并按默认主题回放；启动迁移保留原记录。正式升级前使用 SQLite backup API 制作一致性备份，并同步部署客户端、排行榜和任务后端。

### 签发规则与模拟包持久化

根 `build/check` 在 TypeScript 编译后，用已有构建期 esbuild 生成 `apps/server/dist/replay-runtime.mjs`。它打包 RunnerSim 依赖、回放循环与 STEP_DT；外部依赖只允许 Node 内建模块。**生产无需 esbuild，但发布时必须携带这个产物**、`apps/server/src`、`apps/server/rules-baselines/38d5116.json` 及原有共享包 dist/配置。只复制 src 或直接运行单独的 `tsc -b` 不构成完整发布；watch 后重启后端前也应执行根 build。

新票据的 `runs.rules_id` 引用 SQLite `replay_rulesets`：ABI、完整模拟代码、完整配置、有效局阈值与帧/动作预算共同派生 SHA-256 ID。每种规则只保存一次，结算使用票据绑定值，不临时替换成新部署的内容或模拟器。当前服务对象的配置若被合法更新，只影响后续签发；已绑定快照不随别名变化。

初次升级前停止旧单实例写入并保留原库。当前项目已核对的生产基线为 `38d5116`；仓库封存了从其已核对源码/配置构建的基线。首次启动在事务中把既有 open/NULL 规则票据归到该基线，并写入 `service_metadata` 标记；钱包、已领状态和周期进度不重建。后续启动不会把后来出现的 NULL 票据悄悄绑定到当前新版本，未知来源保留并返回可重试的 503，需核对后处理。

这保留的是**升级前旧服务原本会使用的已知基线**，不是推断缺失的更早开局历史。其他定制部署不能盲用本项目基线，应由可信的服务端初始化显式提供对应封存规则。封存工具的 `--freeze-baseline=38d5116` 仅用于匹配该 Git 基线的输入，且拒绝覆盖既有封存；普通 build 不更新历史基线。

代码哈希的完整性校验不是来源认证。加载数据库回放包前还会比对 SQLite 之外的可信代码哈希：当前本地产物和已封存基线默认可信；后续更多历史发布包须把其**构建输出的代码 SHA-256**列入 `TRUSTED_REPLAY_RUNTIME_HASHES`（逗号分隔，非秘密）。不要把数据库中自报的哈希自动加入信任，也不要误填包含配置/阈值的 rules_id。HTTP 不接受源码、模块路径或 rules_id。数据库即使被改成一个自洽的新 hash，也不能独自授权执行未知程序。

保留有效旧票据所需的规则行与可信代码哈希，直到不再有相关有效票据；当前实现不主动清理规则快照，也没有无限期历史 ABI 兼容承诺。缺失、损坏或不受信任的包返回 503，run 保持 open、客户端队列保留；恢复正确规则/信任配置后重试仍只计一次。原 24 小时自然有效期、跨日/周计入规则和资源限流保持不变，不增加“发布即过期”。

升级后不能把不认识规则绑定的旧后端二进制直接接回新库来处理新票据；回退也应使用支持绑定的服务并保留完整规则/metadata/票据数据。已签发票据的保证不等于旧页面升级后新开局已经有版本握手；客户端匹配、榜单进程内挑战恢复属于后续独立链路。

## API

所有写请求必须包含与 `PUBLIC_ORIGIN` 完全相同的 `Origin`；未设置时，与请求 `Host` 做 host 比较。缺失或不匹配返回 `{"error":"..."}`。服务不开放 CORS。游客会话使用服务端随机 token，数据库只保存 SHA-256 摘要；cookie 为 `HttpOnly; SameSite=Lax; Path=/`，浏览器需以同源凭据调用。未建立/无效会话的受保护 API 返回 401。错误响应统一为 JSON `{"error":"用户可读文本"}`。

- `POST /api/missions/session`：建立游客会话并设置 cookie；成功返回 `{"ok":true}`。可不带 body。
- `GET /api/missions`：返回 `MissionSnapshot`：`serverTime`、`daily`、`weekly`、`wallet`、`rewardLedgerId`。时间戳是 Unix 毫秒；每组含 `periodId`、`resetsAt` 和任务视图。wallet 是该 rewardLedgerId 对应的累计已领取奖励账本，不是可消费余额；rewardLedgerId 使用持久游客用户 ID，会话续期不改变它。客户端按币种累计高水位只导入增量到本机钱包，不回写服务端余额。
- `POST /api/missions/runs`：JSON `{"seed":uint32,"charId":"char_volt"}`（空串表示默认装备），可选 `items`（最多三个有效道具 ID）与 `themeId`（配置中 live/draft 主题，省略取默认）。返回 `{"runId":"..."}`；服务端持久记录种子、角色、装备、主题、开始时间、当时周期和规则引用，结算时按签发环境回放，不接受临时替换主题/规则。
- `POST /api/missions/runs/:id/finish`：JSON `{"frames":正整数,"actions":[{"frame":0,"action":"jump|slide|laneL|laneR|skill"}]}`，返回最新 `MissionSnapshot`。frame 从 0 开始；同一帧动作按数组顺序执行，并在该帧 `step()` 前应用。帧数表示总模拟 step 次数，动作需按 frame 非降序排列且 `0 <= frame < frames`。死亡帧必须是最后一帧；存活时主动结束的请求可返回 200，但不计任务进度，200 不等于有效局。客户端不得提交 summary。相同 ticket + 完全相同回放重试是幂等的；更换回放内容返回 409。
- `POST /api/missions/claim`：JSON `{"period":"daily|weekly","periodId":"...","missionId":"..."}`。任务完成且周期仍当前时才领取；SQLite 事务原子更新 claimed 与 wallet，重复领取不会重复入账。

## 周期与进度

按北京时间（Asia/Shanghai，UTC+08:00）每日 00:00 重置；周一 00:00 同时开启新周。`daily.periodId` 是北京时间日期，`weekly.periodId` 是该周周一日期。每日池按每用户、周期稳定抽取 easy/mid/hard 各一项；周任务使用配置中的全部四项。选择结果在 SQLite 首次建立周期时固化，进程重启/配置池顺序变化不会改变已建立周期的任务。

`config/economy.json → params.missions.minRunSeconds` 是有效对局最短时间，当前为 **10 秒**，每张票据按签发时实际阈值保存。短于该阈值或未死亡收尾的结算可成功处理，但不计任务。有效对局由绑定回放包的 `RunnerSim` 计入：distance/coins/score/hits/casts 来自 summary，slides/itemPickups 来自 `sim.missionStats`，charactersPlayed 在周周期按不同 `charId` 去重。最佳分任务取最高分；其他累计/计数按有效对局累加。跨日/跨周结束的 ticket 只更新其开始周期仍与当前周期相同的任务，不会把旧回放加到新周期。

服务器还会检查基于 ticket 的最短结算耗时（模拟帧时长减 2 秒网络容差，过快返回可重试的 425）、ticket 24 小时有效期、最多 108,000 帧（30 分钟）/20,000 动作、1 MiB 请求 body，以及按 IP/会话每分钟限流。客户端与服务端共享录制上限；超长局明确提示不计任务。回放每 600 步让出事件循环，同时最多验证 2 局，忙时返回可重试的 429。它们是防滥用边界，不是玩法平衡参数。

## 验证与安全边界

```sh
node --test tests/missions-server.test.mjs
```

这是一个单机游客任务服务，不是完整反作弊系统：cookie 可被清除重开，游客没有跨设备身份；可预测的模拟重放只能验证服务端规则，并不阻止自动化/脚本操作。若奖励具备现实或高价值经济影响，应先接入账号身份、持久化滥用检测和运营审计。

## 本机钱包衔接（当前 MVP）

Web 和 WX 的业务存储使用 `createRewardWalletStore`：金币、钻石、钥匙、角色碎片和道具沿用旧键接口，但新值与每个任务账本的已导入累计值保存在同一条 JSON 记录中。旧本机余额在首次写入时懒迁移并保留；现有角色、档案、商店和离线消费都读取这个包装。任务 load / claim / finish 的 snapshot 在返回 UI 前同步；重复响应、刷新、会话续期和较旧的累计值不会补回已消费奖励。大厅只显示本机余额；任务页显示累计奖励。

单条写入失败或写后校验不一致会报错，领取可刷新重试；损坏的钱包记录不会当作空游标重新发奖。所有包装每次读取最新持久数据，不缓存钱包；这仍是单机 MVP，不提供跨设备云存档或多进程事务。清除站点存储会清除本机余额及导入记录，因此不能保留本机消费历史；不要把此实现当作账号级/高价值经济系统。
