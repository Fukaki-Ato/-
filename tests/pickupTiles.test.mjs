/**
 * 道具箱贴图回归（用户 2026-10-07：不再旋转 + 贴大厅同风格金框徽标 + 箱色随徽标）。
 * 真实 three 对象图，不建 WebGLRenderer；砖图用假 image。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { PICKUP_TILES, pickupTileFor, setPickupTiles } from '../packages/game/dist/render/pickupTiles.js';
import { PICKUP_CENTER_Y } from '../packages/game/dist/core/sim/collect.js';
import { createPickupLayer } from '../packages/game/dist/render/entityLayers.js';

const MAGNET = { itemRef: 'item_magnet', lane: 0, worldZ: 40 };

function injectAll() {
  const texes = PICKUP_TILES.map(() => new THREE.Texture({ width: 256, height: 256 }));
  setPickupTiles(PICKUP_TILES.map((t, i) => ({ item: t.item, tex: texes[i] })));
  return texes;
}

function one(list) {
  const scene = new THREE.Scene();
  const layer = createPickupLayer(scene, 2.2);
  layer.update(list, 40, 0);
  const box = scene.children.find(m => m.isMesh && m.visible && m.geometry.type === 'BoxGeometry');
  return { scene, layer, box };
}

function disposeScene(scene) {
  const done = new Set();
  scene.traverse(o => {
    if (o.geometry && !done.has(o.geometry)) { done.add(o.geometry); o.geometry.dispose(); }
    if (o.material && !done.has(o.material)) { done.add(o.material); o.material.dispose(); }
  });
}

test('pickupTileFor：认得的道具给砖，没出图的走兜底砖，池子空时给 null', () => {
  setPickupTiles([]);
  assert.equal(pickupTileFor('item_magnet'), null, '未注入 ⇒ 退回纯色箱');
  injectAll();
  assert.ok(pickupTileFor('item_magnet'), '表内道具应有砖');
  assert.equal(pickupTileFor('item_magnet').bg, PICKUP_TILES.find(t => t.item === 'item_magnet').bg, '底色取表内值');
  assert.equal(pickupTileFor('item_brand_new').bg, PICKUP_TILES.find(t => t.item === 'item_default').bg, '新道具没出图 ⇒ 兜底砖');
});

test('道具箱：贴上砖图、自发光随徽标底色，且不再绕 Y 自转', t => {
  const texes = injectAll();
  const { scene, layer, box } = one([MAGNET]);
  t.after(() => disposeScene(scene));
  assert.ok(box, '道具箱应在');
  assert.equal(box.material.map, texes[0], '正面砖图');
  assert.equal(box.material.emissiveMap, texes[0], '自发光叠同一张砖图 ⇒ 夜里自己亮着');
  assert.equal(box.material.color.getHex(), 0xffffff, '有砖图时不再叠色');
  assert.equal(box.material.emissive.getHex(), pickupTileFor('item_magnet').bg, '发光色与徽标底色同系');
  assert.ok(box.material.emissiveIntensity > 0.5, `淡底要够亮才跳得出来，实得 ${box.material.emissiveIntensity}`);
  assert.ok(Math.abs(box.position.y - PICKUP_CENTER_Y) < 0.1, `悬浮高度与 core 判定同源（${box.position.y} vs ${PICKUP_CENTER_Y}）`);
  const y0 = box.rotation.y;
  for (let i = 1; i <= 30; i++) layer.update([MAGNET], 40 + i * 0.2, i / 60);
  assert.equal(box.rotation.y, y0, '跨帧不累积自转');
  assert.equal(box.rotation.y, 0, '徽标正对玩家（含 ±90° 看不到图的角度）');
});

test('未注入（微信端无加载链）：退回原来的纯色箱，不挂空贴图', t => {
  setPickupTiles([]);
  const { scene, box } = one([MAGNET]);
  t.after(() => disposeScene(scene));
  assert.equal(box.material.map, null);
  assert.equal(box.material.color.getHex(), 0xb48cff, 'magnet 原有纯色兜底');
});
