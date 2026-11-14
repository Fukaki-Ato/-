import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const names = ['shield', 'jetpack', 'board', 'multiplier', 'boots', 'helmet'];
const pathFor = name => `assets/pickups/coastal/${name}.glb`;
const load = name => {
  const bytes = readFileSync(pathFor(name));
  assert.equal(bytes.readUInt32LE(0), 0x46546c67);
  assert.equal(bytes.readUInt32LE(4), 2);
  assert.equal(bytes.readUInt32LE(8), bytes.length);
  const json = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)));
  const binary = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return { bytes, json, binary };
};

test('six original coastal equipment GLBs are self-contained opaque standard PBR, not texture or codec hosts', () => {
  for (const name of names) {
    const { bytes, json } = load(name);
    assert.ok(bytes.length < 120_000, `${name}: bounded pickup download`);
    assert.equal(json.meshes.length, 1, `${name}: one logical batched mesh`);
    assert.ok(json.meshes[0].primitives.length <= 4);
    assert.equal(json.materials.length, 4);
    for (const key of ['extensionsUsed', 'extensionsRequired', 'images', 'textures', 'skins', 'animations']) {
      assert.equal(json[key]?.length ?? 0, 0, `${name}: no ${key}`);
    }
    assert.equal(json.buffers.length, 1);
    assert.equal(json.buffers[0].uri, undefined, `${name}: embedded GLB buffer`);
    for (const m of json.materials) {
      assert.equal(m.alphaMode ?? 'OPAQUE', 'OPAQUE');
      assert.equal(m.pbrMetallicRoughness.baseColorFactor[3], 1);
      assert.ok(m.pbrMetallicRoughness.roughnessFactor >= .25);
      assert.equal(m.extensions, undefined);
    }
    const source = readFileSync(`art-source/pickups-coastal/${name}.blend`);
    assert.equal(source.toString('ascii', 0, 7), 'BLENDER', `${name}: editable Blender project`);
  }
});

test('real GLTFLoader parses all pickup geometry/materials without DOM, texture stubs or host globals', async () => {
  for (const name of names) {
    const { binary } = load(name);
    const gltf = await new GLTFLoader().parseAsync(binary, '');
    const bounds = new THREE.Box3().setFromObject(gltf.scene);
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    assert.ok(center.length() < 1e-5, `${name}: centered on PICKUP_CENTER_Y, not ground-origin`);
    assert.ok(size.x >= .6 && size.x <= .95, `${name}: width ${size.x}`);
    assert.ok(size.y >= .5 && size.y <= .9, `${name}: Y-up height ${size.y}`);
    assert.ok(size.z > .1 && size.z <= .65, `${name}: depth ${size.z}`);
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
      for (const a of [p, normal]) {
        for (const value of a.array) assert.ok(Number.isFinite(value), `${name}: finite vertices/normals`);
      }
      for (const i of index.array) assert.ok(i >= 0 && i < p.count, `${name}: valid triangle vertex`);
      triangles += index.count / 3;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        materials.add(m);
        assert.ok(m.isMeshStandardMaterial);
        assert.equal(m.transparent, false);
        assert.equal(m.opacity, 1);
        for (const key of ['map', 'normalMap', 'emissiveMap', 'roughnessMap', 'metalnessMap', 'alphaMap']) assert.equal(m[key], null);
      }
      o.geometry.dispose();
    });
    // A tiny skateboard needs fewer triangles than the curved shells, without padding geometry.
    assert.ok(triangles >= 700 && triangles <= 2500, `${name}: ${triangles} actual triangles`);
    assert.ok(batches <= 4 && materials.size <= 4);
    for (const m of materials) m.dispose();
  }
});
