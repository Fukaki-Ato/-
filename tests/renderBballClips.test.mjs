/**
 * 篮球小子（char_bball → assets/characters/bball.glb）GLB 装配回归。
 *
 * 为什么单独立文件：它的 clip 集与奶龙不同源——没有 Laugh、多一个 Basketball（投篮）。
 * 头号阻塞就是 animClips 旧契约「CLIP_NAMES 缺一即不合格」会让整条 GLB 路径静默回退
 * 程序化模型（控制台只有一行 warn，局内表现为「角色根本不换」）。CORE/PERF 拆分后，
 * 这里把装配口径、缺失表演 clip 回落 Run、Basketball 的 LoopOnce、脚部探针全部固化成门禁。
 *
 * 口径与 tests/renderFootDust.test.mjs 一致：直接走 createAnimAvatar 解析真实 glb，
 * 不拿合成 clip 近似；QA 锁与 __trAnim 探针经 urlParams 注入（dev/QA 同一条路径）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';

// Node 无 DOM：GLTFLoader 载贴图要走 self.URL / createImageBitmap，垫一层桩（只取骨架+动画）
if (typeof globalThis.self === 'undefined') globalThis.self = globalThis;
if (typeof globalThis.createImageBitmap === 'undefined') {
  globalThis.createImageBitmap = async () => ({ width: 1, height: 1, close() {} });
}
if (typeof URL.createObjectURL !== 'function') URL.createObjectURL = () => 'blob:stub';
if (typeof URL.revokeObjectURL !== 'function') URL.revokeObjectURL = () => {};

const { createAnimAvatar } = await import('../packages/game/dist/render/animAvatar.js');
const { initialRunnerState } = await import('../packages/game/dist/core/sim/simTypes.js');

const NAILONG = 'assets/characters/nailoong.glb';
const BBALL = 'assets/characters/bball.glb';

/** GLTFLoader.parse 只认 ArrayBuffer（Node 的 Buffer 会被判成非 glTF 资产），这里转一手 */
const adapter = { extras: { readBinary: async (path) => {
  const b = readFileSync(path);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
} } };

const noFx = { flyT: 0, invincible: false, magnetT: 0, helmetT: 0, shieldLayers: 0 };

/** 贴地匀速前进的合成状态（只填 pickClip/animAvatar 读到的字段） */
function runningState(speed, supportY = 0) {
  const s = initialRunnerState();
  s.supportY = supportY;
  s.y = supportY;
  s.distance = 1;
  s.prevDistance = 1;
  return { s, speed };
}

/** 装配 + 驱动 sec 秒；urlParams 支持 'debug'（挂 __trAnim 探针）与 'anim=<Clip>'（QA 锁） */
async function drive(glb, sec, speed = 12, urlParams = 'debug', footfall = null) {
  const avatar = await createAnimAvatar(adapter, glb, 1, new URLSearchParams(urlParams));
  assert.ok(avatar, `GLB 装配失败（${glb}）：核心 clip 缺失或资产不合格`);
  const events = [];
  if (footfall) avatar.setFootfallHandler((x, y, z) => events.push({ x, y, z }));
  const { s } = runningState(speed);
  const dt = 1 / 60;
  const feet = [];
  for (let i = 0; i < Math.round(sec / dt); i++) {
    s.t += dt;
    s.prevDistance = s.distance;
    s.distance += speed * dt;
    avatar.group.position.set(s.x, s.y, 0); // avatarRig 的落位（支撑面高度）
    avatar.update(dt, s, noFx);
    const probe = globalThis.__trAnim;
    if (probe) feet.push({ L: probe.feet.L, R: probe.feet.R, act: probe.act });
  }
  const log = globalThis.__trAnim ? [...globalThis.__trAnim.log] : [];
  avatar.setFootfallHandler(null);
  avatar.dispose();
  delete globalThis.__trAnim; // 探针是全局单例，跨用例必须清，否则读到上一个 avatar 的快照
  return { events, feet, log };
}

test('篮球小子装配成功：10 个核心 clip 齐全（缺一即回退程序化模型，这里必须非 null）', async () => {
  const { log } = await drive(BBALL, 0.2);
  assert.ok(log.length >= 1, '应有 clip 切换记录');
});

