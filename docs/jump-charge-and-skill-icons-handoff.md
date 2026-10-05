# 奶蛙跳跃充能 + 局内技能图标 交接文档

> 两件事：① 奶蛙「弹跳之力」从 2.5 秒限时窗口改为**可叠加充能**，顶点 2.40m→3.10m，
> 解决「跳不过高障碍」；② 局内 HUD 加**中右方两枚技能图标**（主动亮=可点释放、
> 被动亮=可触发但不可释放），替换原顶部技能文字行。所有角色共用一套图标。
>
> 分支已按 CONTRIBUTING 拆成三条（见 §一）：`feature/ui-set-background`（框架，base `main`）、
> `content/frog-jump-charge`（跳跃充能，base PR #14）、`feature/run-skill-icons`（图标，base 上一条）。
> 三条**都未推**，等本人点头。基线 `main` = `origin/main` = `22e03fa`。
> 验证：三条各自跑过 `npm run check` 五步全绿；图标那条整包 9.04 MB / 30 MB。

---

## 一、三条分支 / 三条 PR（2026-10-05 已按 CONTRIBUTING 拆开）

| PR | 分支 | base | 内容 |
| --- | --- | --- | --- |
| ① 框架 API | `feature/ui-set-background` | `main` | `Box.setBackground` + `Button.setBackground` + 三条控件用例。**独立可评审**，@Fukaki-Ato 专属 |
| ② 跳跃充能 | `content/frog-jump-charge` | `content/character-skills`（PR #14） | 新原语 `jumpCharge` + `periodic` 子效果叠层 + 起跳乘区 + 配置 + 字体图集 + `?debug` 探针 |
| ③ 技能图标 | `feature/run-skill-icons` | ②分支 | 素材 + 抠图工具 + HUD 装配 + 亮灯口径 + 图标修复；**并 cherry-pick 了 ①的两条提交**（不带上它编译不过） |

①与②无耦合，可并行评审。③依赖①②：①合并后把 ③里那两条 cherry-pick 提交撤掉
（同 patch-id，GitHub 会自动从 diff 里消失），base 保持 ②即可。

评审可按提交逐条看，每条提交信息都写了「改了什么 + 为什么」。

---

## 二、跳跃充能

### 2.1 问题实测（浏览器 + headless，勿凭感觉改数值）

在 `?debug` 下用 `__trRun.state.fx` 逐帧采样顶点，起跳时机按 0.1m 步长扫描：

| 情形 | 顶点（采样 / 理论） | 越 2.6m 高杆的时机占比 |
| --- | --- | --- |
| 基础跳（`jumpVelocity 13.5`, `gravity -38`） | 2.29m / 2.398m | **0/100** |
| 弹跳鞋 `mul 1.1`（旧口径窗口内） | 2.78m / 2.90m | 20/100 |
| 奶蛙充能跳（新口径） | 2.97m / 3.10m | 20/100（带宽 ≈3.9m） |

**关键认知：基础跳谁都过不了 2.6m 高杆（0/100），这是设计而非缺陷** ——
高杆 `slideUnder: true`、`jumpable: false`，本意就是滑铲钻过去。旧口径的问题不在高度，
而在**限时窗口只覆盖全程 25%**（每 10 秒一次、每次 2.5 秒），窗口外手感与普通角色无异，
玩家体感就成了「跳不过」。

### 2.2 改法

- 新原语 `jumpCharge`（`timed`，层数即充能数，**无 `durationS` 故永久**）。
- `periodic` 子效果**改为按各自 `stackRule` 施加**。此前 `runCycle` 写死
  `this.add(c.primitive, c.params, s.label, ctx)` 不传 stackRule，默认 `refresh`
  ⇒ 充能永远停在 1 层。配置声明 `"stackRule": "stack"` 即可逐周期叠层。
- 起跳乘区优先级：**充能 > 弹跳鞋 > 1**，每次起跳扣一层（`consumeJumpCharge`）。
- `mul 1.1369` = `sqrt(2×38×3.1)/13.5`，按 `game.json` 的 `gravity -38` /
  `jumpVelocity 13.5` 反解得到，不是拍脑袋。

### 2.3 踩过的坑（照抄即可，别再踩）

**倍率先取后扣。** `consumeJumpCharge()` 内部会立刻 `recompute()`，而 `fx` 是同一个
对象引用 —— 扣掉最后一层会让 `fx.jumpChargeMul` 当场回落基线 `1`。最初写成
`consume()` 之后才读 `fx.jumpChargeMul`，结果**攒到 1 层时的那次高跳只有 2.29m**，
而 2 层以上都正常（因为还有别的层撑着 `Math.max`）。已加回归用例
`最后一层充能也要吃到倍率`，锁死 `peak > 2.9`。

