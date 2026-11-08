# 场景长期路线图（scene-roadmap）

> 汇编自六份文稿：`docs/scenes/{forgeheart,titan,library}-brief.md`（三个新场景蓝图）+ `docs/scenes/{coast,konbini,harbor}-audit.md`（三个存量场景审计）+ `docs/stormspire-brief.md`（已完成场景，成本基准与共享配方来源）。
> 排序标准：**实现成本 × 复用度 × 依赖关系**。本文给的是建议与默认答案（遗留疑问的默认拍板见 §6）；标注「估算」的数字未经实机验证，落地前以各文稿自己的验收口径为准。
> 编写日期 2026-11-09，基线分支 feat/stormspire-2026-11（雷脊 Phase A + 三波视觉整改已合入，738 测试绿，`stormspire-brief.md` §10 实施记录）。

---

## ① 场景长期目标一览表

> 任务口径说「六个场景（含雷脊）」；实际素材覆盖 **7 个场景**（雷脊 + 3 新蓝图 + 3 存量审计），本表按 7 个全列，不丢任何一份文稿。
> 当前主题表实测（`config/themes.json`：seaside_day live:8 / rain_konbini draft:27 / dusk_harbor live:45 / stormspire draft:65）；`SCENERY_SETS` 已注册 5 项（sceneryProps.ts:205-211）。

| # | 场景 | 一句话概念 | 签名机制 | 当前状态 | 长期目标（Phase B 终态） | 文稿 |
|---|---|---|---|---|---|---|
| 1 | **天穹雷脊 stormspire** | 云海之上驭雷者废墟，赛道是会动的岛链 | 三段式闪电 + 浮空岛链 + 铜环 | **Phase A 完成**（8 步 + 两轮细节整改 + 三波视觉整改，brief:248-273） | sim y 剖面真爬升俯冲、穿环计分、坍塌桥、蹬墙跳、专属 BGM（brief:275-279） | `docs/stormspire-brief.md` |
| 2 | **熔炉巨兽 forgeheart** | 活火山炉腔铸运堤道，山按班次表涨落 | 岩浆潮汐节拍器（144m/周期）+ 喷发 1s 红光预警（288m/次） | 蓝图完成，未开工 | tide(dist) 进 sim 单源 + 出生时潮汐感知放置（低潮开低路金币、高潮排密度）+ 喷发判定化（brief §12 矛盾 1 方案 A、§13 B-1~B-8） | `docs/scenes/forgeheart-brief.md` |
| 3 | **沉眠泰坦 titan** | 跑在巨神尸体脊沟上，尸体仍在呼吸 | 呼吸系统（远场 worldBend + 近场矩阵梯度）+ 420m 睁眼闩锁 | 蓝图完成，未开工 | sim 全局呼吸 y、睁眼事件化（awaken 事件 + 难度池切换）、肋拱穿越计分、蹬墙跳（brief §10.2 B-1~B-5） | `docs/scenes/titan-brief.md` |
| 4 | **失重图书馆 library** | 墨海上的缄默书城，倒悬书阁预告重力翻转 | 反重力区（翻转重力跑天花板，唯一 sim 大项）+ 书页风暴 | 蓝图完成，未开工 | zones/flip 全套（B-1~B-8：trackGen 区块实体→运动学→碰撞镜像→收集→事件→渲染）+ rotor 旋转门 B-10（brief §11.2） | `docs/scenes/library-brief.md` |
| 5 | **白日海景 coast** | 通透柔和晴天，日式治愈向三渲二 | 海面 shader + 六组轻动效（live 默认主题） | 存量，已审计 | 摘掉雨夜 grade（唯一现状违规）→ 构图（疏密/远景焦点）→ 可选晴天微弯；Phase 1~3 见 audit ④ 波次表 | `docs/scenes/coast-audit.md` |
| 6 | **雨夜便利店 konbini** | 雨夜街角霓虹，细节密度对标基准 | 三桶合并 Diorama + 七组微动效 | 存量（draft 主题），已审计 | 开闸现成系统（闪电/湿路倒影/水洼 roughnessMap）→ 分层雨纵深 → 障碍便利店皮肤（K-car 等，Phase 3） | `docs/scenes/konbini-audit.md` |
| 7 | **黄昏渔港 harbor** | 晴天通透黄昏，橙青工业港 | 全仓最轻主题（162 行单文件）| 存量（live），已审计 | 雨后码头的「亮」：暖灯自发光 + wetRoad 湿路 + 灯光定调 → 视差景深 → 海面（渔港缺水是定性缺陷，Phase 3） | `docs/scenes/harbor-audit.md` |

