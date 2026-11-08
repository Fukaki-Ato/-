# 场景优化审计 — 白日海景（scenery = coast）

> 审计口径：`docs/stormspire-brief.md` §「三波视觉/构图整改」（2026-11-11）的八条美学（引导线 / 三层景深 / 疏密节奏 / 湿路反射 / 分层雨 / 后处理克制 / 冲刺镜头联动 / 假弯道）。
> 场景品牌：**通透柔和晴天**，日式治愈向三渲二。所有雨夜资产（湿路、暗角、颗粒、分层雨、闪电）不得照搬，本文只给「晴天版本」的克制参数。
> 写作纪律：每条结论都来自本会话实读的源码（`文件:行`），未实机跑的部分一律标「待实机验证」。审计时间 2026-11-08，修订 2026-11-09（冷读评审 6 条全采纳），基线分支 feat/stormspire-2026-11。

---

## ① 现状清单（实读 `render/coast/` 全部 6 文件 754 行 + 共享 `render/konbini/kit.ts`（coastProps.ts:14 引用，coast→konbini 的既有跨场景共享层先例）+ themes.json 条目）

### 1.1 接线现状

- themes.json `theme_seaside_day`（**live，全仓默认主题**）：`config/themes.json:7-25`。`scenery: "coast"`（:14）、`sky.flashEveryS: [9999,9999]` 环境闪电关闭（:10）、雾 `#CFE9F6`（:11；同行的 density 0.011 全仓无消费方——packages/game/src、framework、apps/server 源码 grep 零命中，渲染层用线性 `THREE.Fog(near, far)`，`runnerScene.ts:88`，死配置）、`vfxTint #FFF0C8` 暖白（:17）、`groundColor #F0C67A` 暖沙（:15）。无 `lighting` 字段 → 走 runTheme 缺省海滨日光口径 hemi 1.15 / key 1.9 暖阳色（`runTheme.ts:57-65`）。
- 侧景注册：`sceneryProps.ts:205-211` SCENERY_SETS 含 `coast: createCoastProps`（:208）。
- 玩法节奏全局件已覆盖 coast（无需任何改动）：breather patterns `pat_breather_coins/slalom/empty`（`config/obstacles.json:1055/1082/1120`）、`laneBlock.weights "0": 22` 呼吸档（`obstacles.json:1271-1277`），trackGen 的 want 过滤放行无封堵模板已核实（`core/sim/trackGen.ts:230-233`）。

### 1.2 侧景资产目录（数量为源码清点，非实机统计）

