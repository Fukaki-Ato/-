# Thunder Run 代码审查报告与开发计划

- 审查日期：2026-11-04（基线 f63de69）· 执行推进至 2026-11-05
- 方法：机械验证（`npm run check` 全流程实跑）+ 四路并行深读（framework/game、web/wx、server 安全、测试工具链）+ 未完成功能盘点，共精读 200+ 文件

## 0. 执行状态（2026-11-06 更新）

## 0.5 第二批执行（2026-11-06，子代理验收 ACCEPT）

| 项 | 状态 | 说明 |
|---|---|---|
| E2E 浏览器冒烟 | ✅ | tools/e2e-smoke.mjs（playwright + SwiftShader）：大厅→商店→选角→开局出帧全绿，npm run test:e2e；看门狗+全等待超时防护 |
| 复活系统 | ✅ | core/sim/revive.ts 确定性自动复活（min(maxPerRun,webFreeRevivePerRun)+无敌窗+走廊软清障），server 重放同构零协议改动；golden 重生审查通过 |
| 道具进局闭环 | ✅ | 购买自动装备→开局消费→initialItems 注入 buffs（不计 itemPickups）；任务服务 items 随票提交 + items_json 列 + 重放同清单注入；item_helmet 端到端确定性测试 |
| 遥测骨架 | ✅ | flow/telemetry.ts 环形 20 条本机持久化 + runSession 记录 + GameFlow.telemetry() 读取口 + __trTelemetry debug 探针 |
| 新场景黄昏渔港 | ✅ | render/harbor/harborProps.ts 五层程序化侧景（提示词合成：工业视差分层+霓虹夜城 5 层配方→橙青调渔港）；theme_dusk_harbor live；字体图集补 昏/渔/港；子代理三场景截图视觉验收 PASS |
| 障碍/难度组合 | ✅ | 五个多机制连段（滑铲→起身跳/双墙+闪电圈/上车→落车→滑铲→换道/摆锤+弧/冲撞+圈）+ by11 难度带；**layTeachingLines 接线**（cells 的 coins 字段此前是死配置，现在真铺设：trainTop 骑顶/链长桶区间/跳跃净空）+ 跨窗清币 purgeOverlappedCoins |
| 子代理验收 | ✅ ACCEPT | 首轮 6/7 PASS + 3 P1 → 修复 2 个（trainTop 0→838 车顶金币实测、__trTelemetry 探针）+ 1 个诚实降级；终审 7/7 PASS 无 P0/P1 阻断 |

已知未完成（诚实清单）：三个运动体连段（train_dismount/pendulum/rusher_zap）的脚本化解法测试（现有池+封堵纪律覆盖）；runSession exit 遥测分支；configValidator diamond 双向对称的 wx 侧；真机/devtools 视觉终验。

## 0. 第一批执行（2026-11-05）

