# 微信上线 Goal 进展

## 当前轮次

2026-11-07，当前Goal第4轮：原创方形图标/可编辑SVG与玩法/审核、隐私、负责人配合资料候选已落盘，完整检查再次841/841通过。当前进入等待外部输入的边界：获准AppID/云环境预算、设备条件、主体隐私策略及剩余素材来源需要负责人确认，不能由继续离线制作代替。主分支`feature/wechat-release-20261106`，全部既有dirty和其他工作树保留；未上传、提审或发布。

## 已完成与证据

- 实施前 `npm run check`：659/659 测试通过，8 个配置校验、架构检查与临时 WX 包检查通过（Node v22.23.3）。不是微信运行时验收。
- WX 真实资源：复制 5 个角色和磁铁 GLB，统一 `assets/...` 到分包路径，manifest 记录 packaged/missing，不再生成假模型占位文件。子任务资源/构建相关 14/14 测试通过。
- 共享 renderer：跑局可注入并保留外部 renderer，结束帧停止调度；子任务 4/4 聚焦测试通过，包含实际 runner 对象的销毁/跨局复用。
- WX 空场景入口已替换为共享 GameFlow，补齐图片/字体解码、自绘 UI、原始触控和单 rAF 的游戏→UI 顺序；补充 GameFlow/UiHost 退出时的订阅释放。
- 主代理 `npm test -- tests/wx-runtime.test.mjs tests/runner-shared-renderer.test.mjs tests/wx-assets.test.mjs`：16/16 通过。包含真实模拟到死亡结算与重开，渲染器是 Node 替身，无像素/设备验收含义。
- 集成后 `npm run check && npm run build:wx -- --minify`：675/675 测试、配置、架构与构建通过。已生成 `apps/wx/dist`；压缩主包 805.5 KB，资源分包 13,821.5 KB，总计 14,627.1 KB（门禁统计的是文件未压缩字节）。
- 首次定向编译出现 TS2742（runtime 导出推断类型引用不可移植），补充显式接口后编译通过。几次按名称定位的旧文件不存在，已按目录找到实际 `overlay.ts/resources.ts/lobbyPanels.ts`，不影响当前实现。
- 只读审查发现配置校验失败正常返回会绕过原生重试；已在 WX 固定启动链识别未进入大厅的结果，清理后触发重试，并新增非 game 配置失败→恢复的回归测试。修复后 `npm test -- tests/wx-runtime.test.mjs` 7/7、WX minify 构建和 `git diff --check` 通过；最新主包 805.7 KB，总计 14,627.2 KB。全量 675 项记录发生在增加此回归用例之前。

### 本次继续执行

