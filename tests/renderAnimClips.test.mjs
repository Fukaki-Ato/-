/**
 * 动作 clip 映射回归（CORE 10 + PERF 2：奶龙 nailoong.glb 带 Laugh、篮球小子 bball.glb 带
 * Basketball，见 render/animClips.ts 的 CORE_CLIP_NAMES / PERF_CLIP_NAMES）。
 * 为什么锁得这么细：状态→clip 的优先级是「玩家此刻在干什么」的翻译表，任意一条被改动
 * （比如把 Hit 放 Death 前面、Land 忘了播一次）都不会编译报错，只会让局内动作莫名错乱，
 * 所以把完整映射表、Land 的一次性、Turn 的方向、Death 的重新起播、?anim= QA 锁全部固化。
 * 纯函数回归：不 import three，node --test 直接跑 dist 产物（与其他 tests/*.test.mjs 同口径）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CLIP_NAMES, CORE_CLIP_NAMES, PERF_CLIP_NAMES, LOOPING_CLIPS, asClipName, createClipContext,
  isPerfClip, loopsForever, pickClip, readAnimLock,
} from '../packages/game/dist/render/animClips.js';

/** RunnerState 夹具（字段与 simTypes.ts 对齐；空装备默认值） */
const st = (over = {}) => ({
  t: 0, distance: 0, prevDistance: 0, lane: 0, x: 0, y: 0, vy: 0,
  sliding: false, slideT: 0, stunT: 0, invulnT: 0, hits: 0, alive: true, topple: 0,
  shocks: 0, coins: 0, nearMiss: 0, score: 0, gliding: false,
  energy: 0, skillCd: 0, casts: 0, supportY: 0, ...over,
});
/** FxState 夹具（freshFx 默认值） */
const fx = (over = {}) => ({
  magnetT: 0, magnetRadius: 0, bootsT: 0, jumpMul: 1, flyT: 0, helmetT: 0,
  shieldLayers: 0, shieldT: 0, boardT: 0, invincible: false, speedMul: 1, timeSlowMul: 1,
  avoidLookahead: 0, coinPct: 0, slideAddS: 0, buffPct: 0, cooldownMul: 1, pickupAllT: 0, ...over,
});
/** 行进中的状态：每次调用 distance 前进 0.15m（≈9m/s@60fps），供「在跑」判定用 */
const runner = (() => { let d = 0; return (over = {}) => { d += 0.15; return st({ distance: d, prevDistance: d - 0.15, ...over }); }; })();

test('资产契约：CORE 10 + PERF 2 共 12 个 clip 名，与 glb 内 AnimationClip.name 逐字一致', () => {
  assert.deepEqual([...CORE_CLIP_NAMES].sort(),
    ['Death', 'Fly', 'Hit', 'Idle', 'Jump', 'Land', 'Run', 'Slide', 'TurnLeft', 'TurnRight']);
  assert.deepEqual([...PERF_CLIP_NAMES].sort(), ['Basketball', 'Laugh'],
    '奶龙带 Laugh、篮球小子带 Basketball，两个资产的表演 clip 不同源');
  assert.deepEqual([...PERF_CLIP_NAMES].filter(isPerfClip).sort(), ['Basketball', 'Laugh']);
  assert.equal(isPerfClip('Run'), false, '核心 clip 不是表演 clip（锁播一期语义只对表演 clip 生效）');
  assert.equal(isPerfClip('Death'), false);
  assert.equal(CLIP_NAMES.length, 12, 'CORE 10 + PERF 2');
  assert.deepEqual([...CLIP_NAMES].sort(),
    ['Basketball', 'Death', 'Fly', 'Hit', 'Idle', 'Jump', 'Land', 'Laugh', 'Run', 'Slide', 'TurnLeft', 'TurnRight']);
  assert.equal(asClipName('Run'), 'Run');
  assert.equal(asClipName('run'), null, '大小写敏感：小写不是合法 clip 名');
  assert.equal(asClipName('Nope'), null);
});

