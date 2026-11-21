import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createCreatures } from '../packages/game/dist/render/stormspire/creatures.js';

test('云渊鲸只绘制十二节已更新的脊椎，不留单位球在角色原点遮挡跑道', t => {
  const scene = new THREE.Scene(), creatures = createCreatures(scene);
  t.after(() => {
    const geometries = new Set(), materials = new Set();
    scene.traverse(mesh => {
      if (mesh.geometry) geometries.add(mesh.geometry);
      for (const material of mesh.material ? [mesh.material].flat() : []) materials.add(material);
      if (mesh.isInstancedMesh) mesh.dispose();
    });
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
  });
  const whale = scene.children.find(mesh => mesh.isInstancedMesh && mesh.geometry.type === 'SphereGeometry'
    && mesh.geometry.parameters.widthSegments === 8 && mesh.material.isMeshLambertMaterial);
  assert.ok(whale);
  assert.equal(whale.count, 12, '背鳍/头角使用另一个 mesh，不占鲸身球体实例');
  const matrix = new THREE.Matrix4(), position = new THREE.Vector3();
  for (const time of [0, 7 / 12, 70]) {
    creatures.update(0, time);
    for (let i = 0; i < whale.count; i++) {
      whale.getMatrixAt(i, matrix); position.setFromMatrixPosition(matrix);
      assert.ok(position.x > 10 && position.z < -10, `实例 ${i} 在远处巡游，不能以单位矩阵留在原点`);
    }
  }
});