- 恢复时发现旧 task_state 的部分客户端/解码器交接与磁盘不一致，已逐文件核对、取得子任务最终交接并补齐，以本轮实际检查为准。
- 已接入 UTF-8 解码与原生 WX Image 内嵌 PNG loader；工厂由 runtime→bootstrap→runner→角色/道具传递。六个真实 GLB 的模型/材质/动画与释放路径有 Node 检查，原生图片 IO 是替身，未声称实际像素解码成功。
- 独立 CloudBase 函数新增 `profile.get/run.begin/run.finish/run.cancel/leaderboard.list`，实际 SDK transaction store 与自包含构建存在。权威重放结果在同一事务更新票据、钱包、统计、榜单和同分顺序；子任务 profile/runs 24 项测试通过。
- WX `cloudClient` 通过 `wx.cloud.callFunction` 连接；`cloud.config.json` 的 envId 当前为空，因此真实启动仍不初始化/调用云。接入云账户时从服务端快照读钱包与角色拥有，本机金币不合并、不在结算时自行加到云余额；晚到的服务器结算能刷新大厅。
- 新增自绘排行榜（前4/前50、个人纪录、刷新错误与返回），结算显示上传状态，并提供同票据/原回放的显式失败重试。
- 主代理在官方文档中确认调用事件可附带 `userInfo`，已修复严格字段校验误拒绝正常微信请求的问题：入口剥离元数据但不信其身份，并加客户端→云入口→真实重放→持久层替身的集成用例。
- 主代理 `npm test -- tests/wx-cloud-client.test.mjs tests/flow-account.test.mjs tests/wx-runtime.test.mjs tests/wx-glb.test.mjs tests/wx-gltf-textures.test.mjs tests/mainFlow.test.mjs tests/pages.test.mjs`：68/68 通过（发生在追加上传重试与userInfo回归之前）。新自绘文案字体覆盖检查无缺字。
- 初次接自绘榜单时使用了错误的 ScrollView 构造签名，编译 TS2554；改为本项目 `content` 选项后编译与上述检查通过。
- 本次完整执行 `npm run check && npm run build:wx -- --minify && node tools/build-wx-cloud.mjs && git diff --check` 通过：724/724 测试、8份配置、193个TS源文件架构检查；WX主包816.2KB、资源分包13,821.5KB、总计14,637.7KB。云函数独立产物已生成，无真实部署。保留已有 `config/game.json` 重复 `ui` 键的构建警告（当前两端按最后一个键解析，规则一致性测试已通过）。
- 云结算审查发现3项：读回 `_id` 不能参与整档 set、上传未完成离页会丢重试入口、同毫秒快照可回退。均已修复：排除 `_id` 并增加真实底层 SDK 校验/序列化测试；上传期间禁止离页、失败明确提示重试或放弃；事务内递增 revision，客户端按版本接收快照。
- 修复后的首轮42项聚焦检查有1项测试失败，原因是实际SDK传输使用EJSON数值而测试按普通JSON读取；已改用依赖自带EJSON读取器，保留真实 SDK DocumentReference 校验。最终完整复测 **727/727** 通过，无跳过；配置/架构检查、WX minify、独立云函数构建和 diff 检查均通过。最新主包816.6KB、资源分包13,821.5KB，总计14,638.1KB。
- 核对了可用工具与MCP服务参考，未发现可直接操作本机微信开发者工具的入口；没有为此启用额外MCP或建设Web替代站。榜单与新增结算恢复文案的字体覆盖均无缺字。

### 上轮任务与福利实现记录（集成缺口已在第2轮闭合）

- 云子任务完成 `welfare.get/mission.claim/handbook.claim`、北京时间日/周周期、有效局10秒门槛、4章免费手册、统一钱包/库存原子发奖；报告新旧云测试37/37、配置校验与独立构建通过。economy只新增手册与版本日期，既有任务平衡未改。
- 为使无伤任务可实际完成，扩展 `run.finish` 的 `finishReason:'quit'`：主动结束可计合法收入/有效进度但不入榜；默认仍要求完整死亡局。主代理已接 `GameFlow.finishRun()`、HUD“结束本局”、对应客户端响应处理，并落定最后一次未step手势帧后再结束，避免非法回放。
- 新自绘任务/手册页面采用暖沙、奶白、海蓝的层级与真实进度条，支持日/周、章节锁定/领取中/已领取、云未配置、失败重试与迟到隔离；已接大厅任务/手册入口和独立flow场景。主代理补充刷新入口，便于跨周期后重新加载，并将重置时间显示改为北京时间。
- 页面子任务的6项行为检查通过，字形检查1项失败：缺 `俱旅匙`；不是目标端视觉验收。主代理已通过独立锁安装 fontgen 的3个依赖，核对现成 Noto Sans CJK SC 字体的 SIL OFL 1.1 许可及字体内版权（© 2014–2021 Adobe），**尚未生成补充字形或复制许可证**。
- 已在 charset 扫描器加入 apps/wx/src；准备使用 `/root/.config/opencode/extensions/cloud-capture-fonts/NotoSansCJKsc-Regular.otf` 补字，许可证和来源在同目录。当前仍需补字后跑 `tests/welfare-ui.test.mjs`。
- 已按微信官方 getWindowInfo.safeArea/screenTop 与胶囊坐标接 UI viewport：游戏仍全屏，UI避开上/下安全区，原始触控转换到UI坐标。尚待新增主代理行为测试和真实设备验证。
- 本轮最新 `npm run build` 已通过。727项完整检查属于上述新增内容之前，不能沿用为本轮全量结果。

### 第2轮：任务/福利本地验收完成