---

## ② 推荐实施顺序与理由

### 结论先行

```
M0-M1  老场景审计快赢（先做）        ← 半天~2天/项，且沉淀三张共享底座
M2     titan Phase A（新场景第一个）
M3     forgeheart Phase A
M4     sim 基建批次（雷脊 Phase B 玩法兑现 + 各场景 Phase B 前置）
M5     library Phase A
M6     library Phase B 反重力
M7     各场景品牌件与 Phase B 收尾（长期并行轨道）
```

**先老场景审计、后新场景蓝图**；新场景内部 **titan → forgeheart → library**。

### 为什么先做老场景审计的快赢

1. **coast 的 Phase 1 是修 bug 不是优化**。postfx 参数（暗角 0.28/颗粒 0.035）是 stormspire 雨夜口径的模块级硬编码（postfx.ts:21-29，`runnerScene.ts:102-103` 注释自证「参数不分主题」），coast 作为 **live 默认主题**每天都被它压着——coast-audit §⑤-1 定性为「头号风险：雨夜 grade 正在污染晴天画面」。live 主题带伤运行，优先级天然最高。
2. **成本差一个量级**。三份审计的快赢项全是「现成系统加门控」（konbini-audit ④：Phase 1 零新系统）：harbor 暖灯自发光是单行改动（harborProps.ts:62-63,95）、konbini 闪电开闸是一行配置（themes.json:29 `[9999,9999]`→`[11,24]`）、coast postfx 晴天档半天。而三个新场景 Phase A 各是 8~10 步、10 个新文件级工程。先用便宜的把 live 主题救回来。
3. **老场景快赢就是新场景的地基**（这是排顺序的决定性理由，不是顺带）。审计快赢清单里埋着三张共享底座，恰好是三个新蓝图 Phase A 点名要吃的：
   - **postfx 主题覆盖字段**（coast #6 开发，konbini #6、forgeheart §7.3 都是消费方）；
   - **rhythmZ 提升为 sceneryProps 共享 util**（coast #3 / konbini ⑥-1 / harbor ②-3 三份审计指向同一决定，新场景 brief 全部按「rhythmZ 直接复用」写——library-brief §8、titan-brief §3.2）；
   - **门控契约统一**：wetRoad/bend 配置字段（harbor ②-4/②-8 提出，konbini ⑥-8 确认 WET_THEMES 常量方案作废）+ env.ts 参数化（harbor Phase 1 开发，konbini Phase 2、forgeheart §7.4、library §11.1-9 抄用）。
   
   先做 M0-M1，新场景 Phase A 的共享改动就从「新写」降为「填配置」。

### 为什么新场景先开 titan