```ts
// 正确：先把倍率取到局部变量，再扣层
const chargeMul = fx.jumpChargeMul;
const mul = this.hooks.consumeJumpCharge() ? chargeMul : (fx.bootsT > 0 ? fx.jumpMul : 1);
```

### 2.4 满格墙定稿没被推翻

新顶点 3.10m **高于** 3.0m 满格墙，但满格墙仍跳不过去，两种跳都是 0/100：
`collision.ts` 的 `hitsRunner` 对 `cls: 'full'` 恒 `return true`，与高度无关。
`config/obstacles.json` v1.9.1 与 `config/items.json` v1.9.1 里你自己定的
「满格墙只能换道」口径成立。**测试里有断言锁这条**，别在后续调数值时无意破坏。

### 2.5 golden 基线

**未重算，也确认不需要**。理由：奶蛙不在 5 seed × 3 角色基线集内；
`movement` 的改动只在 `jumpCharges > 0` 时生效，而 volt/ama/kaze 无充能层数，
行为逐字节一致（`npm test` 全绿可佐证）。**但这属于「实测无影响」而非「证明无影响」，
评审时值得确认一句。**

---

## 三、技能图标

### 3.1 语义

| | 素材 | 亮 | 暗 | 可点 |
| --- | --- | --- | --- | --- |
| 主动 | `assets/ui/skills/active.png`（琥珀金 + 闪电） | 可释放 | 冷却中 / 未达积攒门槛 | **是** |
| 被动 | `assets/ui/skills/passive.png`（青蓝 + 盾牌） | 该被动此刻生效 | 未生效 | **否** |

叠层被动亮时显示次数（奶蛙 `×3`），暗态不留文案。图标下方状态小字：
主动 `可释放` / `12.0s` / `5/10`（下滑积攒进度）；被动 `生效中` / `×N`。

### 3.2 素材：现在走 ImageGen 出图 + 抠图，程序化生成留作离线兜底

`assets/ui/badges/*` 那批是大厅**入口**徽标（金框、尺寸 290~604 不一、烘焙了中文标签、
normal/glow 双帧），语义和尺寸需求都对不上，另做一套。

**当前入库的两张图来自 ImageGen**（2026-10-05 视觉重做定稿）：让它画在**纯品红
#FF00FF** 底上（调色板里没有这个色，键控不会误吃本体），再由 `tools/mat_skill_icons.py`
色度键抠图 → 圆形遮罩裁掉右下角「Qoder AI 生成」水印 → 去粉边 → 192²。
重跑：先 `cp` 到 ASCII 目录（本机 PIL 不吃中文路径），
`D:/python/python.exe tools/mat_skill_icons.py --in D:/tmp/icons/active.png --out D:/tmp/icons_out/active.png`，
再拷回 `assets/ui/skills/`。

`tools/gen_skill_icons.py`（程序化确定性生成，同 192² 规格）保留作**离线兜底**：
没有出图通道时 `D:/python/python.exe tools/gen_skill_icons.py` 能重出一张能用的。

两张共同约束（`tests/skill-icons.test.mjs` 钉住）：存在、>500B、**<120KB**、彼此同量级。
当前 39.7 / 43.8KB。

- **只烘亮态一张**：暗态由 UI 层乘暗 + 降透明度。省一半贴图，也免了两帧配准问题。
- 带外发光：跑酷背景是浅蓝亮沙，无发光会糊进画面。

### 3.3 亮灯口径（`core/sim/passiveView.ts`）

按 `fx` 派生位**逐条判被动原语**，不按角色硬编码：

| 被动形态 | 判定 | 例 |
| --- | --- | --- |
| 常驻 | 开局即为真 | 小电 `coinPct>0`、阿玛拉 `buffPct>0`、风剃 `slideAddS>0`、莉娜 `shieldLayers>0` |
| 周期（`periodic`） | `fx.periodicLive`（子效果此刻生效） | 阿牛冲撞期 |
| 叠层（`jumpCharge`） | `fx.jumpCharges > 0` | 奶蛙弹跳充能 |

换角色 / 改配置不必改这里；加新被动只需在 `passiveLit` 补一条分支。
无被动的角色 `runnerScene` 推 `passive: null`，**不亮假图标**。

`runnerSim.passiveActive()` / `passiveCharges()` 是薄封装，实现拆在 `passiveView.ts`
——因为 `runnerSim.ts` 加上它们会到 321 行，撞 `check-import-rules` 的 300 行上限。

### 3.4 布局