- 补充36个Noto字形，含缺失的 `俱旅匙`；核对旧图集全部像素、字形位置和字距未变，新增UI及手册配置的字体检查通过。复用已有 `assets/fonts/NotoSansSC-OFL.txt`，并纳入WX打包。宽泛扫描中4个符号 `ϟ⁻⚑✦` 未由该字体提供，已写入补充记录；本轮实际UI文案不缺字。旧字形授权来源仍需发布前核实。
- 主代理新增/补齐客户端领奖协议、跨周期刷新、主动quit回放、任务/手册真实入口、安全区screenTop/胶囊坐标、触控转换和游戏全屏保持的行为检查；69项聚焦测试全部通过。
- `npm run check && npm run build:wx -- --minify && node tools/build-wx-cloud.mjs && git diff --check` 全通过：**751/751无跳过**、8份配置、198个TS源文件。最新WX主包826.0KB、分包13,862.6KB、总计14,688.7KB；独立云函数构建成功。已登记原生命令 `sh_1b16e71ac001p0A3VOWqUgbGIA`，退出码0。
- 审查未发现本轮重要新缺陷；这是源码与本地行为证据，不是目标端观感或真实云事务验收。保留既有重复ui键和15个未交付模型引用提示，不伪造素材齐全。
- 美术管线只读定位见 [ART-HANDOFF.md](ART-HANDOFF.md)：现有5个角色GLB与磁铁成品，无已找到源工程/授权记录；主代理实际确认未安装blender/bpy。GLB可导入编辑，缺源工程不作为停止全部美术工作的额外前提。

### 第3轮：消费与持久选择本地验收完成
- 服务器 `market.get/buy`、`character.equip`、`theme.select` 已接通。报价版本、角色拥有、余额、一次/北京时间日限购在事务内校验，扣款/授予/revision/购买回执原子提交；同id不能换请求，也不因有效改价/下架重收费。
- 海滨风商店/仓库/角色/设置页有确认、重试、服务器余额、拥有/不足/限购反馈；仓库去商店再返回，角色与主题保存后实际用于下一局。
- 配置提供角色金币购买、碎片解锁、三名原loot/event角色金币offer、碎片回收及免费手册钻石换币，奖励有消费去向。没有支付、充值、广告或抽奖；未接用途的XP卡/皮肤等不开放购买。
- 客户端按环境/函数/玩家持久保存已确认但结果未明的购买三元组；重进只核对原交易。已对齐真实PURCHASE_LIMIT错误码，明确拒绝不陷入未确认重试。
- 审查发现普通WX storage吞写入失败；已增加仅交易缓存采用的严格模式。新意图保存失败返回PURCHASE_NOT_SAVED，不发送market.buy；实际适配抛错用例通过，普通缓存行为不变。
- 补“募”字并验证旧像素保持，UI用字检查通过。为守300行将旧登录页状态抽到startScene；曾遇TS自身引用推断错误、新测试少括号、两次文档上下文补丁被保护机制拒绝，均修正并重检。
- 46项及修复后58项聚焦检查通过；最终完整检查 **787/787无跳过**、8配置、204TS架构、WX minify、云函数独立构建与diff全部通过。日志 `/tmp/opencode/thunder-run-round3-verified-B5V1Y3.log`；主包840.1KB、分包13,864.9KB、总计14,705.0KB。
- 云账户取票失败时已明确提示本局不计奖励/任务/排行，避免把本地采集数误当云收入。以上不是实际云/设备或像素验收。

### 第4轮：模型、动作、海湾与大厅/结算已集成