| 资产 | 数量 | 形制/材质 | 动效 | 证据 |
|---|---|---|---|---|
| 海景别墅（右 x=12.3） | 2（z=-30/-130，s=1.15） | 双层奶白墙+弧形屋檐半圆柱+双层落地玻璃+阳台白栏杆+庭院露台+室内满陈设（全 glow 自发光桶） | 玻璃反光 sheen 扫过 ×4 位、室内暖光灯带呼吸 ×4 位 | `coastProps.ts:76-81`、`villa.ts:22-110`、`villaIn.ts:16-97`、`coastProps.ts:185-201` |
| 遮阳伞+双躺椅 | 11（右 7 左 4） | 8 瓣伞面双色+躺椅+小桌，toon body | 静态 | `coastProps.ts:83-87`、`beach.ts:156-175` |
| 椰子树 | 6（左 -8.9 起） | 5 段弯干+7 片羽状叶×16 小叶+椰串，toon body | 静态 | `coastProps.ts:89-95`、`beach.ts:50-83` |
| 观景长椅 | 4 | 木条椅面朝海 | 静态 | `coastProps.ts:97-99`、`beach.ts:96-101` |
| 礁石簇 | 7 | 4 团 icosahedron+底部湿岩色 | 静态 | `coastProps.ts:101-107`、`beach.ts:86-93` |
| 水桶/救生圈柱 | 3+3 | 圆柱小件 | 静态 | `coastProps.ts:109-113`、`beach.ts:118-127` |
| 开花灌木 | 26 | 三叶团+10 朵五瓣小花+根草，glow 桶花 | 静态摆位 | `coastProps.ts:116-126`、`beach.ts:26-47` |
| 风动花草 | 46 | 草穗+小野花+叶团；草受光/花发光双桶同摆位 | **整片轻摆**（sway 0.055+0.022 双频） | `coastProps.ts:129-139,203-209`、`beach.ts:130-143` |
| 碎浪沫 | 56 | 白色短窄条带斜角，逐件摆=不规则海岸线 | 静态摆位（动感交给海面 shader） | `coastProps.ts:143-146`、`beach.ts:104-107` |
| 湿沙水洼 | 18 | 椭圆 body+haze 反光 glow | **静态**（无明暗变化） | `coastProps.ts:147-149`、`beach.ts:110-113` |
| 贝壳/卵石 | 46/24 | 小椭圆体/团块 | 静态 | `coastProps.ts:150-155`、`beach.ts:116-117` |
| 沙底+水线 | 静态长条 | 干沙/湿沙两带+0.9m 深色水线，不滚动不跳 | 无 | `coastProps.ts:162`、`beach.ts:12-23` |
| 海面 | 1（84×320，z 至 ≈-244） | 手写 shader：顶点双正弦起伏（近岸压平）+深度渐变蓝+细碎波光+沿岸水线泡沫+远海收雾景深 | uT 驱动 | `coastProps.ts:163-166`、`sea.ts:18-55` |
| 浅滩薄水 | 1（7.6×216） | 半透明 shader：起伏+摆动水痕+陆侧退边 | uT 驱动 | `coastProps.ts:167-170`、`sea.ts:58-86` |
| 海面薄雾 | 4 片 | poolMat 径向软边大方片 | 横向慢飘 | `coastProps.ts:173-176`、`sea.ts:89-93` |
| 波光碎亮 | 74 | 0.62×0.1 方片 additive，确定性相位明灭 | 逐实例 tint 三次幂明灭 | `coastProps.ts:177-184` |
| 海鸥 | 7 只×（身+双翼） | oval+box 小件 | 绕海椭圆盘旋+扇翅（roll） | `coastProps.ts:36-44,210-220`、`beach.ts:146-153` |

- 材质口径：`toonMats(1.06)`（`coastProps.ts:47`）——白天曝光 1.06（对比雨夜便利店 0.52，`konbini/kit.ts:43`），body 三渲二 4 档渐变（`kit.ts:26-36`）、glow 自发光不吃雾（`kit.ts:48`）、glass 半透明。调色板 `palette.ts:7-33`（三渲二多色陈设，见 §5 红线 4）。
- 循环口径：coast 自有 `LOOP=200, WRAP_Z=18`（`coastProps.ts:25`），每类元素一份几何+一批实例独立绕回（防「连片消失」，`coastProps.ts:5-8` 注释与 `beach.ts:2-6`）；沙底/海面是静态不滚动长条（`coastProps.ts:161-170`）。
- 静态清点侧景绘制批次 ≈27：17 个 InstancedMesh（villa body/glow/glass 3 + 其余单桶 10：伞 :87/椰 :95/椅 :99/礁 :107/桶 :112/圈柱 :113/浪沫 :156/贝 :158/卵石 :159/沙底 :162 + puddle body/glow 2（:157）+ shrub body/glow 2（:126））+ 海面/浅滩 2 + Layer 8（mist :173/glint :177/sheen :185/breathe :194/sway :208/swayFlowers :209/gullBody :210/gullWings :214，`kit.ts:254-279`）。**静态清点，未实机核对**；wx 端全部为裸渲染（coast 无任何 wx 不可用特性）。

### 1.3 coast 当前拿到的全局系统

