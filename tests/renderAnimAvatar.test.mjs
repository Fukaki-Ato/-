/**
 * animAvatar 胶水回归（真实 nailoong.glb 资产口径）：
 *   ① Idle 播完的「回卷」必须交叉淡化连贯——旧实现里 spare 与主 action 是同一实例（three 按
 *      clip+root 缓存 clipAction），fadeOut 被紧随的 reset() 取消，右手一帧瞬跳 0.69m。
 *   ② Run 步态放大必须覆盖所有键（含 4D 反号存储的长弧键）——旧实现的「近-π 轴病态」守卫写法
 *      （Math.PI - angle < 1e-4）对 angle>π 恒真，真实资产 LegUpperR 有 14/30 键被静默跳过，
 *      右腿半段摆幅没放大、步幅比左腿窄 12%。
 * 阈值来自修复时的逐帧实测，均留 ≥1.8× 余量（见各断言注释）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';

// Node 无 DOM：GLTFLoader 载贴图要走 self.URL / createImageBitmap，垫一层桩（只取骨架+动画）
if (typeof globalThis.self === 'undefined') globalThis.self = globalThis;
if (typeof globalThis.createImageBitmap === 'undefined') globalThis.createImageBitmap = async () => ({ width: 1, height: 1, close() {} });
if (typeof URL.createObjectURL !== 'function') URL.createObjectURL = () => 'blob:stub';
if (typeof URL.revokeObjectURL !== 'function') URL.revokeObjectURL = () => {};

const { createAnimAvatar } = await import('../packages/game/dist/render/animAvatar.js');
const { initialRunnerState } = await import('../packages/game/dist/core/sim/simTypes.js');
const { meanQuaternion, amplifyClipSwing, RUN_BONE_AMPS } = await import('../packages/game/dist/render/animAmplify.js');

const GLB = 'assets/characters/nailoong.glb';
const glbBuffer = () => {
  const b = readFileSync(GLB);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};
const adapter = { extras: { readBinary: async () => glbBuffer() } };

test('Idle 回卷：播完后交叉淡化回首帧，任何骨骼不得一帧瞬跳（旧实现右手 0.69m/帧）', async () => {
  // ?anim=Idle 锁：无视 sim 状态强制播 Idle，保证回卷必被扫到；?debug 挂 __trAnim 供读时长
  const avatar = await createAnimAvatar(adapter, GLB, 1, new URLSearchParams('anim=Idle&debug'));
  assert.ok(avatar, 'GLB 装配失败（资产/垫片问题，先查资产再查本测试）');
  const dur = globalThis.__trAnim.act.dur;
  assert.ok(dur > 0.5 && dur < 10, `Idle 时长异常：${dur}`);

  const bones = [];
  avatar.group.traverse(o => { if (o.isBone && o.name) bones.push(o); });
  assert.ok(bones.length > 10, '骨骼未挂到场景');

  const s = initialRunnerState();
  s.distance = 1; s.prevDistance = 1; // 行进记忆不参与判定（QA 锁直接返回），给非零值防除零
  const noFx = { flyT: 0, invincible: false, magnetT: 0, helmetT: 0, shieldLayers: 0 };
  const dt = 1 / 60;
  const prev = new Map();
  const p = new THREE.Vector3();
  let maxMove = 0, maxBone = '';
  for (let i = 0; i < Math.ceil((4 * dur) / dt); i++) { // 4 个 Idle 周期 = 3 次回卷
    s.t += dt;
    avatar.update(dt, s, noFx);
    for (const b of bones) {
      b.getWorldPosition(p);
      const before = prev.get(b.name);
      if (before) {
        const d = p.distanceTo(before);
        if (d > maxMove) { maxMove = d; maxBone = b.name; }
      }
      prev.set(b.name, p.clone());
    }
  }
  // 实测：旧实现（fadeOut 被 reset 取消，姿势闪回绑定姿）右手单帧 0.685m；
  //       修复后（独立第二实例交叉淡化 0.12s）全骨骼峰值 0.164m。阈值 0.3m 居中。
  assert.ok(maxMove < 0.3, `${maxBone} 单帧位移 ${maxMove.toFixed(3)}m：Idle 回卷瞬跳（交叉淡化失效？）`);
  delete globalThis.__trAnim;
  avatar.dispose();
});

test('Run 放大：真实资产所有键都按 amp 放大（4D 反号长弧键不得被近-π 守卫跳过）', async () => {
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  const gltf = await new Promise((res, rej) => new GLTFLoader().parse(glbBuffer(), '', res, rej));
  const run = gltf.animations.find(a => a.name === 'Run');
  assert.ok(run, '资产缺 Run clip');
  const amplified = amplifyClipSwing(run, RUN_BONE_AMPS);
  let checked = 0;
  for (const t of run.tracks) {
    const dot = t.name.lastIndexOf('.');
    const node = t.name.slice(0, dot), prop = t.name.slice(dot + 1);
    const amp = prop === 'quaternion' ? RUN_BONE_AMPS[node] : undefined;
    if (!amp || amp <= 1) continue;
    const out = amplified.tracks.find(o => o.name === t.name);
    assert.ok(out, `放大后缺轨道 ${t.name}`);
    const n = t.values.length / 4;
    const qs = [];
    for (let i = 0; i < n; i++) qs.push(new THREE.Quaternion().fromArray(t.values, i * 4));
    const ref = meanQuaternion(qs);
    for (let i = 0; i < n; i++) {
      const inDeg = ref.angleTo(qs[i]) * 180 / Math.PI;
      if (inDeg < 5 || inDeg > 120) continue; // 近均值无信息；>120° 按契约本就跳过
      const outDeg = ref.angleTo(new THREE.Quaternion().fromArray(out.values, i * 4)) * 180 / Math.PI;
      const ratio = outDeg / inDeg;
      assert.ok(Math.abs(ratio - amp) < 0.02,
        `${t.name} 键 ${i} 放大倍率 ${ratio.toFixed(3)} ≠ ${amp}（长弧键被跳过？）`);
      checked++;
    }
  }
  assert.ok(checked > 200, `参与统计的键太少：${checked}（资产被换？）`);
});
