/**
 * 阿牛（char_niu → assets/characters/niu.glb）GLB 装配 + 憨憨步态回归。
 *
 * 与前面四个角色的差异：本资产 12 clip = CORE 10 + PERF 3 里的两个（Laugh + Wave 招手），
 * 是第一个带 Wave 的角色——PERF_CLIP_NAMES/LOOPING_CLIPS 因它扩到 3 个/5 个。这里守的是：
 *   - 12 clip 装配与 QA 锁表（含 Wave 循环口径与锁播一期自动交还）
 *   - 朝向门禁：五官在 -Z 侧（牛无 Nose mesh，判据用 NostrilL——资产是鼻孔+口鼻）
 *   - 资产原始尺寸 1.30m：Chest 0.56m；局内放大到约 1.74m 的回归见 renderNiuScale.test.mjs
 *   - 【憨憨步态】摆臂主轴是 Z（X 轴恒 -90° 无摆动），同侧臂滞后腿 3~7 帧且相关>0.4——
 *     建模侧规格「摆臂滞后摆腿 4 帧」，×1.9 放大后必须仍然保持（防改放大系数抹平憨感）
 *   - 滑铲/倒地时大腹不陷地：Slide 整体 bbox 最低 > -0.06、Death 的 Body  mesh 不低于 -0.30
 *     （既有角色同量级：奶龙 Body -0.426 / 鲸鱼裙 -0.316 / 马耳脚 -0.288）
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

const NIU = 'assets/characters/niu.glb';
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

test('阿牛装配成功：10 核心 clip + Laugh + Wave 齐全（首个带 Wave 的角色）', async () => {
  const { log } = await drive(NIU, 0.2);
  assert.ok(log.length >= 1, '应有 clip 切换记录');
});

test('QA 锁表：Run/Slide/Fly/Death/Wave/Laugh/Jump/Hit 的时长与循环口径', async () => {
  const cases = [
    ['anim=Run', 'Run', 0.75, true],
    ['anim=Slide', 'Slide', 0.7, true],
    ['anim=Fly', 'Fly', 2.0, true],
    ['anim=Death', 'Death', 1.1, false],
    ['anim=Wave', 'Wave', 2.0, true],   // 招手：无缝循环（首末缝 0.0010m）
    ['anim=Laugh', 'Laugh', 2.0, true], // 拍肚笑：无缝循环
    ['anim=Jump', 'Jump', 0.9, false],
    ['anim=Hit', 'Hit', 0.9, false],    // Hit 必须 LoopOnce（首末姿差大）
  ];
  for (const [param, clip, dur, loop] of cases) {
    const { feet, log } = await drive(NIU, 0.5, 12, `debug&${param}`);
    assert.equal(feet.at(-1).act.clip, clip, `${param} 应锁到 ${clip}`);
    assert.ok(Math.abs(feet.at(-1).act.dur - dur) < 0.01, `${clip} 时长应为 ${dur}s`);
    assert.equal(log.find(e => e.clip === clip).loop, loop, `${clip} 的 loop 口径应为 ${loop}`);
  }
});

test('?anim=Wave 播满 2s 一期后自动交还状态机（表演 clip 锁播=演示，不永久接管）', async () => {
  const { feet } = await drive(NIU, 4, 12, 'debug&anim=Wave');
  assert.equal(feet[30].clip, 'Wave', '0.5s 时应锁播 Wave');
  assert.equal(feet.at(-1).clip, 'Run', '4s 时应已交还状态机回 Run');
  assert.equal(feet.at(-1).lock, null, '探针 lock 应已清空');
});

test('阿牛锁 ?anim=Basketball（资产没有该 clip）→ 回落 Run，不静默不播', async () => {
  const { feet } = await drive(NIU, 0.5, 12, 'debug&anim=Basketball');
  assert.equal(feet.at(-1).clip, 'Run', '缺失的表演 clip 必须回落 Run');
});

test('朝向：五官网格在 Head 的 -Z 侧（背对镜头；牛无 Nose，判据用 NostrilL）', async () => {
  const avatar = await createAnimAvatar(adapter, NIU, 1, null);
  assert.ok(avatar);
  const { s } = runningState(0);
  for (let i = 0; i < 30; i++) avatar.update(1 / 60, s, noFx); // 不动 → Idle 姿
  const g = avatar.group;
  const head = g.getObjectByName('Head');
  assert.ok(head, 'Head 骨必须存在');
  const v = new THREE.Vector3();
  const headZ = head.getWorldPosition(v).z;
  for (const name of ['EyeL', 'EyeR', 'Mouth', 'NostrilL']) {
    const m = g.getObjectByName(name);
    assert.ok(m, `${name} 网格必须存在（牛的面部判据）`);
    assert.ok(m.getWorldPosition(v).z < headZ - 0.01, `${name} 应在 Head 的 -Z 侧`);
  }
  avatar.dispose();
});

test('无锁状态机：贴地前进时 Idle→Run 一次切换后持续循环，不跳 clip', async () => {
  const { log, feet } = await drive(NIU, 3);
  assert.deepEqual(log.map(e => e.clip), ['Idle', 'Run'],
    `只允许进场那一次 Idle→Run，实测 ${JSON.stringify(log.map(e => e.clip))}`);
  assert.equal(feet.at(-1).clip, 'Run');
});

test('憨憨步态：同侧摆臂（Z 主轴）滞后摆腿 3~7 帧且相关 >0.4（建模规格 4 帧）', async () => {
  // 牛的臂环在 X 轴恒 -90°（无摆动），摆臂主轴是 Z；腿主轴是 X。逐帧采样后互相关找滞后。
  const avatar = await createAnimAvatar(adapter, NIU, 1, new URLSearchParams('debug'));
  const { s } = runningState(12);
  const arm = [], leg = [];
  for (let i = 0; i < 60 * 4; i++) {
    s.t += 1 / 60; s.prevDistance = s.distance; s.distance += 12 / 60;
    avatar.group.position.set(s.x, s.y, 0);
    avatar.update(1 / 60, s, noFx);
    if (globalThis.__trAnim.current !== 'Run') continue;
    const a = avatar.getBone('ArmUpperL'), l = avatar.getBone('LegLowerL');
    if (a && l) { arm.push(a.rotation.z * 180 / Math.PI); leg.push(l.rotation.x * 180 / Math.PI); }
  }
  avatar.dispose();
  delete globalThis.__trAnim;
  assert.ok(arm.length > 120, `Run 采样不足（${arm.length}）`);
  const n = arm.length;
  const mean = x => x.reduce((p, q) => p + q, 0) / x.length;
  const am = mean(arm), lm = mean(leg);
  const a = arm.map(x => x - am), l = leg.map(x => x - lm);
  let best = { lag: 0, corr: -2 };
  for (let lag = -24; lag <= 24; lag++) {
    let num = 0, da = 0, dl = 0, cnt = 0;
    for (let i = 0; i < n; i++) {
      const j = i + lag;
      if (j < 0 || j >= n) continue;
      num += a[i] * l[j]; da += a[i] * a[i]; dl += l[j] * l[j]; cnt++;
    }
    if (cnt < n * 0.5) continue;
    const corr = num / Math.sqrt(da * dl || 1);
    if (corr > best.corr) best = { lag, corr: +corr.toFixed(3) };
  }
  assert.ok(best.lag >= 3 && best.lag <= 7,
    `同侧臂应滞后腿 3~7 帧（规格 4 帧），实测 ${best.lag} 帧 corr=${best.corr}`);
  assert.ok(best.corr > 0.4, `臂-腿相关应 >0.4（波形可读），实测 ${best.corr}`);
});

test('脚部探针 + 落脚尘土：Run 期间双脚坐标合法、持续摆动且喷尘土（Q 版短腿阈值专项）', async () => {
  // 未放大脚骨只到 0.198m（低于阈值 0.24），靠 RUN_BONE_AMPS 放大才过——与鲸鱼/马耳同款专项。
  const { events, feet } = await drive(NIU, 4, 12, 'debug', true);
  assert.ok(feet.length > 200, '采样不足');
  for (const f of feet) {
    for (const foot of [f.L, f.R]) {
      assert.ok(foot && foot.every(Number.isFinite), `脚坐标应合法，实测 ${JSON.stringify(foot)}`);
      assert.ok(foot[1] > 0 && foot[1] < 0.7, `脚高度应在合理区间，实测 ${foot[1]}`);
    }
  }
  const ys = feet.map(f => f.L[1]);
  assert.ok(Math.max(...ys) - Math.min(...ys) > 0.15, '左脚应有可观测的抬落行程（摆腿放大生效）');
  assert.ok(Math.max(...ys) > 0.24, `左脚峰值 ${Math.max(...ys).toFixed(3)}m 必须高过触地阈值 0.24m，否则尘土不喷`);
  // 阿牛放大后峰值 ~0.31m 仅高出阈值 7cm，尘土密度低于 1.7m 级角色（实测 ~7 次/4s），
  // 这里只要求「确实在喷」不断流。
  assert.ok(events.length >= 4, `落脚事件 ${events.length} 次过少：FootL/FootR 探测或阈值失效`);
});

test('滑铲/倒地大腹不陷地：Slide 整体最低 > -0.06、Death 的 Body 不低于 -0.30', async () => {
  // Slide：实测最低是尾巴尖 -0.03（大腹不参与沉底）
  {
    const avatar = await createAnimAvatar(adapter, NIU, 1, new URLSearchParams('debug&anim=Slide'));
    const { s } = runningState(12);
    let minY = Infinity;
    for (let i = 0; i < Math.round(0.7 * 60); i++) {
      s.t += 1 / 60; s.prevDistance = s.distance; s.distance += 12 / 60;
      avatar.group.position.set(s.x, s.y, 0);
      avatar.update(1 / 60, s, noFx);
      avatar.group.updateMatrixWorld(true);
      const b = new THREE.Box3().setFromObject(avatar.group, true);
      minY = Math.min(minY, b.min.y);
    }
    avatar.dispose();
    delete globalThis.__trAnim;
    assert.ok(minY > -0.06, `滑铲整体最低点应 > -0.06m（大腹不陷地），实测 ${minY.toFixed(3)}`);
  }
  // Death：1.05s 定格趴姿（1.1s 播完前）。Body 实测 -0.239，与既有角色同量级
  {
    const avatar = await createAnimAvatar(adapter, NIU, 1, new URLSearchParams('debug&anim=Death'));
    const { s } = runningState(12);
    let bodyMin = Infinity;
    for (let i = 0; i < Math.round(1.05 * 60); i++) {
      s.t += 1 / 60; s.prevDistance = s.distance; s.distance += 12 / 60;
      avatar.group.position.set(s.x, s.y, 0);
      avatar.update(1 / 60, s, noFx);
      avatar.group.updateMatrixWorld(true);
      const body = avatar.group.getObjectByName('Body');
      if (body) bodyMin = Math.min(bodyMin, new THREE.Box3().setFromObject(body, true).min.y);
    }
    avatar.dispose();
    delete globalThis.__trAnim;
    assert.ok(bodyMin > -0.30,
      `倒地时 Body 最低点应 > -0.30m（奶龙 -0.426/鲸鱼 -0.316/马耳 -0.288 的同量级或更浅），实测 ${bodyMin.toFixed(3)}`);
  }
});

test('buff 挂件锚点：Chest/Head 骨骼存在，chestY≈0.56m（Q 版身高）', async () => {
  const avatar = await createAnimAvatar(adapter, NIU, 1, null);
  assert.ok(avatar);
  assert.ok(avatar.getBone('Chest'), 'Chest 骨必须存在（喷火/护盾锚点）');
  assert.ok(avatar.getBone('Head'), 'Head 骨必须存在（头盔锚点）');
  assert.ok(Math.abs(avatar.chestY - 0.56) < 0.08, `chestY 应约 0.56m，实测 ${avatar.chestY.toFixed(3)}`);
  avatar.dispose();
});

test('回归：frog（原奶龙资产）Laugh 与牢大 Basketball 仍可锁播（PERF 扩到 3 个不破坏老角色）', async () => {
  // main 上奶龙已改名 char_frog（GLB 移到 frog.glb，与旧 nailoong.glb 同哈希）；
  //  frog Laugh 是 1.4s（whale/mambo/niu 才是 2.0s）——老资产时长原样断言，防回归改动
  for (const [glb, clip, dur, loop] of [
    ['assets/characters/frog.glb', 'Laugh', 1.4, true],
    ['assets/characters/bball.glb', 'Basketball', 2.0, false],
  ]) {
    const { feet, log } = await drive(glb, 0.5, 12, `debug&anim=${clip}`);
    assert.equal(feet.at(-1).act.clip, clip, `${glb} 的 ${clip} 应仍可锁播`);
    assert.ok(Math.abs(feet.at(-1).act.dur - dur) < 0.02, `${clip} 时长应 ${dur}s，实测 ${feet.at(-1).act.dur}`);
    assert.equal(log.find(e => e.clip === clip).loop, loop, `${clip} 循环口径不变`);
  }
});

test('铁律：资产缺失时静默回退（resolve null，不抛异常、不卡开局）', async () => {
  const avatar = await createAnimAvatar(adapter, 'assets/characters/nope.glb', 1, null);
  assert.equal(avatar, null, '拉取失败必须回退程序化模型');
});
