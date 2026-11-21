# Brief 5 — 沉眠泰坦 (titan)

> 场景制作总纲。目标读者：实现该场景的 LLM / 工程师。所有"最低数量"都是**地板不是目标**，按 grandeur & fidelity 标准往密了做。
> 结构对标 `docs/stormspire-brief.md`（唯一质量基准模板）；种子创意出自 `docs/scene-ideas-backlog.md` 备选 2。
> 对接点：`packages/game/src/render/`（新场景目录 `render/titan/`），障碍皮肤走 `stormspire/obstacleSkin.ts` 的显式分支模式，假弯道/呼吸共用 `stormspire/worldBend.ts` 的注入基础设施。

---

## 0. 一句话概念

你跑在横跨死寂峡谷的巨神尸体上——脊沟是路，肋骨是拱门，须发是摆动的障碍帘，弑神的断剑斜贯头顶。整具尸体没有死透：它还在**呼吸**，远方地形随呼吸整体起伏；跑得够远，它会**睁眼**。

气质三词：**死寂、浩大、将醒未醒。**

---

## 1. 世界观

### 1.1 场景：神冢峡谷（the Godmoot Canyon）
- 上古神战中一位巨神陨落，尸身横跨峡谷化为陆桥。弑神者的军队早已散去，只留下插满尸身的巨箭、贯胸的断剑和沿途祭拜的葬仪石环。
- 尸体经过千年风化：皮肉化为苍岩（可跑的"石头"其实曾经是皮肤），骨骼外露处覆尸苔，甲胄残片锈成红褐。峡谷底是无底的雾——凡人不敢看第二眼。
- 玩家跑的这 240m 循环段 = 尸身「胸段 → 肋段 → 颈段 → 颅底」的一段脊沟。峡谷对岸的雾里还躺着**第二具尸影**——死者不止一位（远景剪影，见 §5.2）。

### 1.2 核心机制叙事：呼吸与苏醒
- 巨神没有死透：横膈还残存着一缕神性，胸腔每 10s 起伏一次（§3.3 呼吸系统）。肋骨随之张合、甲片随之错动、须发随之摆动——**赛道本身是活的**。
- 玩家累计跑过 420m（第二次途经颅段前——颅段窗为 196~240 / 436~480 / 676~720m，见 §3.2 + LOOP 240），沉睡的巨神**睁眼**：瞳孔亮起亡火金、眼窝透出点光、呼吸变深（振幅 +50%）。苏醒不可逆——之后每一圈他都是醒着的。这是渲染层的距离闩锁（§4.1 / §10 Phase A 步骤 6），Phase B 再升格为 sim 事件。

### 1.3 玩家身份：渡魂人（Psychopomp）
- 玩家是沿脊沟送魂的渡魂人：收集死者残存的魂火结晶（对应现有金币/拾取层），在巨神彻底苏醒前把魂送过峡谷。
- 叙事只需要氛围支撑，不需要过场：开场镜头从峡谷雾底仰拍横跨天际的尸身剪影，一枚渡魂鸦群掠过，然后玩家在脊沟起点起跑。

---

## 2. 调色板（7 色，禁止出圈）

| 色 | Hex | 用途 |
|---|---|---|
| 烬空暮蓝 | `#151C2C` | 天空深处、峡谷底、最暗部（鸦群剪影也用它，**零纯黑**） |
| 雾灰青 | `#46606E` | 峡谷雾、尸体远坡阴影、骨暗面 |
| 骨象牙 | `#D9D2BE` | 外露骨骼、肋拱、牙列、高光 |
| 苍岩肤 | `#8A8271` | 尸身皮肤主体（化岩的皮肉） |
| 尸苔绿 | `#5C7A5E` | 尸身植被、苔覆斑、缠布条 |
| 铁锈红褐 | `#8A4A32` | 甲胄残片、锈蚀、血渍染面 |
| 亡火金 | `#FFB454` | **一切发光物**：瞳孔、魂火、魂火灯、脊沟导引纹、鸦眼点 |

规则：发光物只用亡火金一种；场景内零默认灰、零纯黑（最暗用烬空暮蓝）。派生色（调色板内插值，不出圈，只进 `titan/palette.ts`）：骨暗面（骨象牙×雾灰青）、苔暗面（尸苔绿×烬空暮蓝）、锈亮面（铁锈红褐提亮 10%）。与 stormspire 的 7 色互不串用（`render/stormspire/palette.ts` 与 `render/titan/palette.ts` 各自独立，同格式两份常量表）。

---

## 3. 地形系统

### 3.1 尸身地形配方（所有段共用）
- **路面 = 脊沟**：现有三车道平面直接读作"脊柱与两侧横突之间的沟"。路面主色用主题 `groundColor`（苍岩肤暗档 `#4E4A3E`），程序化颗粒纹理沿用 `trackVisuals.ts` 的 `makeGroundTexture`（通用，零改动）。
- **路缘带（|x| 3.2~4.5m）**：椎棘骨锥列（§4.6）+ 甲缝亡火金导引纹，是"你在脊柱沟里跑"的读法主体。
- **胸廓带（|x| 5~30m）**：车削胸廓体块（§4.11）从路缘向外隆起，覆盖尸苔，间杂半埋甲板。
- **峡谷（|x| >30m）**：雾吞。谷底放两层贴地雾带 + 缓慢上浮的魂火微光点；两侧对岸剪影棱柱群走 `stormspire/skyline.ts` 口径（§5.2）。
- 相机与雾的硬约束（已核实）：相机 far=160m（`runnerScene.ts:90`），雾 22~120m（`runnerScene.ts:63`）——颅首、断剑等焦点物必须布置在「玩家 z 相对 −30~−110m」的可视窗内（§3.2 分区已按此校核）。

### 3.2 解剖分区（240m LOOP 一具尸身，禁止出现"素地段"）
| 分区 | z 区间 | 内容 |
|---|---|---|
| 胸段 | 0 ~ −90 | 车削胸廓体块隆起最高、断剑冢（§4.9，剑身横跨路面，z≈−64）、肋拱 ×4（胸廓下缘浮肋，z −64~−90）、弑神箭最密、葬仪石环 ×2 |
| 肋段 | −90 ~ −150 | 肋拱群（§4.2，×8）、半塌肋斜插、鸦群栖息 |
| 颈段 | −150 ~ −196 | 椎棘加密（间距 ×0.7）、须发帘（§4.4）从上方甲缘垂下、魂火灯列队 |
| 颅段 | −196 ~ −240 | 颅首（§4.1，z≈−214，面朝路心倾侧）、掌残段 ×2、第 4 座葬仪石环围颅 |