test('循环契约：只有 Run/Slide/Laugh/Fly 可循环，其余一律播一次', () => {
  assert.deepEqual([...LOOPING_CLIPS].sort(), ['Fly', 'Laugh', 'Run', 'Slide']);
  for (const n of CLIP_NAMES) {
    assert.equal(loopsForever(n), ['Run', 'Slide', 'Laugh', 'Fly'].includes(n), `${n} 的循环口径`);
  }
  // 一次性 clip 被 ?anim= 锁定时也播放一次并保持末帧（Death 倒地定格的验收点）
  const ctx = createClipContext();
  assert.deepEqual(pickClip(st(), fx(), ctx, 1 / 60, 'Death'), { clip: 'Death', loop: false });
  assert.deepEqual(pickClip(st(), fx(), ctx, 1 / 60, 'TurnLeft'), { clip: 'TurnLeft', loop: false });
  assert.deepEqual(pickClip(st(), fx(), ctx, 1 / 60, 'Run'), { clip: 'Run', loop: true });
  assert.equal(loopsForever('Basketball'), false,
    'Basketball 首末姿差 117.16°，只能 LoopOnce（当成 Laugh 循环会每圈硬跳）');
});

test('完整映射表：待机/跑/跳/滑/飞/滑翔/受击/死亡各就位', () => {
  const idleCtx = createClipContext();
  assert.deepEqual(pickClip(st(), fx(), idleCtx), { clip: 'Idle', loop: false },
    '首帧未建立行进记忆 → Idle（默认展示动作）');

  const runCtx = createClipContext();
  pickClip(runner(), fx(), runCtx, 1 / 60); // 首帧只记 prevDist，仍展示 Idle
  assert.deepEqual(pickClip(runner(), fx(), runCtx, 1 / 60), { clip: 'Run', loop: true },
    '次帧检测到前行 → Run 循环');

  const jumpCtx = createClipContext();
  pickClip(runner(), fx(), jumpCtx, 1 / 60);
  assert.deepEqual(pickClip(runner({ y: 1.2, supportY: 0 }), fx(), jumpCtx, 1 / 60), { clip: 'Jump', loop: false },
    'Jump 播一次不循环');
  assert.deepEqual(pickClip(runner({ y: 2.4, supportY: 2.4 }), fx(), runCtx, 1 / 60), { clip: 'Run', loop: true },
    '站在 2.4m 车顶不算腾空（火车上跑步动画不正常的历史根因）');
  assert.deepEqual(pickClip(st({ sliding: true }), fx(), createClipContext()), { clip: 'Slide', loop: true });
  assert.deepEqual(pickClip(st(), fx({ flyT: 1 }), createClipContext()), { clip: 'Fly', loop: true });
  assert.deepEqual(pickClip(st({ gliding: true }), fx(), createClipContext()), { clip: 'Fly', loop: true },
    '滑翔（飞行器燃料耗尽的降落段）仍播 Fly');
  assert.deepEqual(pickClip(st({ stunT: 0.3 }), fx(), createClipContext()), { clip: 'Hit', loop: false },
    'Hit 播一次，末帧保持到硬直结束');
  assert.deepEqual(pickClip(st({ alive: false, topple: 1 }), fx(), createClipContext()), { clip: 'Death', loop: false, restart: true });
});

test('站立不动回 Idle：停住超过保持窗口才回落，单个无 step 帧不算停住', () => {
  const ctx = createClipContext();
  const a = runner(), b = runner();
  pickClip(a, fx(), ctx, 1 / 60);
  assert.equal(pickClip(b, fx(), ctx, 1 / 60).clip, 'Run', '前行时是 Run');
  // 关键回归：渲染帧率高于 sim 步频时（120Hz/144Hz 屏），没有 sim step 的渲染帧 distance 不变。
  // 旧实现按「本帧是否前进」判定，这种帧会掉回 Idle → Run 每帧被顶掉、action 每帧 reset()，
  // Run 的 time 永远卡在 0.02s，角色定格在 Idle/Run 混合姿（用户实机「一点都没有动」）。
  const stand = st({ distance: b.distance, prevDistance: b.prevDistance });
  assert.equal(pickClip(stand, fx(), ctx, 1 / 60).clip, 'Run',
    '只停了一帧（< MOVED_HOLD_S）仍算在跑：高刷屏上绝大多数渲染帧都没有 sim step');
  for (let i = 0; i < 7; i++) pickClip(stand, fx(), ctx, 1 / 60); // 累计 > 0.1s
  assert.deepEqual(pickClip(stand, fx(), ctx, 1 / 60), { clip: 'Idle', loop: false },
    '停住超过保持窗口 → Idle（暂停/未开局仍能回待机）');
});