| 维度 | titan | forgeheart | library |
|---|---|---|---|
| Phase A 新增框架分支 | **零**（睁眼全部局部化，不接全局闪电，titan §4.1） | eruption 管线需 runnerScene 两处 scenery 分支（brief 矛盾 2 方案 B），**有未拍板取舍** | 零 |
| 复用存量配方 | 最高：statue.ts Lathe、skyline 尸影、creatures 群飞、bridge rhythmZ、atmosphere mist、worldBend 注入全照抄（titan §4.0/§10.0） | 高：契约「与雷脊完全同构」（brief:5），但潮汐驱动的逐帧改写件是全新写法（热熏带 instanceColor 逐帧重写，brief §4.2） | 中：atmosphere 三层循环池抄雨池配方，但书页风暴是 LineSegments→InstancedMesh quad 改造、光尘池无现成可抄（brief §6 表） |
| Phase A 体验闭环 | **完整**：呼吸 + 睁眼闩锁在 Phase A 就是完整叙事（brief §7 三幕） | 残缺：潮汐「Phase A 不判负」纯视觉（brief §8），招牌的「跟节拍跑」要 Phase B 方案 A 才成立 | 残缺：灵魂大项反重力全压 Phase B，Phase A 是「倒挂书城预告片」（brief §3.6） |
| 阻塞项 | 无（遗留疑问全是数值/可选项） | 喷发方案 B 需用户确认（见 §6-F2） | 无，但价值后置 |

补充两个反向论点，为何不成立：forgeheart 的 brief 确实同构度最高、12 defs 皮肤表最全，但它特有的两个非视觉系统（tide.ts + eruption.ts）和「预警必须可读」的硬需求让它比 titan 多一次拍板 + 多 ~180 行特效管线；library 便宜但便宜得没意义——它 Phase A 的可玩交付最薄，放后面不亏。

### 为什么 titan/forgeheart 之间插一个 sim 基建批次（M4）

三个蓝图的 Phase B 玩法项共享同一批 sim 前置（详见 §④-2）：stormspire y 剖面（brief:276）= forgeheart B-5（brief §13）≈ titan B-1（brief §10.2，明确写「同一工作项合并」）；stormspire 穿环计分 = titan B-3 穿越判定层（同一工作项）。**sim 层动骨一次（回放/golden 全量回归一次），覆盖全部场景**——分散在各场景里做就是回归跑三遍。批次放在 forgeheart Phase A 之后、library 之前，让 M5/M6 直接踩在基建上。

---

## ③ Phase A 模块数 / 工作量预估

**基准**：雷脊实码 `packages/game/src/render/stormspire/` **15 个 .ts 文件、2220 行**（ls + wc 实测；任务口径「14 模块」与实测差 1，差额来自整改轮自然拆分——第二轮整改新增 islandParts.ts、statue.ts，见 brief:260-262；首轮落地口径约 8~10 文件，brief §10 步骤 1-8）。

