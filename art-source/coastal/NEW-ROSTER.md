# 海滨竞技俱乐部 · 四名新增角色

原创、可编辑的年轻成人风格化角色；不是立绘替换或占位几何体。建模、配色、装备轮廓和动作均由本任务手写 `bpy` 脚本生成；未导入第三方模型、贴图、动作或现实人物参考，不依赖外部模型服务、付费服务、着色器插件或网络资源。

## 身份与视觉

身份/名称/技能/配置缩放按 `config/characters.json` 保留。子任务交付后，主代理已接入配置/运行时，并将 Run/Idle 统一到实测骨长的接地制作器。

| 文件 / ID | 原名称与技能 | 独立造型 |
| --- | --- | --- |
| `ama` / `char_ama` | 阿玛拉 / Amara · `skill_magnet_pulse` | 深肤色，盘卷短发、金耳环，mint/cream短袖寻宝服，金色磁环和斜挎小包 |
| `kaze` / `char_kaze` | 风剃 / Kaze · `skill_blink_smash` | 削边前翘发、sky/navy轻量上衣、护腕、分叉飘带、低位滑鞋底架 |
| `rina` / `char_rina` | 莉娜 / Rina · `skill_thunder_wings` | 铜色偏分短鲍伯、额上护目镜、coral/cream长袖飞行夹克、背包与成对折叠翼 |
| `bolt` / `char_bolt` | 时空行者 / Chrono · `skill_chrono_leap` | ink斜扫发与银色挑束、violet分摆短长外套、胸前时间吊饰、时间环手套 |

统一服饰语言是俱乐部拉链、滚边、菱形胸章、膝部加强片和有分层鞋底的运动靴。设备用于表达既有技能，不增加玩法武器。脸部包含成形下颌/鼻梁、耳廓、眼白/虹膜/瞳孔/高光、眉毛和微笑；肢体为连续锥度截面，肘/膝/腕/躯干使用混合权重。

## 最终 GLB 统计

2026-11-06，直接读取交付 GLB JSON 与二进制统计。三角形包含导出的全部服装/脸部/设备。每个 GLB 为一个逻辑蒙皮角色网格，glTF 按材质拆 primitive；Three.js 会将这些 primitive 展开为多个 SkinnedMesh。

| GLB | 三角形 | 材质 / primitive | 骨骼 | 动作 | GLB 字节 | `.blend` 字节 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `ama.glb` | 10,228 | 10 / 10 | 18 | 11 | 489,216 | 4,415,645 |
| `kaze.glb` | 9,160 | 10 / 10 | 20 | 11 | 481,544 | 4,699,296 |
| `rina.glb` | 10,152 | 9 / 9 | 20 | 11 | 508,432 | 4,760,216 |
| `bolt.glb` | 10,572 | 10 / 10 | 20 | 11 | 510,752 | 4,781,676 |

无纹理图像、无 Draco/外部解码依赖。使用 glTF 标准 metallic-roughness PBR，适配 MeshStandardMaterial。金属仅用于金属饰件，布料/皮肤为非金属粗糙表面。

## 坐标、蒙皮与动作

- 单位米；**Blender +Y / glTF −Z 为正面**，glTF +Z 游戏镜头看到背面。建模工具以 −Y 起草面部，完整骨架对象绕 Z 旋转 π 后满足交付坐标；编辑者不必额外旋转。
- Idle 实际变形后身高约：ama 1.658m、kaze 1.683m、rina 1.662m、bolt 1.658m；站姿宽约 0.775–0.783m，脚底在 0。配置还会分别乘 1.02 / 0.98 / 1 / 1.05；没有改原配置缩放。
- 必需骨骼：`Root/Hips/Spine/Chest/Neck/Head`，以及 `ArmUpper/ArmLower/Hand/LegUpper/LegLower/Foot` 的 L/R。kaze 另有两根 Scarf，rina 两根 Wing，bolt 两根 Coat 骨。
- `skins`、`JOINTS_0`、`WEIGHTS_0` 和逆绑定矩阵真实导出；肢体不是全身刚性父子。肘、膝和躯干的混合权重由测试读取并统计。
- **场景与骨架对象 extras 都导出 `thunderMotionVersion: 2`。** 集成方应跳过旧 Run 摆幅临时放大；新 Run 原速 0.8s 一周期。运行时步频策略由主代理集成，这里未更改。
- 动作精确命名：`Idle Run Slide Jump TurnLeft TurnRight Fly Land Hit Death Wave`。每条是独立的真实骨架 action/NLA track，不是复制后改名的伪 clip。
- Run 双腿反相，按实际骨长解算接地与膝盖回收、手臂反摆、身体小幅前倾与轻微弹动；0.8s 首尾一致。Idle/Slide/Fly/Wave 也首尾一致。其余动作有自然进入/结束姿态；Death 侧倒后保持。
- Slide 为真正低蹲滑行，实际网格高度约 1.03–1.06m，脚底接地。Land 有约 8cm 髋部缓冲。Fly 张臂并展开 rina 的折翼；Wave 手高过头部。
- 水平根位移保持零，跑步/滑行等接地校正使用实际蒙皮后的最低网格点。Jump/Fly 的世界高度由游戏模拟负责，本地 clip 不偷偷叠加大段上升轨迹。

