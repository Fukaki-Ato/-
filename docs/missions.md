# 每日与每周任务

## 玩家体验

- Web 大厅的「任务」打开任务手册，可切换每日/每周，查看进度、重置时间、奖励与领取状态。
- 北京时间每日零点更新每日任务，每周一零点更新每周任务；过期未领奖励不补领。
- 使用 `config/economy.json → params.missions`：每日按 easy/mid/hard 各抽 1 项，每周 4 项。同一游客同一周期抽选稳定。
- 正常死亡与主动退出都提交操作回放；有效对局时长门槛由 `minRunSeconds` 控制。不计过短局、调试局；刷新或关闭网页造成的未结算局不计。
- 局内金币、任务奖励金币分别保存；大厅合并展示。任务页的钱包显示服务端持久化的金币、角色碎片和钥匙。商店仍只读，不在本次扩展消费/兑换或角色解锁。
- 任务服务不可用不阻止本地游戏；任务页显示错误并可重试。有票据的已完成局最多保留 10 条待同步回放（本机 localStorage），恢复后重试，不重复记进度。
- 游客身份由服务端 HttpOnly Cookie 保存。清理 Cookie 会成为新游客，当前没有账号绑定或跨设备恢复；不能用本机 player ID 冒充服务端身份。

## 集成边界

- `missionIntegration.ts`：Web 大厅/任务页面生命周期、钱包展示与回放上报；调试模式明确不记任务。
- `missionApi.ts`：同源 `/api/missions`、Cookie、错误反馈及有限重试队列。不向后端提交客户端分数/完成标记/奖励数值。
- `mainFlow.trackRun`：可选宿主钩子，由 `RunSession` 在排行榜开局准备完成、真实模拟创建后给出模拟与种子，离开 run 时调用结束函数。排行榜与任务独立录制/上报；取消开局等待不会创建任务票据。无此钩子的共享 UI/WX 流程行为不变。
- `core/missions/recorder.ts`：按固定模拟步录输入；死亡动画不增加帧数，录制上限避免无限占用内存。
- `RunnerSim.missionStats`：独立累计实际滑铲及道具拾取，不修改历史 summary 或 golden；滑铲技能消耗充能不会扣掉累计次数。
- 新页面为 DOM 文本，字体子集包含前端与服务端任务文案，不依赖自绘字体图集新增字形。新增文案后运行 `tools/fontgen/subset-web.py`，不要假定设备一定有 CJK fallback。

## 开发与验收

先根目录 `npm ci`，两个终端分别 `npm run dev:server`、`npm run dev`。Vite 优先将 `/api/missions` 代理到 `127.0.0.1:8768`，可用 `TR_MISSION_API` 调整开发目标；已有排行榜的 `/api/` 代理仍转发至 8788，两个服务与游客 Cookie 相互独立，不改现有排行榜。

生产静态页面需同源反代 `/api/missions`；即使游戏部署在 `/thunder-run/`，API 路径仍在站点根。单独上传静态文件不会部署后端。后端最低 Node 版本与 HTTPS/数据库要求见 [后端文档](missions-backend.md)。

```bash
npm run build
node --test tests/mission-client.test.mjs tests/missions-server.test.mjs tests/mission-proxy.test.mjs tests/mainFlow.test.mjs
npm run check
npm run build:web
```

浏览器检查包括：手机尺寸双页签、领取防连点、刷新持久化、服务断开重试、真实开局/结算同步。WX 仍为空场景验证壳，本功能不声明 WX 真机验收。