| 系统 | coast 是否吃到 | 证据 |
|---|---|---|
| 锥形车道线+距离渐变 | ✅（全主题共享 LINE_PROFILE，仅 stormspire 另做加密） | `trackVisuals.ts:87-106,189-194` |
| 后处理链（bloom/暗角/颗粒/冲刺联动） | ✅ **全主题启用、参数不分主题**——coast 正吃着雨夜 grade | `runnerScene.ts:102-103`、`postfx.ts:21-29` |
| 冲刺 FOV 扩张+镜头微颠簸+speedLines | ✅ 全主题 | `runnerScene.ts:215,218`、`speedLines.ts:1-54`（tint=#FFF0C8 `runnerScene.ts:118`） |
| world-bend 假弯道 | ❌ 且 coast 材质**一个都没注入**（toonMats 不走 `std()`；sea/shallow/poolMat 是手写 ShaderMaterial） | `worldBend.ts:40-44` 恒零、`coastProps.ts:47`、`kit.ts:43-51` |
| 路面水洼 roughnessMap | ❌（正确：stormspire 门控） | `trackVisuals.ts:176-181` |
| 湿路倒影条带 | ❌（正确：stormspire 门控） | `trackVisuals.ts:201-221` |
| stormspire IBL envMap | ❌（正确：scenery 门控） | `runnerScene.ts:100-101` |
| 障碍雷暴皮肤 | ❌（正确：显式分支） | `stormspire/obstacleSkin.ts:10-13` |
| 环境闪电 | ❌（正确：[9999,9999] 关闭；玩法 zap 死亡仍会触发全场冷白闪，见 §5） | `themes.json:10`、`runnerScene.ts:162-165,197-200` |

---

## ② 八条美学逐条差距表

> 「开闸」= 启用/复用哪个已核实存在的现成系统。建议值均为**晴天克制口径的起点**，最终数值待实机截图拍板。

