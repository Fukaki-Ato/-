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

## API

所有写请求必须包含与 `PUBLIC_ORIGIN` 完全相同的 `Origin`；未设置时，与请求 `Host` 做 host 比较。缺失或不匹配返回 `{"error":"..."}`。服务不开放 CORS。游客会话使用服务端随机 token，数据库只保存 SHA-256 摘要；cookie 为 `HttpOnly; SameSite=Lax; Path=/`，浏览器需以同源凭据调用。未建立/无效会话的受保护 API 返回 401。错误响应统一为 JSON `{"error":"用户可读文本"}`。

- `POST /api/missions/session`：建立游客会话并设置 cookie；成功返回 `{"ok":true}`。可不带 body。
- `GET /api/missions`：返回 `MissionSnapshot`：`serverTime`、`daily`、`weekly`、`wallet`。时间戳是 Unix 毫秒；每组含 `periodId`、`resetsAt` 和任务视图。wallet 只包含已发放过的余额。
- `POST /api/missions/runs`：JSON `{"seed":uint32,"charId":"char_volt"}`（空串表示默认装备），返回 `{"runId":"..."}`。每张 ticket 服务端记录 seed、角色、开始时间和当时周期。
- `POST /api/missions/runs/:id/finish`：JSON `{"frames":正整数,"actions":[{"frame":0,"action":"jump|slide|laneL|laneR|skill"}]}`，返回最新 `MissionSnapshot`。frame 从 0 开始；同一帧动作按数组顺序执行，并在该帧 `step()` 前应用。帧数表示总模拟 step 次数，动作需按 frame 非降序排列且 `0 <= frame < frames`。死亡帧必须是最后一帧；仍存活时允许玩家主动结束。客户端不得提交 summary。相同 ticket + 完全相同回放重试是幂等的；更换回放内容返回 409。
- `POST /api/missions/claim`：JSON `{"period":"daily|weekly","periodId":"...","missionId":"..."}`。任务完成且周期仍当前时才领取；SQLite 事务原子更新 claimed 与 wallet，重复领取不会重复入账。

## 周期与进度

按北京时间（Asia/Shanghai，UTC+08:00）每日 00:00 重置；周一 00:00 同时开启新周。`daily.periodId` 是北京时间日期，`weekly.periodId` 是该周周一日期。每日池按每用户、周期稳定抽取 easy/mid/hard 各一项；周任务使用配置中的全部四项。选择结果在 SQLite 首次建立周期时固化，进程重启/配置池顺序变化不会改变已建立周期的任务。

`config/economy.json → params.missions.minRunSeconds` 是有效对局最短时间，当前为 **10 秒**。短于阈值的结算仍成功，但不计入任何任务。有效对局由 `RunnerSim` 重放结果计入：distance/coins/score/hits/casts 来自 summary，slides/itemPickups 来自 `sim.missionStats`，charactersPlayed 在周周期按不同 `charId` 去重。最佳分任务取最高分；其他累计/计数按有效对局累加。跨日/跨周结束的 ticket 只更新其开始周期仍与当前周期相同的任务，不会把旧回放加到新周期。

服务器还会检查基于 ticket 的最短结算耗时（模拟帧时长减 2 秒网络容差，过快返回可重试的 425）、ticket 24 小时有效期、最多 108,000 帧（30 分钟）/20,000 动作、1 MiB 请求 body，以及按 IP/会话每分钟限流。客户端与服务端共享录制上限；超长局明确提示不计任务。回放每 600 步让出事件循环，同时最多验证 2 局，忙时返回可重试的 429。它们是防滥用边界，不是玩法平衡参数。

## 验证与安全边界

```sh
node --test tests/missions-server.test.mjs
```

这是一个单机游客任务服务，不是完整反作弊系统：cookie 可被清除重开，游客没有跨设备身份；可预测的模拟重放只能验证服务端规则，并不阻止自动化/脚本操作。若奖励具备现实或高价值经济影响，应先接入账号身份、持久化滥用检测和运营审计。
