# 场景优化审计 — 黄昏渔港（scenery = "harbor"，theme_dusk_harbor，live）

> 审计日期 2026-11-08；2026-11-09 修订（采纳独立评审 4 条：桅杆间距勘误、lighting 药方补齐、湿路/弯道门控契约三场景统一、遗留疑问收拢成 §6）。对标标尺：`docs/stormspire-brief.md` §「三波视觉/构图整改」（2026-11-11，八条美学：引导线 / 三层景深 / 疏密节奏 / 湿路反射 / 分层雨 / 后处理克制 / 冲刺镜头联动 / 假弯道）。
> 审计方法：通读 `packages/game/src/render/harbor/`（全部源码，仅 1 个文件）、`config/themes.json` 的 `theme_dusk_harbor` 条目、以及八条美学涉及的全部全局系统源码（sceneryProps / trackVisuals / runnerScene / runTheme / postfx / worldBend / atmosphere / roadTex / env / obstacleSkin / skyline / bridge / entityLayers / adPosters / lightning / cameraRig）。每条结论都给出 `文件:行` 证据；未实机跑的数字标注「待实机验证」。

---

## ① 现状清单

### 1.1 接入链与配置面

| 项 | 现状 | 证据 |
|---|---|---|
| 主题条目 | `theme_dusk_harbor`（live）：sky #E8935C / fog #E8B27E / groundColor #C98D5A / vfxTint #FFD9A8 / `scenery: "harbor"` | `config/themes.json:44-63` |
| 侧景注册 | `SCENERY_SETS.harbor = createHarborProps` | `packages/game/src/render/sceneryProps.ts:209` |
| 场景源码 | **单文件** `render/harbor/harborProps.ts`，实测 **162 行**（工单口径「237 行」已过时） | `wc -l` 实测 |
| 灯光 | **无 `lighting` 字段覆盖** → 落到缺省「白日海滨」光：hemiSky 冷蓝 `#bfe3ff` / hemiGround `#d8c39a` / 1.15，key `#fff2d0` / 1.9（黄昏橙景压冷蓝天光，色温失配）——**行动项见 ④ Phase 1 灯光定调** | `themes.json:44-63`（无该字段）+ `runTheme.ts:57-65` |
| 环境闪电 | `flashEveryS: [9999, 9999]` = 关闭（黄昏晴天，合理） | `themes.json:51` + `runTheme.ts:70-71` |
| 障碍皮肤 | harbor 不在 `stormspire` 显式分支内 → skin 恒 null，走「彩盒 + 二次元海报」默认盘 | `entityLayers.ts:62-66`；海报面片**全主题生效**（无门控）：`entityLayers.ts:164-196` + `adPosters.ts`（全文无 scenery 判定） |
| 金币质感 | envMap 仅 stormspire 门控 → harbor 金币为默认漫反射 | `coinField.ts:34`、`runnerScene.ts:110` |
| **死配置** | `fog.density` 无任何消费方（runnerScene 用线性 `THREE.Fog`，`FOG_NEAR 22 / FOG_FAR 120`）；`track.railMat` / `track.groundTiles` 同样无消费方（路面/护栏全程序化） | `runnerScene.ts:63,88`；`trackVisuals.ts:52-81,223`；全仓 grep 无命中 |

### 1.2 侧景构成（七类组件，全部 InstancedMesh + 确定性 rnd + 240m 循环）

| 组件 | 布点 | 证据 |
|---|---|---|
| 远景剪影带（城市块 + 门式起重机） | 两侧 `|x|≈27`，every 16m；1/3 处加 4 件式门吊 | `harborProps.ts:116-124,33-48` |
| 渔船桅杆 | 仅左舷 `|x|≈16`，every 23m | `harborProps.ts:127-133`（:129 `row(side, 16, 23, …)`，16 是横向 x、every=23） |
| 长仓库（弧顶+大门+高窗） | 两侧 `|x| 13.5/15.5`，every 47/53m | `harborProps.ts:141-142,51-65` |
| 集装箱堆（2~3 层错缝撞色 6 色） | 两侧 `|x| 11.2/12.4`，every 17/21m | `harborProps.ts:143-144,68-80` |
| 栈桥灯柱 | 两侧 every 34m | `harborProps.ts:91-96` |
| 系船柱 | 两侧 every 11m | `harborProps.ts:83-88` |
| 油桶 + 渔网架 | 仅右舷 every 19/27m | `harborProps.ts:99-113` |

