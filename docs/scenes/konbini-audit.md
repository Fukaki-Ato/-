# 场景审计 — 雨夜便利店（scenery=konbini）

> 审计日期 2026-11-08 · 分支 feat/stormspire-2026-11 · 静态源码审计（未实机跑帧率/draw call，实机项均标「待实机验证」）。
> 对照标尺：`docs/stormspire-brief.md:268-273` 的「三波视觉/构图整改」八条（引导线 / 三层景深 / 疏密节奏 / 湿路反射 / 分层雨 / 后处理克制 / 冲刺镜头联动 / 假弯道）。
> 定位：konbini 是**细节密度对标基准**（雷脊 2026-11-11 整改的参照物，brief:250「不如雨夜便利店」），但它是波前产物——本审计回答三件事：它已经有什么、哪些全局系统该开闸、动效七组之外还缺什么。

---

## ① 现状清单（读完全部源码后列已有能力）

`render/konbini/` 共 14 文件 1864 行（`wc -l` 实测），全部读过。接入：`config/themes.json:33` `"scenery": "konbini"`（status=draft，themes.json:27）→ `sceneryProps.ts:207` SCENERY_SETS 注册 → `createKonbiniProps`。

**架构（三桶合并 + 实例化）**
- `kit.ts:121-206` Diorama：body（受光三渲二）/ glow（自发光不吃雾）/ glass 三桶各并一份几何，`place()`（kit.ts:198-205）每模型 ≤3 draw call；`toonMats(0.52)`（kit.ts:43-51，konbiniProps.ts:49）用曝光旋钮出夜晚，glow 桶关雾保「远处一团亮光剪影」（kit.ts:47-48）。
- `poolMat`（kit.ts:58-85）：地面光池片元 smoothstep×3 连续衰减（用户点名「不要明显分层」），55~95m 视距淡出。
- `Layer`（kit.ts:254-279）逐帧重写实例矩阵 + `tint/flushColors` 逐实例染色；`rnd(i,salt)` 确定性伪随机（kit.ts:282-285）；临时 M4/Q/V/E 模块级复用零每帧分配（kit.ts:224-228）。
- 回收：自有 `wrapZ` 一次取模（konbiniProps.ts:42-44），**LOOP=200/WRAP_Z=14**（konbiniProps.ts:23）——与全局契约 LOOP=240/WRAP_Z=12（sceneryProps.ts:20-21）不一致，内部自洽，拐点在雾距 120m（runnerScene.ts:63）之外不可见。
- 回归测试 `tests/konbini.test.mjs`：无散 mesh、实例组 10~44（:57）、顶点 <66k（:61）、三角 >20k（:62）、商铺排/餐厅四角不压 |x|<4.75 跑道（:86-109）。**本次实跑 6/6 通过**（`node --test tests/konbini.test.mjs`）。

**内容密度（对标的本钱）**
- 便利店主体：四面薄墙+青/橙横饰带+橱窗+屋顶冷凝机组（store.ts:23-58）、两面雨棚+常亮招牌带+三色圆店招（store.ts:61-83）、自动门框+地垫+盲道（store.ts:86-100）、店头光摊与车行道三道霓虹倒影（store.ts:94-98）、后巷邻居楼+纸箱+壁灯（store.ts:103-110）。
- 店内全陈设走 glow（interior.ts:13-98）：货架三排纵深、四门饮料柜、便当柜、关东煮锅、收银+POS+咖啡机、杂志架、冰柜、海报。
- 街具（streetProps.ts:25-111）：贩卖机×2、自行车、雨伞架、垃圾桶、公告栏、空调外机+落水管、电线杆（横担/绝缘子/变压器/三根电线）、路灯、路牌、信号灯。
- 中景：五间临街商铺排（shopfronts.ts:49-103，雨棚/竖招/空调外机/阳台/水塔）+ 公交站（:111-134）+ 门前一巷杂物/2m 石板小道（frontage.ts:78-104,40-54）+ 两层餐厅与门前餐座（restaurant.ts:21-127）+ 城市广场喷泉（:130-187）。
- 近景植被：小花园四层植被（garden.ts:16-123），plants.ts 的树/草/三种花全程序化、确定性 seed。
- 远景：高层楼三套型+尺度抖动（garden.ts:131-167，konbiniProps.ts:99-105）。

