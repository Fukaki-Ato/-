/**
 * 动作 clip 选择（纯函数、零依赖，node --test 直接回归；three 的播放胶水在 animAvatar.ts）
 * 数据来源：char_nailong → assets/characters/nailoong.glb 的 11 个命名动画 clip（资产契约：
 * Idle/Run/Laugh/Slide/Jump/TurnLeft/TurnRight/Fly/Land/Hit/Death，1 单位=1m、脚底在原点、面朝 -Z）。
 * 优先级（上层压下层，逐条对应「玩家此刻在干什么」）：
 *   ① QA 锁 ?anim=<ClipName>（仅 dev/QA，见 readAnimLock）→ 强制循环
 *   ② !alive → Death 播一次保持末帧；进死亡那一下从 0 重起（restart）
 *   ③ stunT>0 → Hit 循环
 *   ④ fx.flyT>0 || s.gliding → Fly 循环
 *   ⑤ s.sliding → Slide 循环
 *   ⑥ 离地(y > s.supportY + 0.05) → Jump；上一帧腾空且本帧着地 → Land 播一次 0.5s 后回 Run
 *   ⑦ 换道（s.lane 较上一帧 +1/-1）→ TurnRight/TurnLeft 播一次 ~0.3s，随后淡回 Run
 *   ⑧ 默认：本帧有前行（distance 前进）→ Run；原地不动 → Idle（默认展示动作）
 * 「离地」用 supportY 而非绝对高度：站在 2.4m 车顶/坡道上仍是跑，不是跳（同 avatarRig.pickAvatarMode
 * 的口径，历史上把它当滞空是「火车上跑步动画不正常」的根因）。
 * 循环口径（建模侧资产契约，逐字对应交付要求）：只有 Run/Slide/Laugh/Fly 首末无缝，可 LoopRepeat；
 * Idle/Jump/Hit/Land/TurnLeft/TurnRight/Death 一律 LoopOnce 播一次并保持末帧，由 animAvatar 在播完后收尾
 * （Idle 交回自身首帧做 0.12s 交叉淡化抹掉首末 110° 姿差；其余保持末帧，等状态切换自然淡出）。
 * 注：RunnerState 没有 speed 字段（simTypes.ts 逐字段确认），Run 的步频 timeScale 补偿放在
 * animAvatar 里按帧位移估算，本文件只决策「播哪个」，保持可纯函数回归。
 */
import type { FxState } from '@tr/game/core/effects/buffEngine.js';
import type { RunnerState } from '@tr/game/core/sim/simTypes.js';

/** 11 个 clip 名（与 glb 内 AnimationClip.name 逐字一致；缺任何一个即判资产不合格并回退程序化模型） */
export const CLIP_NAMES = [
  'Idle', 'Run', 'Laugh', 'Slide', 'Jump', 'TurnLeft', 'TurnRight', 'Fly', 'Land', 'Hit', 'Death',
] as const;
export type ClipName = typeof CLIP_NAMES[number];

/** 可无缝循环的 clip（建模侧实测首末姿一致）：其余一律只播一次 */
export const LOOPING_CLIPS = ['Run', 'Slide', 'Laugh', 'Fly'] as const;

/** 该 clip 能否 LoopRepeat。QA 锁与状态映射共用同一口径，禁止两头各写一份 */
export function loopsForever(name: ClipName): boolean {
  return (LOOPING_CLIPS as readonly string[]).includes(name);
}

/** 判定「离地」的高度余量（米）：站在支撑面上时 y=支撑面高度，跑动姿态；超出该余量才算腾空 */
const AIRBORNE_EPS = 0.05;
/** Land / Turn 的一次性播放时长（秒）：短到看不出是独立动作、又够接回 Run 的档位。
 *  Turn 0.5→0.3→0.2：实测玩家每 1s 换一次道（躲障碍的基本操作）时 Run 占比只有 44.9%，
 *  一半以上帧都在播转身演出，「跑步不持续」的直接原因。且 sim 的换道横向移动本身只要
 *  laneChangeS=0.18s（config/game.json），窗口比移动还长就是白播；0.2s 与移动时长对齐。
 *  Land 0.5→0.3：着地后角色已在地面且仍在前进，0.5s 的着地演出把 Run 切碎；
 *  15 例 golden 全赛道扫描（tests/renderTrackRun.test.mjs）实测这两项把
 *  「地面跑帧中 Run 占比」从 56.8% 提到 69.5%。 */