排布节奏沿用 `stormspire/bridge.ts:38` 的 `rhythmZ`（240m 切 8 段，奇数段密 ×0.7 / 偶数段疏 ×1.45），各元素类错开 phase；疏密交替读作「尸身一段仍穿着甲 ↔ 一段秃露出骨」。

### 3.3 呼吸系统（本场景核心技术，含与 world-bend 共存方案）

**与代码库事实的矛盾（先说清）**：种子创意要求「地形随巨神呼吸整体起伏（±2m，周期约 10s）」，但已核实 sim 是 lane+worldZ 平面判定模型（`trackGen.ts:1-10` 坐标约定；`runnerSim` 无地形 y），玩家脚下判定恒 y=0。若路面真做 ±2m 整体起伏，脚部贴地判定与画面必然穿帮。**两方案：**
- **方案 A（推荐，Phase A 落地）——远场整体起伏 + 近场分件起伏**：整体起伏通过 `worldBend.ts` 的顶点注入实现——`uBendY` 加一个 10s 周期快分量，**k² 包络（`uBendAhead` 恒 18m，`worldBend.ts:44`）保证判定区恒平**：玩家前方 18m 内偏移恒 0，100m 处全幅。玩家读到的是"远方的尸体随呼吸整体隆起塌落"，走近时脚下永远平——所见即判定，与 stormspire 假弯道同一安全边界口径（`worldBend.ts:10-12`）。近中景的肋拱/胸廓/甲片另走矩阵呼吸（同 `islands.ts:92-107` breathers 口径：每帧重写受影响实例的 y，零分配），幅度按"离脊柱越远越大"：椎棘 ±0.05m、甲片 ±0.06m、肋拱 ±0.35m、胸廓体块 ±0.5m，全部同相位（一具尸体一次呼吸，相位 = `t×2π/10`，各件加 ±0.2rad 确定性微抖）。
- **方案 B（备选）**：路面完全刚性，呼吸只给两侧胸腔/肋廓（纯矩阵 breathers），呼吸感靠"路缘与尸体错动"表达。更便宜但"活赛道"读感弱一档，仅当方案 A 试跑出现晕动/穿帮投诉时回退。

**方案 A 实施要点（接入方式，全部已核实）**：
1. `worldBend.ts` 的注入基础设施原样复用：`applyWorldBend(mat)` 幂等（WeakSet，`worldBend.ts:71-96`），uniforms 是模块级单例。现驱动器 `setWorldBend(t)`（`worldBend.ts:102-105`）是 stormspire 专属包络（横 7m/88.5s、纵 4m/118.6s），**只被 `stormspireProps.update` 调用**（`stormspireProps.ts:68`）。titan 新增自己的驱动器 `setTitanBreath(t, amp)`：`uBendX.value = 3·sin(t×0.07)`（保留缓弯引导线）+ `uBendY.value = amp·sin(t×2π/10)`；因两主题永不并存（一局一个 scenery），直接写同一对 uniforms 零冲突。**唯一需要的代码 courtesy**：`worldBend.ts:39-44` 的注释契约「仅 stormspireProps.update 驱动」要同步改为「stormspire/titan 各自驱动」。
2. 侧景材质全量注入已有现成路径：`sceneryProps.ts:36-40` 的 `std()` 工厂对一切 Lambert 挂注入；titanProps 总装照抄 `stormspireProps.ts:56-63` 的兜底 traverse（不透明 Basic/Lambert/Standard 全补注，透明/加色光效件天然跳过）。
3. **路面侧注入目前是 stormspire 硬编码**（已核实）：`trackVisuals.ts:156` 的 `const deep = scenery === 'stormspire'` 控制地面/路面/车道线/虚线/护栏的 48 段纵深加密与 `applyWorldBend`（`trackVisuals.ts:241-247`）。titan 必须把该判定扩为「弯道主题集」（`scenery === 'stormspire' || scenery === 'titan'`，建议提为常量 `BEND_THEMES`）；水洼粗糙度图（`trackVisuals.ts:176`）与湿路倒影（`trackVisuals.ts:201`）仍 stormspire 专属，不随扩。
4. 数值地板：远场呼吸振幅 `amp = 1.2m`（闭眼）→ `1.8m`（睁眼后，§4.1 闩锁联动），周期 10s；振幅渐变 = 累计跑距 0→420m 线性 1.2→1.5（渲染层累计 `move` 即距离代理，`trackVisuals.ts:261` 的 `lastDist` 同口径，纯函数于 dist，回放安全）。
5. 骨蝶/鸦群/雾带等粒子与天空穹顶**不注入**（同 stormspire 口径：天空穹顶是 ShaderMaterial、粒子是 LineSegments，类型天然排除）。

### 3.4 峡谷与雾
- 谷底雾带 ×2：贴地半透长平面（雾灰青→烬空暮蓝 alpha 纵渐隐），抄 `stormspire/atmosphere.ts` 的 mist 口径（低层薄雾带，299 行文件内 mist 段）。
- 峡谷雾墙：两侧 |x| 26~60 大团压扁球三排纵深，色由深及浅，半速视差（×0.55）+ 300m 回收带，抄 `stormspireProps.ts:32-49` 云墙与 `skyline.ts` 的矩阵自管写法。
- 谷底魂火微光 ×20：缓慢上浮的小光点（0.05~0.12m，亡火金，additive），上浮出雾顶即回收到谷底。

---

## 4. 巨神解剖资产目录（每件 = 数量地板 / 形制 / 材质 / 损毁态 / 动效 / 玩法功能）

