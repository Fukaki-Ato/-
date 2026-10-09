/**
 * 雨夜便利店街角侧景（scenery = "konbini"）的回归测试：真实 three.js 建模，不建 WebGL 上下文。
 * 盯三件事：① 整座模型必须走「分桶合并 + 实例化」，draw call 是个位数到十几，不许散 mesh；
 * ② 顶点数据总量要小（同一家店 N 次出现共用一份几何，这是用户点名的省内存要求）；
 * ③ update(move, t) 每帧推得动、绕回不越界、动画层不报错。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createSceneryProps } from '../packages/game/dist/render/sceneryProps.js';
import { Diorama } from '../packages/game/dist/render/konbini/kit.js';

test('合并几何：索引游标按「索引数」前进（回归：按顶点数走会把后面的三角压成碎片）', () => {
  const d = new Diorama();
  d.box('body', 1, 1, 1, 0, 0, 0, '#fff').box('body', 1, 1, 1, 3, 0, 0, '#fff').box('body', 1, 1, 1, 6, 0, 0, '#fff');
  const geo = d.geometry('body');
  assert.equal(geo.getAttribute('position').count, 72, '三个方块 24 顶点各一');
  assert.equal(geo.index.count, 108, '三个方块 36 条索引各一');
  let hi = 0;
  for (let i = 0; i < geo.index.count; i++) hi = Math.max(hi, geo.index.getX(i));
  assert.equal(hi, 71, '最后一个方块的顶点必须真的被索引到');
  assert.ok(geo.index.getX(107) > 48, `索引尾部不能还停在第一个方块上，实得 ${geo.index.getX(107)}`);
});

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

test('konbini 侧景：全部实例化、无散 mesh，画面上万三角也只存一份顶点', () => {
  const scene = new THREE.Scene();
  createSceneryProps(scene, 'konbini');
  const s = survey(scene);
  assert.equal(s.loose, 0, `侧景不许有未实例化的散 mesh，实得 ${s.loose} 个`);
  assert.ok(s.inst >= 10 && s.inst <= 24, `实例组数应在 10~24（3 桶店 + 2 花园 + 2 远景 + 2 路灯 + 光池/雨/门/涟漪/雨痕/招牌/信号/溅射 各一），实得 ${s.inst}`);
  assert.ok(s.verts < 60_000, `合并后顶点总量应远小于逐个建 mesh 的方案，实得 ${s.verts}`);
  assert.ok(s.tris > 20_000, `画面里确实铺开了上万个三角（说明模型有内容），实得 ${s.tris}`);
});

test('konbini 侧景：update 逐帧推着道具后退，绕回后仍在 LOOP 周期内', () => {
  const scene = new THREE.Scene();
  const props = createSceneryProps(scene, 'konbini');
  const store = scene.children.find(o => o.isInstancedMesh && o.count === 2);
  assert.ok(store, '应有 2 家便利店的实例组');
  const z0 = zOf(store, 0);
  for (let i = 0; i < 60; i++) props.update(0.25, i * 0.25);
  const z1 = zOf(store, 0);
  assert.ok(z1 > z0, `道具随距离向 +Z（角色身后）推进：${z0.toFixed(1)} → ${z1.toFixed(1)}`);
  props.update(400, 30);
  for (const o of scene.children) {
    if (!o.isInstancedMesh) continue;
    for (let i = 0; i < o.count; i++) {
      const z = zOf(o, i);
      assert.ok(z > -260 && z < 60, `绕回后第 ${i} 个实例的 z 应在周期内，实得 ${z.toFixed(1)}`);
    }
  }
});

test('未登记的 scenery id 仍是空侧景（占位场景那条路不能被我改坏）', () => {
  const scene = new THREE.Scene();
  createSceneryProps(scene, 'blank');
  assert.equal(survey(scene).inst, 0, 'blank 场景两侧不该摆任何东西');
});