const LAND_S = 0.3, TURN_S = 0.2;
/** 判定「本帧在跑」的最小帧位移（米）：站立/未开局为 0，跑动中最慢也远大于该值 */
const MOVED_EPS = 0.02;
/** 距离停滞多久才回 Idle（秒）。
 *  历史上按「本帧距离是否前进」判定，在渲染帧率高于 sim 步频时必然误判：120Hz/144Hz 屏上
 *  没有 sim step 的渲染帧 distance 不变 → 掉回 Idle → Run 被 Idle 顶掉、action 每帧 reset()，
 *  Run 的 time 永远卡在 0.02s，角色定格在 Idle/Run 的混合姿（用户实机反馈「一点都没有动」，
 *  而 60fps 无头环境下 Run 占比 99% 一切正常——差别就在刷新率）。
 *  改成「最近 MOVED_HOLD_S 内前进过就算在跑」：0.1s 窗口在任何帧率下都至少覆盖一次
 *  sim step（STEP_DT=1/60），真正停住（未开局/后台暂停）0.1s 后仍回 Idle。 */
const MOVED_HOLD_S = 0.1;

export interface ClipPick {
  clip: ClipName;
  /** true=循环（LoopRepeat）；false=播一次保持末帧（LoopOnce + clampWhenFinished） */
  loop: boolean;
  /** Death 进场等「必须从第 0 帧重起」的时机（animAvatar 据此调 action.reset()） */
  restart?: boolean;
}

/**
 * 渲染层本地记忆（不写进 sim，docs/02 §5 单向数据流）：上一帧车道 / 上一帧是否腾空 /
 * 一次性动作剩余秒数 / 是否已处于死亡。每局新建（createClipContext）。
 */
export interface ClipContext {
  prevLane: number;
  /** 上一帧 distance：本帧有前行才算在跑，否则回 Idle（null=首帧，直接展示 Idle） */
  prevDist: number | null;
  /** 距离停滞累计秒（渲染帧 dt 累加；有前进即归零）。超过 MOVED_HOLD_S 才回 Idle，
   *  避免高刷新率下「没有 sim step 的渲染帧」被误判成站立不动（见 MOVED_HOLD_S 注释） */
  stillT: number;
  airborne: boolean;
  dead: boolean;
  /** Land / Turn 剩余秒与当前转向 clip（换道瞬间写入，每帧统一衰减，见 moved 之后的衰减块） */
  landT: number;
  /** Turn 剩余秒与当前转向 clip（换道瞬间写入，衰减期间持续播） */
  turnT: number;
  turnClip: 'TurnLeft' | 'TurnRight';
}

export function createClipContext(initLane = 0): ClipContext {
  return {
    prevLane: initLane, prevDist: null, stillT: MOVED_HOLD_S, airborne: false, dead: false,
    landT: 0, turnT: 0, turnClip: 'TurnRight',
  };
}

/** 把字符串收敛成合法 clip 名；非法返回 null（忽略 QA 锁，走正常映射） */
export function asClipName(name: string): ClipName | null {
  return (CLIP_NAMES as readonly string[]).includes(name) ? (name as ClipName) : null;
}

/** QA 锁读取（仅 dev/QA）：URLSearchParams 由壳层注入，本模块不 import 任何 app/宿主代码。 */
export function readAnimLock(urlParams?: URLSearchParams | null): ClipName | null {
  const raw = urlParams?.get('anim');
  return raw ? asClipName(raw) : null;
}

/**
 * 状态 → clip 映射。
 * @param dt 帧间隔（秒），仅用于衰减 Land/Turn 的剩余时间；单测可传固定步长
 * @param lock QA 锁（URLSearchParams 解出的原始串），合法则无视状态强制循环该 clip
 */
