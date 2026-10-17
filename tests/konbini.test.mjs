/**
 * 雨夜便利店街角侧景（scenery = "konbini"）的回归测试：真实 three.js 建模，不建 WebGL 上下文。
 * 盯三件事：① 整座模型必须走「分桶合并 + 实例化」，draw call 是个位数到十几，不许散 mesh；
 * ② 顶点数据总量要小（同一家店 N 次出现共用一份几何，这是用户点名的省内存要求）；
 * ③ update(move, t) 每帧推得动、绕回不越界、动画层不报错。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { createSceneryProps } from '../packages/game/dist/render/sceneryProps.js';
import { Diorama } from '../packages/game/dist/render/konbini/kit.js';

const themes = JSON.parse(readFileSync(new URL('../config/themes.json', import.meta.url), 'utf8'));

function disposeScene(scene, props) {
  props.dispose?.();
  scene.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (const mat of mats) mat.dispose();
  });
}

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
  const props = createSceneryProps(scene, 'konbini');
  const s = survey(scene);
  assert.equal(s.loose, 0, `侧景不许有未实例化的散 mesh，实得 ${s.loose} 个`);
  assert.ok(s.inst >= 10 && s.inst <= 44, `实例组数应在 10~44（3 桶店 + 2 花园 + 6 远景三套型 + 2 路灯 + 3 桶商铺排 + 2 桶空地路面 + 3 桶餐厅 + 2 桶广场 + 光池/光晕/雨/门/涟漪/雨痕/招牌/信号/棚沿水滴/灯下雨丝/溅射 各一），实得 ${s.inst}`);
  // 60k 是「便利店 + 花园 + 远景」那三套的预算；10-13 先加了商铺排/小巷路面/三套型远景（→58.1k），
  // 又加了餐厅与城市广场（+5.2k；植被已从 plants 的多面叶团换成扁椭圆，一棵树 1.1k → 120 顶点）。
  // 再往上加东西请先想合并与换基元，别顺手抬这条线。
  assert.ok(s.verts < 66_000, `合并后顶点总量应远小于逐个建 mesh 的方案，实得 ${s.verts}`);
  assert.ok(s.tris > 20_000, `画面里确实铺开了上万个三角（说明模型有内容），实得 ${s.tris}`);
  disposeScene(scene, props);
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
  disposeScene(scene, props);
});

test('商铺排与餐厅：整组四个角都不许压到跑道（|x|<4.75 是硬规则）', () => {
  const scene = new THREE.Scene();
  const props = createSceneryProps(scene, 'konbini');
  const m = new THREE.Matrix4(), v = new THREE.Vector3();
  // 靠 konbiniProps 打的 name 认组（广场长轴也有 39m，尺寸不再是唯一指纹），取长轴最大的那桶＝含底座的 body
  for (const name of ['shopRow', 'restaurant']) {
    const named = scene.children.filter(o => o.isInstancedMesh && o.name === name);
    assert.equal(named.length, 3, `${name} 应有 body/glow/glass 三组，实得 ${named.length}`);
    named.forEach(o => o.geometry.computeBoundingBox());
    const g = named.reduce((a, b) => (a.geometry.boundingBox.max.z - a.geometry.boundingBox.min.z
      >= b.geometry.boundingBox.max.z - b.geometry.boundingBox.min.z ? a : b));
    let near = Infinity;
    for (let i = 0; i < g.count; i++) {
      g.getMatrixAt(i, m);
      const b = g.geometry.boundingBox;
      for (const cx of [b.min.x, b.max.x]) for (const cz of [b.min.z, b.max.z]) {
        v.set(cx, 0, cz).applyMatrix4(m);
        near = Math.min(near, Math.abs(v.x));
      }
    }
    assert.ok(near >= 4.75, `${name} 离跑道中线最近 ${near.toFixed(2)}m，护栏区之内不能摆景观`);
  }
  disposeScene(scene, props);
});

test('未登记的 scenery id 仍是空侧景（占位场景那条路不能被我改坏）', () => {
  const scene = new THREE.Scene();
  const props = createSceneryProps(scene, 'blank');
  assert.equal(survey(scene).inst, 0, 'blank 场景两侧不该摆任何东西');
  disposeScene(scene, props);
});

test('配置里的每个 scenery id 都能实例化侧景道具', () => {
  for (const theme of themes.items) {
    const scene = new THREE.Scene();
    const props = createSceneryProps(scene, theme.scenery);
    assert.ok(scene.children.some(o => o.isInstancedMesh), `主题 ${theme.id} 的 scenery=${theme.scenery} 不能退化为空景`);
    disposeScene(scene, props);
  }
});
