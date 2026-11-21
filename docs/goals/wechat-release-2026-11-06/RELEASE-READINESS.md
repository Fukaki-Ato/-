# M5 当前交付核查（2026-11-07）

## 结论与证据边界

**小游戏包和独立事件云函数的本地交付目录存在，部署所需业务集合没有发现漏项；微信目标端、真实云技术验收和平台手续均未完成，当前未发布。** 本页最初为当前主树只读核查，主代理随后完成HUD/资源分发修正并更新实物结果；不是上线批准。

| 状态 | 当前结果 |
| --- | --- |
| 可构建 / 本地产物 | 主代理最新完整841/841、211个TS源架构、WX minify/独立云函数构建及diff检查通过，日志 `/tmp/opencode/thunder-licensed-assets-verified-WPAaid.log`。主包865.1KB、分包11,423.8KB、总12,288.9KB；这是本轮新构建统计，仍不代表微信运行结果。 |
| 可导入 / 可交付部署材料 | `apps/wx/dist` 的入口、配置、分包存在；`apps/wx/cloud-dist/thunder-api` 的17项白名单/生成文件齐全。下文说明云依赖安装和工具入口缺口。 |
| 微信 / 真机技术验收 | 待完成。已有Node替身和离线shader/美术观察不能证明微信原生API、实际画面、音频或设备性能。 |
| 真实云技术验收 | 待完成。客户端envId为空；没有真实身份、事务、集合权限、索引执行计划、回放成本或重进读回证据。 |
| 账号 / 平台手续 | AppID使用权限、云环境与预算未确认；主体、类目和发布手续以实际官方后台为准。 |
| 已发布 | **否**；没有本轮上传、提审或公开发布结果。 |

核查起点已读 `AGENTS.md`、`CONTRIBUTING.md`、根README和 `PROGRESS.md` 末段；`git status --short` 显示大量既有dirty及其他工作树目录，均保留。本次只新增本页，创建前已确认路径不存在；没有读取副本工作树。主代理正在处理的任务/手册、HUD与离线UI工具不属于本页视觉验收范围。

## 1. 可导入工程与重建入口

### 当前实物

| 源文件 / 工具 | 当前产物 / 实查结果 |
| --- | --- |
| `apps/wx/project.config.json` | 与 `apps/wx/dist/project.config.json` JSON内容一致；`compileType: "game"`、竖屏工程配套，已有非空AppID。该AppID的归属、开发权限及生产用途没有得到确认。 |
| `apps/wx/game.json` | 与dist副本一致；`deviceOrientation: "portrait"`、`iOSHighPerformance: true`，`subpackages[0]` 为 `pkg-assets`。 |
| `apps/wx/cloud.config.json` | 与dist副本一致；`envId: ""`，`functionName: "thunder-api"`。这是明确的本地模式，不是可用生产环境配置。 |
| `apps/wx/dist/game.js`、`pkg-assets/game.js` | 两个入口均存在；后者是资源分包入口，不承担云函数职责。 |
| `apps/wx/dist/pkg-assets/manifest.json` | 新构建58条记录，含16个GLB、17个音频文件及9张UI肖像。仅有新Noto字体对/OFL/来源6文件，旧混合图集和旧磁铁均不在分发；新磁铁与字体已逐字节比对源码资产。Three完整MIT文本仍随包。 |
| `tools/build-wx.mjs`、`tools/wx-assets.mjs` | 打包WX入口，复制三份工程/云配置、内容JSON、字体/OFL、实际肖像PNG、音频、Three MIT文本及配置引用的真实GLB；缺失模型只记清单，不生成假GLB。 |

**开发者工具导入目录是 `apps/wx/dist`，不是仓库根、`apps/wx` 或 `cloudfunctions/thunder-api`。** `apps/wx` 保管源码和配置，本身没有可替代dist的 `game.js`。开发者工具回写dist配置后，再构建会被源码配置覆盖；长期变更应回到 `apps/wx/*.json`。

从仓库根重建（以下是交接命令，本次未执行）：