### 4.0 有机建模 × InstancedMesh 铁律：程序化拼装总纲（先读这段）
种子创意标注"实现成本最高（有机建模量大）"。裁决：**不建任何整体高模，巨神 = 解剖件目录的实例化拼装**，五条纪律全部有现成代码背书：
1. **解剖件目录化**：把巨神拆成 ~15 种可实例化的解剖单位件（椎棘/肋段/甲板/箭杆/箭镞/发束/牙/指节/瞳孔…），每种 = 1 份单位几何 + 1 个 InstancedMesh（`sceneryProps.ts:74-80` `addInst`）。场景的"有机"来自件的数量与错落，不来自单件面数。
2. **复合件烘合**：颅首/断剑/掌这类不可重复的雕塑件，用 `mergeGeometries` 把 3~6 个基本体烘成**一份几何**再实例化（`stormspire/statue.ts:13,37,59` 口径：车削躯干 + 封盘 + 歪斜断块烘为一体），1 件 = 1 draw call。
3. **车削与压扁出体积**：有机曲面用 `LatheGeometry` 车削剖面（`statue.ts:51-55` 八段收分口径）+ 几何级非均匀 scale（颅骨 `scale(1, 0.78, 0.94)`，`statue.ts:100-101` 口径），配合实例矩阵的 rx/rz 歪斜（`sceneryProps.ts:24,50` YXZ 欧拉）。
4. **风化感走"贴片 + tint"**：苔覆/锈斑 = 薄盒贴面微偏转（`statue.ts:84-92` 铜绿斑口径）；同网格实例用 `tint()` 上深浅（`sceneryProps.ts:83-86`）；关节缝 = 深色环/暗盖（`obstacleSkin.ts:111-112` 断口暗盖口径）。
5. **顶点预算与逐帧写入预算（两笔账分开算）**：顶点——单位件 ≤500 tri、复合件 ≤1500 tri、全套解剖几何静态总量 ≤15k tri。逐帧写入——基线是**全部实例**每帧 `p.z += move` + writeAll（`sceneryProps.ts:186-198` 口径，stormspire 侧景全量如此，开销随 draw call 预算走、不单设上限）；在此基线之上的**动效属性改写**（呼吸 y / 摆动角 / 拍翼角的 sin 改写）上限 200 实例/帧：呼吸层（地板 ~150 件：肋拱骨段 84 + 椎棘 40 + 甲板 18 + 胸廓 6 + 掌 2）按 4 帧轮写 ≈38/帧（呼吸周期 10s，20Hz 采样与逐帧无观感差）、摆动层（发束 56 + 骨铃 14 = 70）按 2 帧轮写 ≈35/帧（摆动周期 ≥2.8s，30Hz 采样平滑）、拍翼层 60 逐帧（拍翼 3~4Hz 高频，不可降采样）——地板合计 ≈133/帧，明细见 §8。轮写按帧序分桶（确定性，禁 Math.random）；300 行红线机械拆分同 stormspire 的 tower/islandParts 先例。

### 4.1 泰坦颅首 ×1 —— 场景主地标（苏醒的载体）
- **形制**：颅长 26m、颅宽 14m，Lathe 车削颅穹 + 几何级压扁；面朝路心倾侧 15°、下颌半张没入地里；牙列上颌 ×10 枚骨锥；眼窝 2 处（口径 3.2m、深 2.4m），窝内各悬浮一枚瞳孔八面体（0.9m，亡火金）。
- **材质**：苍岩肤主体 + 骨象牙眼眶缘 + 30% 面积尸苔斑贴片；颅顶一处破洞（神战创口，边缘参差）。
- **损毁态**：下颌陷地、颅顶破洞、左眼窝Empty（瞳孔早被打落——只剩右眼会睁开，读作"他只剩一半在看"）。
- **动效**：闭眼态瞳孔熄灭沉在窝底；**睁眼闩锁**：渲染层累计跑距 ≥420m 时一次性点亮——瞳孔升至窝心 + 自发光渐起（0→1，1.2s）+ 眼窝点光（PointLight，半径 18m，强度 0→8）+ 一圈扩散光环（涟漪环口径，`atmosphere.ts` ripple 段）。**不接全局闪电**：`lightning.strike` 需要 (lane, worldZ) 锚点且由 runnerScene 持有（`runnerScene.ts:97,157`），场景模块越不过这条边界——睁眼表现全部局部化；若验收后想要"全场闪白"增强，可选接线点在 `runnerScene.ts:196-200` 的 ambient 闪电段（一行判 scenery），列为可选项不进地板。呼吸振幅联动：睁眼后 `amp` 1.5→1.8（§3.3）。
- **玩法**：颅段视觉终点锚 + 苏醒叙事载体；颅顶可跑与"睁眼触发 sim 难度档切换"是 Phase B（§10）。

### 4.2 肋拱（rib arches）×12（胸段 4 + 肋段 8，归属见 §3.2）—— 天然拱门群
- **单拱形制**：7~9 节骨段盒（单节 2.2×1.4×1.6m）沿圆弧拼装（实例矩阵摆弧，不烘死，断位才烘），拱跨 8~14m；**拱下净高两档**：4.2m（直接跑过）/ 2.2m（必须滑铲）——与 stormspire 石拱门两档口径同源（`stormspire-brief.md` §4.8）。
- **材质**：骨象牙 Lambert + 节间深色关节环 + 迎风面尸苔贴片。
- **损毁四态**：完整 50% / 半塌（一侧断落斜插地，可读作坡）25% / 断桩（只剩两节根部）17% / 悬而未坠（断口错位 0.4m 架着）8%。
- **动效**：矩阵呼吸 ±0.35m（§3.3，同相位 + 微抖）——肋是呼吸感知最强的部位，靠近时可读出"在张合"。
- **玩法**：拱下净高档 = 天然滑铲/通过读法；scenery 拱与 'high' 皮肤（断甲梁）互文，教学玩家"高物下要铲"。渡魂鸦穿拱飞行（§5.1 硬指标）。

### 4.3 弑神箭（godslay arrows）×36（scenery 24 + 皮肤内箭丛）
- **形制**：全长 4~7m：杆（锥度圆柱，径 0.14→0.2m）+ 三叶青铜镞（0.5m）+ 尾端三片羽环（薄板 0.3×0.5m）。
- **材质**：杆=铁锈红褐；镞=雾灰青；缠布条=尸苔绿（箭杆中段一圈）。
- **损毁/姿态**：斜插入地 55~70°，入土处一圈碎裂骨渣环；1/3 断杆只余半截（断口暗盖）。
- **动效**：静态；入土裂缝随呼吸微张（±3% scale）列为 Phase A+ 可选。
- **玩法**：'low' 皮肤（obs_barrier_low，§4.12）= 车道内横倒箭杆 + 一丛斜插短箭（跳越，可视顶压 `h×0.75` 与判定同源，`obstacleSkin.ts:104-120` 口径）；scenery 箭林布路缘 |x| 3~8m，密度随难度档上行。

### 4.4 须发帘（hair veils）×14 —— 摆动障碍帘
- **形制**：发束帘 = 4~6 条并排锥柱束（单条径 0.12~0.2m、长 3~6m），悬自上方甲缘/颅颌缘，末端坠 1 枚骨铃球（0.5m，骨象牙）。
- **材质**：发束苍岩肤→尸苔绿 tint 渐变（油亮的死人长发读作化岩的皮色）。
- **损毁态**：4 帘缺束（只剩 2~3 条）、3 帘断坠（骨铃滚落在地，束体收短）。
- **动效**：单摆 ±0.5rad、周期 2.8~3.6s、相邻帘相位互错（同 `landmarks.ts` 摆链 ±0.6rad 口径的收紧档）；摆幅调制：呼吸顶点（t 相位 π/2）摆幅 ×1.2——须发随"呼气"荡开。
- **玩法**：'moving' 皮肤 = 摆锤 → 发束锤（骨铃球 1.12m ≈ 判定挡板 1.12m，`obstacleSkin.ts:160-167` 口径：锤头 + 上方三节束示意，横摆沿用 entityLayers 的 obstacleX，皮肤不做摆动逻辑）。

