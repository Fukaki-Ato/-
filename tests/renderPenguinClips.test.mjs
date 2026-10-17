/**
 * 企鹅娘（char_penguin → assets/characters/penguin.glb）GLB 装配 + 短腿落脚阈值回归。
 *
 * 与前面五个角色的差异：本资产 14 clip = CORE 10 + PERF 4（Laugh/Wave/RaiseHand/Hop），
 * 是第一个带 RaiseHand/Hop 的角色——PERF_CLIP_NAMES 因它扩到 5 个。这里守的是：
 *   - 14 clip 装配与 QA 锁表（含 RaiseHand/Hop 的一次性口径与锁播一期自动交还）
 *   - 朝向门禁：五官在 -Z 侧（背对镜头，+Z 历史回归防线）
 *   - Q 版 1.25m：Chest 0.555m；挂点按骨骼相对定位验证不漂移
 *   - 【短腿落脚阈值】企鹅腿是腹内隐藏桩，放大后脚骨仍只到 ~0.105m，低于 FOOT_ENTER_Y=0.24
 *     → 固定阈值下双脚永远不出触地区、尘土一次不喷。animAvatar 已做自适应兜底（量程中点），
 *     本条门禁固化为「尘土 > 0 且阈值落在资产量程内」，防兜底被改回去
 *   - 长腿角色回归：frog（Laugh）/ 牢大 volt 承接的 bball.glb（Basketball）/ mambo（Laugh）
 *     锁播与口径不变（注意 main 上 char_bball 已并入 char_volt， Basketball 走 bball.glb）
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

const PENGUIN = 'assets/characters/penguin.glb';
const adapter = { extras: { readBinary: async (path) => {
  const b = readFileSync(path);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
} } };
const noFx = { flyT: 0, invincible: false, magnetT: 0, helmetT: 0, shieldLayers: 0 };

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
    avatar.group.position.set(s.x, s.y, 0);
    avatar.update(dt, s, noFx);
    const probe = globalThis.__trAnim;
    if (probe) feet.push({ L: probe.feet.L, R: probe.feet.R, act: probe.act, clip: probe.current, lock: probe.lock, footEnterY: probe.footEnterY });
  }
  const log = globalThis.__trAnim ? [...globalThis.__trAnim.log] : [];
  avatar.setFootfallHandler(null);
  avatar.dispose();
  delete globalThis.__trAnim;
  return { events, feet, log };
}

test('企鹅娘装配成功：10 核心 clip + Laugh/Wave/RaiseHand/Hop 齐全', async () => {
  const { log } = await drive(PENGUIN, 0.2);
  assert.ok(log.length >= 1, '应有 clip 切换记录');
});

test('QA 锁表：10 个锁播项的时长与循环口径', async () => {
  // 资产实测时长（建模侧契约 ±0.025s 口径：契约 0.75/0.7/2.0/1.1/0.9，实测略长但全部在带内）；
  // 探针 dur 保留 2 位小数，断言带 ±0.02
  const cases = [
    ['anim=Run', 'Run', 0.775, true],
    ['anim=Slide', 'Slide', 0.725, true],
    ['anim=Fly', 'Fly', 2.025, true],
    ['anim=Death', 'Death', 1.125, false],
    ['anim=Wave', 'Wave', 2.025, true],        // 首末=静止姿，Wave 已在 LOOPING_CLIPS（niu 带入）
    ['anim=RaiseHand', 'RaiseHand', 2.025, false], // 首末=静止姿：一次性
    ['anim=Hop', 'Hop', 2.025, false],             // 首末=静止姿：一次性
    ['anim=Laugh', 'Laugh', 2.025, true],      // 无缝循环（缝 0.006m）
    ['anim=Jump', 'Jump', 0.925, false],
    ['anim=Hit', 'Hit', 0.925, false],       // Hit 必须 LoopOnce
  ];
  for (const [param, clip, dur, loop] of cases) {
    const { feet, log } = await drive(PENGUIN, 0.5, 12, `debug&${param}`);
    assert.equal(feet.at(-1).act.clip, clip, `${param} 应锁到 ${clip}`);
    assert.ok(Math.abs(feet.at(-1).act.dur - dur) < 0.02, `${clip} 时长应 ~${dur}s，实测 ${feet.at(-1).act.dur}`);
    assert.equal(log.find(e => e.clip === clip).loop, loop, `${clip} 的 loop 口径应为 ${loop}`);
  }
});

test('RaiseHand/Hop 锁播满 2s 一期后自动交还状态机（不永久接管）', async () => {
  for (const clip of ['RaiseHand', 'Hop']) {
    const { feet } = await drive(PENGUIN, 4, 12, `debug&anim=${clip}`);
    assert.equal(feet[30].clip, clip, `0.5s 时应锁播 ${clip}`);
    assert.equal(feet.at(-1).clip, 'Run', `4s 时应已交还状态机回 Run（${clip}）`);
    assert.equal(feet.at(-1).lock, null, `探针 lock 应已清空（${clip}）`);
  }
});

test('企鹅锁 ?anim=Basketball（资产没有该 clip）→ 回落 Run，不静默不播', async () => {
  const { feet } = await drive(PENGUIN, 0.5, 12, 'debug&anim=Basketball');
  assert.equal(feet.at(-1).clip, 'Run', '缺失的表演 clip 必须回落 Run');
});

test('朝向：五官网格在 Head 的 -Z 侧（背对镜头，防 +Z 回归）', async () => {
  const avatar = await createAnimAvatar(adapter, PENGUIN, 1, null);
  assert.ok(avatar);
  const { s } = runningState(0);
  for (let i = 0; i < 30; i++) avatar.update(1 / 60, s, noFx); // 不动 → Idle 姿
  const g = avatar.group;
  const head = g.getObjectByName('Head');
  assert.ok(head, 'Head 骨必须存在');
  const v = new THREE.Vector3();
  const headZ = head.getWorldPosition(v).z;
  const eye = g.getObjectByName('EyeL') ?? g.getObjectByName('Eye');
  assert.ok(eye, '眼部网格必须存在（朝向判据）');
  assert.ok(eye.getWorldPosition(v).z < headZ - 0.005, `眼部应在 Head 的 -Z 侧（headZ=${headZ.toFixed(3)}）`);
  avatar.dispose();
});

test('无锁状态机：贴地前进时 Idle→Run 一次切换后持续循环，不跳 clip', async () => {
  const { log, feet } = await drive(PENGUIN, 3);
  assert.deepEqual(log.map(e => e.clip), ['Idle', 'Run'],
    `只允许进场那一次 Idle→Run，实测 ${JSON.stringify(log.map(e => e.clip))}`);
  assert.equal(feet.at(-1).clip, 'Run');
});

test('短腿落脚阈值：自适应兜底生效（尘土 > 0 且阈值落在资产脚程内）', async () => {
  // 企鹅放大后脚骨 ~0.06~0.105m，低于 FOOT_ENTER_Y=0.24——固定阈值下尘土一次不喷。
  // animAvatar 按本资产 Run 量程取中点兜底；长腿角色（量程跨过 0.24）行为不变。
  const { events, feet } = await drive(PENGUIN, 4, 12, 'debug', true);
  assert.ok(feet.length > 200, '采样不足');
  for (const f of feet) {
    for (const foot of [f.L, f.R]) {
      assert.ok(foot && foot.every(Number.isFinite), `脚坐标应合法，实测 ${JSON.stringify(foot)}`);
      assert.ok(foot[1] > 0 && foot[1] < 0.5, `脚高度应在合理区间，实测 ${foot[1]}`);
    }
  }
  const ys = feet.map(f => f.L[1]);
  const lo = Math.min(...ys), hi = Math.max(...ys);
  const threshold = feet.at(-1).footEnterY;
  assert.ok(threshold > lo && threshold < hi,
    `自适应阈值 ${threshold} 必须落在脚程 [${lo.toFixed(3)}, ${hi.toFixed(3)}] 内才能进出触地区`);
  assert.ok(threshold < 0.24, `短腿资产阈值应低于默认 0.24，实测 ${threshold}`);
  assert.ok(events.length >= 8, `落脚事件 ${events.length} 次过少：自适应兜底没生效`);
});

test('长腿角色回归：默认阈值 0.24 不变（自适应只兜底短腿资产）', async () => {
  const { feet, events } = await drive('assets/characters/whale.glb', 3, 12, 'debug', true);
  assert.equal(feet.at(-1).footEnterY, 0.24, '鲸鱼脚程跨过 0.24，阈值必须保持默认');
  assert.ok(events.length > 0, '鲸鱼尘土应仍在');
});

test('buff 挂件锚点：Chest/Head 骨骼存在，chestY≈0.555m（Q 版 1.25m 身高）', async () => {
  const avatar = await createAnimAvatar(adapter, PENGUIN, 1, null);
  assert.ok(avatar);
  assert.ok(avatar.getBone('Chest'), 'Chest 骨必须存在（喷火/护盾锚点）');
  assert.ok(avatar.getBone('Head'), 'Head 骨必须存在（头盔锚点）');
  assert.ok(Math.abs(avatar.chestY - 0.555) < 0.08, `chestY 应约 0.555m，实测 ${avatar.chestY.toFixed(3)}`);
  avatar.dispose();
});

test('回归：frog（Laugh）/ 牢大 volt 承接的 bball.glb（Basketball）/ mambo（Laugh）锁播不变', async () => {
  // main 上 char_bball 已并入 char_volt（prefab=bball.glb），Basketball 回归走资产本身
  for (const [glb, clip, dur, loop] of [
    ['assets/characters/frog.glb', 'Laugh', 1.4, true],
    ['assets/characters/bball.glb', 'Basketball', 2.0, false],
    ['assets/characters/pony.glb', 'Laugh', 2.0, true],
  ]) {
    const { feet, log } = await drive(glb, 0.5, 12, `debug&anim=${clip}`);
    assert.equal(feet.at(-1).act.clip, clip, `${glb} 的 ${clip} 应仍可锁播`);
    assert.ok(Math.abs(feet.at(-1).act.dur - dur) < 0.03, `${clip} 时长应 ${dur}s，实测 ${feet.at(-1).act.dur}`);
    assert.equal(log.find(e => e.clip === clip).loop, loop, `${clip} 循环口径不变`);
  }
});

test('铁律：资产缺失时静默回退（resolve null，不抛异常、不卡开局）', async () => {
  const avatar = await createAnimAvatar(adapter, 'assets/characters/nope.glb', 1, null);
  assert.equal(avatar, null, '拉取失败必须回退程序化模型');
});