test('帧率无关：60/90/120/144Hz 下 Run 都不被 Idle 顶掉（sim 60Hz 定步长）', () => {
  // 复刻 runnerScene.tick 的定步长累加：渲染帧率只决定「多久混一次」，sim 仍按 STEP_DT 推进。
  for (const fps of [60, 90, 120, 144]) {
    const ctx = createClipContext();
    const dt = 1 / fps;
    const STEP = 1 / 60;
    let d = 0, acc = 0, runFrames = 0, switches = 0, prev = null;
    const N = fps * 3;
    for (let i = 0; i < N; i++) {
      acc += dt;
      while (acc >= STEP) { d += 12 * STEP; acc -= STEP; } // 一步 0.2m >> MOVED_EPS
      const clip = pickClip(st({ distance: d, prevDistance: d }), fx(), ctx, dt).clip;
      if (prev !== null && clip !== prev) switches++; // 首帧不计（那时 prev 还是 null）
      prev = clip;
      if (clip === 'Run') runFrames++;
    }
    assert.equal(switches, 1, fps + 'Hz 只允许进场那一次切换（实测 ' + switches + ' 次）');
    assert.ok(runFrames / N > 0.98, fps + 'Hz Run 占比应 >98%（实测 ' + (100 * runFrames / N).toFixed(1) + '%）');
  }
});

test('优先级：死亡 > 受击 > 飞行/滑翔 > 滑铲 > 腾空 > 换道 > 跑', () => {
  const ctx = createClipContext();
  // 死亡压住一切（含受击/飞行/换道同时发生）
  assert.equal(pickClip(st({ alive: false, stunT: 1, lane: 1 }), fx({ flyT: 1 }), ctx).clip, 'Death');
  // 受击压住飞行与滑铲
  assert.equal(pickClip(st({ stunT: 1 }), fx({ flyT: 1 }), ctx).clip, 'Hit');
  // 飞行压住滑铲与腾空
  assert.equal(pickClip(st({ sliding: true, y: 1 }), fx({ flyT: 1 }), ctx).clip, 'Fly');
  // 滑铲压住腾空
  assert.equal(pickClip(st({ sliding: true, y: 1 }), fx(), ctx).clip, 'Slide');
  // 腾空压住换道
  assert.equal(pickClip(st({ y: 1, lane: 1 }), fx(), ctx).clip, 'Jump');
});

test('Land：腾空后的第一帧着地播一次（不循环），放完才回 Run', () => {
  const ctx = createClipContext();
  pickClip(runner(), fx(), ctx, 1 / 60); // 先建立行进记忆（首帧展示 Idle）
  assert.equal(pickClip(runner({ y: 1 }), fx(), ctx, 1 / 60).clip, 'Jump', '腾空帧播 Jump');
  assert.deepEqual(pickClip(runner({ y: 0 }), fx(), ctx, 1 / 60), { clip: 'Land', loop: false },
    '上一帧腾空本帧着地 → Land（一次性）');
  assert.equal(pickClip(runner(), fx(), ctx, 0.1).clip, 'Land', 'Land 0.3s 内持续播放');
  assert.equal(pickClip(runner(), fx(), ctx, 0.1).clip, 'Land', '余量仍 >0 时继续 Land');
  assert.equal(pickClip(runner(), fx(), ctx, 0.2).clip, 'Land', '衰减到 0 的那一帧仍算 Land');
  assert.deepEqual(pickClip(runner(), fx(), ctx, 0.2), { clip: 'Run', loop: true }, 'Land 放完回 Run');
});