| 场景 | Phase A 新增模块（brief 步骤拆出的文件） | 模块数 | 共享代码改动 | 工作量（估算） | 主要风险 |
|---|---|---|---|---|---|
| **titan** | palette / bodyKit / mist / ribs / relics(含断剑) / skull / veils / creatures / titanProps(总装) / obstacleSkin（brief §10.1 步骤 3-8） | **10** | 4 处小改：trackVisuals deep 扩 titan、worldBend 加 setTitanBreath + 注释契约、flashTint scenery 分支、entityLayers 门控提 SKIN_BY_SCENERY 表（§10.1-2） | 首轮 3~4 天 + 预留一轮视觉整改（雷脊经验：整改轮 ≈ 首轮一半） | 顶点预算：全套解剖几何 ≤15k tri、动效改写 ≤200 实例/帧（§4.0 纪律 5 两笔账） |
| **forgeheart** | palette / tide(纯函数) / atmosphere(灰烬火星热流) / islands(柱阵渣滩) / landmarks(内壁炉心哑阀锻像) / props(吊桥引藤晶簇动件) / **eruption(~180 行)** / obstacleSkin / env / forgeheartProps（brief §13 步骤 2-8） | **10~11** | runnerScene 2 处 scenery 分支（方案 B）+ 可选 createPostFx scenery 入参（§7.3） | 首轮 4~5 天 + 整改轮；**前置：喷发方案 B 拍板**（§6-F2） | 潮位驱动的逐帧改写件最多（岩浆海/渣滩/热熏带 y+instanceColor 每帧重写）；eruption 是新特效管线 |
| **library** | palette / atmosphere(墨海墨雾书页光尘涟漪光波) / books(2000+ 册三 batch) / towers / gallery(near 排) / landmarks(万卷塔书梯拱门书阁) / creatures / obstacleSkin / env / libraryProps（brief §11.1 步骤 2-9） | **10** | entityLayers 对称分支（若 M2 已提表则零成本）+ env 门控一行 | 首轮 3~4 天 + 整改轮 | 顶点预算风险最高：书脊 2000+ 册 + 近景 120 件密度地板（§10），konbini 护栏 <66k tri 先例；draw call 总盘 ≤70（§9） |
| coast（审计波次） | 不建新模块，新建 horizon.ts ~100 行 | +1 文件 | postfx 第 4 参 + TrackColors 两字段 + rhythmZ 提升 | Phase 1 ~1 天 / Phase 2 1~2 天 / Phase 3 2~3 天（audit ④ 给出） | toon 材质与手写 shader 的 bend 注入待实机验证（#8） |
| konbini（审计波次） | 不建新场景模块 | 0（皮肤模块 Phase 3 才建） | addRainLayer 导出小重构 + postfx 字段消费 | Phase 1 ≈1 天 / Phase 2 2~3 天 / Phase 3 大工程（audit ④） | 顶点 <66k 测试护栏余量未知（②-2：先量后加） |
| harbor（审计波次） | 新建 atmosphere.ts ~60 行 | +1 文件 | wetRoad/bend 配置字段 + env 参数化 + lighting 字段 | 三波各 ≤2 天（draw call 增量上限 +4/+6/+3，audit ⑤-2） | 海面 z-fighting（⑥-4）、海报违和度待截图（⑥-2） |

> 工作量均标注为估算：依据是各文稿的步骤粒度（8~10 步、每步可独立验收）对照雷脊首轮 8 步的实际规模；「整改轮预留」来自雷脊实测记录（brief:250-265 两轮细节整改 + 三波视觉整改，用户验收驱动）。

---

## ④ 共享系统缺口清单

### ④-1 渲染/配置层缺口（Phase A 期间消化，多数已被 M0-M1 安排）

| 缺口 | 首个需求方 | 后续消费方 | 建议归属 |
|---|---|---|---|
| **postfx 主题覆盖字段**（createPostFx 加参 + runTheme 派生 + runnerScene 传参，缺省=现值） | coast #6（live 主题修伤） | konbini bloom 0.45 档（②-6）、forgeheart bloom 0.34/颗粒 0.04 微调（§7.3） | **M0** |
| **track.roadColor / railColor 可配**（TrackColors 接口加两字段，trackVisuals.ts:171/:223 改 `??` 回退） | coast #1 | 其它主题可白嫖（不改默认值零漂移） | **M0** |
| **rhythmZ 提升为 sceneryProps 共享 util**（剪切自 bridge.ts:38-53，bridge 改 import 零行为变化） | coast #3 | konbini ③-5、harbor ②-3；新场景 brief 全部按复用写 | **M0** |
| **wetRoad / bend 配置字段**（themes.json 自定义字段，schema additionalProperties 已核实；trackVisuals deep 解耦 + runTheme 透传） | harbor Phase 1 | konbini ②-4/②-8（WET_THEMES 方案作废）、coast Phase 3 | **M1** |
| **env.ts 参数化**（buildStormEnvScene 加天顶/地平色参） | harbor Phase 1 | konbini 冷蓝变体（Phase 2）、forgeheart §7.4 / library §11.1-9 抄配方 | **M1** |
| **flashTint scenery 分支**（runnerScene.ts:201-205 调用点按 scenery 取 tint；tint 本就是 lightning.ts:31-42 入参） | titan（暖金白 #FFE9B8） | forgeheart（暖橙 FORGE_TINT #FF8A50） | **M2**，建议提成 TINT_BY_SCENERY 小表一次到位 |
| **entityLayers 皮肤门控提成 SKIN_BY_SCENERY 工厂表**（现为 scenery === 'stormspire' 三元，entityLayers.ts:64） | titan（§10.0-2 推荐提表） | library/forgeheart/konbini/harbor 皮肤全部零成本接入 | **M2**（titan Phase A 步骤 7 顺带） |
| **闪电管线的场景化**：zap 致死冷白闪全主题穿帮（coast-audit ⑤-8 记录在案） | coast 记录 | forgeheart zap 走喷柱视觉（矛盾 2 方案 B 顺带解决一半） | 玩法域暂不动；forgeheart M3 顺带收敛 |