**draw call 静态清点**：源码里 21 处 `addInst` 调用点（`grep -c` 22 减去 import 1 处），按实际调用次数展开：门吊 4 部件（双腿×2/横梁/悬臂）×2 侧=8、仓库 4 部件×2 侧=8、集装箱 1×2=2、系船柱 2×2=4、灯柱 2×2=4、油桶网架 5、剪影块 1×2=2、桅杆 2——每处 addInst 一次收下该组件一整排布点（如门吊每侧 5 个布点批量进 4 个 InstancedMesh，`harborProps.ts:122-123`），再加 `addShadow` 展开 4 个假投影（仓库 2、集装箱 2），合计 **39 个 InstancedMesh ≈ 39 draw call**（侧景层）。文件头自述「约 20 个 draw call」（`harborProps.ts:8`）约为实际一半。轨道全局层另有天空穹顶/地面/路面/4 车道线/2 护栏/48 流动虚线 ≈ 57 条（`trackVisuals.ts:159,169,183,193,226,233-236`）。**精确每帧总数未实机验证**——`?debug` 的 draw 计数在 postfx composer 路径失真（只统计链尾 pass，`stormspire-brief.md:273`；而 postfx 是全主题启用的，见 §1.3）。

### 1.3 已自动受益的全局系统（harbor 零改动即享）

- **后处理链**：bloom 0.32/阈值 0.82 + 暗角 0.28 + 颗粒 0.035，**全主题启用**，wx/非 WebGL2 自动降级（`runnerScene.ts:102-104`、`postfx.ts:21,107-115`）。
- **冲刺联动**：FOV 扩张（`runnerScene.ts:53,218`）、镜头微颠簸 0.03m 仅地面态（`runnerScene.ts:215`）、postfx 暗角/饱和/bloom 三参数 lerp（`postfx.ts:154-160`）、speedLines 色随 vfxTint（`runnerScene.ts:118`）。
- **锥形引导车道线**：远窄近宽 + 距离渐变 alpha，色 = vfxTint `#FFD9A8`（`trackVisuals.ts:87-93,187-194`）。
- **空气透视**：线性雾 22~120m + 天空穹顶（zenith=sky.baseColor、horizon=fog.color）（`runnerScene.ts:88`、`trackVisuals.ts:30-43,107-108`）。
- **障碍疏密节奏**：laneBlock `"0":22` 喘息档与四档池 breather 权重是全局配置，不按主题分（`config/obstacles.json:1271-1275,1187-1247`）→ harbor **已经吃到**，此项无需动作。
- **world-bend 注入但不驱动**：`std()` 工厂已把弯道注入 harbor 全部侧景材质，但无主题调用 `setWorldBend` ⇒ uniforms 恒零恒等（`sceneryProps.ts:33-40`、`worldBend.ts:84-85,102-105`、唯一驱动点 `stormspireProps.ts:68`）。

### 1.4 零动效 & 两处自相矛盾

- `update(move)` **完全忽略 `t`**（`harborProps.ts:151`；接口签名 `sceneryProps.ts:156`）→ 全场纯静态滚动：灯不闪、桅杆不晃、渔网不动。对比 konbini 七组手写动效、雷脊风车/涟漪/呼吸件。
- 注释说远景剪影「单侧一排即可，两侧都摆会盖住雾色地平线」（`harborProps.ts:115`），代码却两侧都摆（`harborProps.ts:138-139`）——注释与实现矛盾，需实机裁决谁对。
- 桅杆和门吊立在沙色地面上：场景里**没有海面**（地面是单一 60m 宽平面，`trackVisuals.ts:165-169`），「渔港」缺水。

---

## ② 八条美学逐条差距表