| 里程碑 | 状态 | 说明 |
|---|---|---|
| M0 同步卫生 | ✅ 完成 | pull PR#51；README 音频条目改真；死代码清理（mainMenu 组/旧 pickupLayer，测试已迁至 pickupLayer.js）；U+2026 存储键修复（两端带迁移读） |
| M1 bug 修复 | ✅ 完成 | 天空金币误删（区间圈定+回归测试）；performance.now()/URLSearchParams 注入化（QueryParamsView 契约）；检查黑名单补全；车顶滑铲（实时支撑面）；GLB 纹理 dispose；任务服务死亡收尾校验。golden 重生（15 例仅 1 例漂移：金币+12/分数+60，死亡帧不变，人工审查通过） |
| M2 服务器加固 | ✅ 完成 | 任务重放墙钟超时（15s→408，run 保持 open）；open-run 每用户上限 4；runs/users 定期清理；HTTP 超时三件套 + aborted 处理；有界限速器；systemd/nginx 部署物料；守护栏回归测试 |
| M3 工程防线 | ✅ 完成 | 架构检查扫全仓（180→198 文件，server/*.mjs 与 src 外纳入；server/index.mjs 拆出 http-protocol.mjs）；economy/growth/unlock 引用校验（上线即抓到 limit.once 布尔真问题）；vite.config/rankPageGateway 纳入 tsc --noEmit 检查步；WX release 探针环境门控；web sourcemap 显式开关；WX GL 上下文属性单源契约（glContext.ts）；dev 资产中间件路径修复；flaky 测试修复（2s 阈值+busy 轮询）；CI concurrency；schema 零依赖走查 + primitive 双清单比对 |
| M4 元游戏（核心） | ✅ 完成 | localEconomy.ts（钱包/购买/限购/解锁/合成）；商店两端购买 UI + 余额显示；选角页解锁/合成按钮；解锁门槛接入 availableCharacter；任务服务奖励白名单加 diamond + wchars 周任务发 1 钻（economy 1.1.0，diff 仅 2 行）。8 个经济单测 + 商店/流测试全绿 |
| M4 元游戏（其余） | ✅ 完成（2026-11-05 二批） | **档案弹层接线**：DOM 版 openProfileOverlay（bootstrap 装配，入口挂选角页底栏「档案」，改名扣钻即时回写大厅顶栏，含背包清单=仓库 MVP）。**活动签到页**：flow/signIn.ts（日历状态+每天一次领取+奖励入钱包）、events 场景（mainFlow/eventsScene）、canvas 版 eventsView + DOM 版 eventsOverlay、大厅「活动」入口接通、event_week_login_nov 转 live（events 1.1.0）。**注意**：成就/福利手册/雷暴围城 mode 型活动仍是新系统级工作，不在本轮范围 |
| M5 WX 完整集成 | ◐ 部分（2026-11-05） | ✅ **M5-3**：missionApiCore 抽出（packages/game/flow，队列/幂等逻辑单源）+ web 薄壳（行为零变化）+ wx 装配（apps/wx/platform/missionApi.ts：wx.request 传输 + storage cookie jar）+ 2 个 mock 测试。✅ **M5-4**：iOSHighPerformance 默认剔除（TR_WX_IOS_HP=1 可逆）、包内 config 改名 gameplay.json + 运行时映射、2 条防回归断言（rAF 取 GameGlobal / WebGL2 全局暴露）、wx-runtime-findings #3/#4/#5 状态更新。⬜ **M5-1**（S7/S20 单 canvas 两 pass 渲染注入）：仓库文档明示"待设计"的架构决策，前置已就绪（GL 契约单源、暴露断言、探针门控），留维护者拍板。⬜ **M5-5**（真机验收）：本环境无微信开发者工具/真机，物理不可行。⬜ **wx 排行榜客户端**：服务端凭据是页面网关签发（meta pageId），小程序无页面通路——需服务端为小程序设计凭证签发，属后端产品决策 |
| M6 依赖升级 | ✅ 完成（2026-11-05） | vite 7.3.6→**8.3.5**（rolldown 内核；生产构建+dev 冒烟 index/资产中间件/publicDir 全 200；注意插件/中间件 API 无需改动）；three 0.160.1→**0.187.0**（227 文件类型零错误，716 测试全过；sim 无 three 依赖，golden 不受影响；视觉默认值差异需真机/浏览器人工复核）；TypeScript 5.5.4→**7.0.2**（原生编译器，tsc -b composite references 全仓零错误）。每步独立验证后统一 ALL PASS |

全程每步 `npm run check` 验证；结束时 ALL PASS（测试 730+，全部真实断言）。**未提交任何 commit**——工作区改动待维护者审查后自行提交。

审查基线结果（2026-11-04）：全绿 —— 687 个测试 3.3s 全过、配置校验 8 文件、架构禁令 181 源文件、WX bundle 门禁通过、零 P0 安全漏洞、无硬编码 secret、无 SQL 注入。

---


---

## 1. 上游与依赖状态（2026-11-04 快照）

### 1.1 Git 远端（origin = github.com/Fukaki-Ato/-）

- **本地 main 落后 origin/main 3 个提交**（PR #51 已合并，待 pull）：
  - `d752ea1` feat(settings): 设置页新增音乐/音效音量控制（图标+可拖滑条）
  - `89bbb70` fix(settings): preserve volume precision and mobile compatibility
  - `51818c9` Merge PR #51
  - ⚠️ PR #51 大量改动了 `assets/fonts/cjk.metrics.json`（~1.8 万行）与 `settingsView.ts`/`overlayViews.ts`/`mobilePanels.ts` —— pull 后请重跑 `npm run check`；本报告 §3 中涉及 settings 相关文件的行号可能有小幅漂移
  - PR #51 同时意味着盘点结论"设置页无音频开关"（§4.1-7）**已被上游部分解决**
- **未合并分支**（可能有进行中的工作，动工前先确认归属）：
  - 本地未合并：`yan/jetpack-pickup-3d`
  - 远端未合并：`origin/feature/cocos-meta-game`、`origin/feature/game-main-menu`、`origin/feature/test-site-current`、`origin/integration/handtest-all`、`origin/yan/jetpack-pickup-3d`

### 1.2 依赖（npm outdated 对 registry 实查）

| 包 | 当前 | 最新 | 升级风险评估 |
|---|---|---|---|
| three | 0.160.1 | 0.187.0 | 跨 27 个 minor，渲染 API 弃用风险真实存在；sim 层无 three 依赖，golden 回放兜不住渲染行为，需人工视觉回归 |
| @types/three | 0.160.0 | 0.187.0 | 跟随 three |
| typescript | 5.5.4 | 7.0.2 | TS 7 是大版本（原生编译器路线），编译器行为/诊断可能不同，单独验证 |
| vite | 7.3.6 | 8.3.5 | 跨 major，插件 API（自定义中间件 trAssets）需回归 |
| esbuild | 0.28.2 | 0.28.2 | 已是最新 |
| Node | 24.16.0 | — | .nvmrc=24 / engines>=22.23 / CI=24 三处一致，无需动 |

---

## 2. 审查发现

严重程度定义：P0 = 明确 bug / 可直接利用；P1 = 高价值修复的设计隐患；P2 = 代码质量 / 加固缺口。

### 2.1 P0

**P0-1 飞行段天空金币带会被地面生成器整链误删（玩家可感知）**
- `packages/game/src/core/sim/trackGen.ts:155-165`：`ensure()` 内 killChains 扫描本意是清理与本轮新地面障碍重叠的**地面**金币链，但遍历整个 `coins` 数组且不看 `c.y`。`spawnSkyContent`（trackSky.ts:35）给空中金币带也写了 chain id，飞行时地面内容照常 320m 提前生成（runnerSim.ts:248），任何新地面障碍只要与天空金币同车道、z 窗口相交（24m 列车窗口）就 splice 掉**该 chain 全部金币**——天空带被逐组打穿，与 `startFlight`"飞行只是从上方掠过"的既定设计冲突。
- 附带：`grantCoinRow` 的奖励金币排用 `simWorld.ts:39` 独立计数器 `coinChainSeq`（从 1 起），与 `TrackGen.chainSeq`（同样从 1 起）**共用编号空间互不知情**，killChains 按 id 整链删除会连带删无辜链。
- 修法：kill 扫描只针对本窗口新生成的地面链（记录本轮 coin 下标区间，如 newObs 的做法），或给 coin 加 ground/sky/bonus 标记。

**P0-2 `performance.now()` 直接运行在 packages/game（宿主中立违规，WX 必崩路径）**
- `packages/game/src/render/animAvatar.ts:188`：`clipLog.push({ ..., t: +performance.now().toFixed(1) })`，**不受 ?debug/?test 门控**——角色走 GLB 路径时每次 clip 切换都执行。WX 小游戏运行时无 `performance`（要 `wx.getPerformance()`），接 WX 完整游戏流时 100% ReferenceError。
- 暴露 `tools/check-import-rules.mjs` 黑名单缺口（只封 `window./document./localStorage/fetch(/wx.`，不封 `performance.`）。
- 修法：换注入的 `adapter.now()`，同时补检查黑名单。

### 2.2 P1

#### 游戏核心（packages/game、packages/framework）

| # | 问题 | 位置 |
|---|---|---|
| G-1 | GLB 角色纹理逐局泄漏：`dispose()` 只释放 geometry/material，three 的 `material.dispose()` 不释放贴图，全仓无一处 GLB 路径的 `texture.dispose()`。每开一局 GLB 角色泄漏一份贴图（数 MB），长会话 GPU 内存持续增长 | animAvatar.ts:280-287、runnerScene.ts:293-297 |
| G-2 | 车顶无法滑铲：`slideInput` 以 `s.y > 0` 判"空中"，站车顶（y=2.4）按铲被当"空中铲速降"吞掉（vy=-20 立即贴回支撑面，pendingSlide 7 步后过期）。判定应改 `s.y > supportY + ε` | movement.ts:57-60,130 |
| G-3 | `URLSearchParams` 在 game/core 运行时使用（宿主中立违规第二例）；`PlatformExtras.urlParams?: URLSearchParams` 把宿主类型写进 framework 公共契约。建议改结构化 `{ has(key) }` 小接口注入 | debugMode.ts:4、platformAdapter.ts:70 |
| G-4 | pendingJump 落地判定用上一步的 floorY，刚落车顶那帧按跳有一帧延迟（自愈但不跟手） | movement.ts:129-131 |
| G-5 | buffEngine 满位淘汰永远选不中 `left=Infinity` 永久槽，24 槽全永久被动时 slots 可超上限（角落 case） | buffEngine.ts:193-199 |
| G-6 | 道具箱槽位数学 `span < (n-1)*minGap` 时 slot=0，箱间距违背 minGap 声明且溢出段尾；configValidator 不检查 dropTable 数值 | trackGen.ts:183-187 |
| G-7 | 除零防护缺口：`laneWidth/laneChangeS`、`heightM/glideS` 直接信任 game.json（`??` 不兜显式 0/负值），runner/flight/coins 段无运行时校验 | movement.ts:84、runnerScene.ts:70 |
| G-8 | 生命周期退订被丢弃：host.ts 的 `canvas.onResize`/`adapter.onInput`、mainFlow.ts:260 全部不存退订函数；sceneMachine 通知期间退订会跳过下一个监听者（应拷贝快照遍历） | host.ts:105,210、mainFlow.ts:260、sceneMachine.ts:33 |
| G-9 | AudioDirector 全流程无人 `audio.dispose()`，AudioService.dispose 契约实际无人触发 | mainFlow.ts:286、audio.ts:39 |

#### 服务器（apps/server 任务服务比 server/ 排行榜整体低一档）

| # | 问题 | 位置 |
|---|---|---|
| S-1 | **任务重放不要求死亡收尾**：排行榜强制"死亡帧恰好收尾"（replay-worker.mjs:20），任务服务只校验帧数一致——≥600 帧的存活截断局即可刷 `mruns`/`mnohit`。修复 = 一行 `summary.alive === false` 校验 | apps/server/src/replay.mjs:20、mission-service.mjs:170 |
| S-2 | **重放在 HTTP 主进程内联、无墙钟超时**：单账号提交超长局占满 2 个并发槽即打瘫全员结算（429），且重放分片拉高正常请求延迟。排行榜已有 worker 线程 + 128MB 堆 + 15s 超时的 ReplayPool 可复用 | mission-service.mjs:165-169、replay.mjs:21 |
| S-3 | **数据无限增长**：open run 无每用户上限、runs/users 永不清理（TTL 24h 只用于 finish 校验，行保留）；限速 240 req/min 下可灌 ~345k 行/天。对照排行榜 challenges 表有 5000 上限 + TTL | mission-service.mjs:122-135、apps/server/src/store.mjs:104-110 |
| S-4 | 任务 API 的 seed 由客户端指定（uint32 即可），可离线筛"金币密/易无伤"种子再精准重放，给 mscore/mnohit 提效。奖励有日上限，属设计权衡 | mission-service.mjs:123 |
| S-5 | 限速器 Map 单窗口 >10000 key 时超限不裁剪；排行榜的 BoundedRateLimiter 强制 ≤4096 按插入序驱逐，建议对齐 | apps/server/src/http.mjs:120-123 |
| S-6 | HTTP 层缺超时与中断处理：readJson 未监听 `aborted`，慢速发送 body 可占连接 ~5 分钟；未设 requestTimeout/headersTimeout（排行榜全设了） | apps/server/src/http.mjs:70-90、main.mjs |
| S-7 | 缺部署加固物料：排行榜有 systemd DynamicUser/ProtectSystem unit + nginx conf（2m body 上限、X-Real-IP 覆写），任务服务无对应文件；`PUBLIC_ORIGIN` 未设时回退信任 Host 头 | apps/server/src/main.mjs:3-4、http.mjs:24-36 |

#### Web / WX 应用

| # | 问题 | 位置 |
|---|---|---|
| W-1 | WX 端 renderer 的 GL 上下文属性被提前创建的 context **静默覆盖**：canvasFactory 在 three 之前 `getContext('webgl2')`（不带 attributes），WebGL 规范下 three 请求的 alpha/antialias 等全部被忽略。当前碰巧默认值相同没炸，未来调 renderer 选项在 WX 上静默无效 | apps/wx/src/platform/canvasFactory.ts:22-28、emptyScene.ts:27 |
| W-2 | WX release 包含无条件调试探针：`(globalThis).__trWx` + 每 2 秒 console.log，esbuild 无 define/strip console，原样进真机包，污染性能面板 | apps/wx/src/main.ts:44-48、tools/build-wx.mjs:116-128 |
| W-3 | `vite.config.ts` / `rankPageGateway.ts` 逃逸所有 tsconfig project 与架构检查（include 只含 src），重构后可能带类型错误静默腐化；rankPageGateway 是正式站安全链路 | apps/web/tsconfig.json:8-10 |
| W-4 | vite dev 资产中间件路径检查瑕疵：`startsWith(assetsDir)` 未补分隔符可读兄弟目录；`decodeURIComponent` 无 try/catch。仅 dev 生效 | apps/web/vite.config.ts:37-47 |
| W-5 | 生产 web 构建无环境区分地带 sourcemap（源码暴露 + 体积翻倍） | apps/web/vite.config.ts:77 |
| W-6 | 存储键含真实 U+2026 省略号：`'thunderrun:…penid'`（两端一致所以能用，疑似某次工具处理把 "openid" 的 o 换成 …），外部工具按直觉写会静默 miss，可读性极差 | webExtras.ts:10、apps/wx extras.ts:14 |
| W-7 | wx readText 把非字符串读取结果吞成空串，下游 JSON.parse('') 报难懂的 SyntaxError，掩盖真实错误；应 reject | apps/wx/src/platform/network.ts:31 |
| W-8 | wx 触摸监听绑定后永不解绑（ensureBound 只挂不卸）；web 平台层 window 监听无 dispose——PlatformAdapter v2 没有 destroy 成员，与 uiShell 的完整 destroy 不对称 | apps/wx input.ts:34-41、webPlatform.ts:49-50,99-102 |
| W-9 | 架构检查规则与 README 漂移：`!inWxApp` 豁免整个 apps/wx（不只 src/platform）可用 wx.；wx platform 禁用清单不含 `fetch(`（真机无 fetch） | tools/check-import-rules.mjs:77 |
| W-10 | 文档/物料卫生：docs/ui-delivery.md:5 提交了测试站公网 IP + HTTP 地址；apps/wx/project.config.json:4 提交真实 appid；游客 openid 用 login code 前 6 位可碰撞（已知占位） | docs/ui-delivery.md、project.config.json |

#### 工具链 / 测试 / 配置

| # | 问题 | 位置 |
|---|---|---|
| T-1 | **架构门禁扫描面与宣称不符**：只扫 `<workspace>/src/**/*.ts`——`server/*.mjs`（最长 514 行，超出"全部 ≤300 行"宣称）、`apps/server/src/*.mjs`、`rankPageGateway.ts`、`vite.config.ts` 全部漏检；正则层 `await import('three')`、`globalThis.window` 别名、`Math['random']` 括号写法均可绕过（当前未利用）。P0-2 与 G-3 就是它漏掉的，四个审查方向独立收敛到这个问题 | tools/check-import-rules.mjs:23-33,55 |
| T-2 | **经济/商店内容是校验盲区**：economy 分支只查"是个对象"；shop offer 的 `give[].item`、货币键、`requiresEvent` 悬空引用（typo 让付费皮肤礼包静默永不出现）、characters 的 `growth.costPerLevel[].shards` 串（lootTables 和 topReward 都有解析校验，唯独这里没有）均未校验——商业化核心数据靠最弱的校验，CI 不会红 | configValidator.ts:30-34,100 |
| T-3 | schema 从未被机器校验：configValidator.ts:4 注释承诺"CI 里 ajv 接入（M2）"未兑现，全仓无 ajv 依赖；schema 各段 `additionalProperties: true`；schema 的 primitive enum（25 项）与 `buffEngine.isPrimitiveSupported` 是两份清单无一致性检查 | schema/config.schema.json |
| T-4 | 测试与校验器消费编译产物（stale dist 假绿风险）：单独跑 `npm test` / `validate-config` 会用旧 dist 给假绿；只有 check.mjs（先 tsc -b）和 CI 是安全入口 | tests/rng.test.mjs:7 等 |
| T-5 | golden 矩阵偏窄：5 seeds × 3 角色（volt/ama/kaze）共 15 例；rina/bolt/frog/mambo/niu 等未进基线；`charId: ''`（默认装备流）无 golden 覆盖 | tools/replay/golden-gen.mjs:21-23 |
| T-6 | minEngineVersion 是死字段：类型声明、全部 config 填写，但全仓无消费点；updatedAt 同样无人检查 | configTypes.ts:20 |
| T-7 | tsconfig 未开 `isolatedModules`/`verbatimModuleSyntax`/`noUncheckedIndexedAccess`（现无实害，bundler 场景建议补） | tsconfig.base.json |
| T-8 | 工程卫生缺项：无 ESLint/Prettier、无覆盖率统计、CI 无 concurrency 组（同分支 push+PR 双跑）、无 Dependabot | .github/workflows/ci.yml |
| T-9 | 零真实渲染/E2E 测试：渲染类测试全部是 node 下 three 逻辑测试，无 Playwright/浏览器冒烟；像素级回归依赖人工（PR 模板的 manual verification 就为此） | tests/render*.test.mjs |

### 2.3 P2 补充（游戏侧杂项）

- resultView 内置结算页收到 `summary.ranking`/`beforeFirstCoin` 不使用——fallback（未来 WX）路径看不到"已入全服榜"反馈（resultView.ts:22-46）
- HUD 文本 `maxWidthPx: 560` 硬编码，<560px 视口（手机竖屏）可横向溢出（hudView.ts:16-17）
- `runSession.feedback()` 的 set 依赖调用时 this，解构使用即崩；message 公开可变绕过订阅者（runSession.ts:20-27）
- shopView 用展示字符串 `'待开放'` 做逻辑相等判断，文案改动静默变行为（shopView.ts:49）
- framework list.ts:186 / scrollView.ts:100 每帧小分配，与"每帧零分配"自述不符（量小）
- mainFlow.ts:167 select.onBack → start 场景是死接线（start 场景 boot 后不可达）
- entityLayers.ts:220-249 `createPickupLayer` 旧版死代码，常量与在用版双份漂移条件
- apps/web mainMenu.ts（148 行）+ mainBackdrop.ts 整组死代码，被 mobile DOM 大厅取代
- web/wx 应共享未共享：clamp01 逐字重复 ×2、CloudBridge 本地镜像整块逐字重复、loadJson 三遍、DPR 封顶常量 ×2
- apps/wx subpackage.ts:42-45 缺 loadSubpackage 时 resolve(0) 放行 → 必然失败的慢失败链路（有 warn，已知取舍）

### 2.4 排查过、确认没有问题的

- SQL 全预编译参数绑定、STRICT 表 + CHECK（server/store.mjs、apps/server/src/store.mjs）
- 凭证体系：身份 token/页面凭证/比赛票全部 `randomBytes(32)` + 服务端只存 sha256，无 secret 可泄露
- 分数完全来自服务端确定性重放（服务端随机 seed + 强制死亡收尾 + runId 单次焚毁 + 三方绑定）
- pageGateway 的 SSRF 防护（仅 loopback、禁凭据、1.5s 超时降级）、CSP/XFO、pageId 字符集安全
- 浏览器 API 越界：grep 全量确认 packages 零宿主 API；wx 全局单点 getWx 收口
- web DOM 生命周期整体正确（pageLifecycle 统一管、排行榜 requestId 防陈旧、testPanel 有 dispose）
- build-wx.mjs 质量好（dry 模式、4MB/30MB 双门禁、分包映射严格对应）

---

## 3. 未完成功能盘点

一句话总结：**Web 侧 menu→run→HUD→result 主链路完整，任务与全服榜双后端已闭环；未完成高度集中在"元游戏层"与"WX 全流程集成"**，另有一批 config 写好但零消费的系统（内容先行、代码未跟）。

### 3.1 界面侧

| # | 功能 | 状态 | 证据 |
|---|---|---|---|
| 1 | 大厅八入口板块（设置/活动/成就/任务/排行榜/手册/仓库/货币+） | 仅商店、设置、任务(Web)、排行榜(Web)接通；活动/成就/手册/仓库/「+」是按压反馈空操作，Web DOM 大厅弹"还在准备中" | lobbyView.ts:26-35,59,74、mobileLobby.ts:33-35,64-89、docs/main-menu-handoff.md:118 |
| 2 | 钻石经济闭环 | **占位**：只有支出（改名扣钻），零获取渠道；任务奖励只发 key/coin/shard | mainFlow.ts:34-35、profileView.ts:136-147、economy.json:57-71 |
| 3 | 玩家档案弹层（头像/昵称/改名） | **代码完整但未接线**（文件/测试/素材/config 全在，主界面无入口） | profileView.ts、docs/main-menu-handoff.md:46-50 |
| 4 | 商店兑换/购买/库存/限购 | **只读预览**（设计决策：docs/mobile-ui.md:26）；`limit.perDay/once` config 有、代码未消费 | shopView.ts:291,153-175 |
| 5 | shopView「待开放」卡 | = `offer_skin_bolt_storm`（12 钥匙），挂 `event_thunder_beast_siege`（draft）+ 皮肤 draft；活动上线+皮肤转 live 自动开放 | shopView.ts:136-147、economy.json:50、events.json:8 |
| 6 | shopView「待补充」卡 | = 方向标 compass 预览卡，等美术合成素材 + economy 正式条目 | shopView.ts:184-188 |
| 7 | 设置页 | 原只有主题切换；**上游 PR #51 已加音乐/音效音量滑条**（待 pull）。画质/语言仍无 | settingsView.ts、§1.1 |
| 8 | 账号/登录界面 | startView 完整但 **boot 后不可达**（直入 select 游客流），登录代码零调用 | startView.ts、mainFlow.ts:289-295 |
| 9 | WX 完整游戏流 | **空场景验证壳**（约整条产品链路 15-20%）：缺 UI 壳两 pass 串接（S7/S20）、mainFlow 接线、ui 贴图读取、两个后端 API 客户端 | apps/wx/src/main.ts:2-4、uiShell.ts:9-11 |

### 3.2 后端 / 平台侧

| # | 功能 | 状态 |
|---|---|---|
| 1 | 任务 API（apps/server:8768） | Web 全接（含离线队列）；**WX 零接线** |
| 2 | 排行榜 API（server:8788） | Web 全接（调试模式主动不连）；**WX 零接线** |
| 3 | CloudBridge 云存档 | 两端都是本地镜像/unsupported 桩，业务代码零消费——整体未开始（S9） |
| 4 | 登录 code2session | wx 拿到真 code 后丢弃，openid 用本地游客串顶替（S9） |
| 5 | 分享 | wx 透传 shareAppMessage 可用；结算页"带分口令"编排未做；web 结算页无分享按钮 |
| 6 | IAA 激励视频 / 订阅消息 | 仅接口定义（S9.4"只定义不实装"） |
| 7 | 开放数据域好友排行 | 未设计未实现（S9 单独设计） |
| 8 | 遥测 | **不存在**（README 声明属实；wx fps 靠 2s 一条 console.log，S16b） |
| 9 | CDN/远程配置源 | 通路备好（readBinary/downloadFile），差 CDN manifest 与优先源叠装（S6/S8） |

### 3.3 配置先行、代码未跟（零消费字段 = 欠账清单）

- `game.json params.revive`（maxPerRun/invincibleS/webFreeRevivePerRun）——复活未实现，resolveHit.ts:59 直接死
- `params.quality`（high/medium/low 三档）——零消费，无画质分级
- `params.antiCheat`（maxScorePerRun/maxRunS/maxCoinsPerMeter/maxSkillCastsPerMin/replaySampleRate）——两端服务都未读，防作弊只有帧数/动作数上限与重放一致性
- `economy.json params.accountLevels`（xp 曲线、解锁 mode_challenge/mode_friend_race）——零消费；挑战模式/好友竞速玩法不存在
- `characters.json unlock`（金币/钥匙/事件/宝箱共 13 处）——零消费，碎片合成/买角色/宝箱出货均未实现
- `events.json` 全部玩法字段（banner/menuSlot/window/entryGate/overrides/loginRewards/活动榜）——仅校验器与商店"待开放"判定消费；banner 图文件不存在；`pat_beast_chase` 追逐玩法未实现

### 3.4 文档声明的里程碑锚点

S6 config 接 CDN（mainFlow.ts:41）· S7/S20 wx 单 canvas 共享渲染器两 pass 串接 · S8 wx CDN manifest（main.ts:30、network.ts:5）· S9 登录/云开发/分享口令/好友排行/云存档（多处 extras.ts、session.ts:3）· S9.4 IAA/订阅消息 · S16b 遥测接管 wx 日志 · wx 遗留决策：iOSHighPerformance 卡 Windows 模拟器（wx-runtime-findings.md #3）、分包内 config/game.json 撞平台保留名（#4）、两条防回归断言待补（#5）

---

## 4. 开发计划（建议）

> 排序原则：先修玩家可感知的 bug 与会被打进真机的雷，再加固会被打瘫的服务，然后补防线，最后按"性价比 × 产品价值"排功能开发。依赖升级单独放最后（有渲染回归风险，golden 兜不住渲染）。

### M0 同步与卫生（0.5 天）
1. `git pull`（PR #51 设置音量 + 字体图集重打包），pull 后重跑 `npm run check`
2. 确认未合并分支（`yan/jetpack-pickup-3d` 等）是否有应保留的工作
3. README:48 音频条目改真（"Web 已接音频全链路；遥测未迁移"）
4. 死代码清理：mainMenu/mainBackdrop 整组、entityLayers 旧 pickupLayer、mainFlow select.onBack 死接线
5. 修 U+2026 存储键（带迁移读旧键，或至少加注释钉死）

### M1 P0/P1 bug 修复（1-2 天）
1. trackGen 天空金币误删（圈定本轮生成区间 or ground/sky/bonus 标记；同时解决 chainSeq 编号空间冲突）
2. `performance.now()` → 注入 `adapter.now()`；`URLSearchParams` 改注入小接口
3. check-import-rules 黑名单补 `performance.`/`URLSearchParams`
4. 车顶滑铲判定（`s.y > supportY + ε`）
5. GLB 纹理 dispose（material.map 遍历释放，对齐 trackVisuals 的做法）
6. 任务服务死亡收尾校验（S-1，一行）
7. 全部改完跑 `npm test` + golden 确认无漂移

### M2 服务器加固（2-3 天）
1. 任务重放移入 worker 池（复用排行榜 ReplayPool 模式：堆限制 + 墙钟超时 + 终止重启）
2. runs/users 清理任务（TTL 过期删除 + 每用户 open-run 上限）
3. HTTP 超时三件套（requestTimeout/headersTimeout/keepAliveTimeout）+ readJson 监听 aborted
4. 限速器对齐 BoundedRateLimiter；补任务服务的 systemd unit + nginx conf；强制 PUBLIC_ORIGIN
5. （可选）任务 seed 改服务端签发

### M3 工程防线（1-2 天）
1. check-import-rules 扫描口径统一：.mjs 与 src 外源码纳入；300 行上限覆盖 server
2. economy/characters 引用校验补齐（give[].item、货币键、requiresEvent、shards 串）
3. vite.config.ts / rankPageGateway.ts 纳入 tsconfig project
4. WX release debug 门控（envVersion 或 esbuild define）+ web sourcemap 按环境开关
5. WX 渲染器 GL 上下文属性契约钉死（W-1，接 mainFlow 前必须）
6. （可选）ajv 全量 schema 校验接入 CI、CI 加 concurrency 组

### M4 元游戏功能开发（大头，按性价比排序）
1. **玩家档案接线**——代码已完整，只差入口（建议挂"角色"面板，docs 已有建议），半天级
2. **商店兑换闭环**——钱包模型 + 购买 API + `limit` 限购消费；先做本机持久化（与任务系统同模式），防作弊等级可后续提
3. **角色解锁/碎片合成**——config 的 unlock 数据全在，接 isCharacterLocked + 合成流水线
4. **钻石获取渠道**——任务奖励加钻石档位 or 商店购买链路
5. **活动系统**——events config 完整：先做 login 型签到（简单），再做 mode 型（雷暴围城，需 pat_beast_chase 玩法 + overrides 管线 + banner 素材）
6. **成就/仓库/福利手册**——comingSoon 入口逐个填
7. 每步都按 LobbySlotHandlers 注入，不动大厅布局（docs/main-menu-handoff.md:118 纪律）

### M5 WX 完整集成（README 计划任务，里程碑级）
1. 前置：M1 的 P0-2 修完、M3 的 GL 契约钉死、wx release 探针门控
2. UI 壳两 pass 串接（S7/S20：packages/render 增 renderer 注入口）
3. mainFlow + createOverlayViews 接线（对照 uiShell.ts 逐项平移；无 video，背景用静态图）
4. 两个后端 API 的 wx 客户端（missionApi/leaderboardClient 的 wx 版）
5. wx 遗留：iOSHighPerformance 按目标平台出 game.json、config/game.json 改名验证、两条防回归断言
6. 真机验收

### M6 依赖升级（放最后，单独 PR 单独验证）
1. vite 7→8（trAssets 中间件回归）
2. three 0.160→0.187（视觉回归靠人工；可先升 @types 试编译）
3. typescript 5.5→7（大版本，单独分支验证 tsc -b 行为）
4. 每步之间跑全量 check + golden + 手工冒烟

---

## 5. 值得保持的优点（修复时不要破坏）

- 架构纪律真实在执行：framework 零游戏词汇/宿主全局，wx 全局单点 getWx，web 唯一 DOM 出口
- 确定性模拟教科书级：注入 RunRng、固定步长 + 渲染插值、事件 drain、deps 复用零分配、防御性配置降级
- 黄金回放闭环：严格 v1 解析 → 确定性执行 → 逐字节比对 → CI 双 OS 矩阵兜跨平台浮点漂移
- 排行榜防作弊设计正确且经测试（服务端 seed + worker 隔离重放 + 票据单次 + rulesId 绑定）
- 687 用例零第三方测试依赖、全部真断言；两个服务端有黑盒 HTTP + SQLite 集成测试
- 配置版本纪律：configVersion + versions[] 变更日志强制非空，内容改动强制走 golden 重生流程