## 编辑与重建

源文件：`art-source/coastal/{ama,kaze,rina,bolt}.blend`。选择骨架进入 Pose Mode，在 NLA 编辑器静音其他 track、仅启用 Idle 或目标动作进行观察。网格材质区、命名顶点组、骨架、11 个 action 均保留可编辑数据，无需插件。网格可以直接编辑，重跑脚本会覆盖任务拥有的同名 GLB/Blend。

```bash
export LD_LIBRARY_PATH=/tmp/opencode/thunder-art-r4-PYOEaG/blender/libs/usr/lib/x86_64-linux-gnu
export OMP_NUM_THREADS=2 OPENBLAS_NUM_THREADS=2
B=/tmp/opencode/thunder-art-r4-PYOEaG/blender/blender-4.5.15-linux-x64/blender
"$B" -b -t 2 --python tools/art/new_roster.py -- ama
# 不传角色 ID 时顺序重建四名；不要同时启动四个 Blender。
```

脚本：`tools/art/new_roster.py`（骨架/动作/材质/保存导出）、`tools/art/new_roster_mesh.py`（原创截面拓扑/脸部/服饰/配件）。没有使用 Blender 内置的人物生成器或已有角色网格。

主代理集成新增 `refine_motion.py` 共用接地制作器。初版 FK Run 的单脚一周期有两个低谷，
在真实 runtime 中会使5秒出现35次尘土事件；已在资产层重做接地/回收轨迹，而非放宽测试或只限流尘土。
站姿脚底也从8mm垫高回到原点附近。完成四角色重导、九角色portrait重渲染后，
`new-roster-assets` 与 `refined-avatar-assets` 合计13/13通过，包含120Hz下的接地次数、连续跑动与换道相位。

## 已执行验证与观察证据

- `node --test tests/new-roster-assets.test.mjs`：**8/8 通过**。直接 GLB JSON 检查 + 真正 GLTFLoader/AnimationMixer/SkinnedMesh 逐顶点采样，覆盖完整骨架、真实混合权重、11 动作、面数/primitive、0.8s 跑步双腿交替、膝盖折叠、循环接缝、接地、低滑行、招手抬手、飞行展臂、跳跃/落地/受击/转弯/死亡语义及水平根不漂移。
- 两个 Python 文件 `compile()` 与 Node 测试文件 `node --check` 通过；未启动根 npm build/check（由集成方负责）。
- Blender 从导出 GLB 重新导入后实际 CPU 渲染并读取观察四名正面、ama Run/Wave、kaze Slide、rina 背面 Fly、bolt 背面 Run/Death；不是设计草图。发现并修正 Wave/Fly 轴向和 Slide 高度后重新导出、重测。
- 24-sample/降噪的两次附加观察随服务器重启/超时中断；已通过 8-sample、不降噪、两线程 CPU 路径补齐缺失动作观察。模型产物未丢失。附加拼图因当前 Python 缺少 Pillow 未生成，以下独立截图完整可用。
- 离线证据仅位于本次会话临时目录，不属于运行时资源：
  - `/tmp/opencode/new-roster-{ama,kaze,rina,bolt}-front.png`
  - `/tmp/opencode/new-roster-ama-run.png`
  - `/tmp/opencode/new-roster-ama-wave.png`
  - `/tmp/opencode/new-roster-kaze-slide.png`
  - `/tmp/opencode/new-roster-rina-fly-back.png`
  - `/tmp/opencode/new-roster-bolt-run-back.png`
  - `/tmp/opencode/new-roster-bolt-death.png`
  - `/tmp/opencode/new-roster-tests.log`

## 交接边界 / 待验收

四套资产已落盘并完成离线结构、蒙皮动画和选定姿态检查；主代理已接新路径、motion-v2分支与真实模型portrait。原有GLB保留不覆盖。微信开发者工具、真实设备中的视觉/性能、与障碍净空的实际画面关系仍待验收，离线图不构成目标端完成证明。
