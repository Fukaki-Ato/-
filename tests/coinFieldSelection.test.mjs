import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createCoinField } from '../packages/game/dist/render/coinField.js';

function assertNearestRendered(coins, field, scene) {
  const dist = 50;
  const t = 10;
  field.update({ coins, dist, t, magnetOn: false, playerX: 0, playerY: 0 });
  // Independent full-sort oracle; all taken coins in these fixtures have expired.
  const expected = coins.filter(c => !c.taken && dist - c.worldZ >= -115 && dist - c.worldZ <= 8)
    .sort((a, b) => Math.abs(dist - a.worldZ) - Math.abs(dist - b.worldZ))
    .slice(0, 260).map(c => Math.fround(dist - c.worldZ)).sort((a, b) => a - b);
  assert.equal(field.lastCount, expected.length);
  const matrix = new THREE.Matrix4();
  for (const mesh of scene.children) {
    assert.equal(mesh.count, expected.length);
    const actual = [];
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, matrix);
      actual.push(matrix.elements[14]);
    }
    assert.deepEqual(actual.sort((a, b) => a - b), expected, 'both coin meshes must draw the nearest visible coins');
  }
}

const visibleCoins = () => Array.from({ length: 300 }, (_, i) => ({ lane: 0, worldZ: 160 - i * 0.3 }));
const hiddenCoins = () => Array.from({ length: 300 }, (_, i) => ({ lane: 0, worldZ: 1000 + i }));
const expiredCoins = () => Array.from({ length: 300 }, (_, i) => ({ lane: 0, worldZ: 150 - i * 0.3, taken: true, takenAt: 9 }));

for (const [name, prefix] of [['out-of-range coins', hiddenCoins], ['expired collected coins', expiredCoins]]) {
  test(`coin field keeps nearest 260 after filtering ${name}`, () => {
    const scene = new THREE.Scene();
    const field = createCoinField(scene, 2.2);
    assertNearestRendered([...prefix(), ...visibleCoins()], field, scene);
    // Reuse buffers with fewer candidates: no stale heap entries may be rendered.
    assertNearestRendered([...prefix(), ...visibleCoins().slice(0, 12)], field, scene);
  });
}

test('coin field nearest selection survives shuffled and interleaved entity order', () => {
  const scene = new THREE.Scene();
  const field = createCoinField(scene, 2.2);
  const visible = visibleCoins();
  const hidden = hiddenCoins();
  const expired = expiredCoins();
  // A deterministic permutation models swap-pop removal without depending on array order.
  const coins = visible.flatMap((_, i) => [hidden[i], visible[(i * 137) % 300], expired[i]]);
  assertNearestRendered(coins, field, scene);
  coins.reverse();
  assertNearestRendered(coins, field, scene);
});
