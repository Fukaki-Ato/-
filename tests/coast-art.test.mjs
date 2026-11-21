import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { loadCoast, measure } from '../tools/art/coast_snapshot.mjs';

// Bundle TS directly: no root build, generated dist, browser or host renderer.
const { THREE, createCoastProps } = await loadCoast();
const loop = 200;
const allMeshes = s => s.children.filter(o => o.isMesh);
const matrix = new THREE.Matrix4();
function bounds(mesh, i) {
  mesh.geometry.computeBoundingBox();
  mesh.updateMatrixWorld(true);
  if (mesh.isInstancedMesh) { mesh.getMatrixAt(i, matrix); matrix.premultiply(mesh.matrixWorld); }
  else matrix.copy(mesh.matrixWorld);
  return mesh.geometry.boundingBox.clone().applyMatrix4(matrix);
}
function repeats(box, dz) {
  const result = box.clone(); result.min.z += dz; result.max.z += dz; return result;
}
function xzOverlap(a, b) {
  return a.min.x < b.max.x && a.max.x > b.min.x && a.min.z < b.max.z && a.max.z > b.min.z;
}
function cleanup(scene, props) {
  // Same split ownership as runnerScene: props own instance attributes and ramp;
  // caller owns attached geometries/materials and discards the per-run scene.
  props.dispose();
  const geometries = new Set(), materials = new Set();
  for (const mesh of allMeshes(scene)) {
    geometries.add(mesh.geometry); materials.add(mesh.material);
  }
  for (const g of geometries) g.dispose();
  for (const m of materials) m.dispose();
  scene.clear();
}

test('coast art: all low scenery clears |x|<4.75 before/after loop seams', () => {
  const scene = new THREE.Scene(), props = createCoastProps(scene);
  let previous = 0;
  for (const distance of [0, 6.7, 17.9, 18.1, 39, 99, 199.9, 200, 400.1, 5017.3]) {
    props.update(distance - previous, distance / 12); previous = distance;
    for (const mesh of allMeshes(scene)) for (let i = 0; i < (mesh.count ?? 1); i++) {
      const b = bounds(mesh, i);
      // Original sea gulls fly above the envelope; no ground plants are exempt.
      if (b.min.y > 6) continue;
      assert.ok(b.max.x <= -4.75 || b.min.x >= 4.75,
        `${mesh.name || mesh.material.type} #${i} x=[${b.min.x}, ${b.max.x}] at ${distance}`);
    }
  }
  cleanup(scene, props);
});

test('coast art: plants and new facilities avoid original houses/chairs across periodic seam', () => {
  const scene = new THREE.Scene(), props = createCoastProps(scene);
  props.update(0, 2);
  const original = allMeshes(scene).filter(m => ['coast:villas', 'coast:parasols', 'coast:benches'].includes(m.name));
  const facilities = allMeshes(scene).filter(m => ['coast:shade-pavilions', 'coast:rinse-stations'].includes(m.name));
  const shrubs = allMeshes(scene).filter(m => ['coast:shrubs', 'coast:flora'].includes(m.name));
  for (const mesh of [...facilities, ...shrubs]) for (let i = 0; i < mesh.count; i++) {
    const b = bounds(mesh, i);
    for (const other of [...original, ...facilities]) {
      if (mesh === other) continue;
      for (let j = 0; j < other.count; j++) for (const dz of [-loop, 0, loop]) {
        assert.ok(!xzOverlap(b, repeats(bounds(other, j), dz)),
          `${mesh.name} #${i} overlaps ${other.name} #${j} seam=${dz}`);
      }
    }
  }
  cleanup(scene, props);
});