### 4.5 甲胄残片（armor shards）—— 滑铲顶板的原生读法
- **'high' 皮肤（obs_gate_low，§4.12）**：断甲横梁——两端断柱（0.3×o.h×0.3m）托一块锈甲板（o.w×0.5×0.8m），**梁下净空 1.2m 与 BAR_LOW_Y 同源**（`obstacleSkin.ts:123-133` 断拱肋口径：梁体钉在 `cal.barLowY + 0.22`），板缘一道亡火金蚀刻纹。
- **'full' 皮肤（obs_adwall，§4.12）**：塌陷甲墙——2~3 层叠锈甲板（错缝、明暗交替）+ 正面一道竖向魂火灼痕（`obstacleSkin.ts:89-102` 塌墙口径），顶缘参差残块。
- **scenery 半埋巨甲板 ×18**：8~14m 长大板斜插 10~20°，一半埋进胸廓体，板背朝天覆苔；是"甲胄曾覆盖全身"的证据链。
- **材质**：铁锈红褐 + 苍岩肤磨面 + 边缘金蚀刻（发光只认亡火金）。
- **损毁态**：'high' 梁体 1/3 带崩口豁三角、'full' 顶缘参差错高（残块明暗交替）、scenery 大板 1/3 断成两块错位。
- **动效**：scenery 半埋板矩阵呼吸 ±0.06m（甲片档，§3.3）；皮肤件不动（判定替身，与 stormspire 皮肤同一口径：只消费 o 现状，不自带动画）。

### 4.6 椎棘（spine process ridge）×40 地板 —— 路缘骨锥列
- 形制：骨锥高 1.2~2.6m、底径 0.8~1.4m，朝后倾 12°，路缘两侧每 9~14m 交替一枚（rhythmZ）；根部一圈骨膜环。
- 材质：骨象牙 + 根部尸苔。
- 损毁：20% 折半（只剩根部斜桩）。
- 动效：矩阵呼吸 ±0.05m（最贴近脊柱，起伏最小——呼吸幅度梯度的事实依据）。
- 玩法：纯读法件（椎棘线 = "你在脊柱沟里跑"）；不进判定。

### 4.7 魂火灯（grave lanterns）×16 —— 葬仪导引
- 形制：高 2.2m 弯骨灯柱（两节圆柱折角）+ 顶端悬浮魂火（八面体 0.22m，亡火金）+ 柱脚一枚光池贴片（64² 径向渐变 DataTexture，`stormspire/bridge.ts` makePoolTexture 口径，additive opacity 0.15）。
- 损毁：3 盏柱折（魂火跌落贴地漂浮）。
- 动效：魂火 ±8% 呼吸；每 6~11s 一次火星爆（2~3 帧，确定性相位，`landmarks.ts` 电弧火花池口径）。
- 玩法：沿 rhythmZ 每 ~15m 一盏，导航锚点 + 夜景节奏器；灯列在颈段最密（引魂入颅）。

### 4.8 葬仪石环（votive circles）×5
- 形制：直径 5~8m 石圈，7~11 块立石（高 0.8~1.6m，歪斜不一），环心一小堆叠骨。
- 材质：雾灰青石 + 苔覆；环心骨堆用骨象牙。
- 损毁：2 环半塌（立石倒伏 2~3 块）。
- 动效：静态；环心偶尔一缕魂火屑上浮（复用粒子池，2~3 帧一次）。
- 玩法：路侧休止符，纯氛围；呼吸段（laneBlock "0" 档，`obstacles.json` laneBlock weights "0":22，`trackGen.ts:226-235` 放行逻辑已核实）沿途多布置，给喘息段一个"驻足祭拜"的读法。

### 4.9 断剑冢（the Godslayer's sword）×1 —— 场景签名物
- **形制**：全长 40m 巨剑斜贯尸胸：剑尖没入胸段岩体（z≈−64，|x|=14），剑身向路心上方斜出，**剑格横跨路面上空、净高 6m**（玩家与空中态相机从剑下穿过——"你跑过杀死他的剑"）；出土 22m，剑格宽 6m，柄首残缺。
- **材质**：剑身雾灰青金属 + 血槽一道亡火金纹（发光）+ 剑身 30% 锈斑贴片。
- **损毁态**：柄首断失、剑身 1/3 段有崩口（豁口三角）。
- **动效**：静态巨物；剑身金纹每 12~18s 一次微脉冲（1.05→1.12 additive 亮度，确定性相位）。
- **玩法**：签名物 + 胸段 focal point；Phase B 蹬墙跳墙面候选。

### 4.10 掌残段（fallen hands）×2
- 形制：半握拳，掌径 7m，五指两节（指节圆柱 ×10 实例，2 根断失）；掌心朝上斜倚颅段路缘，读作"向天摊开的手"。
- 材质：苍岩肤 + 指缝尸苔。
- 损毁：即损毁态本身（断腕截面 + 暗盖）。
- 动效：矩阵呼吸 ±0.1m（连着腕，动得少）。
- 玩法：颅段的护框；掌心凹面 Phase B 可作高台。

### 4.11 胸廓体块（thorax masses）×6 —— 地形级体量
- 形制：Lathe 车削收分体块（单块底径 10~16m、高 6~11m，八段剖面），从路缘向 |x| 8~30m 隆起排布，相邻块错落咬合；表面 2~3 条肋痕（浅环带）。
- 材质：苍岩肤 + 大面积尸苔盖（压扁半球盖，`islands.ts:163-165` 草盖口径）+ 锈斑贴片。
- 损毁：2 块顶部塌陷（破口露"肋骨内壁"骨象牙反色）。
- 动效：矩阵呼吸 ±0.5m（呼吸幅度最大的部位——横膈所在地）。
- 玩法：地形体量 + 峡谷与路的过渡层；挡住玩家视线不看见"世界尽头"。

### 4.12 障碍词汇表（12 defs 全覆盖，显式分支换皮）

> 对标 `stormspire/obstacleSkin.ts` 显式分支模式（`entityLayers.ts:64` 按 scenery 建皮）：只换可视替身，判定口径零改动（low 可视顶 h×0.75、high 杆下 1.2m 净空、rideTop 顶面齐 o.h、hazard 0.35m 提示带由 entityLayers band 出）。新建 `titan/obstacleSkin.ts`，7 个实例槽铁律同款（≤10 新增 draw call）。size 数字为 `config/obstacles.json` defs 的 `size: [w,h,d]` 实测。