```sh
# Node >=22.23.0，推荐24；根锁安装，不改锁绕过问题
npm ci
npm run build:wx -- --minify
```

根 `package.json` 的 `build:wx` 会先执行 `npm run build`，再运行 `tools/build-wx.mjs`。直接运行工具则依赖已有共享TS产物。`dist/` 是可重建输出，不应手改生成JS或拷贝源工程冒充小游戏包。

### DevTools云目录：当前缺配置，不能称“一键上传已就绪”

源与dist的 `project.config.json` **均没有 `cloudfunctionRoot`**。因此当前交付没有声明开发者工具的云函数目录；小游戏可导入文件存在，不等于工具已经识别上传入口。

- 实际函数父目录是 `apps/wx/cloud-dist`，函数目录是 `apps/wx/cloud-dist/thunder-api`，它在客户端dist外。
- 按导入根 `apps/wx/dist` 计算，`../cloud-dist/` 确实解析到现存父目录；`cloud-dist/` 会指向不存在的 `apps/wx/dist/cloud-dist`。不要写成 `cloud-dist/thunder-api` 并把函数目录误当父目录，也不要把其他产品的 `cloudRoot` 字段当成此工程已配置项。
- 若选择开发者工具目录上传路线，需要维护源 `apps/wx/project.config.json` 的 `cloudfunctionRoot`，再重建并在真实工具确认其接受兄弟目录、展示 `thunder-api` 且未混入客户端上传包。**本页只验证路径解析，不声称DevTools已接受该配置。**
- 另一条现有可交付路线是按官方云函数控制台的代码上传流程选择下节的独立生成目录；这不依赖当前客户端project config声明云目录。

主代理当前沿用独立事件函数上传路线；未添加尚无真实DevTools观察的兄弟目录字段。因此此处保留为可选工具入口事项，不把它新增为客户端导入的前置条件。

上述是工具集成配置缺口，已交主代理决定是否补齐；它不是“云函数业务逻辑错误”或账号未授权的替代解释。本次未改配置。

## 2. 云函数构建、上传目录与运行条件

### 实际上传内容

上传对象是 **`apps/wx/cloud-dist/thunder-api` 目录内容**。按平台支持的上传方式选择目录或以其内容为压缩包根，确保 `index.js` / `package.json` 在函数根。不要上传裸 `cloudfunctions/thunder-api`：源码目录刻意缺少运行必需的 `initial-content.json`、`simulation.cjs`，二者由构建生成。

已读取 `tools/build-wx-cloud.mjs`、源码入口和全部业务/store模块，并比较当前产物：

- 14个复制文件逐一与源码字节一致：`index.js`、`profile.cjs`、`cloudbase-store.cjs`、`run-api.cjs`、`run-policy.cjs`、`run-store.cjs`、`welfare-policy.cjs`、`welfare-store.cjs`、`market-api.cjs`、`market-catalog.cjs`、`market-policy.cjs`、`market-store.cjs`、`package.json`、`package-lock.json`。
- 加上所有权标记 `.thunder-cloud-build`、生成的 `initial-content.json` 和 `simulation.cjs`，现存输出正好17项，没有漏项或意外文件。工具只重建具有自身标记的固定函数目录，不清理其他工作树/客户端dist。
- 静态核对生成JS/CJS的字面量 `require`：相对文件均存在；外部依赖只有 `wx-server-sdk` 和Node内置 `node:crypto`。`simulation-entry.mjs` 在构建时取共享纯core、北京时间周期模块和同源配置，部署目录不依赖仓库外源码。此项检查不等同云端执行。
- 独立 `package.json` 固定 `wx-server-sdk: 4.0.2`，`main: index.js`、CommonJS、Node `>=20.19.0`。独立锁是v3，99个依赖记录均有integrity、来自npm官方registry，没有workspace链接或本地file引用；当前源码侧安装的SDK也确为4.0.2。
- **生成目录当前没有 `node_modules`**。它是可安装依赖的独立代码包，不是已经带SDK的即传即运行包。根 `npm ci` 不会替该非workspace目录安装SDK。