- 已隔离安装官方免费Blender4.5.15 LTS并校验SHA256；首次缺libSM/libICE/libGL，Ubuntu默认镜像返回502后从官方archive下载同版本deb并按apt元数据校验，仅解压到任务目录。目录 `/tmp/opencode/thunder-art-r4-PYOEaG/`，制作方法见 `tools/art/README.md`。没有更改项目npm依赖。
- 原5角色GLB保留不覆盖。新`assets/characters/coastal/`有9个实际蒙皮角色，源工程在`art-source/coastal/`，可通过bpy脚本重建。原5有衣装/肩颈/眼位/裙褶及蒙皮权重等实际几何修改和合批；4名缺失角色有原创脸部/服装/设备/骨架/11动作，不是占位方块或换立绘。
- 重新制作实测骨长的Run接地/收腿与无缝Idle；角色技能、scale、clearance和音频不变。bball历史独有+Z朝向已校正到全员-Z。motion-v2在runtime禁用旧摆幅放大，换道/落地后保留Run相位。新4初版FK每周期两次脚部低谷造成5秒35次尘土，已从资产层重做轨迹并通过9角色120Hz行为检查；站姿脚底8mm偏移也修回原点附近。
- 9角色/defaultskin配置均指向新GLB。原5绘制primitive由36/14/67/28/58降至4/2/2/2/7（bball/frog/pony/niu/whale）；新4为9–10批。所有旧GLB回归仍保留，新模型真实蒙皮、循环缝、脚步、相位和接口检查也加入。
- 9张384×512透明portrait由最终GLB重新导入实际渲染，已接WX大厅/结算；启动不再解码旧25张菜单徽标/背景。海滨暖沙/奶白/海蓝与珊瑚CTA，移除无实现的活动/成就/+入口；主CTA固定、内容可滚动、角色名/币钻/真实统计与失败确认均保留。
- 结算等待上传时不能离开，失败重试原回放，放弃奖励前明确确认，异步通知订阅在离页时释放。审查发现portrait误设sRGB而UI shader直通，会变暗；已按框架NoColorSpace契约修正，并验证真实portrait到UI材质的颜色标记接线。不是GPU像素验收。
- 场景子任务先保留实际旧源码和观察，再加入低岛/灯塔、沙洲/帆船、木亭/冲脚板架/局部沙纹；保留海面GLSL、车道净空、右伞x12.1与逐件循环。近似批次27→33、材质仍9、展开三角形52,806→56,728（+7.4%）。前后/细节/72m行进离线图及测试见`COAST-ART.md`；Cycles光照/海面近似不是真实微信效果。
- 已读图并修正过肩部断口、旧袜膝白三角、阿牛眼位及裙摆穿插。服务器两次重启、一次120秒命令超时中断过观察/portrait生成；保留成功文件，只续缺失部分。一个长配置补丁因旧上下文被阻止、一个新增测试少闭合括号，均读回修正。第一次全量检查811/813，两个旧测试仍找旧按钮/旧5张纹理，更新到真实新控制/2张纹理后通过，原断言目标未删除或放宽。
- 最终 **813/813无跳过**、8配置、208TS架构、WX minify、独立云函数构建与diff检查全部通过。日志 `/tmp/opencode/thunder-run-round4-verified-9ez5yS.log`；WX主包853.8KB、分包17,603.7KB、总计18,457.5KB。9角色+磁铁共10个真实模型打包；仍有11个道具/未接皮肤模型引用缺失，保留清单提示；既有config/game.json重复ui键警告仍在。
- 聚焦证据：UI8、海滨5、4角色8、主代理9角色5（最后两个合计13/13）、既有接线更新63、修复后跨流程/资源/骨架32项均通过。以上为源码/本地与离线证据，不声称微信/devtools/真机、真实云或美术最终验收。

### 续接轮：补给与非跑酷页面观察完成