| def | class / 判定 | titan 皮 | 语义 |
|---|---|---|---|
| obs_adwall | full，2×3×0.18，只能换道 | **塌陷甲墙**：2~3 层叠锈甲板错缝（§4.5）+ 顶缘参差残块（明暗交替）+ 正面竖向魂火灼痕 | 甲阵坍塌封路 |
| obs_box | low，可视顶 2.0m，可跳 | **断椎短桩**：立放骨锥桩 + 断口暗盖 + 侧一条尸苔痕 | 椎棘残件 |
| obs_barrier_low | low，可视顶 1.5m，可跳 | **斜插箭丛**：横倒箭杆 + 一丛斜插短箭（§4.3 皮肤版），可视顶压 h×0.75 | 箭雨余烬 |
| obs_cube_roll | low，moveZ −6，可跳 | **滚落指节**：短骨柱段向玩家滚来（滚动视觉沿用 entityLayers 的 moveZ 位移，不自建物理） | 掌骨掉落 |
| obs_gate_low | high，1.4×2.6×0.12，杆下 1.2m，滑铲 | **断甲横梁**：两端断柱托锈甲板（§4.5），梁体钉在 `cal.barLowY + 0.22`，板缘金蚀刻 | 断甲压道 |
| obs_train_static | vehicle，2×2.4×24，rideTop | **殓兽脊甲列**：2~3 段收分骨躯（段顶面全程齐 o.h=2.4m 保 rideTop 支撑面，抄 `obstacleSkin.ts:135-149` 鲸背段拼法）+ 背刺椎棘一列 + 侧腹魂火纹一段 | 驮棺兽残骸长列 |
| obs_train_slow | vehicle，同上，慢速 | 同皮慢速版 | 同上 |
| obs_rusher_long | vehicle，2×2.4×8，moveZ −8，rideTop=false，不可跳 | **拖棺石兽头**：方颅冲锤 + 断角 ×1 + 面甲金纹一道，不可站（rideTop=false 语义吻合） | 送葬队列的失控残部 |
| obs_mount_step | step，2×2.4×6 斜坡 | **保持默认盘**（坡面与 movement 的 step 截面同源，换皮会与登车判定读法分家） | 登车坡 |
| obs_pendulum | moving，1.2³，swing 4.4m / 3.2s | **发束锤**：骨铃球锤头（1.12m 贴判定盒）+ 上方三节发束示意（§4.4 皮肤版），摆动逻辑仍归 entityLayers，皮肤不自带动画 | 摆动的须发 |
| obs_arc_floor | hazard，2×0.1×4，damage 1.5s | **魂火灼地薄板**：骨石板顶面齐 o.h=0.1m + 两段错位金灼纹（纹底面抬 5mm 防共面，抄 `obstacleSkin.ts:169-176` 口径） | 魂火灼地 |
| obs_lightning_circle | hazard，2.2×0.12×2.2，zap 每 200m | **保持默认盘**（黑盘闪电本就是"神罚落点"语义，与 zap 触电结算一体；闪白走 §6 的暖色 tint 分支） | 神罚落点 |

- zap 与 step 是否上皮：**都不上皮**（zap 语义本就契合神罚落点、step 与登车判定同源）——与 stormspire 的处置一致（`stormspire/obstacleSkin.ts:10`），与 forgeheart 不同（那是洞内黑盘出戏才上皮 zap）。
- `config/obstacles.json` 的 defs.themes 数组**不需要加** theme_titan——trackGen 不读该字段（§10.0-4 已核实：障碍本就全主题通用，门控是死配置）。

---

## 5. 生物（全部独立于玩家运行）

### 5.1 渡魂鸦（psychopomp crows）—— 1 群 30 只地板
- 形制：翼展 0.8~1.2m，体 = 压扁小纺锤 + 双翼薄板；通体烬空暮蓝（剪影，零纯黑），每鸦 1 枚 0.06m 亡火金眼点（发光，近景可读；侧视只见朝镜头一侧的眼）。拍翼表现沿用 `stormspire/creatures.ts` 魟群的既有实现口径（**参数化群飞**——不是真 boid：零分配零 O(n²)，观感等价，`creatures.ts:3-4` 自我声明；实现时逐字参照，不另发明）。
- 行为：参数化群飞，绕"肋段 ↔ 颅首"之间的游移中心盘旋（creatures.ts 每群绕自己游移中心的同款口径），路径在肋拱下与断剑格间穿行（**穿拱硬指标：路径至少 2 次穿过肋拱下净空**）。
- 动效：拍翼 3~4Hz、相位互错，**逐帧只写翼矩阵**（体 30 + 眼点 30 只随滚动基线 writeAll，不参与动效改写——预算见 §4.0 纪律 5）；睁眼后旋速 ×1.3（同喂 dist 闩锁状态）。
- 鸣声：远距低哑哑鸣，音量随距离衰减（audioDirector 现有口径，Phase A 可后置）。

### 5.2 对岸尸影（the second corpse）×1 —— 远景巨物常驻
- 形制：峡谷对岸 |x| 48~64（与 skyline 的 38~58 同一雾视窗包络，再远会整体沉进 120m 雾外）、横陈剪影棱柱群拼出"另一具巨尸的轮廓"（胸廓鼓包 + 头颅残段 + 斜插箭杆 3~4 根），高 12~26m，雾灰青/烬空暮蓝双色交替（`stormspire/skyline.ts:1-10` 双色剪影口径：靠雾吃出空气透视，×0.3 半速视差、300m 回收带、矩阵自管非均匀缩放）。
- 动效：无（死者就是死的——与主尸的呼吸形成"死/半死"对比，反而衬出主尸是活的）。
- 玩法：巨物必现保底（§9）。

### 5.3 骨蝶（可选点缀）
- 0.2m 碎骨片蝶 12~16 只，贴胸廓体缓慢盘旋，只为近景生命感；没有就不验收不过关的部分。

---

## 6. 光照、后期与粒子特效（对接现有系统）

