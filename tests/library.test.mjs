/**
 * 失重图书馆侧景（scenery = "library"）的回归测试：真实 three.js 建模，不建 WebGL 上下文。
 * 盯三件事：① 整座书城必须走 InstancedMesh 实例化，散 mesh 只许是贴图滚动的长平面例外件；
 * ② update(move, t) 每帧推得动、超大步长绕回后所有实例仍落在 240m 循环带内；
 * ③ themes.json 里每个 scenery id 都能实例化非空侧景（library 注册进 SCENERY_SETS 不许掉）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { createSceneryProps } from '../packages/game/dist/render/sceneryProps.js';

const themes = JSON.parse(readFileSync(new URL('../config/themes.json', import.meta.url), 'utf8'));

function disposeScene(scene, props) {
  props.dispose?.();
  scene.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (const mat of mats) mat.dispose();
  });
}

function survey(scene) {
  let inst = 0, loose = 0, tris = 0;
  scene.traverse(o => {
    if (o.isInstancedMesh) {
      inst++;
      const g = o.geometry;
      tris += (g.index ? g.index.count : 0) / 3 * o.count;
    } else if (o.isMesh) loose++;
  });
  return { inst, loose, tris };
}

const zOf = (mesh, i) => { const m = new THREE.Matrix4(); mesh.getMatrixAt(i, m); return m.elements[14]; };

test('library 侧景：全部实例化、散 mesh 仅长平面例外，画面铺开上万三角', () => {
  const scene = new THREE.Scene();
  const props = createSceneryProps(scene, 'library');
  const s = survey(scene);
  // 长平面例外 = 8 件（brief §3.1/§6：墨海条 ×4 + 墨雾带 ×2 + 翻页光波 ×2，走贴图滚动不进循环回收，
  // 单件 Mesh 合理）；除此之外任何散 mesh 都是漏实例化。新增例外请先改这条断言并写明理由。
  assert.equal(s.loose, 8, `散 mesh 只许是 8 件长平面例外（墨海/墨雾/光波），实得 ${s.loose}`);
  assert.ok(s.inst >= 20 && s.inst <= 60, `实例组数应在 20~60（书页 3 + 光尘/涟漪 + 书脊 3 batch + 塔群 + 近景排 + 地标 + 生物），实得 ${s.inst}`);
  assert.ok(s.tris > 20_000, `画面里确实铺开了上万三角（说明书城有内容），实得 ${s.tris.toFixed(0)}`);
  disposeScene(scene, props);
});

test('library 侧景：update 逐帧推着道具后退，超大步长绕回后全部实例仍在循环带内', () => {
  const scene = new THREE.Scene();
  const props = createSceneryProps(scene, 'library');
  const biggest = scene.children.filter(o => o.isInstancedMesh)
    .reduce((a, b) => (a.count >= b.count ? a : b)); // 最大实例组 = 书脊 batch，必随 move 回收
  const z0 = zOf(biggest, 0);
  for (let i = 0; i < 60; i++) props.update(0.25, i * 0.25);
  const z1 = zOf(biggest, 0);
  assert.ok(z1 > z0, `道具随距离向 +Z（角色身后）推进：${z0.toFixed(1)} → ${z1.toFixed(1)}`);
  props.update(400, 30); // 大步长：总装层切块喂入，绕回必须一次到位（子模块是逐帧小步长写法）
  for (const o of scene.children) {
    if (!o.isInstancedMesh) continue;
    for (let i = 0; i < o.count; i++) {
      const z = zOf(o, i);
      assert.ok(z > -260 && z < 60, `绕回后第 ${i} 个实例的 z 应在 240m 周期带内，实得 ${z.toFixed(1)}`);
    }
  }
  disposeScene(scene, props);
});

test('配置里的每个 scenery id 都能实例化非空侧景道具（含 library）', () => {
  for (const theme of themes.items) {
    const scene = new THREE.Scene();
    const props = createSceneryProps(scene, theme.scenery);
    assert.ok(scene.children.some(o => o.isInstancedMesh), `主题 ${theme.id} 的 scenery=${theme.scenery} 不能退化为空景`);
    disposeScene(scene, props);
  }
});
