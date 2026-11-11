import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createTrackVisuals } from '../packages/game/dist/render/trackVisuals.js';
import { createCoinField } from '../packages/game/dist/render/coinField.js';
import { uBendX, uBendY } from '../packages/game/dist/render/stormspire/worldBend.js';

function assertBend(material) {
  const shader = { uniforms: {}, vertexShader: '#include <project_vertex>' };
  material.onBeforeCompile(shader);
  assert.equal(shader.uniforms.uBendX, uBendX);
  assert.equal(shader.uniforms.uBendY, uBendY);
}

for (const scenery of ['stormspire', 'titan', 'forgeheart', 'library']) {
  test(`${scenery}: 路面、车道线和金币共用弯道，图书馆道路也有足够细分`, t => {
    const scene = new THREE.Scene();
    const track = createTrackVisuals(scene, 2.2, { baseColor: '#16233E', flashColor: '#FFFFFF', tint: '#FFC145' }, scenery);
    const coins = new THREE.Scene();
    createCoinField(coins, 2.2, { scenery });
    t.after(() => {
      track.dispose();
      for (const root of [scene, coins]) root.traverse(o => {
        o.geometry?.dispose();
        for (const mat of o.material ? [o.material].flat() : []) mat.dispose();
      });
    });
    const road = scene.children.find(o => o.geometry?.type === 'PlaneGeometry' && o.geometry.parameters.height === 240 && o.geometry.parameters.width < 10);
    assert.ok(road);
    assert.equal(road.geometry.parameters.heightSegments, 48);
    assertBend(road.material);
    const lines = scene.children.filter(o => o.material?.isMeshBasicMaterial && o.material.vertexColors && o.geometry?.getAttribute('color'));
    assert.equal(lines.length, 4);
    for (const line of lines) {
      assertBend(line.material);
      assert.ok(line.geometry.getAttribute('position').count > 10, '车道线要与细分道路同弯');
    }
    for (const coin of coins.children) assertBend(coin.material);
  });
}