| # | 美学项 | 现状（证据） | 差距 | 开闸哪个现成系统 | 具体改法（文件 + 配置字段） |
|---|---|---|---|---|---|
| 1 | **引导线** | 锥形车道线全主题生效，色 #FFD9A8（`trackVisuals.ts:87-93,187-194`）；但流动虚线色**硬编码冷蓝** `0x40598c`（`trackVisuals.ts:231`），不随主题 | 冷蓝虚线压在 #C98D5A 暖沙地上的违和感**待实机验证**；侧景缺一个纵向收束的远景焦点物（港口天然答案是灯塔） | skyline.ts 信标光柱配方（1×16 渐变 alpha 竖片，`skyline.ts:20-34,85-92`） | 快赢：`trackVisuals.ts:231` dashMat 色改随 `colors.tint` 或暖色；Phase 2 加一座灯塔（杆+灯头+光柱三实例，复用 skyline 光柱材质）放在远剪影带制高点 |
| 2 | **三层景深** | 五层道具**全部同速 ×1.0** 滚动（`harborProps.ts:151-160` 对每个 inst 统一 `p.z += move`）——x≈27m 的远景剪影与 x≈3.9m 的系船柱同速后退 | 纵深全靠 x 间距撑，没有视差；「海平面缓慢流动」的港口感出不来。雷脊靠 skyline ×0.3 / 云墙 ×0.55 / 近景 ×1.0 三档速度拉开（`skyline.ts:113-114`、`stormspireProps.ts:78-84`） | `skyline.ts` 的矩阵自管 + 半速视差配方（`skyline.ts:9,104-110`） | `harborProps.ts`：把 far 剪影带 + 桅杆拆成自管数组按 `move * 0.45~0.55` 推进（仿 `skyline.ts:104-110` 的 advance 写法），仓库/集装箱/灯柱/小件保持 ×1.0。注意半速层的回收带要独立（`skyline.ts:36` 的 BAND=300 口径） |
| 3 | **疏密节奏** | 障碍层全局已生效（`obstacles.json:1271-1275,1187-1247`），**此项 harbor 已开闸**；但侧景摆位全是等间隔+微抖（`row()` 等距，`sceneryProps.ts:60-72`；仓库 every 47/53、灯柱 every 34、系船柱 every 11，`harborProps.ts:85,93,141-142`） | 跑 240m 视觉密度恒定，没有「密一段、喘一段」的构图呼吸。雷脊侧景用 rhythmZ 240m 切 8 段密×0.7/疏×1.45（`bridge.ts:32-49`） | `bridge.ts:rhythmZ`（建议提为 `sceneryProps.ts` 共享 util，konbini/coast 可复用） | harborProps 各组件的布点从 `row()` 换成 rhythmZ 产出的 z 列表 + 原 rnd 抖动（各组件类错开 phase，同 `bridge.ts:92,106` 口径）。半天级改造，风险低 |
| 4 | **湿路反射**（雨后码头，本场景最大提升点） | 路面是普通 `MeshStandardMaterial roughness 0.85`，**无 roughnessMap、无 envMap**（`trackVisuals.ts:171-183`；stormspire 分支 `176-181`、倒影条带分支 `201-221` 均未进）；金币无金属质感（`coinField.ts:34`）；场景无水面（§1.4） | 「雨后码头」的招牌味完全没有：路面无水洼、灯光无倒影、金币无环境反射 | ① `roadTex.ts` 的 `makeRoadRoughnessTexture(roadWidth)` **签名本就主题无关**（`roadTex.ts:28`）；② 倒影条带配方 `trackVisuals.ts:201-221`（色随 vfxTint=暖金，正好是晚霞味）；③ PMREM envMap 配方 `env.ts:34-50`；④ konbini/bridge 光池 DataTexture（`bridge.ts:52-68`） | themes.json harbor 条目加自定义字段 `"wetRoad": true`（schema 全放开）；`trackVisuals.ts:156` 把弯道加密的 `deep` 与湿路的分支解耦：新增 `const wet = wetRoad === true`，`176-181` 与 `201-221` 两个分支改吃 `wet`；`runnerScene.ts:100` 的 envMap 门控同步改读配置，`env.ts` 的 `buildStormEnvScene`（`env.ts:14-31`）参数化天顶/地平色（harbor 用 #E8935C 天顶 + #FFD9A8 金带）；`coinField.ts:34` 门控同扩。**门控契约（三场景统一）**：harbor/coast/konbini 三份审计统一走 themes.json 自定义字段方案——与 `lighting` 先例同构（`themes.json:73` → `runTheme.ts:57-65`），未列名主题零漂移；schema 各层 `additionalProperties: true` 已核实（`schema/config.schema.json:25-151`）。konbini-audit ②-1 的 `WET_THEMES` 代码常量方案作废（与 konbini-audit ②-1 择一时以配置字段为准）。**水面平面**（海侧 y=-0.01 长条 + 倒影）另列 Phase 3 |
| 5 | **分层雨 / 氛围** | harbor **零氛围层**（`harborProps.ts` 无任何粒子/雾带/风件）；雨后设定**不该下雨**（品牌） | 缺海面水汽：低层薄雾带与风痕是雨后港口的空气感来源；雷脊有 2 条贴地薄雾 + 12 条风痕（`atmosphere.ts:97-110,202-234`） | `atmosphere.ts` 的 `addMist` / `addWindStreaks` 配方整段可抄（`atmosphere.ts:96-109,200-234`） | 新建 `render/harbor/atmosphere.ts`（薄雾 2 条改暖雾色 #E8B27E 系、风痕 12 条、可选海侧雾团 6~9 团）；在 `harborProps.ts` 接线——dt 用 t 差分口径（`stormspireProps.ts:65-70`），`update` 签名补 t |
| 6 | **后处理克制** | postfx 全主题已启用且参数克制（bloom 阈值 0.82 只捞自发光，`postfx.ts:21,6-7`） | 港口的「该发光物」**不是自发光**：灯头 `std(LAMP_HEAD)`（`harborProps.ts:95`）与仓库高窗条 `std(0xffd9a0)`（`harborProps.ts:62-63`）都是 Lambert 漫反射——黄昏里亮度够不到 0.82 阈值，bloom 捞不着 ⇒ 暖灯不晕光，夜景味少半档 | obstacleSkin 的发光件口径：MeshBasicMaterial 直出（`obstacleSkin.ts:42`） | `harborProps.ts:62-63,95` 两处改自发光：保留 Lambert 但 `mat.emissive.setHex(0xffd9a0)`（emissive 不吃光照、进 bloom），或换 `MeshBasicMaterial` + `applyWorldBend`（同 `obstacleSkin.ts:42-44` 口径，防止日后开弯道分家）。**纪律：发光只认暖橙一种**（对齐雷脊 §2 规则，`stormspire/palette.ts:5`） |
| 7 | **冲刺镜头联动** | FOV / 微颠簸 / postfx 三参数联动 / speedLines 全部全主题生效（§1.3） | **无差距**（记录为已开闸，无需动作） | — | — |
| 8 | **假弯道** | `std()` 已注入 harbor 侧景材质但从不驱动 ⇒ 恒零恒等（`sceneryProps.ts:33-40`、`worldBend.ts:102-105`）；trackVisuals 的 `deep` 分支（长面片加密 + road/ground/线/栏/虚线注入）也仅 stormspire（`trackVisuals.ts:156,182,189,241-247`） | 港口铁道直线到底，引导线没有雷脊那套 88.5s/118.6s 呼吸（`worldBend.ts:103-104`） | `worldBend.ts` 全套（注入已就位，缺的只是「驱动」与「轨道层注入」） | themes.json harbor 加 `"bend": true`；`runTheme.ts:74-77` 的 RunStage 增加该字段透传；`trackVisuals.ts:156` `deep` 改读配置；`harborProps.ts` 的 update 调 `setWorldBend(t)`。门控契约同 §2-4 注：`bend` 走 themes.json 字段，不走 konbini-audit ②-8 的 deep gate 加名方案（三场景统一配置字段，`deep` 内部实现改为读该字段）。⚠️ 但「晴天通透的黄昏铁道」是否需要弯道是**品牌决策**，建议放 Phase 3 并实机裁决（见 §5、§6-3） |

