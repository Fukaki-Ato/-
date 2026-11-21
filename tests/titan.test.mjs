/**
 * 沉眠泰坦侧景（scenery = "titan"）的回归测试（titan-brief §10.1 步骤 9）：真实 three.js 建模，不建 WebGL 上下文。
 * 盯三件事：① 全部实例化、无散 mesh（尸体地形不许散装）；
 * ② update(move, t) 每帧推得动、大步长绕回不越界、动画层不报错；
 * ③ 颅首睁眼闩锁：420m 一次性、不可逆、awakeBoost 呼吸幅度联动（§10.1-6）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createSceneryProps } from '../packages/game/dist/render/sceneryProps.js';
import { createSkull, THRESHOLD_M } from '../packages/game/dist/render/titan/skull.js';

function disposeScene(scene, props) {
  props.dispose?.();
  scene.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.material && typeof o.material.dispose === 'function') o.material.dispose();
  });
}

function survey(scene) {
  let inst = 0, loose = 0, verts = 0, tris = 0;
  scene.traverse(o => {
    if (o.isInstancedMesh) {
      inst++;
      const g = o.geometry;
      verts += g.getAttribute('position').count;
      tris += (g.index ? g.index.count : 0) / 3 * o.count;
    } else if (o.isMesh) loose++;
  });
  return { inst, loose, verts, tris };
}

const zOf = (mesh, i) => { const m = new THREE.Matrix4(); mesh.getMatrixAt(i, m); return m.elements[14]; };

test('titan 侧景：全部实例化、无散 mesh，模块齐且铺开了内容', () => {
  const scene = new THREE.Scene();
  const props = createSceneryProps(scene, 'titan');
  const s = survey(scene);
  assert.equal(s.loose, 0, `侧景不许有未实例化的散 mesh（颅首烘合件等也须走 InstancedMesh），实得 ${s.loose} 个`);
  // 13(bodyKit) + 5(mist) + ~20(relics) + 3(ribs) + 4(skull) + 2(veils) + 5(creatures) 的量级
  assert.ok(s.inst >= 30 && s.inst <= 70, `实例组数应在 30~70，实得 ${s.inst}`);
  assert.ok(s.tris > 20_000, `画面里确实铺开了上万三角（尸体地形有内容），实得 ${s.tris}`);
  disposeScene(scene, props);
});

test('titan 侧景：update 逐帧推着道具后退，大步长绕回后不越界', () => {
  const scene = new THREE.Scene();
  const props = createSceneryProps(scene, 'titan');
  // 找任一实例组当探针（躯体件 240m 循环）
  const probe = scene.children.find(o => o.isInstancedMesh && o.count > 5);
  assert.ok(probe, '应有可探针的实例组');
  const z0 = zOf(probe, 0);
  for (let i = 0; i < 60; i++) props.update(0.25, i * 0.25);
  const z1 = zOf(probe, 0);
  assert.ok(z1 > z0, `道具随距离向 +Z 推进：${z0.toFixed(1)} → ${z1.toFixed(1)}`);
  props.update(400, 30); // 大步长：绕回逻辑必须一次到位（.z > WRAP_Z 扣 LOOP）
  for (const o of scene.children) {
    if (!o.isInstancedMesh) continue;
    for (let i = 0; i < o.count; i++) {
      const z = zOf(o, i);
      assert.ok(z > -260 && z < 60, `绕回后第 ${i} 个实例的 z 应在回收带内，实得 ${z.toFixed(1)}`);
    }
  }
  disposeScene(scene, props);
});

test('睁眼闩锁：420m 一次性触发、不可逆、awakeBoost 呼吸幅度 +50% 联动', () => {
  const scene = new THREE.Scene();
  const skull = createSkull(scene);
  // awakeBoost 语义 = 睁眼渐起 k（0→1，1.2s 窗口）；总装映射 amp = 1 + 0.5k（醒态呼吸 +50%）
  assert.equal(skull.awakeBoost, 0, `初始沉睡 k=0，实得 ${skull.awakeBoost}`);
  // 瞳孔/眼窝光在沉睡期完全不可见（§4.1 沉睡感）
  const lights = scene.children.filter(o => o.isPointLight);
  for (const l of lights) assert.ok(!l.visible || l.intensity === 0, '沉睡期眼窝点光必须不可见');

  skull.update(0.25, 0.25, THRESHOLD_M - 1); // 差 1m 不睁
  assert.equal(skull.awakeBoost, 0, '未达阈值保持沉睡');

  skull.update(2, 0.5, THRESHOLD_M + 1); // 越阈 1m：同帧 wakeT 记位，k=0
  skull.update(2, 1.0, THRESHOLD_M + 3); // 0.5s 后：k=(1.0-0.5)/1.2≈0.42，渐起窗口内
  assert.ok(skull.awakeBoost > 0 && skull.awakeBoost < 1, `渐起窗口内 0<k<1，实得 ${skull.awakeBoost}`);
  skull.update(2, 2.5, THRESHOLD_M + 3); // 推进 2s > 1.2s 窗口
  assert.equal(skull.awakeBoost, 1, `k 收满 1，实得 ${skull.awakeBoost}`);
  const lit = lights.filter(l => l.visible && l.intensity > 0);
  assert.ok(lit.length > 0, '睁眼后眼窝点光必须亮起');

  skull.update(0.25, 2.75, 0); // moveAccum 归零也不可逆（渲染层闩锁一次性）
  assert.equal(skull.awakeBoost, 1, '苏醒不可逆：里程回看不得回到沉睡');
  skull.update(2, 3.0, THRESHOLD_M + 500); // 更远也保持醒态
  assert.equal(skull.awakeBoost, 1, '持续醒态');
  disposeScene(scene, skull);
});