| # | 美学项 | 现状 | 差距 | 开闸哪个现成系统 | 具体改法（文件与字段） |
|---|---|---|---|---|---|
| 1 | **引导线** | 锥形车道线（近 0.09→远 0.035、alpha 0.85→0.25 指进雾里）已对 coast 生效，色=vfxTint 暖白 `#FFF0C8`（`trackVisuals.ts:87-93,188-194`、`themes.json:17`）；海岸线水线泡沫是天然第二引导线（`sea.ts:46-47`） | ① 跑道色 `0x18233c` 深藏青**硬编码**（`trackVisuals.ts:171`），coast 无从调成海岸公路色；② 护栏=`sky.flashColor` 纯白加色 additive 0.5（`trackVisuals.ts:223-227`、`themes.json:10`），是雷脊「金线」口径的副产品，晴天高亮画面上偏刺眼（待实机验证） | 无需新系统；themes.json 自定义字段有先例（stormspire `lighting` 字段 `themes.json:73` → `runTheme.ts:57-65` 读取），schema 全放开（`schema/config.schema.json` 各层 `additionalProperties: true` 已核实） | themes.json coast 条目加 `"track": { ..., "roadColor": "#cfc9bd", "railColor": "#eaf4f8" }`（浅水泥海岸公路/雾蓝白护栏，候选值待实机对比）；`trackVisuals.ts:171` 改 `colors.roadColor ?? 0x18233c`、:223 改 `colors.railColor ?? colors.flashColor`（TrackColors 接口 `trackVisuals.ts:20-27` 加两字段，runTheme/runnerScene 透传） |
| 2 | **三层景深** | 近景（沙面小物/花草/伞）→中景（椰树/礁石/别墅）→远景（海面 shader 远处收 haze `sea.ts:50` smoothstep(60,190) + 薄雾 4 片 `coastProps.ts:173-176` + 雾 FOG_FAR 120 `runnerScene.ts:63`）三层结构成立 | **远景层没有焦点物**：海平线一片空——海鸥最远只到 x≈-61（`coastProps.ts:37-44` gullPath），海面大而无内容；对比雷脊有远景剪影带+信标光柱（`stormspire/skyline.ts:1-11`）与云墙 ×0.55 半速三排（`stormspireProps.ts:35-49`） | skyline 的「半速视差剪影带」配方（×0.3、300m 回收带、矩阵自管非均匀缩放，`skyline.ts:8-11`） | 新建 `render/coast/horizon.ts`（不塞 coastProps.ts，守 ≤300 行铁律）：海平线帆影 3~5 艘 + 1 座灯塔岛剪影，×0.3 半速视差、300m 带、色用 P.haze 加深一档（palette.ts 新增常量如 `'#b9dbe8'`）；**禁 additive 光柱**（晴天品牌，见 §5）。coastProps.ts:222 的 update 里补一行 `horizon.update(move, t)` |
| 3 | **疏密节奏** | 障碍侧已全局达标：breather patterns + laneBlock `"0":22`（`obstacles.json:1055,1082,1120,1271-1277`、`trackGen.ts:230-233`），coast 自动吃到，**无需改动**。侧景侧：大件有手工簇（右伞 -50~-90 每 10m 密排、`coastProps.ts:84`），但灌木/花草/椰树/礁石是线性等距（`(i*7.3)%LOOP` :117-121、`(i*5.3)%LOOP` :130-134、`i*33` :91、`i*27` :103） | 侧景跑起来「每段都一样」，无雷脊的 密×0.7/疏×1.45 八段呼吸（`stormspire/bridge.ts:38-53` rhythmZ，240m 切 8 段） | rhythmZ（已 export，`bridge.ts:38`）——不新增场景间耦合：coast→konbini/kit 的共享工具层是既有先例（`coastProps.ts:14`），而 `stormspire/bridge.ts` 是场景专属模块，故与 kit 同层解决——提升到 `sceneryProps.ts` | `sceneryProps.ts` 增加 `export function rhythmZ(...)`（剪切自 `bridge.ts:38-53`，bridge 改为 import，行为零变化）；`coastProps.ts` 的 shrubs/flora/palms/rocks 四处 z 生成改走 `rhythmZ(every, phase)`（每类错开 phase，同 bridge.ts:92 口径）；占位避让 `free()/take()`（:55-57）逻辑不动 |
| 4 | **湿路反射** | coast 不进 stormspire 湿路分支（roughnessMap `trackVisuals.ts:176`、倒影条带 `:201` 均 stormspire 门控）✅ 品牌正确。自己的「湿」表达：水线深色带（`beach.ts:22`）、水洼椭圆+haze glow（`beach.ts:110-113`）、玻璃 sheen 扫过（`coastProps.ts:185-193`） | 水洼是**静态材质**（place() 静态 InstancedMesh `coastProps.ts:60-72,157`），阳光下的湿沙反光纹丝不动，是画面里最显死板的一处。**不是要开 roadTex**（品牌红线），而是给既有水洼 glow 加明暗 | glint 的 Layer+逐实例 tint 相位明灭模式（`coastProps.ts:177-184`，确定性 sin 相位、零分配） | `coastProps.ts`：puddle 的 glow 桶改 Layer（同 floraPlace 双桶同摆位手法 :203-209）：`tint = 0.35+0.65*(0.5+0.5*sin(t*0.9+i*1.3))`；**克制参数**：频率 ≤1Hz、不加 additive、不加宽不改色（仍 P.haze）——晴天湿沙反光要「微闪」不要「镜面」 |
| 5 | **分层雨**（晴天等价物=分层风） | coast 无雨、闪电关（`themes.json:10`）✅。空气感只有薄雾 1 层（4 片、x -34 起、z -118~-190，`coastProps.ts:173-176`） | 只有「雾」没有「风」：雨夜是三层雨+涟漪+风痕+薄雾带（`stormspire/atmosphere.ts:1-10` header：雨 380/700/320、涟漪 60、风痕 12）；晴天海边的等价物是**低空盐雾/海风痕一层**，coast 现在完全缺失 | atmosphere.ts 的 wind 风痕配方（12 条半透白条 y 2~8、\|x\| 5~14、自速+move 快速出画绕回）——atmosphere.ts 是 stormspire 场景专属模块（非共享层），不新增场景间耦合，抄配方本地新建（同 #3 口径） | `coastProps.ts`（或并入 horizon.ts）加一个 wind Layer：8~12 条细长白条（PlaneGeometry，P.mist 色）；**克制参数**：仅 1 层、条数 ≤12、普通透明（**不开 AdditiveBlending**）alpha ≤0.2、y 1.5~6、速度与 mist 同量级。放 Phase 2，不进快赢 |
| 6 | **后处理克制** | postfx **全主题启用且参数是模块级硬编码**：暗角 0.28、颗粒 ±0.035、饱和 1.0、bloom 0.32/0.82（`postfx.ts:21-29`，`runnerScene.ts:102-103` 注释「参数不分主题」，`createPostFx` 签名无主题参数 `postfx.ts:100-103`） | **八条中唯一的「现状违规」**：暗角+颗粒正是雨夜口径——暗角压画面四周毁「通透」，±0.035 颗粒在高亮天空上出脏点（grade shader：`col *= 1-uVignette*...` :77、`col += (n-0.5)*0.035` :83）。coast 的 glow 物（白泡沫/波光/室内暖光）在 0.82 阈值下会轻度泛光（强度待实机验证） | themes.json 自定义字段先例（同 #1）；postfx 加参数口 | ① themes.json coast 加 `"postfx": { "vignette": 0.12, "vignetteBoost": 0.06, "grain": 0.0, "saturation": 1.0, "bloom": 0.22, "bloomThreshold": 0.85 }`；② `runTheme.ts` deriveRunStage 派生透传（**缺省回退现常量值，保证其它主题零漂移**）；③ `postfx.ts` `createPostFx` 加第 4 参 `grade?` 覆盖 :21-29 常量与 :145 初值（含 VIGNETTE_BOOST/SATURATION_BOOST/BLOOM_BOOST 同步缩放）；④ `runnerScene.ts:103` 传入。**克制建议值**：暗角 0.28→0.12（保留一点点四角收拢感但不压通透）、颗粒→0、bloom→0.22、冲刺联动幅度减半 |
| 7 | **冲刺镜头联动** | 已全主题达标：FOV 扩张（`runnerScene.ts:218`）、镜头微颠簸 0.03m 仅地面态（:215）、postfx 冲刺联动暗角→0.42/饱和→0.86/bloom→0.5（`postfx.ts:22-25,154-160`）、speedLines 44 条暖白（`runnerScene.ts:118`） | 仅一处：若按 #6 把 coast 暗角基线降到 0.12，冲刺时 0.12+0.14=0.26 仍会明显压暗，晴天画面「冲刺=变闷」 | 同 #6 的 postfx 字段 | coast postfx 字段带 `"vignetteBoost": 0.06`（联动保留、幅度减半）；饱和/bloom 联动维持原值（玩法反馈不是氛围，不动） |
| 8 | **假弯道** | coast 零弯道：uBendX/uBendY 恒零（`worldBend.ts:40-44`，仅 `stormspireProps.ts:68` 驱动）；且 coast 侧景材质**一个都没注入**——toonMats 未走 `std()`（`coastProps.ts:47` vs `sceneryProps.ts:36-40`），sea/shallow/poolMat 是手写 ShaderMaterial（`sea.ts:20-86`、`kit.ts:58-85`），worldBend 的 project_vertex 注入（`worldBend.ts:53-68`）不覆盖手写 shader | 晴天治愈向适合「微弯」不适合雷脊 7m 大弯；且 coast 接入成本高于其它主题：三处手写 shader 要手动拼 bend 公式；MeshToonMaterial 能否走同一注入**待实机验证**（`worldBend.ts:76` 注释只核对了 Basic/Lambert/Standard；toon 顶点模板同位置 include project_vertex，理论可行） | worldBend（全材质注入+单主题驱动）；glow/glass 桶是 MeshBasicMaterial 可直接 `applyWorldBend`（kit.ts:48-49） | **Phase 3 可选**：① `coastProps.update` 首行接管 `setWorldBend` 晴天版（建议参数化：`uBendX=3.5*sin(t*0.05)`、`uBendY=2*sin(...)`——幅度减半、周期 ~2min，另需 stormspireProps 不活跃时 coast 接管 uniforms，注入即清零机制 `worldBend.ts:81-84` 已保证）；② sea.ts/shallowMat/poolMat 三个 vertex 手动拼 `BEND_UNIFORMS_GLSL`+k² 位移（抄 `worldBend.ts:50,63-67` 公式）；③ toon 材质先在 ?debug 实机验证注入有效性。**若品牌评审否掉弯道，本条「不做」也是合法结论** |

