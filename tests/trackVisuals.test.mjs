/** 沙地纹理滚动回归：真实 Three.js 场景/UV 变换，不需要浏览器或 WebGL。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createTrackVisuals } from '../packages/game/dist/render/trackVisuals.js';

function fixture(t) {
  const scene = new THREE.Scene();
  const track = createTrackVisuals(scene, 2.2, {
    baseColor: '#8ED0F2', flashColor: '#FFF3C4', tint: '#FFD98A', groundColor: '#E3CFA4',
  });
  const ground = scene.children.find(o => o.isMesh && o.material?.map?.isDataTexture);
  assert.ok(ground, '程序化草斑沙地应存在');
  const texture = ground.material.map;
  const tileM = ground.geometry.parameters.height / texture.repeat.y;
  t.after(() => {
    const resources = new Set();
    scene.traverse(o => {
      if (o.geometry) resources.add(o.geometry);
      const materials = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      for (const material of materials) {
        resources.add(material);
        if (material.map) resources.add(material.map);
      }
    });
    for (const resource of resources) resource.dispose();
  });
  return { track, ground, texture, tileM };
}

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

function sampleGroundUv(ground, texture, worldPoint) {
  const local = ground.worldToLocal(worldPoint.clone());
  const { width, height } = ground.geometry.parameters;
  const uv = new THREE.Vector2(local.x / width + 0.5, local.y / height + 0.5);
  texture.updateMatrix();
  return texture.transformUv(uv);
}

test('沙地草斑随奔跑向角色身后移动，与侧景保持相同世界速度', t => {
  const { track, ground, texture } = fixture(t);
  ground.updateMatrixWorld(true);
  const point = ground.localToWorld(new THREE.Vector3(0, 0.75, 0));
  const before = sampleGroundUv(ground, texture, point);
  const position = ground.position.clone();
  const repeat = texture.repeat.clone();
  track.update(2);
  point.z += 2; // 侧景向 +Z 移动 2m；同一草斑也应出现在这个世界位置。
  const after = sampleGroundUv(ground, texture, point);
  near(after.x, before.x);
  near(after.y, before.y);
  assert.deepEqual(ground.position, position, '地面网格固定，不露出边缘');
  assert.deepEqual(texture.repeat, repeat, '草斑大小不随滚动改变');
});

test('沙地纹理按绝对插值距离取相位：暂停不漂移，距离重置回到初始纹理', t => {
  const { track, texture, tileM } = fixture(t);
  track.update(1.5);
  near(texture.offset.y, 1.5 / tileM);
  track.update(1.5);
  near(texture.offset.y, 1.5 / tileM);
  track.update(4.5);
  near(texture.offset.y, 4.5 / tileM);
  track.update(0);
  near(texture.offset.y, 0);
  near(texture.offset.x, 0);
});

test('沙地纹理跨平铺周期连续滚动，长距离相位保持有界', t => {
  const { track, texture, tileM } = fixture(t);
  track.update(tileM - 0.1);
  const before = texture.offset.y;
  track.update(tileM + 0.1);
  near((texture.offset.y - before + 1) % 1, 0.2 / tileM);
  track.update(tileM * 1_000_000 + 1.5);
  near(texture.offset.y, 1.5 / tileM);
  assert.ok(texture.offset.y >= 0 && texture.offset.y < 1);
});