test('QA 锁表：Run/Slide/Death/Basketball 的时长与循环口径（?anim= 同路径）', async () => {
  const cases = [
    ['anim=Run', 'Run', 0.75, true],
    ['anim=Slide', 'Slide', 0.7, true],
    ['anim=Fly', 'Fly', 2.0, true],
    ['anim=Death', 'Death', 1.1, false],
    ['anim=Basketball', 'Basketball', 2.0, false], // 首末姿差 117.16° → LoopOnce 保持末帧
  ];
  for (const [param, clip, dur, loop] of cases) {
    const { feet, log } = await drive(BBALL, 0.5, 12, `debug&${param}`);
    assert.equal(globalThis.__trAnim, undefined, 'drive 结束应清理探针');
    assert.equal(feet.at(-1).act.clip, clip, `${param} 应锁到 ${clip}`);
    assert.ok(Math.abs(feet.at(-1).act.dur - dur) < 0.01,
      `${clip} 时长应为 ${dur}s，实测 ${feet.at(-1).act.dur}`);
    const entry = log.find(e => e.clip === clip);
    assert.equal(entry.loop, loop, `${clip} 的 loop 口径应为 ${loop}`);
  }
});

test('篮球小子锁 ?anim=Laugh（资产没有该 clip）→ 回落 Run，不静默不播', async () => {
  const { feet } = await drive(BBALL, 0.5, 12, 'debug&anim=Laugh');
  assert.equal(feet.at(-1).act.clip, 'Run', '缺失的表演 clip 必须回落 Run');
});

test('奶龙回归：Laugh 仍能锁播且循环；锁 Basketball（奶龙没有）→ 回落 Run', async () => {
  const laugh = await drive(NAILONG, 0.5, 12, 'debug&anim=Laugh');
  assert.equal(laugh.feet.at(-1).act.clip, 'Laugh', '奶龙必须仍能播 Laugh');
  assert.equal(laugh.log.find(e => e.clip === 'Laugh').loop, true, 'Laugh 无缝故循环');

  const miss = await drive(NAILONG, 0.5, 12, 'debug&anim=Basketball');
  assert.equal(miss.feet.at(-1).act.clip, 'Run', '奶龙没有 Basketball，回落 Run');
});

test('无锁状态机：篮球小子贴地前进时 Idle→Run 一次切换后持续循环，不跳 clip', async () => {
  const { log, feet } = await drive(BBALL, 3);
  assert.deepEqual(log.map(e => e.clip), ['Idle', 'Run'],
    `只允许进场那一次 Idle→Run，实测 ${JSON.stringify(log.map(e => e.clip))}`);
  assert.equal(feet.at(-1).act.clip, 'Run');
});

test('脚部探针：Run 期间双脚世界坐标合法且持续摆动（amplify 与落脚探测命中骨骼）', async () => {
  const { events, feet } = await drive(BBALL, 4, 12, 'debug', true);
  assert.ok(feet.length > 200, '采样不足');
  for (const f of feet) {
    for (const foot of [f.L, f.R]) {
      assert.ok(foot && foot.every(Number.isFinite), `脚坐标应合法，实测 ${JSON.stringify(foot)}`);
      assert.ok(foot[1] > 0.05 && foot[1] < 1.2, `脚高度应在合理区间，实测 ${foot[1]}`);
      assert.ok(Math.abs(foot[0]) < 1.5 && Math.abs(foot[2]) < 1.5, '脚应在角色附近');
    }
  }
  const zs = feet.map(f => f.L[2]);
  assert.ok(Math.max(...zs) - Math.min(...zs) > 0.15, '左脚应有可观测的前后行程（摆腿放大生效）');
  // 落脚探测：cadence ≈ clip 0.75s / TS_MAX 1.4 ≈ 1.93Hz，4s × 2 脚 ≈ 15 次
  assert.ok(events.length >= 8, `落脚事件 ${events.length} 次过少：FootL/FootR 骨骼探测没命中`);
});