- 原创六件海滨补给GLB/可编辑blend与可重复bpy工具已交付（shield/jetpack/board/multiplier/boots/helmet），总356,536字节、每件792–1788三角形/4材质，无图片/扩展依赖。主代理读取最终前后视合成页，确认喷包/板桥轮/护盾环/弹跳底架/头盔轮廓和正反×2铭牌；子任务修正过镜像、帽壳通风和鞋底。证据 `/tmp/opencode/coastal-pickups-review-20261106-c/`，来源说明在`art-source/pickups-coastal/README.md`。
- 实读dropTable只有6类（含旧磁铁），不是初次委派时误以为的7类；multiplier已有items配置但未入掉落池。本轮不改掉落或玩法数值。金币继续用实例几何，钥匙只用于库存/兑换，XP/皮肤不造假使用；缺模型清单剩5项均为这些非当前掉落表现。
- 6条prefab已切coastal路径；近35m进/40m出沿原契约。WX远距或加载未完成时以7种真实几何符号区分箱子，已有Web贴图注入仍优先保留。滞回改双Set逐帧交换，清除已拿取/离视野的历史键；退出先卸clone槽，再释放loader自有资源，避免共享几何重复销毁。1000帧几何复用、真实GLB缓存/换模/处置与原回退测试通过。
- 角色/仓库/商店复用精确ID肖像和配置技能/天赋，不借未知角色默认资料；角色开始CTA固定且只启动已拥有并出战者。仓库数量置前，主题按实际sky/fog/ground配色预览，不冒充跑局截图。新海滨榜单保留前4/50、个人纪录、首次金币前距离/得分、失败/空/刷新/迟到隔离。
- 配置启动页已统一海滨风且不显示假进度百分比；大厅补实际手势说明，WX HUD就绪提示仅写双击屏幕；结算新增独立首次金币前记录，明确与总里程/总分、云入榜确认不同。
- 新离线UI管线`tools/art/ui_snapshot.mjs / ui_render.py / ui_probe.py`在隔离EGL/ModernGL/llvmpipe中编译真实SDF/UIBasic/CoastalBay shader，直接捕获同源UiHost几何/UV/纹理/裁剪。没有HTTP、浏览器或Web测试站。最初缺ensurepip、Mesa某版本404，子任务改用官方可核验pip wheel/基础版deb，仅解压/安装在`/tmp/opencode/thunder-ui-KpLhky/`，见`tools/art/ui_README.md`。
- 实际读图发现大厅副文案在深海色上对比低，已加奶白信息底并重拍。主代理最终图在`/tmp/opencode/thunder-ui-checked-35gkNK/`（启动/320大厅/430角色/结算等待和失败底部）；角色/商店/仓库/设置/榜单在`/tmp/opencode/thunder-ui-final-4SmDep/`。均标offline/sample；真实字体像素RGB误差0、368个portrait稳定采样最大误差2、裁剪越界9324→0；不据此声称微信像素/性能或真实云数据验收。
- 本轮UI子任务20项、资产2项、主代理42项聚焦通过；新增真实WX facade/GLB接线、首币前成绩与触控提示回归。初次46项有1测试因页面重绘后缺tick而取不到新rect，修正夹具后通过；一次多文件补丁因旧wx-assets上下文被阻止，回读重建。三处按旧名猜测的text/fontAtlas/云leaderboard文件不存在，已glob/grep定位实际源码。只读审查未发现重要新问题；全仓diff查询超出maxBuffer后按指定文件完成审阅。
- 最终 **832/832无跳过**、8配置、210TS架构、WX minify、云函数独立构建及diff全通过。日志`/tmp/opencode/thunder-goal-current-verified-Oap4uM.log`；WX主包863.5KB、分包17,952.7KB、总18,816.2KB，16个真实GLB。保留既有重复ui键警告，真实云/设备仍未验收。所有子任务、渲染与命令已结束。

### 第2轮：福利状态、手机HUD与交付核查完成

- 复用现有软件OpenGL工具，新增`ui_states.mjs`从纯福利政策/配置投影构造offline/sample快照，经实际UiInput触发模拟领奖；观察了任务/手册加载、可领/锁定/进行中、领取中、已领、领取/加载失败与HUD就绪/冷却/下滑积攒/多增益。没有调用云或写真实钱包。基线`/tmp/opencode/thunder-welfare-before-wCO2yH/`，修后`/tmp/opencode/thunder-welfare-after-gQNTHJ/`；新状态均无缺字。
- 实际读图发现旧手机HUD硬编码560px折行宽，多增益在320px右侧裁断。WX touchOnly分支新增`coastalHud.ts`分层显示成绩/生命、采集/里程、技能、增益，按真实宽度测量；同名取最长、永久项不显示Infinity，空状态隐藏，dispose幂等且不误清新页。旧默认HUD/键盘提示保留。修后320px完整换行，430px可一行容纳，画面与边界测试通过。
- 任务/手册未见领取信息重叠；刷新和领取中按钮的可用外观已与请求状态对齐，刷新中禁领奖；日周切换、原period重试、确认快照更新和离页丢弃迟到响应保持。
- 新`RELEASE-READINESS.md`实查WX/独立云产物、五集合/索引与SDK锁、素材来源和上线资料。没有确定的云业务缺文件/漏集合；DevTools尚无cloudfunctionRoot，当前继续用独立事件函数上传路径，不盲目把未验证兄弟目录变成客户端前置。云端安装/上传步骤、权限与预算/设备待验边界明确。
- 核查发现旧52张菜单/徽标虽未加载仍随包分发；复核WX调用后只打包当前9张portrait，旧源图片保留未删除。增加`pkg-assets/licenses/three-LICENSE.txt`，新构建逐字节确认MIT全文随包，Noto OFL仍保留；原模型/磁铁、旧字体与音频权利没有被这一步代为解决。
- 聚焦46项最初45过1失败，原因是新测试错误要求430px也必须折行；读图证实320两行/430一行均完整，将“必须折行”限定于真实窄屏，同时保留三宽边界/内容断言。一次按旧名读取wx-size测试文件不存在，随后目录定位到wxbuild。只读审查未发现重要代码问题，审查时旧产物缺新增许可的提醒已由新构建复核消除；全库diff缓冲溢出后按文件审阅。
- 最终 **836/836无跳过**、8配置、211TS架构、WX minify、独立云函数构建、diff全部通过。日志`/tmp/opencode/thunder-welfare-hud-verified-JugERF.log`；新包主包865.1KB、分包11,443.8KB、总12,308.9KB（上一轮18,816.2KB，约减34.6%）。manifest57条均存在，16GLB、17音频、9UI肖像与Three许可实物确认。既有重复ui键警告仍在。
- M5核查`ses_e4b3c7ba0ffeo7PhYm3Qh2cPcZ`和审查`ses_e4b2c14f9ffeMVvTp96J8SsZTw`均结束，无自有渲染进程。以上仍不是微信/真机画面、真实云或已发布证明。

