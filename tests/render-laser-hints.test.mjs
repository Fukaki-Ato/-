import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createObstacleLayer } from '../packages/game/dist/render/entityLayers.js';

test('激光熄灭/提前充能/启用三态分明，复用槽位不残留预警材质', t => {
  const scene = new THREE.Scene(), layer = createObstacleLayer(scene, 2.2);
  t.after(() => scene.traverse(o => {
    o.geometry?.dispose(); for (const m of o.material ? [o.material].flat() : []) m.dispose();
  }));
  const root = scene.children[0], beam = root.children[0];
  const laser = { cls: 'laser', lane: 0, worldZ: 100, w: 4.8, h: 0.4, d: 0.4, laserCfg: { onS: 2, offS: 2, phase: 0 } };
  layer.update([laser], 95, 2.5);
  assert.equal(beam.visible, false, '熄灭且距启用 >0.5s 不显示光束');
  layer.update([laser], 95, 3.7);
  assert.equal(beam.visible, true);
  assert.equal(beam.material.transparent, true);
  assert.ok(beam.material.opacity > 0 && beam.material.opacity < 0.4);
  assert.equal(beam.material.depthWrite, false, '弱预燃光不遮挡后面的安全提示');
  const chargingGlow = beam.material.emissiveIntensity;
  layer.update([laser], 95, 4.2);
  assert.equal(beam.visible, true);
  assert.equal(beam.material.opacity, 1);
  assert.equal(beam.material.transparent, false);
  assert.ok(beam.material.emissiveIntensity > chargingGlow, '启用态明显强于预燃态');
  assert.equal(beam.position.y, 0.2); assert.equal(beam.scale.y, 0.4, '光束仍贴合真实可跳高度');
  layer.update([{ ...laser, cls: 'low', laserCfg: undefined }], 95, 4.2);
  assert.equal(beam.material.emissive.getHex(), 0);
  assert.equal(beam.material.emissiveIntensity, 1);
  assert.equal(beam.material.transparent, false);
  assert.equal(beam.material.depthWrite, true);
});