`skillIconLayout(vw, vh, safe)` 纯函数，设计基准 **1024×1536**（与 `menuLayout` 同思路），
`scale = min(vw/1024, vh/1536)`。贴右边缘（`EDGE_X = 28` 设计 px）、竖直一列、
整体中心锚在设计 `y = 700`，吃 `config/game.json params.ui.{safeTop,safeBottom}`。
页面里没有魔法数字。

**注意 `safeBottom` 只是兜底**：图标锚在画面中段，正常机型下底部安全区够不着，
所以加大 `safeBottom` 不会挪动图标（有测试断言这一点，避免位置随机型漂移）。
只有极端值（如 1400px）才触发兜底，此时「满足安全区」与「不出屏」不可兼得，
**选择不出屏**（贴顶对齐）—— 图标被裁掉比压到安全区更糟。

### 3.5 框架侧两处：只加不改

`Box.setBackground()` / `Button.setBackground()`：就地改背景乘色与不透明度。

**为什么不重建控件换贴图**：重建会打断 `InputRouter` 的命中注册与 `Button` 的按压态机，
而暗态点亮灭每秒可能翻转多次。`badges.ts` 之所以敢重建 `Button`，是因为它的
normal/glow 是点击瞬间换一次，不存在高频翻转。

> ⚠️ **CONTRIBUTING 要求 `packages/framework/**` 公共 API 变更必须由 @Fukaki-Ato review，
> 且不得夹带在无关 gameplay PR 里。这两处应单独提 PR。**

---

## 四、验收对照

| 项 | 状态 | 证据 |
| --- | --- | --- |
| 奶蛙十秒充能一次、可叠加 | ✅ | `tests/jumpCharge.test.mjs`：1→2→3→4 层 / 每 10 秒 |
| 起跳消耗一层、顶点 3.1m | ✅ | 同文件，采样 2.97m（理论 3.10，与基础跳 2.29/2.398 同量级误差） |
| 被动显示次数 | ✅ | 浏览器实测图标显示 `×1`；`skill-icons.test.mjs` 验 `×2`/`×3` |
| 充能耗尽后图标转暗 | ✅ | `sim.passiveActive`：跳完后 `active === false` |
| 两枚图标所有角色一致 | ✅ | 同一套 `SkillIconSet`，`sim` 侧 8 角色开局被动都亮 |
| 主动亮=可释放、点击释放 | ✅ | 浏览器实测 `casts 0→1`、`cd=29.6s`、`invincible=true` |
| 冷却中点击无效 | ✅ | 连点 3 次只释放 1 次；测试走 `host.pushInput` 真实输入通路 |
| 被动亮=可触发、不可释放 | ✅ | 被动用 `Box` 非 `Button`，`tappable === false` |
| 图标不出屏/不重叠/贴边 | ✅ | 7 档视口（390×844 … 1200×500）含竖屏横屏极端档 |
| 缺贴图降级 | ✅ | 退化为纯色圆，结构与命中区不变 |
| `npm run check` | ✅ | 五步全绿，448 用例（拆 PR 后在 `feature/run-skill-icons` 上复验） |
| WX 包体门禁 | ✅ | 分包 +52KB，整包 9.04 MB / 30 MB（26.5%） |
| golden 基线 | ⚠️ 未重算 | 见 2.5，已确认不需要，但属实测推断 |

---

## 五、验证过的坑

1. **浏览器量顶点要清 `localStorage.thunderrun:character` 再开局。**
   `mainFlow` 启动时读 `CHAR_KEY`；中途改 localStorage 不生效，会一直测到上次的角色。
   第一轮就因为这个把奶蛙测成了小电（读出 2.29m）。
2. **`__trRun` 探针原先读不到 `jumpCharges`**（`fxOf` 只映射了 `bootsT`/`jumpMul`），
   而 `__trTest` 面板收集的是 items/skills 的一层原语、不含 `jumpCharge`。
   `b59779b` 补了三个派生位后才能在浏览器里直接验充能。
3. **headless 量顶点不能用「固定提前量跳一次」**：滞空只有 ~0.7s，单次结果没有意义
   （跳早跳晚都判死）。必须扫 0.1m 步长的时机带，才能得到「20/100 可通过」这种可比数据。
4. **测越障时每步要重铺障碍**：`TrackGen` 会不断生成随机障碍，不清掉的话测到的是
   被别的东西撞死（一度四组用例全部返回同一个 `y=2.18`）。
5. **测「基础跳」不能用奶蛙**：它开局第一步就被 `periodic` 挂上 1 层充能，
   不显式 `buffs.remove('jumpCharge')` 就会把充能跳误报成基础跳。基线用小电。