export function pickClip(
  s: RunnerState, fx: FxState, ctx: ClipContext, dt = 0, lock: string | null = null,
): ClipPick {
  // ① QA 锁：按该 clip 自己的循环口径播放（Death/Turn 等一次性 clip 锁了也播一次并定格）
  const locked = lock ? asClipName(lock) : null;
  if (locked) return { clip: locked, loop: loopsForever(locked) };

  // 本帧行进判定提前算：下面每个分支都可能直接 return，prevDist 每帧都必须更新。
  // 「在跑」看的是最近 MOVED_HOLD_S 内有没有前进过，不是本帧有没有前进——渲染帧率高于
  // sim 步频时，没有 step 的帧 distance 不变，按本帧判会把 Run 每帧切回 Idle（见常量注释）。
  const first = ctx.prevDist === null;
  const advanced = !first && s.distance - (ctx.prevDist as number) > MOVED_EPS;
  ctx.prevDist = s.distance;
  ctx.stillT = advanced ? 0 : ctx.stillT + Math.max(dt, 0);

  // ② 死亡：进场从 0 重起，播完保持末帧；同时清掉其它一次性记忆，避免复活瞬间串味
  if (!s.alive) {
    const entry = !ctx.dead; // 本次调用即死亡进场（复活后再次死亡也算一次新的进场）
    ctx.dead = true;
    ctx.prevLane = s.lane; ctx.airborne = false; ctx.landT = 0; ctx.turnT = 0;
    return entry ? { clip: 'Death', loop: false, restart: true } : { clip: 'Death', loop: false };
  }
  if (ctx.dead) ctx.dead = false; // 复活（重开一局换新 ctx，这里是双保险）

  // ⑦ 换道记账：先记后放，受击/飞行/滑铲/腾空时高优先级 clip 抢占播放
  if (s.lane !== ctx.prevLane) {
    ctx.turnClip = s.lane > ctx.prevLane ? 'TurnRight' : 'TurnLeft';
    ctx.turnT = TURN_S;
    ctx.prevLane = s.lane;
  }

  // ③ 受击
  if (s.stunT > 0) { ctx.turnT = 0; return { clip: 'Hit', loop: false }; } // Hit 播一次，末帧保持到硬直结束
  // ④ 飞行 / 滑翔（gliding 是飞行器燃料耗尽后的降落段，仍播 Fly）
  if (fx.flyT > 0 || s.gliding) { ctx.airborne = false; ctx.landT = 0; ctx.turnT = 0; return { clip: 'Fly', loop: true }; }
  // ⑤ 滑铲
  if (s.sliding) { ctx.airborne = false; ctx.landT = 0; ctx.turnT = 0; return { clip: 'Slide', loop: true }; }

  // ⑥ 腾空 → Jump；着陆那一帧 → Land（一次），Land 放完才回 Run
  const airborne = s.y > s.supportY + AIRBORNE_EPS;
  if (airborne) { ctx.airborne = true; ctx.landT = 0; ctx.turnT = 0; return { clip: 'Jump', loop: false }; }
  if (ctx.airborne) { ctx.airborne = false; ctx.landT = LAND_S; return { clip: 'Land', loop: false }; }
  if (ctx.landT > 0) { ctx.landT = Math.max(0, ctx.landT - dt); return { clip: 'Land', loop: false }; }

  // ⑦ 换道转身（一次 ~0.3s），放完淡回 Run（淡化在 animAvatar 的换切里统一做）。
  // 受击/飞行/滑铲/腾空抢占时 turnT 已清零：不补播过期转身，Run 不白被切走。
  if (ctx.turnT > 0) { ctx.turnT = Math.max(0, ctx.turnT - dt); return { clip: ctx.turnClip, loop: false }; }

  // ⑧ 默认：最近还在前进 → Run 循环；停住超过 MOVED_HOLD_S → Idle 播一次（默认展示动作）
  const base: ClipName = (!first && ctx.stillT < MOVED_HOLD_S) ? 'Run' : 'Idle';
  return { clip: base, loop: loopsForever(base) };
}