**附加差距（八条之外，但属同标尺的「近景密度」教训）**：雷脊三轮整改的起点是用户评语「只有形状没有细节，不如雨夜便利店」（`stormspire-brief.md:250`）。harbor 现在正是这个状态：近景小件只有油桶/渔网架两种（`harborProps.ts:99-113`），且仅右舷；无光池、无光斑。开闸件：bridge 光池贴图（`bridge.ts:52-68`）+ lamp 配方（konbini `lamps.ts` 光池/光晕跟臂尖走）。

---

## ③ 快赢清单（每项 ≤ 半天，互不依赖）

1. **暖灯自发光**：`harborProps.ts:62-63,95` 改 emissive/Basic——黄昏灯头立刻进 bloom，画面提升最大的单行改动。
2. **湿路水洼开闸**：themes.json 加 `"wetRoad": true` + `trackVisuals.ts:156,176,201` 门控从 `scenery === 'stormspire'` 扩为读配置（roadTex 本就主题无关；契约见 §2-4 注）。倒影条带顺带拿到（同分支）。
3. **虚线色随主题**：`trackVisuals.ts:231` 一行（先实机确认冷蓝是否真违和再动）。
4. **rhythmZ 疏密**：`bridge.ts:38-49` 移植进 harborProps（或提为共享 util），替换 3~4 处 `row()` 布点。
5. **注释/实现矛盾修正**：`harborProps.ts:115` vs `138-139`，实机截图裁决两侧剪影是否盖地平线，改注释或改代码。
6. **薄雾带**：抄 `atmosphere.ts:97-110` 两条暖雾（新文件 ~60 行）。
7. **draw call 实测**：`?debug` 计数在 composer 路径失真 → 临时用 `renderer.info` 直读或 Spector 实测 harbor 全帧 draw call，把 §1.2 的静态清点钉成实数（`stormspire-brief.md:273` 同款遗留）。

