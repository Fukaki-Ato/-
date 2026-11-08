/**
 * 熔炉巨兽侧景（scenery = "forgeheart"）的回归测试（forgeheart-brief §13 步骤 8 验收）：真实 three.js 建模。
 * 盯三件事：① 全部实例化、无散 mesh；② update 大步长绕回不越界；
 * ③ 潮汐纯函数边界（level/surgeWindow）与喷发管线 flash 尖峰（进入喷发段触发全场闪橙）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createSceneryProps } from '../packages/game/dist/render/sceneryProps.js';
import { level, surgeWindow } from '../packages/game/dist/render/forgeheart/tide.js';
import { createEruption } from '../packages/game/dist/render/forgeheart/eruption.js';

function disposeScene(scene, props) {
  props.dispose?.();
  scene.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.material && typeof o.material.dispose === 'function') o.material.dispose();
  });
}

function survey(scene) {
  let inst = 0, loose = 0;
  scene.traverse(o => {
    if (o.isInstancedMesh) inst++;
    else if (o.isMesh) loose++;
  });
  return { inst, loose };
}

test('forgeheart 侧景：全部实例化、无散 mesh、模块铺开有内容', () => {
  const scene = new THREE.Scene();
  const props = createSceneryProps(scene, 'forgeheart');
  const s = survey(scene);
  // 散 mesh 预算 = 5（岩浆海 3 平面 + 热浪雾带 2 平面——brief §3.1 铁律例外：长条贴 y 移动不实例化不回收）
  //   + 11（landmarks 独件雕塑：火山颈圆管/炉心×2/哑阀/锻像等唯一几何，各 1 draw call 计入 17 dc 预算）
  assert.equal(s.loose, 16, `散 mesh 应恰为文档化例外（岩浆海 3 + 雾带 2 + 地标独件 11），实得 ${s.loose}`);
  assert.ok(s.inst >= 20 && s.inst <= 60, `实例组数应在 20~60，实得 ${s.inst}`);
  disposeScene(scene, props);
});

test('forgeheart 侧景：大步长绕回不越界（240m 主体 + 300m 雾墙带）', () => {
  const scene = new THREE.Scene();
  const props = createSceneryProps(scene, 'forgeheart');
  for (let i = 0; i < 30; i++) props.update(0.25, i * 0.25);
  props.update(400, 30); // 大步长：绕回逻辑必须一次到位（ceil 多重回收）
  const m = new THREE.Matrix4();
  for (const o of scene.children) {
    if (!o.isInstancedMesh) continue;
    for (let i = 0; i < o.count; i++) {
      o.getMatrixAt(i, m);
      const z = m.elements[14];
      assert.ok(z > -260 && z < 60, `绕回后 z 应在回收带内，实得 ${z.toFixed(1)}`);
    }
  }
  disposeScene(scene, props);
});

test('潮汐纯函数边界：144m 周期、驻留段精确 0/1、喷发窗恰在奇数周期高潮', () => {
  assert.equal(level(0), 0, '低潮驻留');
  assert.equal(level(72), 1, '高潮驻留');
  assert.ok(level(56) > 0 && level(56) < 1, '涨潮中段在 0..1');
  assert.equal(surgeWindow(215.9), false, '喷发窗前界 216 之前为 false');
  assert.equal(surgeWindow(216), true, '216 起进入喷发窗');
  assert.equal(surgeWindow(251.9), true, '窗内');
  assert.equal(surgeWindow(252), false, '252 出窗');
  assert.equal(surgeWindow(360), false, '偶数周期恒 false');
  assert.equal(surgeWindow(504), true, '下下个奇数周期 504 再开窗');
});

test('喷发管线：进入喷发段触发全场闪橙尖峰，段外 flash 归零', () => {
  const scene = new THREE.Scene();
  const eruption = createEruption(scene);
  let peak = 0;
  for (let d = 180; d <= 260; d += 2) {
    const flash = eruption.update(0.05, d);
    peak = Math.max(peak, flash);
  }
  assert.ok(peak > 0.3, `跨入喷发段（216-252）应触发闪橙尖峰（FLASH_PEAK 口径），实测峰值 ${peak.toFixed(2)}`);
  let idle = 0;
  for (let d = 300; d <= 380; d += 2) idle = Math.max(idle, eruption.update(0.05, d));
  assert.equal(idle, 0, '喷发段之外的偶数周期不得有 flash');
  eruption.dispose();
});