### ④-2 sim 层缺口（Phase B 前置，M4 一次批次消化）

| 缺口 | 前置需求方（同一工作项合并） | 规模与关键约束 |
|---|---|---|
| **sim 赛道 y 剖面** | stormspire B-1（brief:276）= forgeheart B-5（brief §13-5）≈ titan B-1（§10.2 自注「与 stormspire 同一工作项合并」） | sim 大项；需回放/golden 全量回归；titan 全局呼吸 y 是它的便宜变体（全体统一 delta，相对判定不变） |
| **穿越判定层** | stormspire 穿环计分（brief:277）= titan B-3 肋拱穿行/须发帘时机（§10.2-3，自注同一工作项） | 判定层扩展，判定口径零改动铁律不破 |
| **出生时潮汐感知放置** | forgeheart 矛盾 1 方案 A（brief §12，推荐方案） | 纯函数 dist 驱动，零运行时冲突、回放安全；依赖 tide(dist) 进 sim 单源（forgeheart B-1） |
| **sim 阶段事件机制** | titan B-2 睁眼事件化（awaken 事件进 drainEvents 管线 + 难度池切换） | titan Phase A 的渲染层闩锁先顶着，事件化后替换 |
| **反重力 zones/flip** | library B-1~B-8（唯一 sim 大项：trackGen zones→RunnerState flip→movement 重力项→collision 镜像→collect 镜像→SimEvent→渲染翻转→数值地板） | 必须从 (distance, seed) 推导，回放安全红线（library §11.2 前置原则）；随 M4 立设计稿、M6 实施 |
| **fog density → FogExp2 接线** | forgeheart B-8（density 是死配置——三份文稿各自核实：coast-audit ①-1 / konbini ① / harbor ①-1） | 小项，若炉腔包容感需要真密度雾才做 |
| **trackGen 主题门控口子** | library §11.3-3 询问是否给 trackGen 加主题字段读取 | **默认不开**（见 §6-L3）：障碍 pattern 池全主题共享是三份 brief 一致核实的既定契约（trackGen.ts:83-85 只建索引），疏密表达走渲染层 rhythmZ |

### ④-3 各场景独有的新系统（无共享价值，Phase A/B 各自做）

- **forgeheart**：`tide.ts` 节拍器纯函数单源（level/dist/surgeWindow 三导出）+ `eruption.ts` 反向三段式（地→天）+ distAcc 距离闩锁状态机（炉心回响尾声，brief §8 诚实说明）+ 热熏带逐帧 instanceColor 重写。
- **titan**：`setTitanBreath(t, amp)` 驱动器 + 幅度梯度矩阵呼吸（椎棘 ±0.05 → 胸廓 ±0.5 五档、4 帧轮写）+ 睁眼闩锁三件套（瞳孔 1.2s 渐起 + 眼窝点光 + 涟漪环）。
- **library**：书页风暴三层循环盒（LineSegments→InstancedMesh quad 改造）+ 翻页光波 + 光尘池（stormspire 无现成光尘可抄，brief §6 表已核实）+ Phase B 的 rotor 旋转门（B-10，一个谓词分支 + 一个皮肤槽）。
- **coast**：无独有系统（品牌=雨夜系统的反向克制）；Phase 3 若做微弯，需 sea/shallow/poolMat 三个手写 shader 手接 bend 公式 + toon 注入实机验证——全矩阵接入成本最高的弯道。
- **konbini**：动效七组已有；缺分层雨纵深（addRainLayer 参数化导出）+ 障碍皮肤模块。
- **harbor**：氛围层从零（薄雾/风痕，抄 atmosphere 配方改暖色）+ 海面平面 + 灯塔旋转光束（skyline 光柱改绕 y）。
- **stormspire**：Phase A 已毕；Phase B 玩法项（坍塌桥 chunk、蹬墙跳）是 y 剖面的下游。