---

## ③ 快赢清单（半天内可完成，按性价比排序）

1. **后处理晴天档**（#6/#7，半天）：themes.json `postfx` 字段 + runTheme 派生 + createPostFx 第 4 参。这是唯一「现状违规」，性价比最高。验收：晴天截图四角不再发闷、天空无脏点；其它主题（尤其 stormspire）截图零变化（缺省回退现值）。
2. **水洼相位明灭**（#4，1~2 小时）：puddle glow 改 Layer 套 glint 模式。验收：湿沙反光缓闪、无 additive 泛白。
3. **track.roadColor / railColor 可配**（#1，半天）：TrackColors 加两字段+两处读取+coast 配值。验收：护栏不刺眼、路面读作海岸公路（候选色实机对比后拍板，可以决定「保持深色沥青」——海边公路沥青本来也是深灰）。
4. **远景帆影/灯塔**（#2，半天）：新建 `coast/horizon.ts`（~100 行，×0.3 视差 +2~3 draw call）。验收：海平线有可读焦点物；`?debug` 探针核对 draw call 增量与帧率。
5. **rhythmZ 提升与接入**（#3，半天）：提升到 sceneryProps.ts 共享，coast 四类侧景换节奏。验收：跑动中 240m 内可读出「密段/开阔段」交替；`tsc -b` + 全仓测试绿。

