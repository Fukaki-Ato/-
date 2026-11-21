import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createPostFx } from '../packages/game/dist/render/postfx.js';

test('WX 后处理降级由 adapter.env 决定，无需宿主全局且不探测 GPU', () => {
  let probes = 0;
  const renderer = { getSize() { probes++; throw new Error('unexpected GPU probe'); } };
  const fx = createPostFx(renderer, new THREE.Scene(), new THREE.PerspectiveCamera(), 'wx');
  assert.equal(fx.composer, null);
  assert.equal(probes, 0);
  fx.update(1 / 60, 1);
  fx.resize(390, 844, 1);
  fx.dispose();
});

test('Web 无 WebGL2 能力时保留裸渲染路径', () => {
  const renderer = { getSize() {}, capabilities: { isWebGL2: false } };
  const fx = createPostFx(renderer, new THREE.Scene(), new THREE.PerspectiveCamera(), 'web');
  assert.equal(fx.composer, null);
  fx.dispose();
});