6. **`Button` 的背景只认 `opts.skin`，不读 `opts.background`**（`framework/src/ui/widgets/button.ts`
   的 `onBind`）。第一版技能图标传的是 `background`，于是主动图标一直画成**通用按钮灰皮**，
   闪电/盾牌贴图根本没上屏——headless 测试全绿也照样看不出来，因为是浏览器实跑才发现的。
   照 `ui/badges.ts:51` 的写法传 `skin`。
7. **暗态会被 `Button.setDisabled` 覆盖**：`setDisabled` 走 `applyVisual()`，把乘色重置成白、
   透明度重置成 disabled 自带的 0.45。所以 `setLit` 里必须**先 `setDisabled` 后 `setBackground`**，
   顺序反了图标就只是块半透明灰，压在亮沙背景上直接糊掉。
   回归用例在 `tests/ui-widgets.test.mjs` 与 `tests/skill-icons.test.mjs`，
   读的是 `NinePatchSprite` 的 `uColor`/`uOpacity` uniform——**断言取纯黑 `#000000`**，
   THREE 的 Color 有 sRGB↔linear 往返，`0x80` 读回来是 `0xbc`，只有 0/1 精确可逆。

---

## 六、后续接手须知

- **两条乘区不要串**：`jumpBoost`（弹跳鞋，带时限）走 `fx.jumpMul`，
  `jumpCharge`（充能，无时限）走 `fx.jumpChargeMul`，`movement.jump()` 里
  充能优先。若要新增跳跃类乘区，先想清楚它属于哪一类。
- **新原语三处同集合**（仓库铁律）：`primitives.ts` 的 `PRIMITIVES` +
  `buffEngine.ts` 的 `recompute()` 分支 + `schema/config.schema.json` 的
  `primitive` 枚举 + `tests/effects.test.mjs`。
- **改中文文案后重建 CJK 图集**：
  `node tools/fontgen/charset.mjs` 然后 `node tools/fontgen/gen.mjs --preset cjk`。
  本次已重建（1229 字，748KB）。新增汉字不入图集不会报错，只会**占宽不出墨**。
- **300 行上限**是硬门禁（`tools/check-import-rules.mjs`）。加代码前先看当前行数，
  超了就近职责拆文件（本次 `passiveView.ts` 就是这么来的）。
- **`wx` 端还没跑游戏流程**（`apps/wx/src/main.ts` 仍是空场景壳，issue #6）。
  两张图标已随 `assets/ui/**.png` 进 `pkg-assets` 分包，但 wx 侧还没读它们。
  接上时注意：wx 无 `<video>`，图标不受影响；`skillIcons`/`skillIconLayout` 是跨端纯代码，
  可直接复用，只需在 wx 壳补一次贴图加载（照 `uiShell.loadStill` 的写法走
  `extras.readBinary` → `wx.createImage()`）。
- **文件行数**（2026-10-05 图标修复后实测，改前先看；`tools/check-import-rules.mjs` 卡 ≤300）：
  ⚠️ **`runnerSim.ts` 已经 300 行整，一行余量都没有**——再加东西必须先就近拆文件。
  `runnerSim.ts` 300 / `buffEngine.ts` 296 / `movement.ts` 179 / `primitives.ts` 107 /
  `skillIcons.ts` 214 / `hudView.ts` 81 / `passiveView.ts` 41 /
  `box.ts` 169 / `button.ts` 141。

---

## 七、未决 / 待裁决

1. **图标视觉是否定稿**。当前两张由 ImageGen 出（品红底 → 抠图，见 §3.2），
   风格与大厅徽标同源但不是同一套抠图。要再换风格就重出图后**同名替换**，
   **不需要改任何代码**（暗态由 UI 乘暗，与素材无关）。
   已知观感取舍：暗态乘色用中性浅灰 `#9aa3b0` + 不透明度 0.72——早先的蓝灰 `#5a6478`
   会把琥珀金糊成灰饼、看不出那是闪电；再暗就会在亮沙背景上糊成一团半透明。
3. **被动「亮=生效」的口径是否够**。当前口径下 8 个角色的被动开局即亮（常驻），
   周期被动只在冲撞/充能窗口内亮。若想让周期被动**接近下次触发时预告性地亮**
   （提前 2 秒），需要给 `periodic` 槽位暴露 `nextAt`，那是新的派生位与新测试。
4. **3.1m 是否该再高一点**。当前 20/100 的时机占比与弹跳鞋实测（4.4~5.3m 带宽）同量级，
   已经是「可玩底线」口径。若继续加高，顶点会逼近甚至超过 3.0m 满格墙 ——
   虽然 `cls:'full'` 恒判负不会真被跳越，但**视觉上会出现「看起来能过、实际判死」的割裂**，
   正是 `obstacles.json` v1.9.1 当初加高墙要消除的问题。
