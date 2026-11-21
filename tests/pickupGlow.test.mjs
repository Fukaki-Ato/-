/**
 * 道具地面光圈回归（pickupGlow.ts + pickupLayer 接线）。
 *
 * 背景：道具悬浮在 1.15m 高度，用户要求"道具放在地面上要有光圈特效"——
 * 光圈贴地（y=0.03）跟道具同 x/z，颜色随道具徽标主色，两态（贴图箱/3D 模型）都亮。
 * 光圈是纯表现件：槽满丢弃不报错，帧末 hideRest 收场，捞取判定零接触。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

const { createPickupGlow } = await import('../packages/game/dist/render/pickupGlow.js');
const { createPickupLayer } = await import('../packages/game/dist/render/pickupLayer.js');
const { setWorldBend, uBendX, uBendY } = await import('../packages/game/dist/render/stormspire/worldBend.js');

const glowPlanes = (scene) => scene.children.filter(c => c.isMesh && c.geometry?.type === 'PlaneGeometry');
const pickup = (itemRef, worldZ, lane = 0, taken = false) => ({ itemRef, worldZ, lane, taken });

test('光圈：贴地跟随道具、按道具上色、hideRest 收场、槽满不报错', () => {
  const scene = new THREE.Scene();
  const glow = createPickupGlow(scene);
  const planes = glowPlanes(scene);
  assert.equal(planes.length, 8, '预建 8 个光圈槽');

  glow.show(0, -30, 'item_magnet', 30, 1);
  glow.show(2.2, -50, 'item_boots', 50, 1.2);
  assert.equal(planes.filter(p => p.visible).length, 2, '两个道具两圈光');
  const [m, b] = planes;
  assert.ok(Math.abs(m.position.y - 0.03) < 1e-6, '光圈贴地（y=0.03）');
  assert.ok(Math.abs(m.position.x - 0) < 1e-6 && Math.abs(m.position.z - (-30)) < 1e-6, 'x/z 跟随道具');
  const mc = m.material.uniforms.uColor.value;
  const bc = b.material.uniforms.uColor.value;
  assert.notDeepEqual(mc.getHex(), bc.getHex(), '不同道具不同色（磁铁紫 vs 弹跳鞋绿）');
  assert.equal(mc.getHex(), 0xb48cff, '磁铁光圈用既有道具紫');

  // 未登记 id 走兜底暖白；槽满（>8）静默丢弃不抛
  glow.show(0, -70, 'item_nope', 70, 1);
  assert.equal(glowPlanes(scene).filter(p => p.visible).length, 3);
  for (let i = 0; i < 12; i++) glow.show(i * 2.2, -90 - i, 'item_coin', i, 1);
  assert.equal(glowPlanes(scene).filter(p => p.visible).length, 8, '槽满截断，多出的丢弃');
  glow.hideRest();
  assert.equal(glowPlanes(scene).filter(p => p.visible).length, 8, '本帧已展示的保持亮（协议同模型槽）');
  glow.hideRest(); // 下一帧没有任何 show：used=0 → 全收
  assert.equal(glowPlanes(scene).filter(p => p.visible).length, 0, '无 show 的帧收场');
});

test('光圈：接入 pickupLayer 后箱/模型两态都亮、道具消失即收', () => {
  const scene = new THREE.Scene();
  const layer = createPickupLayer(scene, 2.2); // 无 loader：全走贴图箱路径
  layer.update([pickup('item_magnet', 100)], 0, 1);
  assert.equal(glowPlanes(scene).filter(p => p.visible).length, 1, '远距贴图箱态也亮光圈');
  layer.update([], 0, 1.1);
  assert.equal(glowPlanes(scene).filter(p => p.visible).length, 0, '道具没了光圈收场');

  // taken 不亮
  layer.update([pickup('item_magnet', 100, 0, true)], 0, 1.2);
  assert.equal(glowPlanes(scene).filter(p => p.visible).length, 0, 'taken 不亮光圈');

  // 范围外（z 超出可见深度）不亮
  layer.update([pickup('item_magnet', 100)], 0, 1.3);
  layer.update([pickup('item_magnet', 500)], 0, 1.4);
  assert.equal(glowPlanes(scene).filter(p => p.visible).length, 0, '视野深度外不亮');
});

test('光圈与贴图箱共享道路弯曲 shader 及动态 uniforms，不悬空或埋地', () => {
  const scene = new THREE.Scene();
  createPickupLayer(scene, 2.2);
  const glow = glowPlanes(scene)[0].material;
  const box = scene.children.find(o => o.geometry?.type === 'BoxGeometry').material;
  const shaders = [glow, box].map(material => {
    const shader = { uniforms: {}, vertexShader: material.vertexShader ?? '#include <project_vertex>' };
    material.onBeforeCompile(shader);
    assert.equal(shader.uniforms.uBendX, uBendX);
    assert.equal(shader.uniforms.uBendY, uBendY);
    assert.match(shader.vertexShader, /spWorld\.y \+= uBendY/);
    assert.doesNotMatch(shader.vertexShader, /#include <project_vertex>/);
    return shader;
  });
  setWorldBend(10);
  assert.ok(shaders.every(shader => shader.uniforms.uBendY.value > 0));
});