每条验收都跑：`npx tsc -b` + 全仓测试套件 + `?debug` 探针（draw calls/triangles，`runDebugProbe.ts`；注意 composer 路径下 draw 计数失真——brief:273 已知折中，wx/降级路径才准确）。

---

## ④ 波次计划（对照雷脊三波）

| 波次 | 内容 | 对标雷脊 | 规模 | 验收 |
|---|---|---|---|---|
| **Phase 1 · 参数与材质级** | ① 后处理晴天档（暗角 0.12/颗粒 0/bloom 0.22/联动减半）；② 水洼微闪；③ 路面/护栏色可配 | 雷脊第二波「质感」（postfx 建）的反向操作：coast 要**减** grade 不是加 | ~1 天 | 晴天截图对比：通透感提升、其它主题零漂移；738 测试全绿 |
| **Phase 2 · 构图级** | ① rhythmZ 侧景八段疏密（灌木/花草/椰树/礁石）；② 远景帆影+灯塔（景深第三层焦点物）；③ 海风痕一层（≤12 条 alpha≤0.2） | 雷脊第一波「构图」（三层雨/剪影带/疏密节奏）的晴天版：只取「景深与节奏」，弃「雨与光柱」 | 1~2 天 | 跑动视频：远景有焦点、侧景有呼吸；wx 真机帧率不回退 |
| **Phase 3 · 大工程（可选）** | ① 晴天微弯 world-bend（幅度减半周期加倍 + 三个手写 shader 手接 + toon 注入实机验证）；② 若品牌评审通过，可议「沙滩高差/沙丘」类 Phase B 项（需动视觉层假高差，超出本文范围） | 雷脊第三波「大工程」（world-bend） | 2~3 天 | 弯道呼吸不晕、判定区 18m 恒直复核实机验证 |

**新增资产预算表**（Phase 1/2 新增件对照 brief §8「资产｜数量｜呈现方式」口径；数量是地板不是目标）：

| 新增资产 | 数量地板 | 呈现方式 | draw call 增量 | 所在波次 |
|---|---|---|---|---|
| 水洼明灭层 | 1 个 Layer（18 片摆位复用既有 puddles 列表） | puddle 的 glow 桶静态 InstancedMesh 改 kit Layer，逐实例 tint 相位明灭（复用 glint 模式 `coastProps.ts:177-184`） | ±0（1 个批次换 1 个批次） | Phase 1 |
| 海平线帆影 | 3~5 艘（地板 3） | `coast/horizon.ts` 合并几何 InstancedMesh，×0.3 半速视差、300m 回收带 | +1~2 | Phase 2 |
| 灯塔岛剪影 | 1 座 | 并入 horizon.ts 与帆影共享几何/批次 | 0（计入上行的 2~3 预算内） | Phase 2 |
| 海风痕 | 1 层、8~12 条（地板 8） | kit Layer 细长白条，普通透明 alpha ≤0.2（P.mist 色） | +1 | Phase 2 |

合计新增 ≤4 批次，与 §5.6 性能护栏口径一致；Phase 3 若做假弯道为纯 shader 改造、无新增资产。

依赖关系：Phase 1 无依赖先行；Phase 2 的 rhythmZ 依赖工具函数提升（半天前置）；Phase 3 强依赖品牌评审拍板（治愈向要不要弯）与 toon 注入验证。

---

## ⑤ 风险与「该场景品牌不许破坏什么」

**品牌一句话：通透、柔和、干净的晴天海。雨夜的一切「压暗、加脏、变湿」手段反向适用于它。**

