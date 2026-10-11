/**
 * 马耳女仆（char_pony → assets/characters/pony.glb）GLB 装配 + 姿态量化回归。
 *
 * 与鲸鱼女仆接入的差异：本资产 10 核心 clip + Laugh 与契约逐字一致（纯配置接入），
 * 这里守的是「马」特有的验收口径：
 *   - 朝向门禁：五官网格在 Head 的 -Z 侧（背对镜头，与篮球小子 +Z 历史回归防线同一条）
 *   - Q 版 3 头身 1.30m：Chest 0.62m / Head 0.74m，挂点按骨骼相对定位验证不漂移
 *   - 短腿抬脚低：放大后脚骨峰值必须高过 FOOT_ENTER_Y=0.24，否则落脚尘土一次不喷
 *   - Slide 姿态量化：髋降 ≈0.20m（相对 Idle 站立位）、马尾 rx 增量 ≈-42°（相对静息姿）
 *   - Death 姿态量化：躯干世界俯仰前倒 >40°、头 z 前移 <-0.3m（朝 -Z 前倒趴地）
 *   - ?anim=Laugh 锁播满 2s 一期自动交还（表演 clip 锁播=演示，不永久接管）
 *
 * 口径与 tests/renderWhaleClips.test.mjs 一致：直接走 createAnimAvatar 解析真实 glb。
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

const PONY = 'assets/characters/pony.glb';
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
    if (probe) feet.push({ L: probe.feet.L, R: probe.feet.R, act: probe.act, clip: probe.current, lock: probe.lock });
  }
  const log = globalThis.__trAnim ? [...globalThis.__trAnim.log] : [];
  avatar.setFootfallHandler(null);
  avatar.dispose();
  delete globalThis.__trAnim;
  return { events, feet, log };
}

test('马耳女仆装配成功：10 个核心 clip + Laugh 齐全（纯配置接入，代码清单零改）', async () => {
  const { log } = await drive(PONY, 0.2);
  assert.ok(log.length >= 1, '应有 clip 切换记录');
});

test('QA 锁表：Run/Slide/Fly/Hit/Death/Laugh 的时长与循环口径', async () => {
  const cases = [
    ['anim=Run', 'Run', 0.75, true],
    ['anim=Slide', 'Slide', 0.7, true],
    ['anim=Fly', 'Fly', 2.0, true],
    ['anim=Hit', 'Hit', 0.9, false],
    ['anim=Death', 'Death', 1.1, false],
    ['anim=Laugh', 'Laugh', 2.0, true],
  ];
  for (const [param, clip, dur, loop] of cases) {
    const { feet, log } = await drive(PONY, 0.5, 12, `debug&${param}`);
    assert.equal(feet.at(-1).act.clip, clip, `${param} 应锁到 ${clip}`);
    assert.ok(Math.abs(feet.at(-1).act.dur - dur) < 0.01, `${clip} 时长应为 ${dur}s`);
    assert.equal(log.find(e => e.clip === clip).loop, loop, `${clip} 的 loop 口径应为 ${loop}`);
  }
});

test('?anim=Laugh 播满 2s 一期后自动交还状态机（不永久接管、不会被定死）', async () => {
  const { feet } = await drive(PONY, 4, 12, 'debug&anim=Laugh');
  assert.equal(feet[30].clip, 'Laugh', '0.5s 时应锁播 Laugh');
  assert.equal(feet.at(-1).clip, 'Run', '4s 时应已交还状态机回 Run');
  assert.equal(feet.at(-1).lock, null, '探针 lock 应已清空');
});

test('马耳女仆锁 ?anim=Basketball（资产没有该 clip）→ 回落 Run，不静默不播', async () => {
  const { feet } = await drive(PONY, 0.5, 12, 'debug&anim=Basketball');
  assert.equal(feet.at(-1).clip, 'Run', '缺失的表演 clip 必须回落 Run');
});

test('朝向：五官网格在 Head 的 -Z 侧（背对镜头，防篮球小子 +Z 回归）', async () => {
  const avatar = await createAnimAvatar(adapter, PONY, 1, null);
  assert.ok(avatar);
  const { s } = runningState(0);
  for (let i = 0; i < 30; i++) avatar.update(1 / 60, s, noFx); // 不动 → Idle 姿
  const g = avatar.group;
  const head = g.getObjectByName('Head');
  assert.ok(head, 'Head 骨必须存在');
  const v = new THREE.Vector3();
  const headZ = head.getWorldPosition(v).z;
  for (const name of ['EyeL', 'EyeR', 'Nose', 'Mouth']) {
    const m = g.getObjectByName(name);
    assert.ok(m, `${name} 网格必须存在（五官在 -Z 侧的判据）`);
    assert.ok(m.getWorldPosition(v).z < headZ - 0.01, `${name} 应在 Head 的 -Z 侧`);
  }
  avatar.dispose();
});

test('无锁状态机：贴地前进时 Idle→Run 一次切换后持续循环，不跳 clip', async () => {
  const { log, feet } = await drive(PONY, 3);
  assert.deepEqual(log.map(e => e.clip), ['Idle', 'Run'],
    `只允许进场那一次 Idle→Run，实测 ${JSON.stringify(log.map(e => e.clip))}`);
  assert.equal(feet.at(-1).clip, 'Run');
});

test('脚部探针 + 落脚尘土：Run 期间双脚坐标合法、持续摆动且喷尘土（Q 版短腿阈值专项）', async () => {
  // 未放大的 Run 脚骨只到 0.258m，逼近 FOOT_ENTER_Y=0.24——靠 RUN_BONE_AMPS 放大才稳过。
  // 这条门禁防以后改小放大系数把落脚探测打失效。
  const { events, feet } = await drive(PONY, 4, 12, 'debug', true);
  assert.ok(feet.length > 200, '采样不足');
  for (const f of feet) {
    for (const foot of [f.L, f.R]) {
      assert.ok(foot && foot.every(Number.isFinite), `脚坐标应合法，实测 ${JSON.stringify(foot)}`);
      assert.ok(foot[1] > 0 && foot[1] < 0.7, `脚高度应在合理区间，实测 ${foot[1]}`);
    }
  }
  const ys = feet.map(f => f.L[1]);
  assert.ok(Math.max(...ys) - Math.min(...ys) > 0.15, '左脚应有可观测的抬落行程（摆腿放大生效）');
  assert.ok(Math.max(...ys) > 0.3, `左脚峰值 ${Math.max(...ys).toFixed(3)}m 应显著高过触地阈值 0.24m`);
  assert.ok(events.length >= 8, `落脚事件 ${events.length} 次过少：FootL/FootR 探测或阈值失效`);
});

test('buff 挂件锚点：Chest/Head 骨骼存在，chestY≈0.62m（Q 版 3 头身身高）', async () => {
  const avatar = await createAnimAvatar(adapter, PONY, 1, null);
  assert.ok(avatar);
  assert.ok(avatar.getBone('Chest'), 'Chest 骨必须存在（喷火/护盾锚点）');
  assert.ok(avatar.getBone('Head'), 'Head 骨必须存在（头盔锚点）');
  assert.ok(Math.abs(avatar.chestY - 0.62) < 0.08, `chestY 应约 0.62m，实测 ${avatar.chestY.toFixed(3)}`);
  avatar.dispose();
});

test('Slide 姿态量化：髋降 ≈0.20m、马尾 rx 增量 ≈-42°（相对静息姿）', async () => {
  // Idle 站立位髋高基线
  const idleAvatar = await createAnimAvatar(adapter, PONY, 1, null);
  const { s } = runningState(0);
  for (let i = 0; i < 60; i++) idleAvatar.update(1 / 60, s, noFx);
  const idleHipsY = idleAvatar.getBone('Hips').getWorldPosition(new THREE.Vector3()).y;
  const tailRestRx = idleAvatar.getBone('Tail').rotation.x * 180 / Math.PI;
  idleAvatar.dispose();
  delete globalThis.__trAnim;

  const slideAvatar = await createAnimAvatar(adapter, PONY, 1, new URLSearchParams('debug&anim=Slide'));
  const { s: s2 } = runningState(12);
  let minHipsY = Infinity, minTailRx = Infinity;
  const v = new THREE.Vector3();
  for (let i = 0; i < Math.round(0.7 * 60); i++) { // Slide 0.7s 一整轮
    s2.t += 1 / 60; s2.prevDistance = s2.distance; s2.distance += 12 / 60;
    slideAvatar.group.position.set(s2.x, s2.y, 0);
    slideAvatar.update(1 / 60, s2, noFx);
    minHipsY = Math.min(minHipsY, slideAvatar.getBone('Hips').getWorldPosition(v).y);
    minTailRx = Math.min(minTailRx, slideAvatar.getBone('Tail').rotation.x * 180 / Math.PI);
  }
  slideAvatar.dispose();
  delete globalThis.__trAnim;

  const drop = idleHipsY - minHipsY;
  assert.ok(Math.abs(drop - 0.20) < 0.06, `髋降应约 0.20m，实测 ${drop.toFixed(3)}m（Idle ${idleHipsY.toFixed(3)} → Slide ${minHipsY.toFixed(3)}）`);
  const tailDelta = minTailRx - tailRestRx;
  assert.ok(Math.abs(tailDelta - (-42)) < 10, `马尾 rx 增量应约 -42°，实测 ${tailDelta.toFixed(1)}°（静息 ${tailRestRx.toFixed(1)}° → 滑铲最低 ${minTailRx.toFixed(1)}°）`);
});

test('Death 姿态量化：躯干前倒（世界俯仰 >40°）、头朝 -Z 前移 <-0.3m', async () => {
  // 1.05s：Death(1.1s) 播完前、自动解锁前的定格趴姿
  const avatar = await createAnimAvatar(adapter, PONY, 1, new URLSearchParams('debug&anim=Death'));
  const { s } = runningState(12);
  for (let i = 0; i < Math.round(1.05 * 60); i++) {
    s.t += 1 / 60; s.prevDistance = s.distance; s.distance += 12 / 60;
    avatar.group.position.set(s.x, s.y, 0);
    avatar.update(1 / 60, s, noFx);
  }
  assert.equal(globalThis.__trAnim.current, 'Death', '1.05s 时应仍在 Death（1.1s 才播完解锁）');
  const chest = avatar.getBone('Chest');
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(chest.getWorldQuaternion(new THREE.Quaternion()));
  const pitch = Math.atan2(-up.z, up.y) * 180 / Math.PI; // 正=朝 -Z 前倒
  const headZ = avatar.getBone('Head').getWorldPosition(new THREE.Vector3()).z;
  assert.ok(pitch > 40, `躯干世界俯仰应前倒 >40°，实测 ${pitch.toFixed(1)}°`);
  assert.ok(headZ < -0.3, `头应朝 -Z 前移 <-0.3m，实测 ${headZ.toFixed(3)}`);
  avatar.dispose();
  delete globalThis.__trAnim;
});

test('铁律：资产缺失时静默回退（resolve null，不抛异常、不卡开局）', async () => {
  const avatar = await createAnimAvatar(adapter, 'assets/characters/nope.glb', 1, null);
  assert.equal(avatar, null, '拉取失败必须回退程序化模型');
});