---

## ⑤ 里程碑切法（每步交付可玩的东西）

| 里程碑 | 内容 | 可玩交付（验收时能看到什么） | 沉淀的共享系统 |
|---|---|---|---|
| **M0 晴天不再发闷** | coast Phase 1：postfx 晴天档 + 水洼微闪 + roadColor/railColor 字段落地（色值先零漂移）+ rhythmZ 提升 | 打开默认主题，四角不发闷、天空无脏点（coast-audit ③ 快赢 1/2/3 的验收口径） | postfx 主题字段、TrackColors 扩展、rhythmZ util |
| **M1 三老店各回各味** | harbor Phase 1（暖灯自发光 + wetRoad + lighting 黄昏定调 + env 参数化）；konbini Phase 1（闪电开闸 + 车道线倒影 + 水洼 roughnessMap + 薄雾 + 灯距节奏）；coast Phase 2（远景帆影灯塔 + 海风痕 + 四类侧景换 rhythmZ） | harbor 黄昏灯头进 bloom、雨后码头有水洼倒影；konbini 雨夜有雷、脚下有反光；coast 海平线有帆影、侧景有疏密呼吸 | wetRoad/bend 配置字段、env 参数化（titan/forgeheart/library 直接受益） |
| **M2 巨神醒了** | titan Phase A 全量（brief §10.1 步骤 1-9） | 设置面板切 titan：静立 10s 能看到远方尸身起伏、肋拱张合；跑到 420m 瞳孔亮起、眼窝点光、涟漪环，之后每圈他都是醒着的 | SKIN_BY_SCENERY 表、flashTint 表、worldBend 双主题驱动契约 |
| **M3 山按拍子喷发** | forgeheart Phase A（前置：方案 B 拍板，见 §6-F2） | 切 forgeheart：216~252m 第一次喷发——阀轮亮起 → 一秒红光 → 喷柱 ×3 → 全场闪橙；潮汐涨落可读、炉心每 144m 心跳一次 | eruption 管线（LightningFx 同接口，可复用的场景化特效先例） |
| **M4 赛道真的会动** | sim 基建批次：y 剖面 + 穿越判定层 + titan 全局呼吸/睁眼事件化 + 潮汐感知放置 + 反重力 zones 设计定稿 | stormspire 兑现 Phase B-1/2：真爬升螺旋坡道、俯冲宽瀑滑道、穿环得分；titan 睁眼由 sim 事件驱动 | 一次 golden/回放回归覆盖全部场景的 Phase B 玩法地基 |
| **M5 倒挂的书城** | library Phase A（brief §11.1 步骤 1-10） | 切 library：书页风暴绕城盘旋、头顶倒挂书阁视觉隧道、万卷塔与墨渊鲸每分钟照面 | 书页/光尘循环池配方（未来纸感场景复用） |
| **M6 重力翻转** | library Phase B B-1~B-8 + 倒挂 fixture 测试 + golden 回归（B-10 rotor 小项并行） | 600m 后进反重力区：翻上天花板跑完 60~120m，倒挂书架擦身而过，出口章纹门落回地面 | sim flip 范式（若未来有「镜面世界」类创意直接复用） |
| **M7 品牌件与收尾（长期轨道）** | konbini Phase 3（障碍皮肤/植物风摆）、harbor Phase 3（海面+灯塔）、coast Phase 3（微弯，品牌评审）、各场景专属 BGM 音频补给、forgeheart Phase B 玩法化（喷发判定/焰髓晶 pickup）、titan 蹬墙跳等 | 各场景招牌记忆点逐个落位 | —— |