---

## ④ 波次计划（对照雷脊三波）

**Phase 1 · 湿路与光（对雷脊第二波）** —— 主题：雨后码头的「亮」。快赢 1/2/3 + **灯光定调**：themes.json harbor 加 `lighting` 字段（机制现成：stormspire 先例 `themes.json:73` → `runTheme.ts:57-65` 读取；coast-audit ②-1 同款接法）——hemiSky 由缺省冷蓝 `#bfe3ff`（`runTheme.ts:60`）改黄昏青蓝、hemiGround 贴 groundColor 暖反射、key 改低角度暖橙并降强度（方向：hemiSky 取天空色同族青调、key 偏 `#FFC98F`；色值/强度实机调，A/B 对比见 §6-5）。本审计采「加字段」而非「维持白日光」：黄昏主题压白日冷蓝天光是明确失配；若实机对比后更认可现状，则显式回退并在 themes.json 注明——二选一在 Phase 1 落定，不许悬置。再加 envMap 参数化（`env.ts:14-31` 加色参，harbor 传黄昏配色）+ `coinField.ts:34` 门控扩展（金币抛光金，晚霞反射）。验收：湿路水洼 + 车道线倒影 + 暖灯光晕 + 金币反光 + 灯光定调五件齐；`tsc -b` 与全仓测试绿；wx 裸渲染路径回归（postfx/PMREM 降级门不变，`postfx.ts:107-115`）。

**Phase 2 · 景深与呼吸（对雷脊第一波）** —— 主题：构图。快赢 4/5/6 + 远景视差分层（§2-2）+ 灯柱光池（bridge 光池贴图）+ 近景小件加密（缆绳卷/货板/鸟群剪影，左舷补齐）。验收：240m 一圈内有可感的疏密与远缓近急；draw call 增量 ≤ 6（守住轻量定位）。

**Phase 3 · 品牌件（对雷脊第三波的大工程位）** —— 主题：渔港的签名。按性价比排序：
1. **海面**：海侧（x ≈ ±12~30 带）暖橙海面长条 + 天空反射 + 桅杆改「浮在船上」（船体剪影实例）；这是把「集装箱堆场」变成「渔港」的定性改造（`trackVisuals.ts:165-169` 的地面不动，海面叠 y=-0.01，z-fighting 待实机验证）。
2. **灯塔**：远剪影带制高点一座灯塔 + 旋转光束（skyline 光柱材质改绕 y 旋转实例）。
3. **障碍渔港皮肤**（可选）：走 `obstacleSkin` 显式分支模式（`entityLayers.ts:62-66` 复制口径；harbor 加 `harbor/obstacleSkin.ts`），集装箱皮/缆桩皮/渔网架皮；判定零改动（`obstacleSkin.ts:1-15` 的分工与铁律照抄）。⚠️ 海报默认盘对 harbor 的违和度先实机截图评估，值不值一个新皮肤模块由截图定。
4. **假弯道**（最靠后）：§2-8 改法就绪后实机裁决；黄昏渔港的「通透直线感」可能比弯道更值钱。

---

## ⑤ 风险与「该场景品牌不许破坏什么」