**光照**：主题 `lighting` 字段覆盖（已核实派生口径 `runTheme.ts:56-57`、接线 `runnerScene.ts:93-96`）：hemiSky `#6B7A8C`（暮青天光）/ hemiGround `#1A2030` / hemiIntensity 0.9；key `#C9B896`（残阳暖键光）/ keyIntensity 1.05——葬礼暮光的"冷天光 + 暖残阳"对打。
**闪白色陷阱（本仓已知，与 forgeheart-brief.md:375-376 同款矛盾，核对过）**：`sky.flashColor` 的运行时消费方只有护栏加色材质（`trackVisuals.ts:223`）；闪白色是 `lightning.ts:25` 的常量 FLASH_TINT `#cfe4ff`（`runTheme.ts:67` 写死 `new THREE.Color(FLASH_TINT)`）——**配 flashColor 不会改变闪白色**。且 zap 闪电圈每 200m 一枚、全主题通用（`obstacles.json` zap 段 + `trackGen.ts:194-205`），冷蓝白闪会在"死寂神冢"里周期性出现。titan 处置（forgeheart §12 矛盾 2 方案 B 同款）：flashColor 仍配 `#FFE9B8`（护栏语义正确），闪白走 **flashTint 的 scenery 分支**（1~3 行：`runnerScene.ts:201-205` 的 applyLightningFlash 调用点按 scenery 取 `TITAN_FLASH_TINT #FFE9B8`——tint 本就是入参，`lightning.ts:31-42`），zap 闪白由此读作神冢的"魂火脉动"暖金白。**已知折中**：锯齿闪电本体与打击点点光仍是 lightning.ts 内置冷色（coreMat `0xeaf4ff` / glowMat `0x9fd8ff` / impactLight `0xdfe9ff`，`lightning.ts:70-86`），只有背景/雾的全场插值变暖；如需全暖化再动 lightning.ts 置数（Phase B 可选）。
**后期**：零新增——postfx 全主题既有（`postfx.ts`：bloom 阈值 0.82 只捞亡火金自发光，暗角/颗粒/饱和度 + 冲刺联动，wx 自动降级）；titan 不加主题分支，靠调色板自发光就够 bloom 捞。

| 特效 | 规格 | 对接 |
|---|---|---|
| 魂火飘屑 | 1000+ 缓浮光点（骨象牙 85% + 亡火金 15%，尺寸 0.02~0.08m），三层池贴镜头循环，方向**向上**（雨的镜像：atmosphere.ts 三层雨口径抄结构、反转漂移向与色调） | 新增 `titan/mist.ts`（抄 `stormspire/atmosphere.ts`） |
| 谷底雾带 | 2 条贴地半透长平面，纵向 alpha 渐隐、横向慢滚 | `atmosphere.ts` mist 段口径 |
| 峡谷雾墙 | 两侧压扁球三排，半速视差 ×0.55 + 300m 回收 | `stormspireProps.ts:32-49` 口径 |
| 涟漪扩散环 | 睁眼瞬间眼窝一圈扩散光环（0.15→1.0 渐大 + 0.35→0 渐隐，一次性） | `atmosphere.ts` ripple 段口径 |
| 火星爆 | 魂火灯 6~11s 一次 2~3 帧粒子爆（确定性相位池） | `landmarks.ts` 电弧火花池口径 |
| 环境闪电 | **关闭**（`flashEveryS: [9999, 9999]`）——随机环境闪电是雷脊的签名不是这里的；zap 闪电圈（每 200m 一枚，全主题通用）的闪白走 §6 暖色 tint 分支；全局闪白留给 Phase B 的 sim 睁眼事件 | `themes.json` sky 字段 + `runnerScene.ts:196-200` |
| 冲刺速度线 | 沿用 speedLines，色调改雾灰青 | 复用 `speedLines.ts`（tint 走主题 vfxTint） |

---

## 7. 赛道叙事与循环带

> 现有玩法是 lane + worldZ 滚动赛道（`trackGen.ts:8-9` 坐标约定），Phase A 不改 sim。泰坦把"三车道"升级为**有叙事剖面的循环带**：240m 一圈 = 尸身胸→肋→颈→颅的一段，叙事按累计跑距推进（渲染层 dist 闩锁），玩法难度仍由 sim 的 `difficulty = floor(z/300)`（`trackGen.ts:111`）+ obstacles.json 模板池驱动，两套时间轴并行不干扰。

### 幕一 · 静默送葬（0 ~ 300m）
新手段净空（trackGen 开局 60m + 模板池 by0 档）内视觉同样温柔：脊沟开阔、椎棘疏列、魂火灯引路；第一次抬头看见断剑横贯（z≈−64）；障碍以断鼓/拱肋级温柔为主。

### 幕二 · 苏醒前兆（300 ~ 420m）
呼吸振幅从 1.2 渐升至 1.5（§3.3 实施要点 4 的渐变口径）；肋拱净高 2.2m 档占比上行（对应模板池 by5+ 档 slide 类）；须发帘摆速 +10%；渡魂鸦开始穿拱；雾墙里对岸尸影轮廓"更近了一层"（剪影带 x 向内收 4m，纯视觉）。

### 幕三 · 睁眼（≥420m，不可逆）
第二次途经颅段前触发闩锁（§4.1）：瞳孔亮起、眼窝点光、涟漪环；呼吸振幅 →1.8；鸦群旋速加快；此后每圈颅段都是"他醒着看你跑过"。难度不再加码（sim 已有的 difficulty 曲线照旧）——恐惧感来自氛围不来自数值。

### 循环带拼装规则（Phase A 口径，与 stormspire 实际落地一致）
- 每个解剖分区 = 1 个模块文件内的静态/动效实例组，沿 240m LOOP 循环回收（`sceneryProps.ts:20-21` LOOP=240/WRAP_Z=12）；排布走 rhythmZ 疏密节奏（§3.2）。
- **诚实说明**：stormspire-brief §7 设想的"chunk 池按三幕权重抽取"在 stormspire 实际落地时改为模块化循环带（见其 §10 实施记录），本场景沿用实测口径；chunk 化（按距离带切换场景内容池）与 sim y 剖面绑定，一并放 Phase B。
- 确定性约束：循环回收与呼吸相位只吃 `(move, t)` 与累计 dist，渲染层随机一律确定性 `rnd(i, salt)`（`sceneryProps.ts:28-31`），不反写玩法状态。

---

## 8. 实例化预算表（地板）

