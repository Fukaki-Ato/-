import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const bytes = readFileSync(new URL('../assets/pickups/coastal/magnet.glb', import.meta.url));
const json = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)));

test('original magnet is an editable, self-contained, opaque four-batch PBR asset', () => {
  assert.equal(bytes.readUInt32LE(0), 0x46546c67);
  assert.equal(bytes.readUInt32LE(4), 2);
  assert.equal(bytes.readUInt32LE(8), bytes.length);
  assert.equal(bytes.readUInt32LE(16), 0x4e4f534a);
  assert.ok(bytes.length < 120_000);
  assert.equal(json.meshes.length, 1);
  assert.ok(json.meshes[0].primitives.length <= 4);
  assert.equal(json.materials.length, 4);
  assert.equal(json.buffers.length, 1);
  assert.equal(json.buffers[0].uri, undefined);
  for (const key of ['extensionsUsed', 'extensionsRequired', 'images', 'textures', 'skins', 'animations', 'cameras']) {
    assert.equal(json[key]?.length ?? 0, 0, `no ${key}`);
  }
  assert.equal(json.extensions, undefined);
  for (const node of json.nodes) {
    assert.equal(node.extensions, undefined, 'no lights or other node extensions');
    assert.equal(node.skin, undefined);
  }
  for (const primitive of json.meshes[0].primitives) {
    assert.equal(primitive.mode ?? 4, 4);
    assert.equal(primitive.extensions, undefined);
    assert.equal(primitive.targets, undefined);
    assert.equal(primitive.attributes.TEXCOORD_0, undefined, 'no unused texture coordinates');
  }
  for (const material of json.materials) {
    assert.equal(material.alphaMode ?? 'OPAQUE', 'OPAQUE');
    assert.equal(material.pbrMetallicRoughness.baseColorFactor[3], 1);
    assert.ok(material.pbrMetallicRoughness.roughnessFactor >= .25);
    assert.equal(material.extensions, undefined);
  }
  const source = readFileSync(new URL('../art-source/pickups-coastal/magnet.blend', import.meta.url));
  assert.equal(source.toString('ascii', 0, 7), 'BLENDER');
});

test('real GLTFLoader parses magnet without host globals or texture stubs and preserves the pickup anchor', async () => {
  const binary = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const gltf = await new GLTFLoader().parseAsync(binary, '');
  const box = new THREE.Box3().setFromObject(gltf.scene);
  const size = box.getSize(new THREE.Vector3());
  assert.ok(box.getCenter(new THREE.Vector3()).length() < 1e-5, 'AABB center is zero, not ground-origin');
  for (const [i, target] of [.8196, .70, .2471].entries()) {
    assert.ok(Math.abs(size.getComponent(i) - target) <= .01, `axis ${i}: ${size.getComponent(i)} vs ${target}`);
  }
  let triangles = 0, batches = 0;
  const materials = new Set();
  gltf.scene.traverse(o => {
    if (!o.isMesh) return;
    batches++;
    assert.equal(o.isSkinnedMesh, undefined);
    const p = o.geometry.getAttribute('position');
    const normal = o.geometry.getAttribute('normal');
    const index = o.geometry.getIndex();
    assert.ok(p.count > 0 && normal.count === p.count && index);
    assert.equal(index.count % 3, 0);
    for (const attribute of [p, normal]) {
      for (const value of attribute.array) assert.ok(Number.isFinite(value));
    }
    for (const i of index.array) assert.ok(i >= 0 && i < p.count);
    triangles += index.count / 3;
    for (const mat of Array.isArray(o.material) ? o.material : [o.material]) {
      materials.add(mat);
      assert.ok(mat.isMeshStandardMaterial);
      assert.equal(mat.transparent, false);
      assert.equal(mat.opacity, 1);
      for (const key of ['map', 'normalMap', 'emissiveMap', 'roughnessMap', 'metalnessMap', 'alphaMap', 'aoMap']) {
        assert.equal(mat[key], null, `no ${key}`);
      }
    }
    o.geometry.dispose();
  });
  assert.ok(triangles > 0 && triangles < 1800, `${triangles} triangles`);
  assert.ok(batches <= 4);
  assert.equal(materials.size, 4);
  for (const mat of materials) mat.dispose();
  console.log(JSON.stringify({ bytes: bytes.length, triangles, batches, size: size.toArray() }));
});