可重复准备命令（根依赖已按上一节安装）：

```sh
npm run build
npm ci --prefix cloudfunctions/thunder-api --workspaces=false --ignore-scripts --no-audit --no-fund
node tools/build-wx-cloud.mjs
```

`tools/build-wx-cloud.mjs` 没有根npm脚本别名，按上面直接运行即可；它只准备代码，不部署。源SDK的独立 `npm ci` 用于本地实际SDK检查；工具不会把该 `node_modules` 复制进输出。真实上传时二选一：

1. 使用目标平台支持的云端依赖安装，核实实际运行时和安装器是否遵循独立锁；或
2. 在受控Linux构建环境对**生成目录**执行以下命令，再上传整个函数目录（不上传根node_modules）。重新执行云构建会重建此目录，故此步放在最后。

```sh
npm ci --prefix apps/wx/cloud-dist/thunder-api --workspaces=false --omit=dev --ignore-scripts --no-audit --no-fund
```

### 获准环境的必要设置

沿用 `cloudfunctions/README.md` 的普通CloudBase**事件函数**路线，函数名 `thunder-api`、入口 `index.main`；选择账号实际支持并验证的Node20.19或更新LTS，数据库必须支持当前事务API的传统文档模式，不把PG模式当作同一实现。

- 服务端仅需本业务配置 `TR_APP_ID` 为**实际获准的小游戏AppID**；不填伪造值绕过校验。`index.js` 使用 `DYNAMIC_CURRENT_ENV`，无需往客户端或仓库注入管理员密钥。
- 客户端填真实获准环境的 `apps/wx/cloud.config.json.envId` 并重建。环境ID是路由配置，不等于登录授权或已部署证明；开发/体验与正式数据隔离。
- 当前没有函数运行时、超时、内存、集合与索引的已部署配置凭证；这些需要在获准目标环境实际设置并记录。已有README提供手工部署步骤，尚无已验证的自动部署执行结果。
- 回放上限为108000帧、20000输入，票据窗口1860秒；最长合法回放的CPU/冷启动/整体超时及费用没有实测，不默认体验套餐可承载。按实际控制台确认预算、限额和必要告警，不能自动开通付费或省去权威回放。

## 3. 可信路由、集合与索引核对

已核对客户端 `cloudClient.ts` → `index.js` → `profile.cjs` → `run-api.cjs` / `market-api.cjs` → CloudBase stores：

- 客户端用 `wx.cloud.callFunction`，不是HTTP网关；`envId` 为空时 `connectWxCloud` 直接返回本地模式，不初始化/调用云。
- 每次调用从SDK `getWXContext()` 取可信OPENID/APPID，校验非空服务端 `TR_APP_ID` 并严格比对；玩家键由APPID+OPENID派生。事件附带的 `userInfo` 被剥离，不作为身份凭据。
- 已实现路由与README表一致：`profile.get`、`run.begin/finish/cancel`、`leaderboard.list`、`welfare.get`、`mission.claim`、`handbook.claim`、`market.get/buy`、`character.equip`、`theme.select`。没有任意钱包/存档写接口。

| 代码集合常量 | 用途及README一致性 |
| --- | --- |
| `thunder_profiles` (`cloudbase-store.cjs`) | 钱包、拥有、偏好、统计、最佳纪录、福利及商店有界状态；福利没有漏掉独立集合，因为确实内嵌在profile中。 |
| `thunder_runs` (`run-store.cjs`) | 票据、seed、规则、状态、payload摘要和权威结果。接收操作回放，但持久集合不保存原始inputs数组。 |
| `thunder_first_coin` (`run-store.cjs`) | 每玩家/榜单最佳首次金币前纪录。 |
| `thunder_rank_order` (`run-store.cjs`) | 每榜单持久sequence，同分次序来源。 |
| `thunder_purchases` (`market-store.cjs`) | 玩家+requestId的持久幂等购买回执。不能漏建，也不能按每日限购周期删除。 |

