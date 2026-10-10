import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  RUN_BONE_AMPS, amplifyClipSwing, amplifyQuaternion, meanQuaternion, needsAmplify,
} from '../packages/game/dist/render/animAmplify.js';

const q = (x, y, z, w) => new THREE.Quaternion(x, y, z, w);

/** 绕 X 轴 angle 弧度的单位四元数 */
function rotX(a) {
  const h = a / 2;
  return q(Math.sin(h), 0, 0, Math.cos(h));
}

test('meanQuaternion：符号对齐后不被抵消；同朝向平均=自身', () => {
  const a = rotX(0.3), b = q(-a.x, -a.y, -a.z, -a.w); // 同一旋转的负号表示
  const m = meanQuaternion([a, b]);
  assert.ok(Math.abs(Math.abs(m.dot(a)) - 1) < 1e-6, 'q/-q 平均仍是同一朝向');

  const c = rotX(0.5), d = rotX(-0.5);
  const m2 = meanQuaternion([c, d]);
  assert.ok(m2.dot(q(0, 0, 0, 1)) > 0.999999, '对向旋转平均≈单位');
});

test('amplifyQuaternion：amp=1 恒等，amp=2 相对角翻倍', () => {
  const ref = q(0, 0, 0, 1);
  const k1 = rotX(0.2), k2 = rotX(0.4);
  const out = new THREE.Quaternion();
  amplifyQuaternion(ref, k1, 1, out);
  assert.ok(out.angleTo(k1) < 1e-6, 'amp=1 恒等（浮点噪声级）');
  amplifyQuaternion(ref, k1, 2, out);
  assert.ok(out.angleTo(k2) < 1e-6, 'amp=2 把 0.2rad 偏差放大成 0.4rad');

  // 参考姿不是单位四元数时：绕 ref 放大，相对角等比例变大（0.2rad → 0.4rad）
  const ref2 = rotX(0.5);
  const rel = new THREE.Quaternion().copy(ref2).invert().multiply(rotX(0.7)).normalize();
  const relAngle = 2 * Math.acos(Math.min(1, Math.max(-1, rel.w)));
  assert.ok(Math.abs(relAngle - 0.2) < 1e-9, '构造：ref2 与 rotX(0.7) 的相对角 = 0.2rad');
  const out2 = new THREE.Quaternion();
  amplifyQuaternion(ref2, rotX(0.7), 2, out2);
  const relAfter = out2.clone().multiply(ref2.clone().invert()).normalize();
  const relAngleAfter = 2 * Math.acos(Math.min(1, Math.max(-1, relAfter.w)));
  assert.ok(Math.abs(relAngleAfter - 0.4) < 1e-6, '放大后相对角 = 0.4rad');
});

test('amplifyQuaternion：接近 ref / 相对角≈π 时原样返回（不炸姿势）', () => {
  const ref = q(0, 0, 0, 1), near = rotX(1e-5), far = rotX(Math.PI - 1e-5);
  const out = new THREE.Quaternion();
  amplifyQuaternion(ref, near, 9, out);
  assert.ok(out.angleTo(near) < 1e-9, '近静止帧原样');
  amplifyQuaternion(ref, far, 9, out);
  assert.ok(out.angleTo(far) < 1e-9, 'π 病态帧原样');
});

test('amplifyClipSwing：只放大列出的骨骼的 quaternion 轨道', () => {
  const trackX = new THREE.QuaternionKeyframeTrack('LegUpperL.quaternion', [0, 0.5], [
    ...rotX(0.1), ...rotX(0.3),
  ]);
  const trackOther = new THREE.QuaternionKeyframeTrack('Hips.quaternion', [0, 0.5], [
    ...rotX(0.1), ...rotX(0.3),
  ]);
  const pos = new THREE.VectorKeyframeTrack('Hips.position', [0, 0.5], [0, 0.72, 0, 0, 0.76, 0]);
  const clip = new THREE.AnimationClip('Run', 0.75, [trackX, trackOther, pos]);
  const amps = { LegUpperL: 2 };
  const out = amplifyClipSwing(clip, amps);

  assert.equal(out.tracks.length, 3);
  assert.equal(out.duration, 0.75);
  assert.equal(out.name, 'Run');
  // 命中轨道被替换为新对象；原 clip 的 track 值未被修改
  const t = out.tracks.find(tk => tk.name === 'LegUpperL.quaternion');
  assert.notEqual(t, trackX, '命中轨道换成新轨道');
  // 原值应与 rotX(0.3) 等价（Float32 存储精度内）
  const origLast = new THREE.Quaternion().fromArray(clip.tracks[0].values, 4);
  assert.ok(origLast.angleTo(rotX(0.3)) < 1e-6, '原末姿仍是 0.3rad（未被放大污染）');
  // 两键 0.1/0.3 → 均值 0.2、偏差 ±0.1；amp=2 后为 0.0/0.4
  const lastQ = new THREE.Quaternion().fromArray(t.values, 4);
  assert.ok(lastQ.angleTo(rotX(0.4)) < 1e-6, 'amp=2 后末姿 ≈ 0.4rad');
  const firstQ = new THREE.Quaternion().fromArray(t.values, 0);
  assert.ok(firstQ.angleTo(rotX(0)) < 1e-6, 'amp=2 后首姿 ≈ 0rad');
  // 未命中轨道按原引用保留（quaternion 与 position 都不动）
  assert.equal(out.tracks.find(tk => tk.name === 'Hips.quaternion'), trackOther);
  assert.equal(out.tracks.find(tk => tk.name === 'Hips.position'), pos, 'position 轨道原样');
});

test('amplifyClipSwing：amps 全 ≤1 → 逐字节返回原 clip', () => {
  const clip = new THREE.AnimationClip('Run', 0.75, []);
  assert.equal(amplifyClipSwing(clip, {}), clip);
  assert.equal(amplifyClipSwing(clip, { LegUpperL: 1 }), clip);
  assert.equal(needsAmplify({}), false);
  assert.equal(needsAmplify(RUN_BONE_AMPS), true);
});

test('RUN_BONE_AMPS：腿 1.9/脚 1.75/臂 1.35，四组腿骨齐全', () => {
  assert.equal(RUN_BONE_AMPS.LegUpperL, 1.9);
  assert.equal(RUN_BONE_AMPS.LegUpperR, 1.9);
  assert.equal(RUN_BONE_AMPS.LegLowerL, 1.9);
  assert.equal(RUN_BONE_AMPS.LegLowerR, 1.9);
  assert.equal(RUN_BONE_AMPS.FootL, 1.75);
  assert.equal(RUN_BONE_AMPS.ArmUpperL, 1.35);
});

test('RUN_BONE_AMPS：摆腿幅度不得回到「风车档」', () => {
  // 2.2× 摆腿配 1.8× 播放 = 脚峰值速度 11~12 m/s（与角色 12 m/s 前进同量级），
  // 用户实机判定「太快、不明显、很丑」。这道门禁防有人把幅度调回风车档：
  // 步态可读性由「摆幅 × 步频」共同决定，幅度单独涨回去同样会糊。
  for (const k of ['LegUpperL', 'LegUpperR', 'LegLowerL', 'LegLowerR', 'FootL', 'FootR']) {
    assert.ok(RUN_BONE_AMPS[k] <= 2.0, `${k}=${RUN_BONE_AMPS[k]} 超过 2.0 风车阈值`);
  }
  // 手臂与腿保持对侧对位关系，不单独越界
  assert.ok(RUN_BONE_AMPS.ArmUpperL < RUN_BONE_AMPS.LegUpperL, '臂幅度应小于腿幅度');
});