### 第3轮：WX字体与磁铁来源替代已交付

- 已核验现成官方Noto Sans CJK SC Regular源SHA、fontFamily、©2014–2021Adobe版权和OFL。新增`tools/fontgen/licensed.mjs`，仅接受记录的源，不读旧图集、不用系统字体回退；缺少的`ϟ⁻⚑✔✦❤`为`licensed-symbols.mjs`原创手写通用标志。两图95/1509字形，共1604扫描字符、无missing；CJK2046×1987、Latin2030×113，均≤2K。
- 使用源OS/2 typo880/-120度量统一40px基线，保留精确cell-edge UV比率，避免原三位小数在2K上偏移1–2px。原generator和根图集保留不覆盖。独立候选`/tmp/opencode/thunder-font-candidate-jrggp9/noto`与正式`assets/fonts/noto`逐字节一致；来源/OFL/重建说明随新目录保留，16MB源OTF不进包。
- 切换前实际比较9个主要页面，正式目录又捕获320/430大厅、榜单、库存、手册失败与多增益HUD，未见新缺字/关键按钮越界。正式证据`/tmp/opencode/thunder-noto-final-wcVpug/`；标题RGB误差0、363个portrait稳定采样最大误差2、真实裁剪越界6234→0。旧具体像素数不混作新结果，仍仅offline/sample。
- 新`assets/pickups/coastal/magnet.glb`、可编辑blend与`coastal_magnet.py`由原创手写U路径制作，未读/重导旧磁铁；1148tri/4opaque PBR、58,340字节，尺寸0.8196×0.70×0.2471米、中心零。主代理已读导出后重新导入的前后视，证据`/tmp/opencode/original-magnet-yx1a9Z/review-final/`。保持spin/锚点与玩法数值，配置改新路径；旧GLB仅保留legacy回归。
- WX shell、同源capture默认、字体白名单都指向`assets/fonts/noto`；分包只有新字体对/2metrics/OFL/provenance6文件，旧混合图集和旧磁铁实际不在manifest。相关WX UI测试改读新metrics，legacy helper默认仍可读旧目录；根CI只检已提交资产，不依赖外部OTF或fontgen独立opentype安装。
- 首次候选因原创Glyph未设置index而被判notdef，已定位/修正index=i+1后重建；独立磁铁复建曾遇无用UV浮点差，移除后重建字节一致。默认覆盖拒绝和原资源保留均有检查，没有以失败观察当作方法失败。
- 90/90聚焦通过；最终 **841/841无跳过**、8配置、211TS、WX minify/独立云构建/diff全通过。日志`/tmp/opencode/thunder-licensed-assets-verified-WPAaid.log`；主包865.1KB、分包11,423.8KB、总12,288.9KB。新manifest58条、16GLB；新字体/磁铁与包内字节一致。保留既有重复ui键和5个非当前掉落missing提示。
- 原创磁铁`ses_e4b195f04ffeTgmmFWxxjgvWKp`、只读审查`ses_e4b05dda6ffendsLFf763TOjf1`均结束，无自有渲染。审查未发现重要新缺陷；其检查时旧产物未重建的局限已由主代理最终构建补齐。全量diff缓冲过大仍按指定文件审阅。