test('Turn：换道方向决定 clip，播一次 ~0.2s 后淡回 Run', () => {
  const left = createClipContext();
  pickClip(runner(), fx(), left, 1 / 60); // 建立行进记忆
  assert.deepEqual(pickClip(runner({ lane: -1 }), fx(), left, 1 / 60), { clip: 'TurnLeft', loop: false }, 'lane -1 → TurnLeft');
  assert.equal(pickClip(runner({ lane: -1 }), fx(), left, 0.1).clip, 'TurnLeft', '0.2s 内持续转身');
  assert.equal(pickClip(runner({ lane: -1 }), fx(), left, 0.1).clip, 'TurnLeft', '余量 >0 时继续 TurnLeft');
  assert.deepEqual(pickClip(runner({ lane: -1 }), fx(), left, 0.2), { clip: 'Run', loop: true }, '转身结束回 Run');

  const right = createClipContext();
  pickClip(runner(), fx(), right, 1 / 60);
  assert.deepEqual(pickClip(runner({ lane: 1 }), fx(), right, 1 / 60), { clip: 'TurnRight', loop: false }, 'lane +1 → TurnRight');
  assert.equal(pickClip(runner({ lane: 1 }), fx(), right, 0.6).clip, 'TurnRight', '大步长也只按剩余时间衰减');
  assert.deepEqual(pickClip(runner({ lane: 1 }), fx(), right, 0.6), { clip: 'Run', loop: true });
});

test('Death：进场从 0 重起（restart），死亡期间不重复 restart，复活后再次死亡重新 restart', () => {
  const ctx = createClipContext();
  const first = pickClip(st({ alive: false }), fx(), ctx, 1 / 60);
  assert.equal(first.clip, 'Death');
  assert.equal(first.restart, true, '死亡进场必须重起（否则第二次死亡从暂停处继续放）');
  assert.equal(pickClip(st({ alive: false }), fx(), ctx, 1 / 60).restart, undefined, '死亡持续中不重复重起');
  pickClip(runner(), fx(), ctx, 1 / 60); // 复活且继续前行
  assert.equal(pickClip(runner(), fx(), ctx, 1 / 60).clip, 'Run', '复活回正常映射');
  assert.equal(pickClip(st({ alive: false }), fx(), ctx, 1 / 60).restart, true, '再次死亡重新重起');
});

test('?anim= QA 锁：合法 clip 名按其循环口径播放，非法名字忽略走正常映射', () => {
  assert.equal(readAnimLock(new URLSearchParams('anim=Laugh')), 'Laugh');
  assert.equal(readAnimLock(new URLSearchParams('anim=NoSuch')), null, '未定义的名字不锁');
  assert.equal(readAnimLock(new URLSearchParams('')), null);
  assert.equal(readAnimLock(null), null, 'wx 端无 urlParams 时不锁');

  const ctx = createClipContext();
  assert.deepEqual(pickClip(st({ alive: false, stunT: 1 }), fx({ flyT: 1 }), ctx, 1 / 60, 'Laugh'),
    { clip: 'Laugh', loop: true }, 'QA 锁压过死亡/受击/飞行；Laugh 无缝故循环');
  assert.deepEqual(pickClip(st({ y: 1 }), fx(), ctx, 1 / 60, 'Basketball'),
    { clip: 'Basketball', loop: false }, 'Basketball 锁了也播一次（首末差 117° 不能循环）');
  assert.equal(pickClip(st({ y: 1 }), fx(), ctx, 1 / 60, 'Bogus').clip, 'Jump', '非法锁名按正常映射');
  assert.equal(pickClip(st({ y: 1 }), fx(), ctx, 1 / 60, null).clip, 'Jump', '无锁按正常映射');
});

test('ctx 是渲染层本地记忆：同一 sim 状态下两个 ctx 互不串味', () => {
  const a = createClipContext(0), b = createClipContext(1);
  pickClip(runner({ lane: 1 }), fx(), a, 1 / 60);
  assert.equal(pickClip(runner({ lane: 1 }), fx(), a, 1 / 60).clip, 'TurnRight');
  pickClip(runner({ lane: 1 }), fx(), b, 1 / 60); // 先建立行进记忆（首帧仍展示 Idle）
  assert.equal(pickClip(runner({ lane: 1 }), fx(), b, 1 / 60).clip, 'Run',
    '新 ctx 的换道记忆从 lane=1 起算，同车道不再触发转身');
});