当前README明确要求**预建这五个集合**，均设置客户端规则 `{"read":false,"write":false}`；代码不在业务请求里建集合。客户端所有读取也经函数，服务端仍须保留身份校验。这些是已交付设置说明，**未证明真实数据库已应用规则**。

`run-store.cjs:65–79` 的top查询为boardId等值过滤，按 `distance DESC, score DESC, order ASC` 排序并取50条；个人名次以同boardId的三个OR分支count。README的非唯一复合索引 `boardId ASC, distance DESC, score DESC, order ASC` 对应这些字段与排序，其余集合仅按主键操作，没有发现漏集合/已确定的索引文档矛盾。实际OR执行计划是否需附加索引必须在目标云验证，不能凭本地替身断定。

**本次没有发现需要立即修复的云业务入口/依赖缺文件错误。** 已确定的问题是上一节的DevTools目录声明缺失及尚未落到获准环境的部署配置，不将缺账号或未测执行计划归为代码bug。

## 4. 当前素材来源与待补证范围

核查限于主树 `assets/`、`art-source/`、相关 `tools/art/` 与来源记录。下列“有制作记录”指仓库证据，不把文件存在、脚本存在或使用Blender当作对所有权利的保证；目前没有据此认定侵权。

| 素材 | 已知来源 / 当前使用 | 发布前待证明何物 |
| --- | --- | --- |
| 新4角色 `ama/kaze/rina/bolt` | `art-source/coastal/NEW-ROSTER.md`、`new_roster.py` / `new_roster_mesh.py` 记录手写几何、骨架与动作，无外部人物/贴图/动作；4份blend、coastal GLB及派生肖像存在。 | 留存项目内创作/交付记录；角色原有名称与设定沿用配置，制作记录不单独证明名称/身份相关权利。没有已发现的外部人物素材需追索。 |
| 新6补给 `shield/jetpack/board/multiplier/boots/helmet` | `art-source/pickups-coastal/README.md` 及 `pickup_assets*.py` 记录原创几何和手写×2铭牌，无外部模型/图片/字体；6份blend与GLB存在。 | 留存这套来源/交付记录；该说明不覆盖旧磁铁。倍率器虽打包，尚未进入掉落表。 |
| 代码化海湾/海滨场景、远距标志 | `packages/game/src/render/coast/**`（含bay）、`COAST-ART.md`、`pickupBeacons.ts` 为代码几何/材质/shader；新增场景不依赖新下载的模型/贴图。 | 保留代码作者/贡献记录；不以新增代码场景的来源说明覆盖其他旧图片/模型。设备效果仍待验。 |
| 原5模型及其派生 | 原输入 `assets/characters/{bball,frog,pony,niu,whale}.glb` 留存；发布使用coastal改造GLB，5份改造blend和对应portrait存在。`art-source/coastal/README.md` 明确来源边界。 | 原模型的作者/供应者、授权或自有创作证明，范围覆盖修改、在小游戏及宣传中分发；相关名称/肖像/角色身份按实际内容核实。改造、重做动作和肖像没有消除原输入的待补证事项。 |
| 原创磁铁替代 | 当前`assets/pickups/coastal/magnet.glb`来自`coastal_magnet.py`原创手写路径，未读取旧磁铁；1148tri/4材质、尺寸与锚点保持，blend与前后视观察完整。原`assets/pickups/magnet.glb`保留历史，不再分发。 | 留存新制作/交付记录；旧磁铁作者许可仍未知，但已不是当前WX分发的依赖，不能把原输入留在源码误当仍在包内。 |
| 当前WX字体 | `assets/fonts/noto/`由固定SHA的Noto Sans CJK SC Regular（©2014–2021Adobe，OFL1.1）加6枚原创几何标志构建，95 Latin＋1509 CJK/符号，全覆盖当前1604扫描字符；2图单轴均≤2048。源网址、SHA、版权、重建步骤与OFL全文随来源记录保留。 | 此项当前来源链路已落实。生成器不使用系统字体或旧图集，独立候选与正式输出逐字节一致；目标端解码/排版仍要实测。源16MB OTF不进运行包。 |
| 旧字体与37字历史补丁 | 根`assets/fonts`仍保留msyh/SimHei/Segoe/Arial混合图集及后来的37字Noto补充，供历史Web路径与回归使用；WX只读取并复制新的noto目录。 | 旧37字保留原OFL记录；其他旧字体若以后另行Web/宣传分发仍需核对输入版本及许可。这些未进入当前WX包的旧图集不再列为WX字体许可阻塞。 |
| 音频17件 | `assets/audio/README.md` 对frog cast、mambo cast/pickup、niu cast四件记录项目所有者提供并确认仓库再分发；更早BGM、全局死亡池、start及volt cues的权利声明指向当时PR。所有17件当前被WX复制。 | 保存那四件的原包/确认记录，并取回早期PR中的具体许可/所有权依据；核实范围覆盖小游戏成品和必要宣传使用。不要把“规则要求有权”当作每件已补齐证明。 |
| 旧UI图片 | 初查包内曾有61张UI PNG。主代理复核实际WX调用后，将未使用的52张旧菜单/徽标等排除出分发，源树保留不删除；新manifest仅有9张当前模型portrait。 | 当前WX分发不再包含旧菜单PNG；如果以后用于Web、宣传或其他交付，仍需补其作者/来源与分发范围。9张portrait中的原5角色派生权利事项仍按上行保留，不能因图片重拍而消除。 |

