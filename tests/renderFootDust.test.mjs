/**
 * 落脚尘土 + 步频回归（render/animAvatar 的落脚探测 + render/footDust 池）。
 *
 * 为什么值得单独立门禁：
 *   奶龙 Run 的脚行程只有 0.65m/周期，而 12 m/s 下一个周期身体前进 6.7m——脚相对地面
 *   90% 在滑。用户四轮反馈的落点都是「看不出在跑步」，代码侧能做的只有两件：
 *   ① 把步频/摆腿从「风车档」调回可读档（本文件用真实 GLB 跑整条管线量化）；
 *   ② 给每次蹬地补一圈贴地尘土，把滑步读成蹬地（本文件验 cadence 与平流）。
 *   步幅本身受腿长锁死，无代码解，只能等建模侧重导 sprint cycle（见 animAmplify.ts 头）。
 *
 * 真实资产口径：直接走 createAnimAvatar（GLTFLoader 解析 nailoong.glb → 11 clip 装配 →
 * amplifyClipSwing → mixer），不拿合成 clip 近似，数值与局内逐帧一致。
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
const { createFootDust } = await import('../packages/game/dist/render/footDust.js');
const { initialRunnerState } = await import('../packages/game/dist/core/sim/simTypes.js');

const GLB = 'assets/characters/nailoong.glb';
/** GLTFLoader.parse 只认 ArrayBuffer（Node 的 Buffer 会被判成非 glTF 资产），这里转一手 */
const adapter = { extras: { readBinary: async () => {
  const b = readFileSync(GLB);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
} } };
/** 局内基础速度（config/game.json runner.baseSpeed）：步频门禁按它算 */
const BASE_SPEED = 12;

/** 造一个「贴地匀速前进」的合成状态（只填 pickClip/animAvatar 读到的字段） */
function runningState(speed, supportY = 0) {
  const s = initialRunnerState();
  s.supportY = supportY;
  s.y = supportY;
  s.distance = 1; // 首帧 prevDist=null 不判 moved，给个非零起点让第二帧起就算在跑
  s.prevDistance = 1;
  return { s, speed };
}

const noFx = { flyT: 0, invincible: false, magnetT: 0, helmetT: 0, shieldLayers: 0 };

/** 驱动 avatar 跑 sec 秒，返回落脚事件与每帧脚世界坐标。
 *  先落位再 update——与 avatarRig 的真实顺序一致（落脚探测读的是本帧脚世界坐标）。 */
async function drive(sec, speed = BASE_SPEED, supportY = 0) {
  const avatar = await createAnimAvatar(adapter, GLB, 1, null);
  assert.ok(avatar, 'GLB 装配失败（资产/垫片问题，先查资产再查本测试）');
  const events = [];
  avatar.setFootfallHandler((x, y, z) => events.push({ x, y, z }));
  const { s } = runningState(speed, supportY);
  const dt = 1 / 60;
  const feet = [];
  for (let i = 0; i < Math.round(sec / dt); i++) {
    s.t += dt;
    s.prevDistance = s.distance;
    s.distance += speed * dt;
    avatar.group.position.set(s.x, s.y, 0); // avatarRig 的落位（支撑面高度）
    avatar.update(dt, s, noFx);
    // 混流器已推进，取本帧双脚世界坐标（与局内探针 __trAnim.feet 同口径）
    const g = avatar.group;
    const L = g.getObjectByName('FootL'), R = g.getObjectByName('FootR');
    if (L && R) {
      feet.push({
        L: L.getWorldPosition(new THREE.Vector3()).clone(),
        R: R.getWorldPosition(new THREE.Vector3()).clone(),
      });
    }
  }
  avatar.setFootfallHandler(null);
  avatar.dispose();
  return { events, feet };
}

test('落脚探测：贴地 12 m/s 跑 6 秒，每只脚每周期落地一次', async () => {
  const { events } = await drive(6);
  // 局内周期 = clip 0.725s / TS_MAX；TS_MAX=1.4 → 1.93Hz，6s ≈ 11.6 周期 × 2 脚 ≈ 23 次
  const expected = (6 / (0.725 / 1.4)) * 2;
  assert.ok(events.length >= expected * 0.8 && events.length <= expected * 1.2,
    `落脚次数 ${events.length} 偏离理论值 ${expected.toFixed(1)}（周期/步频被改动？）`);
});

test('落脚探测：y 取支撑面高度（车顶/坡道也贴地），x/z 在角色附近', async () => {
  const { events } = await drive(3, BASE_SPEED, 2.4); // 站在 2.4m 列车顶
  assert.ok(events.length > 0, '车顶上没有落脚事件');
  for (const e of events) {
    assert.ok(Math.abs(e.y - (2.4 + 0.03)) < 1e-6, `尘土高度应贴在支撑面上，实测 ${e.y}`);
    assert.ok(Math.abs(e.x) < 1.5 && Math.abs(e.z) < 1.5, `落脚位置应靠近角色，实测 (${e.x},${e.z})`);
  }
});