1. **晴天的通透感是第一红线**。harbor 的身份是「黄昏晴天港口」：雾只许线性 22~120m 微调、不许改 FogExp2/加浓雾带；postfx 参数是全局克制口径（暗角 0.28），不许给 harbor 单独压暗/加棕褐滤镜。一切氛围件（薄雾/风痕/海面雾团）保持 alpha ≤ 0.12 档（对齐 `atmosphere.ts:100` 的 0.10/0.07）。
2. **轻量是它的部署价值**。「全仓最轻」是 harbor 在场景矩阵里的生态位（低端机兜底主题）；每波改造给出 draw call 增量上限并实测（Phase 1 ≤ +4、Phase 2 ≤ +6、Phase 3 海面 ≤ +3）。静态清点 39 条已在 §1.2，改造前后同口径计数。
3. **橙青调纪律，发光只认一种**。现发光候选只有暖橙 0xffd9a0（灯头/高窗，`harborProps.ts:25,62-63,95`）。抄雷脊/熔炉的纪律（`stormspire/palette.ts:5`、`forgeheart-brief.md` §2）：自发光只许暖橙一种，青色只许出现在剪影/集装箱撞色（`harborProps.ts:19,22`）里作漫反射，不开青色发光。
4. **障碍全主题通用铁律**。任何障碍皮肤走显式分支（`entityLayers.ts:62-66` 模式），判定尺寸零改动（`obstacleSkin.ts:2-5`）；海报注入与否不改变判定与拾取。
5. **海侧元素不进判定带**。海面/船只/桅杆保持在 `|x| ≥ 10`（现有最近道具系船柱 x≈3.9、灯柱 4.9，`harborProps.ts:85,93` 是近界），水面从 x≈±12 起坡，视觉贴着现有布带走，不给玩家「能跑过去」的错觉。
6. **确定性与零分配不回退**。新动效一律确定性 rnd + 相位锁（禁 Math.random 进摆位）、每帧零分配（`atmosphere.ts:20-25` 的口径），dt 用 t 差分（`stormspireProps.ts:69`）；半速视差层的回收带独立核算，防止与 ×1.0 层接缝错位露馅。

---

## ⑥ 遗留疑问与需拍板项（2026-11-09 修订收拢）

| # | 事项 | 原出处 | 需要什么 |
|---|---|---|---|
| 1 | 流动虚线冷蓝 `0x40598c` 压 #C98D5A 暖沙地是否违和 | §2-1 / 快赢 3 | 实机截图确认后再改 `trackVisuals.ts:231` |
| 2 | 障碍默认盘二次元海报（`adPosters.ts` 无主题门控，全主题生效）对橙青工业港的违和度 | 附 / ④-3.3 | 实机截图评估 → 决定 Phase 3 是否做渔港障碍皮肤 |
| 3 | 假弯道是否适用「晴天通透黄昏铁道」 | §2-8 ⚠️ / ⑤ | 品牌拍板（Phase 3 实机裁决） |
| 4 | 海面平面与地面的 z-fighting | ④-3.1 | 实机验证 y=-0.01 抬量是否稳定盖住地面（地面 y=-0.02，`trackVisuals.ts:169`） |
| 5 | `lighting` 字段色值/强度，与「维持白日光」的 A/B 对比 | §1.1 / ④ Phase 1 | 实机定稿；两案不许悬置 |
| 6 | 远景剪影注释（单侧，`harborProps.ts:115`）与实现（两侧，`138-139`）矛盾 | 快赢 5 | 实机截图裁决改注释还是改代码 |
| 7 | 侧景 39 draw call 静态清点钉成实数 | 快赢 7 / §1.2 | `?debug` 计数在 composer 路径失真（`stormspire-brief.md:273`），需直读 `renderer.info` 或 Spector |
| 8 | 门控契约三份对齐：harbor/coast 已统一配置字段方案，konbini-audit ②-1（`WET_THEMES` 常量，konbini-audit.md:63）/②-8（deep gate 加名）待按同契约修订 | §2-4 / §2-8 注 | 另两份文件修订不在本次范围（本次仅改 harbor-audit.md），列待办 |

---

## 附：本次审计读过但未改变结论的事实

- `config/themes.json` 全文（81 行）：harbor 条目无 `lighting` 字段；stormspire 条目有（`themes.json:73`），是 lighting 覆盖的现成参照。
- `lightning.ts` 全文：harbor `flashEveryS [9999,9999]` 关闭，闪电三段式不涉及；zap 障碍的雷击表现仍会触发（`runnerScene.ts:157,164`），与主题无冲突（黑盘黄电，非场景品牌件）。
- `docs/stormspire-brief.md` 全文（279 行）：三波整改记录在 §「三波视觉/构图整改」（268-273 行），是本审计的标尺与积木清单来源。
- 障碍海报全主题生效（`entityLayers.ts:164-196` + `adPosters.ts` 无门控）：这是 harbor 视觉与「橙青工业港」品牌冲突的最大未知数，**待实机截图评估**后决定是否进 Phase 3 皮肤位。