test('coast art: individual looping, exact 200m period, fixed horizon and original right parasols', () => {
  const scene = new THREE.Scene(), props = createCoastProps(scene);
  props.update(0, 2);
  const moving = allMeshes(scene).filter(m => ['coast:shoals', 'coast:sailboats', 'coast:shade-pavilions',
    'coast:rinse-stations', 'coast:sand-ripples', 'coast:villas', 'coast:parasols'].includes(m.name));
  const initial = moving.map(m => Array.from(m.instanceMatrix.array));
  const horizon = scene.getObjectByName('coast:bay-horizon');
  const horizonMatrix = Array.from(horizon.instanceMatrix.array);
  const parasols = scene.getObjectByName('coast:parasols');
  assert.equal(Array.from({ length: parasols.count }, (_, i) => parasols.instanceMatrix.array[i * 16 + 12])
    .filter(x => x > 0).every(x => Math.abs(x - 12.1) < 1e-5), true);
  props.update(200, 2);
  moving.forEach((m, i) => m.instanceMatrix.array.forEach((v, j) => assert.ok(Math.abs(v - initial[i][j]) < 1e-4)));
  assert.deepEqual(Array.from(horizon.instanceMatrix.array), horizonMatrix);
  let individualWraps = 0;
  for (const m of moving) {
    const zs = Array.from({ length: m.count }, (_, i) => m.instanceMatrix.array[i * 16 + 14]);
    // A small move should wrap only members reaching +18, never the whole group.
    const advance = 18.01 - Math.max(...zs);
    props.update(advance, 2);
    const wrapped = zs.filter((z, i) => m.instanceMatrix.array[i * 16 + 14] - z < -100).length;
    if (m.count > 1 && wrapped > 0 && wrapped < m.count) individualWraps++;
    props.update(-advance, 2);
  }
  assert.ok(individualWraps >= 5);
  cleanup(scene, props);
});

test('coast art: finite shared resources, no frame growth, shader time and disposal ownership', () => {
  let expected;
  for (let cycle = 0; cycle < 3; cycle++) {
    const scene = new THREE.Scene(), props = createCoastProps(scene);
    const objects = [...scene.children], meshes = allMeshes(scene), metrics = measure(scene);
    expected ??= metrics;
    assert.deepEqual(metrics, expected);
    assert.ok(metrics.batches <= 33 && metrics.materials === 9);
    assert.ok(metrics.triangles < 60000);
    assert.ok(meshes.every(m => !m.castShadow));
    const resources = meshes.map(m => [m.geometry, m.material, m.instanceMatrix?.array]);
    for (let frame = 0; frame < 1200; frame++) props.update(0.43, frame / 60);
    assert.deepEqual(scene.children, objects);
    meshes.forEach((m, i) => {
      assert.equal(m.geometry, resources[i][0]); assert.equal(m.material, resources[i][1]);
      assert.equal(m.instanceMatrix?.array, resources[i][2]);
    });
    assert.deepEqual(measure(scene), metrics);
    const sea = meshes.find(m => m.material.uniforms?.uDeep);
    assert.equal(sea.material.uniforms.uT.value, 1199 / 60);
    const instanced = meshes.filter(m => m.isInstancedMesh);
    let disposedInstances = 0, disposedRamp = 0, disposedGeometry = 0, disposedMaterial = 0;
    instanced.forEach(m => m.addEventListener('dispose', () => disposedInstances++));
    const ramp = meshes.find(m => m.material.gradientMap).material.gradientMap;
    ramp.addEventListener('dispose', () => disposedRamp++);
    const geometries = new Set(meshes.map(m => m.geometry)), materials = new Set(meshes.map(m => m.material));
    geometries.forEach(g => g.addEventListener('dispose', () => disposedGeometry++));
    materials.forEach(m => m.addEventListener('dispose', () => disposedMaterial++));
    props.dispose(); props.dispose();
    assert.equal(disposedInstances, instanced.length); assert.equal(disposedRamp, 1);
    assert.equal(disposedGeometry, 0); assert.equal(disposedMaterial, 0);
    cleanup(scene, props);
    assert.equal(disposedGeometry, geometries.size); assert.equal(disposedMaterial, materials.size);
    assert.equal(scene.children.length, 0);
  }
});

test('coast art: source size and original sea GLSL retained', async () => {
  for (const name of ['coastProps', 'bay']) {
    const source = await readFile(`packages/game/src/render/coast/${name}.ts`, 'utf8');
    assert.ok(source.split('\n').length <= 300);
  }
  const sea = await readFile('packages/game/src/render/coast/sea.ts', 'utf8');
  assert.match(sea, /uT \* 1\.15/); assert.match(sea, /uSpark/);
});