1. **头号风险：雨夜 grade 正在污染晴天画面**（#6，证据链 `postfx.ts:21-29` + `runnerScene.ts:102-103`）。暗角 0.28 与颗粒 0.035 是 stormspire「雨夜质感」的参数，coast 作为 live 默认主题每天都被它们压着——Phase 1 必须最先做。
2. **不许开的系统清单**（每条都有明确门控证据，现状全部正确，保持）：三层雨/涟漪/雨点溅花（`atmosphere.ts:1-10`）、路面水洼 roughnessMap（`trackVisuals.ts:176-181`）、湿路倒影条带（`trackVisuals.ts:201-221`）、stormspire 冷色 IBL（`runnerScene.ts:100`）、障碍雷暴皮肤（`obstacleSkin.ts:10-13`）、环境闪电（`themes.json:10` [9999,9999] 保持）。
3. **通透感参数红线**：雾色 `#CFE9F6` 不改浑浊方向（`themes.json:11` 的 fog.color，消费方 `runTheme.ts:52` → `runnerScene.ts:88` 线性 Fog 与 `:106-107` 天穹地平线色）；FOG_NEAR 22/FOG_FAR 120 是「障碍 3 秒外可见」的玩法口径（`runnerScene.ts:62-63`）不动；海面 haze 收边带 smoothstep(60,190)（`sea.ts:50`）别压近——这三处共同构成「远处融进天光」的通透底座。新增远景件靠半速视差做纵深，**不靠加雾**。
4. **发光纪律**：coast 是三渲二多色陈设（`palette.ts:15-19` 室内书脊五色/挂画三色），与雷脊 7 色纪律不同源，**不要用 7 色标准去砍室内陈设**；但要守现行事实口径「动态发光只认室内暖光 strip 一种」（呼吸灯带 `coastProps.ts:194-201` 是唯一周期性发光动件，glint/sheen 是反光不是发光）。新增远景件**禁 additive 光柱**（雷脊 skyline 信标光柱的晴天版不存在）。
5. **动效资产别动**：海面 shader（起伏/波光/水线/雾收四合一，`sea.ts:18-55`）、海鸥绕飞扇翅、草灌双桶同摆位风摆、sheen 玻璃反光——这四组是场景已定稿的品牌动效（themes.json:22 版本记录「六组轻量化动效」），审计全部保留，未列入任何改动项。
6. **性能护栏**：侧景现约 27 绘制批次（静态清点 §1.2）；新增件控制在 ≤4 批次（雷脊 skyline 全带只 4 批次，`skyline.ts:11`）。铁律沿用：InstancedMesh+确定性 rnd、每帧零分配（Layer 模式已保证）、coast 自家 LOOP=200/WRAP_Z=18 绕回（`coastProps.ts:25`）、单文件 ≤300 行（coastProps.ts 已 237 行，新内容一律新建文件）。
7. **wx 端一致性**：postfx 在 wx 自动降级为裸渲染（`postfx.ts:9-11,109-115`），「晴天档」grade 只在非 wx 端可见——与现状（雨夜 grade 同样只在非 wx 端生效）一致，可接受；但意味着 wx 端永远看不到 Phase 1 的改善，若要 wx 端也通透，唯一手段是调灯光/配色而非 postfx（待实机验证取舍）。
8. **已知既有矛盾（不在八条内，仅记录）**：玩法 zap 障碍致死会触发 lightning.strike 全场冷白闪（FLASH_TINT 0xcfe4ff，`runnerScene.ts:162-165`、`lightning.ts:25`）——「晴天打雷白屏」是全主题玩法件的既有穿帮，属玩法域，本审计不建议动；若要处理应由玩法侧统一拍板。

---

## 遗留疑问（需拍板）

1. 路面色：保持深色沥青（海边公路合理）还是改浅水泥色？候选值需实机截图对比。
2. postfx 晴天档建议值（暗角 0.12/颗粒 0/bloom 0.22）是起点，需实机验证微调。
3. Phase 3 晴天微弯做不做（治愈向品牌评审）。
4. 障碍默认盘「彩盒+二次元海报」（adPosters）在海岸晴天是否出戏——雷脊已为此建了 obstacleSkin 显式分支（brief:263），coast 若也要「沙滩版皮肤」是独立立项，超出本次八条范围。