**动效（统一口径 = konbiniProps.ts:206-209 `update()` 逐帧驱动的 7 个动画组。themes.json:38 的原始「七组」为 降雨/滴水/涟漪/雨痕/自动门/招牌闪烁/信号灯，后两项已按 10-13 用户裁定删除——store.ts:74、streetProps.ts:107-110、konbiniProps.ts:193-194；下表按现行代码清点，与原始口径不是同一张清单）**
1. 自动门 15s 开合（konbiniProps.ts:137-148，update :206）；2. 降雨 300 根单层（:150-161）；3. 屋檐滴水（:165-171，锚点 streetProps.ts:18）；4. 落点涟漪（:173-180，锚点 streetProps.ts:22）；5. 玻璃雨痕下滑（:184-191）；6. 落地溅射 30 点×7 珠同时间线（splash.update :209；splash.ts:10-12,29-66）；7. 商铺排组：光池双层+棚沿水滴挂颤坠落+灯下雨丝（rowFX.update :209；shopfronts.ts:140-185）。

**全局系统接入现状（核对 runnerScene/trackVisuals/coinField/entityLayers 门控）**

| 系统 | 状态 | 证据 |
|---|---|---|
| 后处理链 bloom/暗角/颗粒 + 冲刺联动 | **已开（全主题）** | runnerScene.ts:102-103,194；参数常量 postfx.ts:21-29；wx 降级 postfx.ts:107-115 |
| 锥形引导车道线+距离渐变 | **已开（全主题）**，色取 vfxTint #9FD8FF | trackVisuals.ts:185-191；themes.json:36 |
| 相机微颠簸 / FOV 冲刺扩张 / speedLines | **已开（全主题）** | runnerScene.ts:213-215,218,118 |
| 障碍疏密节奏 laneBlock "0" 档 22% | **已开（全配置，不分主题）** | obstacles.json:1271-1278 |
| 环境闪电 flashEveryS | **关闭**（[9999,9999]） | themes.json:29；机制 runTheme.ts:68-71 + runnerScene.ts:96-99,196-200 |
| 车道线湿路倒影 | **未开**（stormspire 门控） | trackVisuals.ts:201 |
| 跑道水洼 roughnessMap | **未开**（stormspire 门控） | trackVisuals.ts:176-181；roadTex.ts:2 |
| 金币/湿面 envMap IBL | **未开**（stormspire 门控） | runnerScene.ts:100-101；coinField.ts:34-42 |
| world-bend 假弯道 | **未开（整条缺席）** | konbini/*.ts 零引用（grep 实测）；trackVisuals.ts:156 `deep` 仅 stormspire；驱动仅 stormspireProps.ts:68 |
| 障碍皮肤显式分支 | **未开**（konbini 走默认彩盒+海报盘） | entityLayers.ts:62-66 |
| theme.lighting 灯光覆盖 | 未用（夜景靠曝光 0.52 旋钮） | themes.json:27-42 无 lighting 字段；runTheme.ts:57-65；kit.ts:40-45 |

两处文档/配置失真，顺手记录：① sceneryProps.ts:33-35 注释称「海/便利店/渔港也因此带注入（world-bend）」——与事实不符，konbini 材质走自家 kit，未经过 `std()`（sceneryProps.ts:36-40），实际**未注入**；② themes.json 的 `track.railMat`/`track.groundTiles` 字段在 game 源码中无任何消费方（grep 实测零引用），是死配置。

**动效七组之外还缺什么（对标 brief 三波后的缺口清单）**
- 环境闪电联动（全场闪白 + hemi/key 增益照亮店体 body 桶）——机制现成，只差配置。
- 分层雨纵深 + 12° 风斜：stormspire 三层 380/700/320（atmosphere.ts:152-160）vs konbini 单层 300（konbiniProps.ts:151-161）；stormspire SLANT=0.21 斜切风偏（atmosphere.ts:117）vs konbini 仅 ±0.25m 水平正弦摆（konbiniProps.ts:158 `0.25 * Math.sin(t * 0.7 + …)`——是横摆不是斜切，雨丝全程竖直）。
- 贴地薄雾带（atmosphere.ts:97-110 配方，konbini 无）与沿跑道涟漪（konbini 涟漪只锚在店底座 ANCHOR.pool，streetProps.ts:22）。
- 植物风摆：`Spot.sway` 字段与欧拉序支持早已就位（kit.ts:18,231-238），但花园花/草/树全在静态桶，无任何 sway 消费方——要做需把植被拆出独立 Layer（Phase 3 工程件）。
- 障碍便利店皮肤（雷脊模式 stormspire/obstacleSkin.ts 的显式分支，konbini 未建）。
- 调色板口径出格项（如实记录）：palette.ts:6-44 共 87 个 hex 字面量（`grep -o "'#[0-9a-fA-F]\{3,8\}'" palette.ts | wc -l` = 87），对照「5~8 色、发光物只认一种」铁律是最大出格项；但多色霓虹就是本场景品牌，处理见 §⑤。另有死色 `C.neonD`（palette.ts:17 定义，全仓零引用，grep 实测）。

---

## ② 八条美学逐条差距表

| # | 条目 | 现状（证据） | 差距 | 开闸哪个现成系统 | 具体改法（文件+字段） |
|---|---|---|---|---|---|
| 1 | 引导线 | 锥形车道线+距离渐变全主题生效，色 #9FD8FF（trackVisuals.ts:185-191, themes.json:36）；护栏光带用 sky.flashColor（trackVisuals.ts:223） | 有线无倒影：湿路倒影条带 stormspire-only；雨夜主题里这条缺口它最疼 | trackVisuals 倒影分支（第一波产物，brief:269） | `trackVisuals.ts:201` `if (scenery === 'stormspire')` → 加 `\|\| scenery === 'konbini'`（建议提成 `WET_THEMES` 常量），倒影色自动取主题 vfxTint，零新增对象 |
| 2 | 三层景深 | 近店 SIDE_X=12.8(x)×1.45 放大 / 中景商铺排 13.8(x)+餐厅 10(x)+广场 12.6(x) / 远楼 FAR_X=26(x) 三套型 32 楼位带抖动（konbiniProps.ts:23-27,86-105；garden.ts:131-167）——三层齐、层次最全（括注均为横向离道距，非高度） | 远景只有 26m(x) 一条线，楼顶上缘最高 16.5m(h)（garden.ts:131）在 120m 雾距里直接切断，地平线上缘发虚 | 自家 farSets 机制扩展（第二远景带） | `konbiniProps.ts:100-105` farSets 循环加第二排 `spot(FAR_X*1.6≈42, z…)`，走新「雾影套型」第四套（色用 C.farDark，palette.ts:25）；注意顶点预算测试上限 66k（tests/konbini.test.mjs:61），余量未知先量后加 |
| 3 | 疏密节奏 | 障碍侧全球已开无需动作（obstacles.json:1271-1278）；**侧景完全等周期**：店每 100m（konbiniProps.ts:75）、灯每 20m（:109-112）、远楼每 12.5m（:102） | 跑两圈即可预测；雷脊有 rhythmZ 密×0.7/疏×1.45（bridge.ts，brief:269） | rhythmZ **已 export**（`bridge.ts:38`，islands.ts:19 跨文件 import 即先例）——但 konbini 直接 import stormspire 模块破坏主题互不依赖，与 coast-audit 同一拍板项：先提升为 sceneryProps.ts 共享 util（见 §⑥-1） | `konbiniProps.ts:109-112` 灯表由函数生成：z 段内间距 20m→密段 14m/疏段 28m（240m 切 8 段同雷脊口径）；远楼行距同理乘系数。在拍板落地前可先本地抄写公式不阻塞本项 |
| 4 | 湿路反射 | 侧景湿感足：光摊/倒影条遍布（store.ts:94-98, shopfronts.ts:101-102, restaurant.ts:81-82, frontage.ts:63-65,101-103, streetProps.ts:94-97）；**跑道本体纯色哑光**（roadMat 无 roughnessMap，trackVisuals.ts:171） | 跑到店门口「一侧光摊倒影、脚下哑光沥青」断裂；这是雨夜场景的招牌质感 | stormspire/roadTex.ts（参数化 roadWidth、确定性、中线干燥带口径现成，roadTex.ts:28-69） | ① `trackVisuals.ts:176` gate 加 konbini → roughnessMap+roughness 1+envMapIntensity 0.6（同 :176-181 现分支体）；② envMap 见 §④ Phase 2（env.ts 环境盘是雷暴金色带 env.ts:26-28，雨夜该冷蓝化后才有反射内容）；无 envMap 时 roughnessMap 仍吃 keyLight 高光（key (3,8,4)@1.9，runnerScene.ts:95-96），效果待实机验证；③ roadTex.ts:2「只供 stormspire」注释同步更新 |
| 5 | 分层雨 | 单层 300 根+溅射+滴水/涟漪/雨痕/灯下雨丝（konbiniProps.ts:150-191, splash.ts, shopfronts.ts:149-170）——微观动效是全场景标杆，宏观雨幕没有纵深 | 一层同速同长无远近；无风斜；远景楼与店之间缺雨幕层次；无贴地薄雾 | atmosphere.addRainLayer（模块内函数，atmosphere.ts:116 未导出）/ addMist / addRipples 配方 | ① atmosphere.ts:116 `addRainLayer` 加 color/盒参数后 export（299 行红线内零增长），konbiniProps.ts（现 213 行）建 far 层 320 根 z[-46,-14] α0.16 + near 层照 atmosphere.ts:156-158 参数、色 #bfe0ff；② 风斜：konbiniProps.ts:156-161 的 out.x 加 `(TOP - y) * 0.21` 同 SLANT 口径；③ 薄雾两条抄 atmosphere.ts:97-110，色换 fog 色 #243050（themes.json:30）；④ 沿路涟漪 60 枚抄 atmosphere.ts:165-198，路缘 \|x\| 3~5，色 #cfe6ff（与 konbiniProps.ts:173 同色） |
| 6 | 后处理克制 | 全主题已开：bloom 0.32/0.82+暗角 0.28+颗粒 0.035+wx 降级（postfx.ts:21-29,107-115） | 参数硬编码无主题字段；bloom 阈值 0.82 对 konbini 半合身：店招底光 #fff2cf（store.ts:76）线性亮度≈0.87 过阈、多数光摊（#6a5730，store.ts:94）≈0.1 不过——雨夜霓虹理应比雷脊更强一档；颗粒在湿画面上是否偏脏待实机验证 | 无现成主题字段——**小系统新增**（schema 全放开）：theme.postfx 覆盖 | `runTheme.ts:57` 旁照 `lig` 读取模式加 `theme.postfx` 派生；`postfx.ts:100` createPostFx 加可选参（缺省=现值，其它主题零变化）；themes.json konbini 条目加 `"postfx": { "bloomStrength": 0.45 }`。若坚持零代码，则接受现值并在实机确认 |
| 7 | 冲刺镜头联动 | **全主题已开**：postfx.update(speedMul)（runnerScene.ts:194, postfx.ts:154-160）+ speedLines（:118）+ FOV（:218）+ 微颠簸（:213-215） | 无差距。唯一备注：wx 端 postfx 恒降级（postfx.ts:107-115）后冲刺只剩 FOV+speedLines——全主题问题，不在本场景修 | —（已开） | 无 |
| 8 | 假弯道 | **整条缺席**：konbini 零注入（grep 实测）、`deep` gate 不含（trackVisuals.ts:156）、setWorldBend 仅 stormspire 驱动（stormspireProps.ts:68） | 八条里唯一零分项 | worldBend 全材质注入+单主题驱动设计（worldBend.ts:81-96,102-105） | 四步：① `trackVisuals.ts:156` deep gate 加 konbini → 地面/路面/线/护栏/虚线注入+几何加密自动生效（trackVisuals.ts:242-247,163-169）；② kit.ts 给 `toonMats` 三材质与 `addMat`（kit.ts:43-51,218-222）调 `applyWorldBend`——**Toon 兼容性我已核实**：three 0.187.0 meshtoon.glsl.js:38 含 `#include <project_vertex>`，与 worldBend.ts:53-68 替换点匹配（worldBend.ts:77 注释只背书 Basic/Lambert/Standard，Toon 为本次核实的新扩展，建议补进注释）；**同时放行两处门控**：coinField.ts:34 与 entityLayers.ts:122 的 `if (scenery === 'stormspire')` 分支加 konbini（两者的 applyWorldBend 调用体都包在分支内，coinField.ts:36-37 / entityLayers.ts:123-130）——不放行则路面/侧景弯而金币/障碍不弯，正是本条要防的「分家」；③ `konbiniProps.ts:197` update 开头调 `setWorldBend(t)`（konbiniProps 只在 konbini 局构造，单主题驱动语义不破）；④ `poolMat` 是 ShaderMaterial 走不了 applyWorldBend（kit.ts:58-85）——顶点着色器手接同式 bend（~6 行 + 三个 uniform），或接受脱开量：起弯 18m/100m 全幅 7m（worldBend.ts:44,63-65），光池自身 55m 起淡出（kit.ts:57-58），55m 处 k≈0.45 → 偏移≈1.4m，光池与灯杆脱开是否可见**待实机验证**。跑道层的弯道注入面：**仅道具箱材质无条件注入**（pickupLayer.ts:28）；金币/障碍的注入体分别包在 coinField.ts:34、entityLayers.ts:122 的 stormspire 分支内（见第②步放行），放行后 uniforms 非零即同弯。LOOP=200 与弯道无冲突（弯是视深 f(z)，与回收周期无关） |

---

## ③ 快赢清单（半天内可完成，按性价比排序）

1. **环境闪电开闸**：`config/themes.json:29` `"flashEveryS": [9999, 9999]` → `[11, 24]`。一行。自动联动 runnerScene.ts:96-99 定时器 + lightning.ts 三段式（FLASH_TINT #cfe4ff 冷白，lightning.ts:25，与雨夜不冲突）+ hemi/key 闪白增益（runnerScene.ts:202-203）瞬间照亮店体 body 桶。节奏取值待实机验证（[7,14] 是雷脊的暴烈档，themes.json:67，雨夜街角应更稀）。
2. **车道线湿路倒影**：`trackVisuals.ts:201` gate 加 konbini。一行，颜色自动跟随 vfxTint。
3. **跑道水洼 roughnessMap**：`trackVisuals.ts:176` gate 加 konbini（roadTex 参数化现成）；同步改 roadTex.ts:2 的「只供 stormspire」注释。
4. **远景第二排（雾影带）**：konbiniProps.ts:100-105 加一排 42m 处 farDark 楼影（半天含调色）。
5. **灯距密疏节奏**：konbiniProps.ts:109-112 灯表改 rhythmZ 式分段间距（rhythmZ 共享或本地抄写待 §⑥-1 拍板，本地抄写不阻塞本项）。
6. **贴地薄雾**：抄 atmosphere.ts:97-110 两条，色 #243050。
7. **死件清理**：`C.neonD`（palette.ts:17）删除或投入使用；themes.json `track.railMat/groundTiles` 死字段标注或清理（涉及 schema 口径，先确认无外部消费）。

每项完成后跑 `node --test tests/konbini.test.mjs`（本次基线 6/6 绿）。

---

## ④ 波次计划（对照雷脊三波，brief:268-273）

**Phase 1 · 构图开闸（≈1 天）**——全部是「现成系统加门控」，零新系统：
闪电开闸（③-1）＋车道线倒影（③-2）＋跑道 roughnessMap（③-3）＋灯距节奏（③-5）＋薄雾（③-6）。验收：konbini 测试全绿 + `?debug` 探针 draw call 不越 44 上限（runnerScene.ts:271-272；composer 路径计数失真是已知折中，brief:273，以 wx 真机为准）。

**Phase 2 · 质感（2~3 天）**：
- 分层雨三层化＋12° 风斜＋沿路涟漪（②-5，需导出 addRainLayer 小重构）。
- 假弯道四步接线（②-8，**是否给雨夜街角上弯先过 §⑥-2 拍板**），含 Toon 注入实机验证与 poolMat 手接二选一。
- env.ts 参数化冷蓝变体（店头暖光带替金光带，env.ts:26-28 结构现成 55 行小改）→  roughnessMap 才有反射内容，coinField envMap gate（coinField.ts:34）同步开，金币在雨夜里得一次「湿反光」。
- postfx 主题覆盖字段（②-6，bloom 微强 0.45 档）。
- 远景第二排（③-4 若未在 Phase 1 完成）。

**Phase 3 · 大工程**：
- **障碍便利店皮肤**（显式分支模式，模板 obstacleSkin.ts:23-59 槽位 + :85-180 emit + entityLayers.ts:62-66 门控 + runnerScene.ts:112 传 scenery）：low=橙白交通锥（C.bollA/bollB palette.ts:38 现成色）、high=施工围栏+警示灯（梁下净空 1.2m 口径不变，obstacleSkin.ts:127）、full=围挡喷绘墙、vehicle=K-car 小货车（顶面齐 o.h 保 rideTop，obstacleSkin.ts:136-151 同款纪律）、moving=悬挂招牌摆锤、hazard=湿滑警示垫；zap/step 留默认盘（obstacleSkin.ts:22 同口径）。
- 植物风摆：花/草/树拆出静态桶成独立 Layer，消费 kit.ts:18 的 sway 字段（Spot 欧拉序已支持）；先花园一景试点。
- world-bend 依难度加深（brief:280 Phase B-4 同款，两场景共用）。

---

## ⑤ 风险与「该场景品牌不许破坏什么」

1. **「远处一团暖光慢慢淡入」的剪影感**是本场景的招牌镜头（kit.ts:47-48 glow 不吃雾是根）。开 bloom 调参时阈值守住 ≥0.8——压低了雾中远店会整块泛光，剪影感即毁。
2. **「不要闪」是用户裁定过的**：店招/信号灯闪烁动画层已删（store.ts:74、streetProps.ts:107-110、konbiniProps.ts:193-194）。环境闪电是全场闪白、照亮所有受光体，不是单体闪烁，不违反；但任何「招牌呼吸/灯光明灭」类新动效都越线。
3. **三桶合并 + 预算红线**：draw call 10~44、顶点 <66k 是测试护栏（tests/konbini.test.mjs:57,61）。Phase 2/3 每加一批内容先想合并与换基元（interior/plants 的省顶点口径，kit.ts:184-192），别顺手抬线。
4. **确定性/零分配铁律**：新动件一律 Layer + `rnd(i,salt)` + 原地改写（kit.ts:254-285）；splash.ts:5 的「切后台回来也不乱」是验收口径。
5. **青/橙横饰带 + 三色圆店招**的记忆点（store.ts:30-31,77-79）不许被 Phase 3 皮肤或调色收敛稀释；调色板 87 色（grep 实测，见 ①）不做雷脊式 7 色收敛——杂而不乱靠的是分区注释（palette.ts 按店体/灯光/店内/花园/商铺/广场分段），要做只收敛「发光色相」而非全局。
6. **曝光公式与 lighting 字段绑死**：夜景感由 `toonMats(0.52)`（kit.ts:43-45）×白天灯光（hemi 1.15/key 1.9 缺省，runTheme.ts:58,64）相乘达成。若给 konbini 加 `theme.lighting` 覆盖（机制现成，themes.json:73 有雷脊先例），body 桶明暗与闪电增益基线（runnerScene.ts:202-203）同时漂移，必须连同曝光重调——**建议不动**，现状已达标。
7. **LOOP=200 差异**：与全局 240 契约不一致但内部自洽、拐点藏雾里；改它要重排全部摆位表（konbiniProps.ts:75-112），收益仅一致性——除非有全局系统硬编码假设 240，否则不动，留待实机核对。
8. **wx 主力平台**：postfx 恒降级（postfx.ts:107-115），Phase 2 的 bloom/弯道视觉验收以桌面为准、wx 端以 build:wx 真机另验；`?debug` 的 draw 计数在 composer 路径失真（brief:273）。
9. **两项待实机验证**（本审计未跑，不许当作已解决）：poolMat 光池与灯杆在弯道 55m 外的脱开可见性（§②-8，估算偏移≈1.4m）；MeshToonMaterial 注入后三渲二 ramp 在弯道带内无着色 artifacts（注入点已核实匹配，视觉未验）。

---

## ⑥ 遗留疑问与需拍板

| # | 事项 | 背景证据 | 归属 |
|---|---|---|---|
| 1 | rhythmZ **提升为 sceneryProps 共享 util** vs 各场景本地抄写 | `bridge.ts:38` 已 export、islands.ts:19 跨文件引用即先例；konbini（②-3）/ coast（coast-audit §2#3）/ harbor（harbor-audit ②#3）三份审计指向同一决定；直接 import stormspire 模块会破坏主题互不依赖 | 主程，一次决定三场景受益 |
| 2 | konbini **上不上 world-bend** | ②-8 四步接线全部小改可落地；但 konbiniProps.ts:83 的「街是直的」是 10-13 拍过板的构图折中，±7m/±4m 呼吸（worldBend.ts:103-104）对雨夜街角是氛围还是出戏，需品牌评审 + 实机双确认 | 品牌/用户评审 + 实机 |
| 3 | postfx 主题覆盖字段（**小系统新增**，非纯开闸） | ②-6：不做则雨夜霓虹吃不到比雷脊强一档的 bloom；做则动 runTheme.ts:57 旁 + postfx.ts:100 签名（缺省=现值，其它主题零变化） | 主程 |
| 4 | 障碍 vehicle=**K-car 小货车**的品牌口径 | Phase 3 皮肤；顶面齐 o.h 保 rideTop 的纪律现成（obstacleSkin.ts:136-151） | 美术/品牌 |
| 5 | 环境闪电 flashEveryS 取值 | ③-1 建议 [11,24]；[7,14] 是雷脊暴烈档（themes.json:67），雨夜街角应更稀 | 实机手感定档 |
| 6 | LOOP=200 是否归一 240 契约 | §⑤-7：内部自洽、拐点藏雾；改动是纯重排摆位表（konbiniProps.ts:75-112） | 主程（出现硬编码假设 240 的全局系统之前可挂起） |
| 7 | §⑤-9 两项待实机验证的销项 | poolMat 光池弯道脱开可见性、Toon 注入弯道带 artifacts——均需实机截图/真机确认后销项 | 实机验证轮 |