test('落脚探测：离地/站立时不发事件', async () => {
  const avatar = await createAnimAvatar(adapter, GLB, 1, null);
  const events = [];
  avatar.setFootfallHandler((x, y, z) => events.push({ x, y, z }));
  const s = initialRunnerState();
  s.distance = 1;
  s.y = 1.2; s.supportY = 0; // 腾空（Jump clip）
  const dt = 1 / 60;
  for (let i = 0; i < 120; i++) { s.t += dt; s.prevDistance = s.distance; s.distance += 12 * dt; avatar.update(dt, s, noFx); }
  assert.equal(events.length, 0, '腾空时不应有落脚尘土');

  // 站立不动（distance 不推进 → Idle）
  for (let i = 0; i < 120; i++) { s.t += dt; avatar.update(dt, s, noFx); }
  assert.equal(events.length, 0, '站立时不应有落脚尘土');
  avatar.setFootfallHandler(null);
  avatar.dispose();
});

test('步频门禁：12 m/s 下 cadence ∈ [1.6, 2.4]Hz、脚峰值速度 ≤ 9 m/s（防回风车档）', async () => {
  const { feet } = await drive(5);
  assert.ok(feet.length > 200, '采样不足');
  // cadence：用左脚世界 Y 的过零周期估计（一个周期两次触地）
  const ys = feet.map(f => f.L.y);
  const mean = ys.reduce((a, b) => a + b, 0) / ys.length;
  let crossings = 0;
  for (let i = 1; i < ys.length; i++) {
    if (ys[i - 1] < mean && ys[i] >= mean) crossings++;
  }
  const secs = feet.length / 60;
  const cadence = crossings / 2 / secs; // 每周期 2 次上行穿均值
  assert.ok(cadence >= 1.6 && cadence <= 2.4, `cadence=${cadence.toFixed(2)}Hz 越界（TS_MAX 被改动？）`);

  const peak = a => {
    let m = 0;
    for (let i = 1; i < a.length; i++) m = Math.max(m, a[i].distanceTo(a[i - 1]) * 60);
    return m;
  };
  const pk = Math.max(peak(feet.map(f => f.L)), peak(feet.map(f => f.R)));
  assert.ok(pk <= 9, `脚峰值速度 ${pk.toFixed(1)} m/s 超过 9 m/s：摆腿又回到风车档了`);
  assert.ok(pk >= 3, `脚峰值速度 ${pk.toFixed(1)} m/s 过低：腿基本不动，读不出跑步`);
});

test('步态门禁：左右脚反相（交替）且不陷地', async () => {
  const { feet } = await drive(5);
  const n = feet.length;
  const zL = feet.map(f => f.L.z), zR = feet.map(f => f.R.z);
  const mL = zL.reduce((a, b) => a + b, 0) / n, mR = zR.reduce((a, b) => a + b, 0) / n;
  let num = 0, dl = 0, dr = 0;
  for (let i = 0; i < n; i++) {
    const a = zL[i] - mL, b = zR[i] - mR;
    num += a * b; dl += a * a; dr += b * b;
  }
  const corr = num / Math.sqrt(dl * dr);
  assert.ok(corr < -0.85, `左右脚相位相关系数 ${corr.toFixed(3)}，应强反相（交替）`);
  const minY = Math.min(...feet.map(f => Math.min(f.L.y, f.R.y)));
  assert.ok(minY > 0.05, `脚最低点 ${minY.toFixed(3)}m，陷地或穿模`);
});

// ---------- footDust 池 ----------

/** 取池中第一个尘土组（测试专用：spawn 后按创建顺序回收） */
function firstPuff(scene) {
  const g = scene.children.find(c => c.type === 'Group' && c.children.some(ch => ch.geometry?.type === 'RingGeometry'));
  return g;
}

test('footDust：spawn 后可见，按寿命淡出并回收槽位', () => {
  const scene = new THREE.Scene();
  const dust = createFootDust(scene);
  assert.equal(scene.children.length, 12, '池容量 12');
  const g = firstPuff(scene);
  assert.equal(g.visible, false, '初始隐藏');
  dust.spawn(0.5, 0.03, -0.2);
  assert.equal(g.visible, true, 'spawn 后可见');
  assert.deepEqual([g.position.x, g.position.y, g.position.z], [0.5, 0.03, -0.2], '生成在给定位置');
  const mat = g.children[0].material;
  assert.ok(mat.opacity > 0, '初始有透明度');
  dust.update(0.34, 12); // 正好一个寿命
  assert.equal(g.visible, false, '寿命结束隐藏');
  assert.equal(mat.opacity, 0, '寿命结束全透明');
  dust.dispose();
});

test('footDust：随赛道同速向 +z 平流，否则会飘在角色前面', () => {
  const scene = new THREE.Scene();
  const dust = createFootDust(scene);
  const g = firstPuff(scene);
  dust.spawn(0, 0, 0);
  const z0 = g.position.z;
  for (let i = 0; i < 10; i++) dust.update(1 / 60, 12); // 12 m/s × 1/6s = 2m
  assert.ok(Math.abs((g.position.z - z0) - 2) < 1e-6, `平流距离 ${(g.position.z - z0).toFixed(3)}m，应为 2m`);
  dust.dispose();
});

test('footDust：池满时静默丢弃，不抛异常', () => {
  const scene = new THREE.Scene();
  const dust = createFootDust(scene);
  for (let i = 0; i < 50; i++) dust.spawn(i, 0, 0); // 远超池容量
  const visible = scene.children.filter(c => c.visible).length;
  assert.equal(visible, 12, '同时在演的不超过池容量');
  dust.update(1 / 60, 12);
  dust.dispose();
  assert.equal(scene.children.length, 0, 'dispose 后全部移出场景');
});