`assets/pickups/tiles/*.jpg` 和旧 `menu-bg.mp4` / `menu-bg-loop.jpg` 当前不在WX上述复制白名单或manifest；它们是仓库存留素材，不在本次WX包的已验证分发清单内。以后启用再纳入对应来源记录。原5输入GLB也不是当前manifest中的直接发布路径，但coastal派生仍继承待核实事项。

当前manifest的5个missing引用为 `assets/skins/volt_thunder.glb`、`assets/skins/bolt_storm.glb`、`assets/pickups/coin.glb`、`assets/pickups/key.glb`、`assets/consumables/xp_card.glb`。结合当前dropTable及来源记录：9个live角色与实际6类掉落（含原创coastal磁铁）有模型；金币走程序几何、钥匙走库存，XP卡和非默认皮肤未接首发使用。这5项不应写成“局内仍缺5类掉落”，也不把清单提示掩盖为全部配置引用齐全。

第三方依赖：本地 `three@0.160.1` 和 `wx-server-sdk@4.0.2` 包metadata均标MIT。WX构建虽使用 `legalComments: 'none'`，现已将已安装Three的完整MIT文本复制到 `pkg-assets/licenses/three-LICENSE.txt`；主代理新构建后验证文件与原许可逐字节相等。云SDK及其依赖随实际云端/生成目录安装保存自身许可；此项没有展开全依赖法律审计。

## 5. 可直接整理的上线材料

这是本项目的准备项，不把历史网文或泛化资质清单扩成新增硬性条件。现已准备[首发资料候选包](launch/README.md)，包括原创图标、简介/玩法审核路径、隐私底稿和负责人配合单；尚未定稿或提交。名称/图标/说明、隐私和截图须与实际后台及最终验收版本对应。