节奏建议：M0-M1 合计约一周（全是半天~2 天项，可随时插队）；每个新场景 Phase A 后都留一轮用户视觉整改（雷脊实测证明这轮必发生）；M4 是唯一「不产出新场景」的里程碑，但它是 M5/M6 与三个蓝图 Phase B 的共同前置，不许跳过。

---

## ⑥ 遗留疑问默认答案表

> 原则：能实跑后拍板的不预拍板；数值类一律「按文稿地板实跑 → 验收轮调」；框架改动类看量级与先例；品牌类留给截图。以下默认答案允许被用户推翻，推翻即改本表。

| # | 疑问 | 默认答案 | 依据 |
|---|---|---|---|
| F1 | forgeheart 潮汐 144m / 喷发 288m 是否调整 | **保持文稿数值实跑后拍**——这是按节拍器可读性拍的地板，实机前没有更好的依据；难度只走现有 difficultyCurve，不动预警时长 | forgeheart-brief §3.1「1.0s 是安全底线」 |
| F2 | forgeheart 喷发方案 B（改 runnerScene 两处各 1~3 行）vs 纯 Phase A 方案 A | **批准方案 B**。理由：分支模式有现成先例（runnerScene.ts:100 环境贴图门控、entityLayers.ts:64 皮肤门控），量级 1~3 行/处；方案 A 失去 1s 预警 = 丢掉种子核心需求（「山在数拍子」），省 6 行代码不值。方案 A 只当契约冒烟的临时档 | forgeheart-brief §12 矛盾 2 |
| F3 | forgeheart/titan/library 专属音频素材 | **Phase B-7 前全部暂用 run.mp3**，音频补给立一个跨场景工作项（三场景 BGM + 炉心心跳/警报 SFX），放 M7 轨道 | 三份 brief 同一先例（stormspire 暂用 run.mp3） |
| T1 | titan 睁眼 420m 不可逆常亮是否接受 | **接受**。420m 是修订轮已校准值（= 第二次途经颅段窗 436~480m 之前，titan 附-④）；「无尽跑酷无终段 → 距离闩锁」有雷脊同款先例（forgeheart §8 诚实说明）。Phase B 事件化排 M4 | titan-brief §10.0-7、修订记录④ |
| T2 | 呼吸振幅 1.8m 晕动安全上限 | **先按 1.8 实机验收**；验收轮跑 ?debug 两圈自测，若晕动则加无障碍开关（封顶 1.5m）为 Phase A+ 可选项，不阻塞主流程 | titan-brief §3.3 数值地板 + brief §10.1-4 验收口径 |
| T3 | titan 金币 IBL 抛光是否接入 | **不接入**（蓝图默认：暮色金属感靠亡火金自发光）。M1 env 参数化落地后接入只值一行配置，留视觉验收截图对比后随整改轮决定 | titan-brief §10.0-5 |
| L1 | 反重力区内高价值金币带 | **允许**——诱导冒险线就是设计目的，且 B-5 已定区内金币带 y=ceilH−0.65 通路；Phase B 验收时沿天花板铺一段金色带验证 | library-brief §11.3-2 + §11.2 B-5 |
| L2 | B-1 区内障碍铺设方案 | **方案 1：zone 预注册 + pattern 生成期跳过**（brief 推荐案）；禁铺窗规则（入口/出口各 12m）随方案 1 一并实现。clearObstacles 事后软清依赖生成顺序，回放安全上扣分 | library-brief §11.2 B-1 |
| L3 | 是否给 trackGen 开主题门控口子 | **不开**。三份 brief 一致核实的契约（trackGen.ts:83-85 只建索引不读场景）；疏密表达走渲染层 rhythmZ。真需要时另立 sim 变更单 | library-brief §11.0-3、forgeheart §8、stormspire brief:300 |
| C1 | coast 跑道色深沥青 vs 浅水泥 | **字段先落地、默认值不动**（roadColor 可配但 coast 暂不配值）→ 验收轮实机截图 A/B 后拍板。字段零风险，色值不预判 | coast-audit #1、遗留疑问 1 |
| C2 | coast postfx 晴天档建议值 | **按建议值落地**（暗角 0.12/颗粒 0/bloom 0.22/联动减半），实机微调在验收轮——先止住 live 主题的伤，再谈精调 | coast-audit ③-1 |
| C3 | coast Phase 3 晴天微弯做不做 | **最后做 / 可不做**。全矩阵接入成本最高的弯道（三个手写 shader + toon 注入验证），且「通透直线感」可能比弯更值钱（harbor ④-3.4 同款逻辑）——排 M7 品牌评审 | coast-audit #8、⑤-8 |
| C4 | coast 沙滩版障碍皮肤 | **不进主干**。与 harbor 海报违和度（H3）同批实机截图评估，出戏则立独立小立项 | coast-audit 遗留疑问 4 |
| K1 | konbini postfx 主题覆盖字段做不做 | **做**（bloom 0.45 档）——该字段 M0 必须为 coast 而建，konbini 是零增量的第二批消费者 | konbini-audit ②-6、⑥-3 |
| K2 | konbini LOOP=200 归一 240？ | **不归一，挂起**。内部自洽、拐点藏雾（konbini ⑤-7）；归一触发条件写明：出现硬编码假设 240 的全局系统时重排摆位表 | konbini-audit ⑤-7、⑥-6 |
| K3 | konbini K-car 品牌口径 / 闪电 [11,24] | K-car **Phase 3 皮肤立项时由美术拍板**；闪电按 [11,24] 落地后实机定档（先落地再调，同 F1 原则） | konbini-audit ⑥-4/⑥-5 |
| H1 | harbor wetRoad/bend 用配置字段还是硬编码白名单 | **配置字段**（themes.json 自定义字段，schema 全放开已核实）——konbini ⑥-8 已按此契约作废 WET_THEMES 方案；titan §10.0-3 的 BEND_THEMES 常量并轨此契约（驱动器仍场景专属：setWorldBend/setTitanBreath 各写各的） | harbor-audit §2-4 注、konbini-audit ⑥-8 |
| H2 | harbor 假弯道是否适用黄昏铁道 | **Phase 3 最后实机裁决**（与 C3 同批品牌评审） | harbor-audit ⑥-3 |
| H3 | 二次元海报默认盘对 harbor/coast 的违和度 | **实机截图评估**后决定是否做皮肤；建议立一个「默认盘海报主题门控」跨场景小评估单（adPosters.ts 无门控是 harbor ①-1 与 coast 遗留 4 的共同根因） | harbor-audit ①-1、⑥-2 |
| H4 | harborProps.ts:115 注释 vs 138-139 代码矛盾 | **实机截图裁决**（快赢 5，半天级），不预判谁对 | harbor-audit ⑥-6 |

---

## 附：本文引用核对记录

- 实测命令与输出：`ls packages/game/src/render/stormspire/`（15 个 .ts）、`wc -l`（stormspire 2220 行；coast+konbini+harbor 合计 2780 行，其中 coast 754 / konbini 1864 / harbor 162 与三份审计自述一致）、`grep -n status config/themes.json`（4 主题及 live/draft 状态）、SCENERY_SETS 注册表（sceneryProps.ts:205-211）。
- 文中其余 `文件:行` 引用均转引自六份文稿与 stormspire-brief 的核实记录（titan-brief 附录、forgeheart §12、library §11.0、三份 audit 的证据列），本次未逐行重验源码；各场景开工时按 brief 惯例「动手前先重读」对应文件。
- 未能验证项：所有工作量估算（标注为估算）；三份审计与三份 brief 的「待实机验证」项（弯道 toon 注入、poolMat 脱开、z-fighting 等）仍待实机，本文不销项。
