# 隐私说明候选｜未生效｜不可直接提交

本稿供负责人核对当前WX主链及拟启用的云数据流；不是已上线政策、法律意见或合规认证。工作名称“雷霆酷跑”待后台确认；主体、联系渠道与下列策略补齐并实现、验收后，才能另行定稿，没有预设生效日期。

## 当前模式与托管

`apps/wx/cloud.config.json.envId` 当前为空：`connectWxCloud` 返回本地模式，不初始化/调用云；大厅可进入本地跑局，任务/手册/商店不能据此验证真实存档与领奖。填入获准环境并部署后，将启用下表CloudBase链路，不能沿用“完全离线”的表述。客户端经 `wx.cloud.callFunction` 调用 `thunder-api`，由微信云开发CloudBase托管函数和业务数据库；地域、平台日志/备份及可能的跨境处理尚待负责人按实际环境确认。

## 数据、用途与可见范围（云启用后的代码行为）

| 数据/字段 | 用途与存储 | 公开/处理范围 |
| --- | --- | --- |
| SDK可信 `OPENID`、`APPID`；派生 `playerId` | 每次函数调用取 `getWXContext()`，校验服务端 `TR_APP_ID`；SHA-256(APPID+OPENID)派生稳定玩家键。已查业务集合写入未保存明文OPENID，事件自带 `userInfo` 被剥离、不作身份依据。 | 当前玩家档案返回派生ID；派生键可关联玩家，不称绝对匿名。不是头像昵称授权。 |
| `wallet.coin/diamond`、`inventory.characters/items`、`preferences.characterId/themeId`、`stats`、`firstCoinBest`、`revision`及创建/更新时间 | `thunder_profiles` 保存余额、拥有角色/钥匙/碎片、出战/主题、局数/距离/采币/最高分与最佳首币前纪录，用于存档、结算和跨次进入读回。 | 经函数返回本人档案，不是全体公开档案。云数据库客户端直读写拒绝规则仍需部署验收。 |
| `welfare.daily/weekly/handbook` 的周期、定义、进度、已领标记、使用角色；`commerce.once/daily` 的限购状态 | 内嵌同一profile，用于任务/免费手册进度、原子发奖及限购；日周状态按北京时间周期切换，手册进度持久。 | 本人页面经函数读取；周期更新不等于其他数据自动删除。 |
| 对局票据 `runId`、角色、`seed`、规则/榜单ID、周期ID、状态、签发/过期时间；上传 `frames`、`inputs[{frame,action}]`、可选 `finishReason` | 原始离散操作数组经函数上传，在服务器内存重放以校验收入/成绩；seed由服务端票据保存，客户端不另传可信seed。`thunder_runs` 持久保存票据、`payloadHash`、结束时间、是否可入榜、`summary`及`firstCoinRecord`，**不保存原始inputs数组**。 | 不公开回放；动作是换道/跳跃/滑铲/技能，不是上传原始触摸坐标。票据过期只限制受理，不是删除计时器。 |
| 派生 `playerName`、`charId`、首币前 `distance/score`与排名；内部玩家/榜单ID、时间、同分 `order` | `thunder_first_coin` 保存个人最佳；`thunder_rank_order.sequence` 确定同分先后。榜单函数返回前50及本人名次。 | 向进入榜单的玩家展示“跑者-…”派生名、角色、距离、分数和名次；不展示明文OPENID、真实姓名或微信头像。 |
| `playerId/requestId/offerId/catalogVersion/createdAt` | `thunder_purchases` 持久幂等回执，重试原交易时防重复扣款；不是现金支付记录。 | 不公开；当前实现长期保留，无自动清理，最终期限未定，不能随日限购重置删除。 |
| 本机storage：配置缓存、入口记忆、角色/主题、本地最佳分/币数；未确认交易三元组 | `wx.get/setStorageSync`；交易键按环境、函数、玩家隔离，值为 `offerId/requestId/catalogVersion`，收到确认或明确拒绝后清除，结果不明时保留供原交易恢复。云钱包以服务端快照为准，本地币数不合并。 | 设备本地；清本机缓存不等于删除云档案，还可能丢失交易恢复线索。原回放重试目前留在该结算会话内，未见写入本机storage。 |
| 窗口/屏幕安全区、胶囊坐标、触点与时间；音频播放 | 本地用于布局、按钮/滚动、手势识别和 `InnerAudioContext` 播放。已查主链未将原始布局/触点作为独立云字段上传。 | 播放音乐/音效，不录音。不能据此推断微信平台自身完全不处理设备信息。 |

## 权限与日志核对范围

- 在 `apps/wx/src`、WX bootstrap→共享flow、上述云入口及store中，当前未见手机号、位置、相册、麦克风、微信头像昵称权限请求或昵称/图片等UGC上传路径；这仅说明当前WX主链，不覆盖未来功能或微信平台自身行为。资源使用当前分包，不能因适配器支持URL就声称已接外部资源服务。
- 云业务源码未见 `console.*`；已查WX/共享主链没有主动打印OPENID、playerId、钱包或回放。现有输出包括流程就绪场景、分包提示、启动原始异常及GLB资源路径/异常；保留的extras登录/分享占位还有错误消息日志，但boot不调用其登录。真实SDK/CloudBase平台日志的内容、权限与期限未验，不能承诺日志绝无个人信息。

## 访问、更正、删除与保留：待落地

拟处理渠道：**【负责人填写有效邮箱或客服渠道】**；运营主体：**【待填】**。当前仅能在游戏内读取档案、修改出战/主题；**没有用户自助删除/注销接口，也没有已验收的人工删档流程**。不要发布“可立即删档”“30天自动删除”等承诺。

负责人需决定各类档案/榜单/票据/交易回执、本机缓存及平台日志/备份的保留期限、请求核验方式、处理时限和删除/更正规则。删除方案必须处理幂等回执与经济一致性，评估后实现并验证；不能仅凭本文删除回执导致旧请求再次扣款。另须确认托管地域/跨境安排、未成年人适用范围及具体处理与联系机制，不能将待办写成现有能力。

源码依据：`apps/wx/src/{bootstrap.ts,platform/{cloudClient.ts,commerceClient.ts,storage.ts,uiInsets.ts,input.ts,audio.ts,extras.ts}}`；`packages/game/src/flow/{mainFlow.ts,progress.ts,runSession.ts}`；`cloudfunctions/thunder-api/{profile.cjs,index.js,*-store.cjs,run-policy.cjs,welfare-policy.cjs,market-policy.cjs}`。本稿为源码核对，非真实云/设备验收。