| 资产 | 数量 | 呈现方式 |
|---|---|---|
| 椎棘 | 40+ | 锥体 InstancedMesh（根环同网格第二实例组） |
| 肋拱骨段 | 12 拱 × 7~9 节 ≈ 100+ | 骨段盒 InstancedMesh（关节环独立实例组） |
| 弑神箭（scenery） | 24+ | 杆/镞/羽环各一 InstancedMesh |
| 须发帘 | 14 帘 × 4~6 束 ≈ 70+ | 束锥 InstancedMesh + 骨铃球实例组（摆动 2 帧轮写，§4.0 纪律 5） |
| 半埋甲板 | 18+ | 大/小板两档 InstancedMesh |
| 魂火灯 | 16 | 柱身实例 + 魂火八面体实例 + 光池贴片实例 |
| 葬仪石环 | 5 环 × 7~11 石 ≈ 45 | 立石 InstancedMesh（骨堆复用椎棘锥网格缩放） |
| 颅首 | 1（+瞳孔 1） | mergeGeometries 复合单件 + 瞳孔八面体独立（闩锁动件） |
| 断剑 | 1 | 剑身三段烘合单件 + 剑格独立实例 |
| 掌残段 | 2 | 掌体烘合单件 ×2 + 指节 InstancedMesh |
| 胸廓体块 | 6 | Lathe 单几何 ×6 实例（苔盖压扁半球独立实例组） |
| 峡谷雾墙 / 雾带 | 三排 / 2 条 | 压扁球实例 / 半透长平面 ×2 |
| 谷底魂火 | 20 | 小八面体 InstancedMesh（上浮循环） |
| 魂火飘屑 | 1000+ | 三层池 LineSegments（相机空间循环） |
| 渡魂鸦 | 30（1 群） | 体 30 + 翼 60 + 金眼点 30（每鸦 1 枚，仅滚动）：翼矩阵逐帧拍动，体/眼随滚动基线 |
| 对岸尸影 | 1 组（11~14 棱柱） | 非均匀盒矩阵自管（skyline 口径，draw call 4） |
| 障碍皮肤 | 12 defs 全覆盖（§4.12），zap/step 默认盘 | `titan/obstacleSkin.ts` 7 个 InstancedMesh 槽（≤10 新增 draw call 铁律，`stormspire/obstacleSkin.ts:7-9` 同口径） |

性能约束：侧景模块 draw call ≤42（目标 ~35，对齐 stormspire 的 ~35 口径，`stormspireProps.ts:6`）；全部走 instancing；渲染层每帧零分配（dummy/Color 预建，`obstacleSkin.ts:67-68` 口径）。逐帧写入两笔账（§4.0 纪律 5）：滚动 writeAll 全量 = 基线（stormspire 同款，不单设上限）；动效属性改写 = 呼吸层 4 帧轮写 ≈38 + 摆动层 2 帧轮写 ≈35 + 拍翼层逐帧 60 ≈ **合计 ≤140/帧**（地板口径，上限 200）。

---

## 9. 美术底线（验收）

- 开场镜头有设计：峡谷雾底仰拍横跨天际的尸身剪影 → 渡魂鸦群掠过 → 拉起进脊沟起点（静帧要能当海报）。
- 呼吸可感知：静立不动 10s 内，玩家能从**远方地形起伏 + 近处肋拱张合**两处读到呼吸（§3.3 双机制缺一不算过）。
- 睁眼是瞬间事件不是渐变氛围：瞳孔点亮 + 点光 + 涟漪环三件套在 1.2s 内完成，之后不可逆常亮。
- 严格 7 色调色板（§2），发光只认亡火金，零默认灰零纯黑。
- 巨物必现：每一圈内断剑（胸段）与颅首（颅段）都必须进入 120m 雾视窗被玩家注意到；对岸尸影常驻对岸（§5.2）。
- 有机不等于糊：肋骨有节、甲片有缝、箭有镞与羽、颅有牙列——解剖件目录里的形制细节缺一不可（§4.0 纪律 4）。
- 最低数量全部按本 brief §4–§6 的地板执行；障碍皮肤六类齐备且其余主题零变化（`entityLayers.ts:60-66` 显式分支口径）。

---

## 10. 落地拆分（已对照代码锁定，2026-11-08）

### 10.0 接入契约核实与矛盾清单（Phase A 动工前读）
1. **场景接入**：`config/themes.json` 新增 `theme_titan` 条目（schema 全放开，`lighting` 覆盖灯光、`flashEveryS: [9999,9999]` 关闪电——字段语义已核实 `runTheme.ts:56-73`）→ `sceneryProps.ts` 的 `SCENERY_SETS` 注册 `"titan"`（`sceneryProps.ts:205-211`）→ `render/titan/` 目录放模块。
2. **障碍皮肤门控是硬编码**（已核实）：`entityLayers.ts:64` `scenery === 'stormspire'` 三元建皮肤；titan 要么扩三元、要么提成 `SKIN_BY_SCENERY` 表。**推荐提表**（两主题各指一个工厂，第三主题零成本）。
3. **弯道/路面注入是硬编码**（已核实）：`trackVisuals.ts:156` `deep` 旗标控制 48 段加密与五处 `applyWorldBend`；titan 加入需扩为弯道主题集常量（§3.3 实施要点 3）。水洼/倒影分支不扩。
4. **defs 的 `themes` 数组是死配置**（已核实）：`trackGen.ts:83` 只按 id 建 defs 索引，不读 defs.themes；obstacles.json **不动**（stormspire §10 实施记录同一结论）。
5. **金币 IBL 门控是硬编码**（已核实）：`runnerScene.ts:100` `scenery === 'stormspire'` 才挂程序化环境贴图。titan 金币默认不抛光（可接受：暮色场景金属感靠亡火金自发光）；若要抛光，把该门控并进 2 的主题集常量——一行改动，列为可选项。
6. **「整体呼吸起伏」与平面判定的矛盾**：按 §3.3 方案 A 落地（远场 uBendY 呼吸 + 近场矩阵 breathers），不再重复。
7. **「终段睁眼」与无尽循环的矛盾**：无尽跑酷没有终段；按 §4.1 距离闩锁（420m 不可逆，即第二次途经颅段窗 436~480m 之前）落地为"第 N 圈睁眼"叙事，Phase B 再事件化。
8. **`sky.flashColor` 不是闪白色**（本仓已知陷阱，与 forgeheart-brief.md:375-376 同款矛盾）：闪白色是 `lightning.ts:25` 常量 FLASH_TINT（`runTheme.ts:67` 写死），flashColor 只喂护栏（`trackVisuals.ts:223`）。titan 走 flashTint scenery 分支（forgeheart §12 矛盾 2 方案 B 同款），详见 §6。