| 材料 | 当前可用内容 / 缺口 |
| --- | --- |
| 名称与简介 | 工程名“雷霆酷跑 / Thunder Run”是现有工作名称，非后台名称已核准证据。可用简介草稿：**“海滨风格跑酷游戏，通过滑动换道、跳跃与滑铲躲避障碍，双击释放角色技能；完成任务与免费手册，积攒游戏内奖励解锁角色，挑战首次金币前距离排行榜。”** 正式提交前按实际功能与名称审核结果定稿。 |
| 图标与宣传图 | 已新增“海湾雷霆”原创方形候选，1024/512/144px及64/32px观察图、分层SVG源与重建脚本均在；未用人物/旧图/字体。规格与最终图标待后台和负责人确认，未上传。宣传图仍须选已获素材许可、与实际版本一致的真实目标端画面。 |
| 游戏说明 / 审核路径 | 已整理`launch/GAMEPLAY-REVIEW.md`的短/完整简介和实际导航/手势/云闭环路径；不承诺充值、广告、现金奖励、抽奖或未接能力。路径是待真实验收的说明，不是已经走通微信/云的证明。 |
| 隐私与权限资料 | 已整理`launch/PRIVACY-DRAFT.md`，按真实profile/run/welfare/market字段、存储与公开边界核对。主体名称、联系渠道、保留/删除和托管/未成年人处理等明确待确认，稿件未生效且不可直接提交；当前没有自助删除及已验收人工删档流程。 |
| 测试截图 / 记录 | 需真实开发者工具与设备的大厅、跑局/HUD、结算、任务/手册、商店/仓库、排行及错误恢复截图；记录工具/基础库、OS、设备、AppID/环境用途、版本和结果。已有offline/sample图可做设计附件，不填作真机证据。 |
| 发布主体及适用手续 | 由获准账号在官方后台确认实际主体、游戏类目、备案/审核、适龄及实名/防沉迷等适用分支与材料；是否需要某项资质按当前主体/产品/商业化方式确认，不在本页推定。正式提审/发布另需对应授权。 |

当前数据与能力说明底稿（来自已核查代码，不是已经上线的隐私协议）：

| 数据 / 能力 | 实际用途与边界 |
| --- | --- |
| 微信OPENID/APPID | SDK可信上下文在服务端派生稳定玩家ID；不是请求头像昵称授权。公开档案不返回明文OPENID；派生ID仍按可关联玩家数据说明，不写成绝对匿名。 |
| 钱包、拥有、出战/主题、任务/手册、购买回执 | 目标云持久存档、奖励和重复请求核对。当前没有用户自助删除接口及已落定的保留期限，需准备实际处理渠道/策略；不能为删除说明随意清空维持幂等的回执。 |
| 对局输入/seed/成绩/榜单 | 回放用于服务器校验收入与成绩；runs持久保存票据、摘要和结果，不保存原始操作数组。榜单展示派生“跑者-…”名称及成绩，不上传真实姓名/头像。 |
| 本机storage、屏幕/安全区、触摸、音频 | 用于缓存/未确认交易恢复、布局、操控及播放；音频播放不等于录音权限。当前核查启动与云主链未见手机号、位置、相册或麦克风采集请求。 |
| 网络 / 托管方 | 资源当前随分包，本次配置未发现外部HTTP资源URL；云链为微信原生CloudBase。不要因project config关闭了 `urlCheck` 就声称正式域名/网络条件已经验收。 |

## 6. 最小后续配合与真实验收门槛

此前用户已说明暂时无法设备配合，AppID/云环境/预算问题尚未给出有效答案。本页不重复索问，保留以下**条件具备时的一次性交接**：

1. 负责人在官方后台确认可用小游戏AppID及开发/体验权限，并明确现有云环境、用途/地域、可用套餐和预算范围；通过官方登录/授权流程交给执行者，不在对话粘贴AppSecret或上传私钥。素材授权可由负责人并行汇总，不必等设备。
2. 执行者在获准环境建五集合、规则和索引，设置实际 `TR_APP_ID`、函数运行限制并安装锁定SDK；上传独立函数目录，填客户端真实envId后重建。记录真实部署版本和环境用途，不上传假env或裸src。
3. 设备可用时安排一次开发者工具导入与真机体验验证：先确认8份配置读取、`iOSHighPerformance` 历史启动问题、原生GLB内嵌PNG解码、真实UI/音频，再跑完整局/主动结束/重开和领奖/兑换/出战/主题/榜单闭环。记录安全区、长文本与连续动作及代表性长局性能。`docs/wx-runtime-findings.md` 的历史问题仍是待复测事项，不是本轮新增缺陷定论。
4. 同时用真实微信身份验证云收入一次入账、同回放重试、并发领奖/购买、重进读回、客户端数据库直读写拒绝、跨玩家/应用拒绝及榜外个人名次；检查目标云索引执行计划，并测最长合法回放的执行时间/内存/费用。函数创建成功或日志无错只证明部署阶段。
5. 根据实际截图和上述结果定稿资料，负责人确认后台适用手续与最终版本；技术验收、手续、提审及公开发布分别记录状态。