### 第4轮：图标与首发资料候选完成

- 在当前`assets`与`apps/wx`路径查找图标/品牌候选，仅见金/钻道具图标，未发现已定稿应用主图标。新增独立原创“海湾雷霆”：海蓝底、珊瑚太阳、暖金闪电与弯曲跑道，不用人物、旧图、字体或外部图像。
- `tools/art/app_icon.py`从同一手写几何定义生成分层SVG和1024/512/144/64/32px不透明RGB PNG，源`art-source/branding/app-icon.svg`，图片`assets/branding/coastal/`。实际读512/144/32图，缩略主轮廓可辨；尺寸/色彩格式/非空、独立重建字节相等、默认拒覆盖、SVG自包含和无外链/字体/脚本检查通过。临时检查目录`/tmp/opencode/thunder-launch-checked-aCDDVY/`；临时Pillow像素检查产生getdata弃用提醒，生成器未用该API，断言全部通过。
- 新`launch/{README,GAMEPLAY-REVIEW,PRIVACY-DRAFT,OWNER-INPUTS}.md`提供资料入口、可复制简介/实际手势与审核路径、按代码字段核对的数据用途/存储/公开范围及一页集中配合单。主体/联系方式/保留删除/地域和未成年人安排保留待确认，不写假生效日期、企业、自动删除或已上线承诺。明确旧extras游客占位不是真实云身份、日周任务不发钻而免费手册末章发钻。
- 图标与文案全部标候选、未提交/未生效，不接入客户端、不擅改账号配置；图片不增加运行包。资料按实际profile/run/welfare/market/本机storage/音频和SDK主链复核，原OPENID不作公开数据、不把哈希玩家键称绝对匿名，平台日志/真实云行为仍待实际环境确认。
- `ses_e4af3a0ccffewZLvjTd9OoqXVQ`资料子任务结束，主代理已复核三份正文和关键调用方；纠正旧核查文档残留“含旧磁铁”为当前原创磁铁。相对链接、格式和源码生成语法检查通过。
- 最终本轮重新执行 **841/841无跳过**、8配置、211TS架构、WX minify、独立云函数构建与diff，全通过。日志`/tmp/opencode/thunder-launch-materials-verified-gMZXk0.log`；运行包维持主包865.1KB/总12,288.9KB，既有重复ui键/非当前掉落missing提示保留。没有真实账号/云/设备、上传/提审/发布结果。
- 当前可直接独立准备的本轮交付已完成；下一阶段是拿到明确外部输入后执行真实部署/技术验收与资料定稿，Goal保持未完成，不靠再造离线附件替代。

## 外部输入/未验收

- 用户本轮选择“暂时无法配合”开发者工具/真机验证。
- AppID 权限与云环境/预算问题未给有效答案，尚未确认。继续独立工作，不重复追问相同内容。
- 尚未登录、创建云资源或部署；暂无真实微信身份、云数据或设备运行证据。
- 任务/手册/消费/出战与首版美术已通过本地集成检查；9个live角色与6类实际掉落模型齐全。5个剩余missing引用是未接皮肤、程序金币、库存钥匙和未接XP卡；整体目标端视觉/连续动作/性能仍待验收。
- 微信配置/高性能模式历史问题、模型原生图片解码及长局性能仍须目标端验收；云函数真实事务/索引、最长回放时限、限流与费用待验证，不能从本地测试推断可上线。

## 本轮协作