### 10.1 Phase A 步骤（每步可独立验收；契约内 = 不改 sim）
1. **主题配置**：`themes.json` 加 `theme_titan`（§2 调色板 + §3.4 雾 + lighting 覆盖：hemiSky `#6B7A8C` / hemiGround `#1A2030` / hemiIntensity 0.9 / key `#C9B896` / keyIntensity 1.05；sky.baseColor `#151C2C`、flashColor `#FFE9B8`（**护栏色语义，非闪白**——见 §10.0-8 与 §6 陷阱）、fog.color `#46606E`、density 0.012、groundColor `#4E4A3E`、vfxTint `#FFB454`、music 暂用 run.mp3）+ `SCENERY_SETS` 注册（先指向空总装，主题可切即验收）。
2. **共享门控接线**：`trackVisuals.ts:156` deep 扩 titan（仅加密 + 注入，水洼/倒影不扩）+ `worldBend.ts` 注释契约更新（§3.3 要点 1）+ **flashTint scenery 分支**（`runnerScene.ts:201-205` 调用点按 scenery 取 `TITAN_FLASH_TINT #FFE9B8`，forgeheart §12 矛盾 2 方案 B 同款，§10.0-8）。
3. **调色与地形**：`render/titan/palette.ts`（7 色常量，抄 stormspire/palette.ts 格式）+ `bodyKit.ts`（胸廓体块 ×6 / 椎棘 ×40 / 半埋甲板 ×18 / 峡谷雾墙）+ `mist.ts`（谷底雾带 + 魂火飘屑三层池 + 谷底魂火 ×20）。
4. **呼吸系统**：`worldBend.ts` 加 `setTitanBreath(t, amp)` 低层写手 + `titanProps.ts` 总装（兜底 traverse 注入照抄 `stormspireProps.ts:56-63`）+ breathers 矩阵呼吸（§3.3 幅度梯度表）。验收：静立 10s 远方起伏可见、判定区 18m 恒平（`?debug` 走两圈看脚底）。
5. **解剖地标**：`relics.ts`（弑神箭 ×24 / 葬仪石环 ×5 / 掌残段 ×2 / 魂火灯 ×16）+ `ribs.ts`（肋拱 ×12，两档净高 + 四态损毁）+ `sword`（并入 relics，断剑 ×1 横跨净高 6m）。
6. **颅首与睁眼**：`skull.ts`（Lathe 颅 + 牙列 + 眼窝 + 瞳孔闩锁状态机 + 眼窝点光 + 涟漪环）。闩锁输入 = 模块内累计 dist（`props.update` 的 move 累加），阈值常量 420m 暴露在文件头便于调参（= 第二次途经颅段窗 436~480m 之前）。
7. **须发帘与皮肤**：`veils.ts`（×14 摆动，摆幅随呼吸相位调制，2 帧轮写）+ `render/titan/obstacleSkin.ts`（六类皮肤，形制按 §4.12 词汇表：full=§4.5 / low=§4.3 / high=§4.5 / vehicle=殓兽脊甲列 / moving=发束锤 / hazard=魂火灼地薄板；zap/step 默认盘）+ `entityLayers.ts:64` 门控提表（§10.0-2）。
8. **生物**：`creatures.ts`（渡魂鸦 1 群 30 只参数化群飞穿拱 + 对岸尸影 skyline 口径）。
9. **验收**：`tests/titan.test.mjs`（抄 `tests/konbini.test.mjs` 三件事：全实例化无散 mesh / update 循环不越界 / 睁眼闩锁一次性与幅度联动）+ `tsc -b` 零错误 + 全仓测试 + 设置面板切主题完整跑 + 浏览器实跑截图（`?debug` draw 计数在 composer 路径失真——stormspire 已知折中，draw call 靠测试桩统计）。

### 10.2 Phase B（sim 前置项，逐条给前置条件）
1. **sim 全局呼吸 y**：前置 = 无（这是便宜的惊吓）——sim 全体（玩家/金币/障碍）统一加 `y += A·sin(2πt/10)`，**相对判定几何不变**（都抬同一个 delta），需要的是相机与雾读绝对 y、以及渲染层 uBendY 分量停用避免双重起伏；局部坡度（脊沟有坡度、肋段上坡）才需要真 y 剖面，与 stormspire §10 Phase B-1 同一工作项合并。
2. **睁眼事件化**：前置 = sim 阶段事件机制——420m 处 sim 发 `awaken` 事件（进 `drainEvents` 管线，`runnerScene.ts:148-169`），难度池切换（obstacles.json 加苏醒档 curve band）+ 可选 `flashEveryS` 启用 + 鸦群/呼吸参数由事件驱动（替代渲染层闩锁）。
3. **肋拱穿行计分 / 须发帘时机判定 / 颅顶可跑 / 掌心高台**：前置 = 穿越判定层扩展（stormspire 穿环计分同一工作项）与 y 剖面。
4. **箭丛裂缝呼吸开合、断剑蹬墙跳**：前置 = 蹬墙跳（墙面提供者，stormspire 塔身同一工作项）。
5. **专属 BGM**（暂用 run.mp3）：前置 = 音频补给。

---

## 附：本文档的核实记录（2026-11-08）
- 读：`docs/stormspire-brief.md`（结构模板）、`docs/scene-ideas-backlog.md`（种子）、`docs/scenes/forgeheart-brief.md`（§9 词汇表格式与 §12 矛盾 2/3 flashColor 裁决对齐）、`packages/game/src/render/{sceneryProps,runnerScene,trackVisuals,entityLayers,lightning,postfx}.ts`、`render/stormspire/{worldBend,islands,obstacleSkin,stormspireProps,statue,tower,landmarks,bridge,skyline,atmosphere,palette,creatures}.ts`、`core/sim/trackGen.ts`、`render/runTheme.ts`、`config/{themes,obstacles}.json`、`tests/konbini.test.mjs`。
- 关键数值出处：LOOP/WRAP_Z `sceneryProps.ts:20-21`；rnd `sceneryProps.ts:28-31`；呼吸岛 ±1.6m/8s `islands.ts:93,202`；worldBend 18m 安全区与 uniforms `worldBend.ts:39-47`；flashTint 写死 `runTheme.ts:67` + FLASH_TINT `lightning.ts:25` + flashColor 护栏消费方 `trackVisuals.ts:223`；参数化群飞声明 `creatures.ts:3-4`；皮肤槽位 ≤10 铁律与校准注入 `obstacleSkin.ts:7-9,25-33`；12 defs 的 size 字段 `config/obstacles.json` defs（§4.12 表内数字实测）；laneBlock "0" 档 `obstacles.json` laneBlock + `trackGen.ts:226-235`；难度曲线 `trackGen.ts:111`；闪电三段式与内置冷色 `lightning.ts:1-8,70-86`；相机 far/雾窗 `runnerScene.ts:63,90`。
- 修订记录（2026-11-09，独立评审六条）：①flashColor/flashTint 语义反了 → §6/§10.0-8/§10.1-1,2 改为 flashTint scenery 分支 + flashColor 注明护栏语义；②vehicle/hazard 皮肤缺形制 → 新增 §4.12 十二 defs 词汇表；③逐帧写入预算对不上 → §4.0 纪律 5 重写为"滚动基线 + 动效改写 ≤200"两笔账（呼吸 4 帧轮写/摆动 2 帧轮写/拍翼逐帧），鸦减至 1 群 30 只、眼点每鸦 1 枚仅滚动、发束 4~6 束；④睁眼 600m 与"第二次途经颅段前"不符 → 全文改 420m；⑤肋拱 12 座只落实 8 → 胸段补 4 座（§3.2/§4.2/§8）；⑥boid 术语 → 参数化群飞（`creatures.ts:3-4` 口径）。