## 本次实际核查记录

- 执行了只读 `git status --short`、目标路径不存在检查、定向read/glob/grep及Node JSON/目录/字节比较；全部观察命令成功，没有失败的构建或部署尝试。
- Node实查：三份dist配置与源码内容一致；入口/分包存在；manifest108条文件均存在；函数17项输出白名单无漏/多文件，14项复制内容与源一致；字面量相对require无缺失；独立SDK/锁及字体/OFL与旧字形来源标记已核对。
- 主要证据路径：`apps/wx/{project.config.json,game.json,cloud.config.json,README.md,dist}`、`apps/wx/cloud-dist/thunder-api`、`tools/{build-wx.mjs,build-wx-cloud.mjs,wx-assets.mjs}`、根 `package.json`、`cloudfunctions/README.md` 与 `cloudfunctions/thunder-api/*.{js,cjs,mjs,json}`、`assets/{characters,pickups,ui,audio,fonts}`、`art-source/{coastal,pickups-coastal}`、`tools/art/README.md`、本Goal来源/场景/进展文档及 `docs/wx-runtime-findings.md`。
- 本轮新增交付仅本页。未运行root build/check或安装依赖；没有操作账号、真实云、部署、上传、提审、付费或凭据，也没有建设Web站或执行设备验收。本页命令均明确为后续交接步骤。

### 主代理后续实施与新实物

- 第4轮已交付`launch/`四份资料候选及原创图标/分层SVG/代码源。实际查看512/144/32px，PNG尺寸/RGB/非空、独立重建一致、默认拒覆盖、SVG无外链/字体/脚本与相对链接检查通过。没有将候选图当作平台已批准图标，也没有上传/提审。
- 本轮最终再次执行完整841/841、8配置、211TS、WX/独立云构建及diff检查，通过日志`/tmp/opencode/thunder-launch-materials-verified-gMZXk0.log`。运行包仍为12,288.9KB，品牌候选不进入客户端包。继续真实部署/验收需要负责人配合单中的实际账号/云授权与设备条件。

- 第3轮已将WX字体完全切到独立OFL Noto/原创符号图集，并将磁铁改为原创coastal资产；原字体和旧磁铁留历史不分发。新字体在9页面候选比较和正式320/430软件OpenGL捕获中无缺字；标题原色误差0，363个肖像稳定采样最大误差2、裁剪越界6234→0。不是微信目标端像素证据。
- 当前最终检查841/841、8配置、211TS、WX minify/独立云构建/diff通过；58条manifest中的新字体/新磁铁实物与源资产一致，旧输入未混入。当前待补证素材收窄到原5角色及派生、部分历史音频等本页仍列出的项目，未声称所有素材权利已解决。

- 初始子任务所见108条旧manifest和61张UI PNG是当时事实，现已被上述57条/9张肖像的新构建替代；保留初查操作记录供追溯。
- 真实同源shader离线观察发现手机HUD多增益裁断，已改按视口拆行，并保持原业务手势、buff合并、技能门槛与更新/销毁语义。任务/手册各状态已观察，刷新/领取中按钮禁用与实际请求状态对齐。均不是设备验收。
- 旧UI分发裁剪和Three许可复制有针对性回归。最终 `npm run check && npm run build:wx -- --minify && node tools/build-wx-cloud.mjs && git diff --check` 全通过（836/836、8配置、211TS）；软件观察与M5变更的只读审查未发现重要新缺陷。
- 源图片仍在，旧字体、原5模型/磁铁和相关音频来源事项仍按本页列出；当前没有真实云/账号/设备操作，未发布。
