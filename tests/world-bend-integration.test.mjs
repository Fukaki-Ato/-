import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createTrackVisuals } from '../packages/game/dist/render/trackVisuals.js';
import { createCoinField } from '../packages/game/dist/render/coinField.js';
import { uBendX, uBendY } from '../packages/game/dist/render/stormspire/worldBend.js';
import { createLandmarks } from '../packages/game/dist/render/stormspire/landmarks.js';

function assertBend(material) {
  const shader = { uniforms: {}, vertexShader: '#include <project_vertex>' };
  material.onBeforeCompile(shader);
  assert.equal(shader.uniforms.uBendX, uBendX);
  assert.equal(shader.uniforms.uBendY, uBendY);
}

test('雷脊计分环在玩家前方负Z，接近时向0推进，完成后隐藏', t => {
  const scene = new THREE.Scene(), landmarks = createLandmarks(scene);
  t.after(() => scene.traverse(o => {
    o.geometry?.dispose();
    for (const material of o.material ? [o.material].flat() : []) material.dispose();
  }));
  const rings = scene.children.find(o => o.isInstancedMesh && o.geometry.type === 'TorusGeometry' && o.count === 16);
  assert.ok(rings);
  const matrix = new THREE.Matrix4(), position = new THREE.Vector3();
  const ring = { lane: 1, worldZ: 150 };
  const readPosition = () => { rings.getMatrixAt(0, matrix); return position.setFromMatrixPosition(matrix); };
  landmarks.syncCrossings([ring], 100, 2.2);
  assert.equal(readPosition().z, -50); assert.ok(Math.abs(position.x - 2.2) < 1e-6);
  landmarks.syncCrossings([ring], 125, 2.2); assert.equal(readPosition().z, -25);
  landmarks.syncCrossings([{ ...ring, done: true }], 150, 2.2); assert.equal(readPosition().y, -999);
});

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