test('buff 挂件锚点：Chest/Head 骨骼存在，chestY ≈ 1.05m（喷火/头盔/护盾不漂移）', async () => {
  const avatar = await createAnimAvatar(adapter, BBALL, 1, null);
  assert.ok(avatar);
  assert.ok(avatar.getBone('Chest'), 'Chest 骨必须存在（喷火/护盾锚点）');
  assert.ok(avatar.getBone('Head'), 'Head 骨必须存在（头盔锚点）');
  assert.ok(Math.abs(avatar.chestY - 1.05) < 0.1, `chestY 应约 1.05m，实测 ${avatar.chestY.toFixed(3)}`);
  avatar.dispose();
});

test('步频 timeScale 随速度在 TS_MIN~TS_MAX 间变化（?debug 探针 act.ts）', async () => {
  const slow = await drive(BBALL, 3, 2, 'debug&anim=Run'); // 2 m/s → 2/2.25 ≈ 0.89
  const fast = await drive(BBALL, 3, 20, 'debug&anim=Run'); // 20 m/s → 截断到 TS_MAX 1.4
  const tsSlow = slow.feet.at(-1).act.ts, tsFast = fast.feet.at(-1).act.ts;
  assert.ok(tsSlow >= 0.6 && tsSlow <= 1.0, `慢速 timeScale 应接近 TS_MIN 档，实测 ${tsSlow}`);
  assert.ok(tsFast > tsSlow + 0.2, `高速 timeScale 应显著大于慢速，实测 ${tsSlow}→${tsFast}`);
});

test('铁律：资产缺失时静默回退（resolve null，不抛异常、不卡开局）', async () => {
  const avatar = await createAnimAvatar(adapter, 'assets/characters/nope.glb', 1, null);
  assert.equal(avatar, null, '拉取失败必须回退程序化模型');
});

test('迟到装配防护：场景已销毁（isDead）时放弃装配，不污染 __trAnim 探针', async () => {
  // 回归：重开一局/回菜单时上一局的 GLB 才加载完，晚到的 build() 曾把 __trAnim 覆盖成
  // 不再 update 的死实例（采样看到 time=0/ts=0 冻结快照，被误判成动画卡死）。
  const dead = await createAnimAvatar(adapter, BBALL, 1, new URLSearchParams('debug'), () => true);
  assert.equal(dead, null, '场景已死必须放弃装配');
  assert.equal(globalThis.__trAnim, undefined, '死实例不许挂载全局探针');
  // 对照：isDead 返回 false 时正常装配，且 ticks 随 update 增长
  const live = await createAnimAvatar(adapter, BBALL, 1, new URLSearchParams('debug'), () => false);
  assert.ok(live);
  const { s } = runningState(12);
  const dt = 1 / 60;
  const t0 = globalThis.__trAnim.ticks;
  for (let i = 0; i < 60; i++) {
    s.t += dt; s.prevDistance = s.distance; s.distance += 12 * dt;
    live.group.position.set(s.x, s.y, 0);
    live.update(dt, s, noFx);
  }
  assert.equal(globalThis.__trAnim.ticks - t0, 60, 'ticks 应逐帧递增（活实例标识）');
  live.dispose();
  delete globalThis.__trAnim;
});

test('QA 锁一次性 clip 播完自动解锁：?anim=Basketball 放完回状态机，不永久定帧', async () => {
  // 回归用户实测「一开始是好的，之后跑步/下蹲都没动作」：?anim=Basketball 是 URL 参数、
  // 跨刷新持久，LoopOnce+clamp 播完 2s 后若不解锁，角色永久定在投篮末帧。
  const avatar = await createAnimAvatar(adapter, BBALL, 1, new URLSearchParams('debug&anim=Basketball'));
  assert.ok(avatar);
  const { s } = runningState(12);
  const dt = 1 / 60;
  const seen = [];
  for (let i = 0; i < Math.round(4 / dt); i++) {
    s.t += dt;
    s.prevDistance = s.distance;
    s.distance += 12 * dt;
    avatar.group.position.set(s.x, s.y, 0);
    avatar.update(dt, s, noFx);
    seen.push(globalThis.__trAnim.current);
  }
  assert.equal(seen[30], 'Basketball', '0.5s 时应锁播 Basketball');
  assert.equal(seen.at(-1), 'Run', '4s 时应已自动解锁回状态机（修复点：不再定死）');
  assert.equal(globalThis.__trAnim.lock, null, '解锁后探针 lock 应为 null');
  avatar.dispose();
  delete globalThis.__trAnim;
});