- `ses_e4fc4ac4affe6PfL6lWp7hSI2V`：资源构建/network，已返回、已集成检查。
- `ses_e4fc4ac38ffedW2KHJXerBL3iS`：renderer 与内嵌纹理切片，已交接、已挂入主入口；无残留后台进程。
- `ses_e4fb1212dffe6czLFkcDTQM15R`：第3轮商店审查完成，严格storage问题已修复并复测。
- `ses_e4faea6dfffeLsl6bAI6oUxsHW`：商店/仓库/持久选择服务已集成；主代理追加回收/钻石兑换与联动回归。
- `ses_e4f665c92ffeeCWvumchZuHqpx`：商店/仓库/角色/设置UI已集成，补字与错误码对齐后检查通过。
- `ses_e4e90c47fffeO3BY6IXt33QCiU`：美术管线只读定位已返回，结论收录ART-HANDOFF；没有后台工作遗留。
- 主代理拥有 WX bootstrap/UI 壳、帧调度/输入、整体验证和文档。
- 第4轮 `ses_e4e141f25ffelsGxGlN6E07Np0`（大厅/结算）、`ses_e4e0fd901ffeZ7RgmE11eHg2GJ`（4原创角色）、`ses_e4e0a6930ffeDpoMfVAwrrLS2r`（海湾）、`ses_e4de34cfeffe7CoqER9XIZ2m2o`（既有接线测试）、`ses_e4dd75da1ffeSWUS4s1X5XXZI0`（只读审查）均已结束并集成。主代理修正新4接地循环与portrait色彩契约，完成最终检查。
- 当前续接Goal：`ses_e4c598ea1ffeGh8M4lXGXFP22d`（补给）、`ses_e4c58e0feffe4HB0f666rIc0Af`（角色/库存页面）、`ses_e4c5717beffeNb1F4NBTPeghZj`（离线像素工具）、`ses_e4c427c66ffetAhrFaGMTE6lK6`（只读审查）均已结束。补给子任务最初两次仅回pending，主代理续接后核对原生命令完成与最终12张图，未把空闲会话当成功。
- 第2轮M5核查`ses_e4b3c7ba0ffeo7PhYm3Qh2cPcZ`与HUD/福利/打包审查`ses_e4b2c14f9ffeMVvTp96J8SsZTw`已结束并整合。主代理拥有HUD/福利、状态观察工具、打包裁剪/许可及测试/文档。
- 第3轮原创磁铁`ses_e4b195f04ffeTgmmFWxxjgvWKp`与字体/接线审查`ses_e4b05dda6ffendsLFf763TOjf1`已结束并整合。主代理拥有Noto生成/接线/同源观察、打包、相关测试和文档。
- 第4轮资料底稿`ses_e4af3a0ccffewZLvjTd9OoqXVQ`已结束并整合；主代理完成原创图标、分层源/重建与检查、launch资料入口和最终验证。无自有后台任务遗留。

## 下一步

等待负责人按`launch/OWNER-INPUTS.md`先确认可执行的AppID开发权限与云环境/预算，或并行提供原5角色/历史音频来源；设备暂不可配合保持待验。明确主体/隐私联系渠道与保留删除策略后实现必要处理流程并定稿文本。条件具备后按已交付路径部署独立云函数并完成真实微信/设备/云闭环验收，提审与公开发布另行授权；不重复离线制作或把候选包视为Goal完成。

历史调度：第2轮曾因intervening_input导致report被拒；第3轮已成功登记continue。第4轮经历两次服务器重启，恢复状态为paused/recovered_needs_resume，仍按用户最新“接着执行”完成了上述集成。末尾report再次返回`A delivered goal round is required for a report`，没有登记成功；项目检查已独立通过，完整交接在本页与task_state revision10之后的更新中。接着按用户授权登记同一Goal的延迟resume，结束回复让原生完成事件续跑；不反复重试report，也不重建目标。

## Goal 续跑规则（用户最新指示）

用户要求：Goal 暂停时自动执行 `/goal resume`（工具等价操作为 `workflow.resume`），恢复同一目标。后续新的明确停止/暂停指令仍以最新指示为准。

此前恢复曾被旧40轮/4小时预算拒绝。用户随后说明已改为无上限并热加载；已实际确认 `maxRounds:null/deadlineAt:null`，不再需要追加旧预算。

新的恢复调用暴露控制器缺陷：当前回复被算入“上一轮仍执行”，导致工具内 resume 被拒。用户已明确批准修复。已修改 `/root/.config/opencode/extensions/workflow-engine/controller.mjs` 及其测试/README，新增持久 `resumePending`：先登记请求，当前原生执行成功结束后仅恢复同一目标一次；后续新输入、明确暂停/清除/恢复、目标/模型/目录变化或执行中断取消请求。保留用户无上限配置与所有操作授权边界。

控制器49项与插件完整102项测试全部通过；RPC实查已热加载 `2026-11-06.2-deferred-resume`。同一目标已实际从第1轮自动恢复到第2、3轮。仅普通暂停时登记延迟resume并结束回复，不循环请求；当前轮正常running时直接report。
