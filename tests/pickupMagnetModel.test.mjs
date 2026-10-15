/**
 * 道具 3D 化回归（item_magnet → assets/pickups/magnet.glb；item_jetpack → assets/pickups/jetpack.glb）。
 *
 * 背景：items.json 里 10 个道具都预留了 model.prefab，但仓库里起初只有磁铁一个文件，且渲染层
 * 从未消费过 model.prefab/spin——道具视觉一直是 entityLayers 的贴图箱。本批次：
 *   1. pickupModels.ts：照 animAvatar 模式按 itemRef 异步加载 GLB，任何失败返回 null
 *      （预留路径里没文件的道具绝不能集体报错或空白——回退铁律）
 *   2. entityLayers.createPickupLayer：近距换模（进 35m / 出 40m 滞回）+ spin 消费，
 *      箱槽与模型槽分离，每帧零分配；捞取判定/数值/音效零改动
 *   3. jetpack.glb 落盘后 item_jetpack 从「文件缺失回退」列表移到正向用例
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';

// Node 无 DOM：GLTFLoader 载贴图要走 self.URL / createImageBitmap，垫一层桩（磁铁无贴图，只取骨架+网格）
if (typeof globalThis.self === 'undefined') globalThis.self = globalThis;
if (typeof globalThis.createImageBitmap === 'undefined') {
  globalThis.createImageBitmap = async () => ({ width: 1, height: 1, close() {} });
}
if (typeof URL.createObjectURL !== 'function') URL.createObjectURL = () => 'blob:stub';
if (typeof URL.revokeObjectURL !== 'function') URL.revokeObjectURL = () => {};

const { createPickupModelLoader } = await import('../packages/game/dist/render/pickupModels.js');
const { createPickupLayer } = await import('../packages/game/dist/render/pickupLayer.js');
const { PICKUP_CENTER_Y } = await import('../packages/game/dist/core/sim/collect.js');

const root = join(fileURLToPath(import.meta.url), '..', '..');
const NAMES = ['game', 'characters', 'skills', 'items', 'obstacles', 'themes', 'events', 'economy'];
const content = Object.fromEntries(NAMES.map(n => [n, JSON.parse(readFileSync(join(root, 'config', `${n}.json`), 'utf8'))]));

/** 真文件适配器：assets/ 下存在才读，否则 reject（模拟 dev server 404） */
const realAdapter = { extras: { readBinary: async (p) => {
  const b = readFileSync(join(root, p));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
} } };
/** 垃圾字节适配器：任何路径都返回非 GLB 内容（解析失败路径） */
const garbageAdapter = { extras: { readBinary: async () => new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer } };
const flush = () => new Promise(r => setTimeout(r, 60));

test('加载器：磁铁 GLB 加载成功（尺寸/原点/双网格/自转口径）', async () => {
  const loader = createPickupModelLoader(content, realAdapter);
  assert.equal(loader.hasPrefab('item_magnet'), true);
  assert.equal(loader.spins('item_magnet'), true, 'items.json model.spin=true 应被消费');
  assert.equal(loader.model('item_magnet'), null, '首帧同步未就绪（异步加载不阻塞开局）');
  await flush();
  const m = loader.model('item_magnet');
  assert.ok(m, 'flush 后应加载完成');
  const box = new THREE.Box3().setFromObject(m);
  const size = box.getSize(new THREE.Vector3());
  assert.ok(Math.abs(size.x - 0.8196) < 0.01 && Math.abs(size.y - 0.70) < 0.01 && Math.abs(size.z - 0.2471) < 0.01,
    `尺寸应 0.8196×0.70×0.2471，实测 ${size.toArray().map(v => v.toFixed(3)).join('×')}`);
  assert.ok(box.getCenter(new THREE.Vector3()).length() < 0.01, '几何中心应在原点（与道具箱同锚点）');
  let meshes = 0;
  m.traverse(o => { if (o.isMesh) meshes++; });
  assert.equal(meshes, 2, ' magnet_red + magnet_blue 两个 primitive');
  // 夜间可见性补偿：源资产无 emissive，加载后补了同色弱发光
  m.traverse(o => {
    if (!o.isMesh) return;
    const mat = o.material;
    assert.ok(mat.emissive.getHexString() !== '000000', '加载后应补了 emissive');
    assert.ok(Math.abs(mat.emissiveIntensity - 0.18) < 1e-6, 'emissive 强度 0.18');
  });
  assert.equal(loader.model('item_magnet'), m, '重复取应返回同一实例（不重复加载）');
});

test('加载器：飞行包 GLB 加载成功（尺寸/原点/5 材质/自转口径）', async () => {
  const loader = createPickupModelLoader(content, realAdapter);
  assert.equal(loader.hasPrefab('item_jetpack'), true);
  assert.equal(loader.spins('item_jetpack'), true, 'items.json model.spin=true 应被消费');
  assert.equal(loader.model('item_jetpack'), null, '首帧同步未就绪（异步加载不阻塞开局）');
  await flush();
  const m = loader.model('item_jetpack');
  assert.ok(m, 'flush 后应加载完成');
  const box = new THREE.Box3().setFromObject(m);
  const size = box.getSize(new THREE.Vector3());
  assert.ok(Math.abs(size.x - 0.70) < 0.01 && Math.abs(size.y - 0.1592) < 0.01 && Math.abs(size.z - 0.6183) < 0.01,
    `尺寸应 0.70×0.1592×0.6183，实测 ${size.toArray().map(v => v.toFixed(3)).join('×')}`);
  assert.ok(box.getCenter(new THREE.Vector3()).length() < 0.01, '几何中心应在原点（与道具箱同锚点）');
  let meshes = 0; const mats = new Set();
  m.traverse(o => {
    if (!o.isMesh) return;
    meshes++;
    (Array.isArray(o.material) ? o.material : [o.material]).forEach(mat => {
      mats.add(mat.name);
      assert.ok(mat.emissive.getHexString() !== '000000', '加载后应补了 emissive');
      assert.ok(Math.abs(mat.emissiveIntensity - 0.18) < 1e-6, 'emissive 强度 0.18');
    });
  });
  assert.equal(meshes, 5, 'ship_hull/glass/wing/greeble/engine 五个 primitive');
  assert.deepEqual([...mats].sort(), ['ship_engine', 'ship_glass', 'ship_greeble', 'ship_hull', 'ship_wing']);
  assert.equal(loader.model('item_jetpack'), m, '重复取应返回同一实例（不重复加载）');
});

test('加载器回退铁律：预留路径文件缺失/垃圾字节/无适配器/未配置道具全部返回 null', async () => {
  const ok = createPickupModelLoader(content, realAdapter);
  await flush();
  for (const id of ['item_shield', 'item_coin', 'item_key', 'item_boots', 'item_helmet', 'item_board', 'item_multiplier']) {
    assert.equal(ok.hasPrefab(id), true, `${id} 配了 prefab（预留路径）`);
    assert.equal(ok.model(id), null, `${id} 文件不存在 → null（保持贴图箱）`);
  }
  assert.equal(ok.hasPrefab('item_nope'), false, '未配置道具');
  assert.equal(ok.model('item_nope'), null);

  const bad = createPickupModelLoader(content, garbageAdapter);
  bad.model('item_magnet');
  await flush();
  assert.equal(bad.model('item_magnet'), null, '解析失败 → null');

  const noAdapter = createPickupModelLoader(content, undefined);
  assert.equal(noAdapter.model('item_magnet'), null, '无 adapter（wx）→ null，不抛');
  const noExtras = createPickupModelLoader(content, {});
  assert.equal(noExtras.model('item_magnet'), null, '无 extras.readBinary → null，不抛');
});

// ---------- 层逻辑（假加载器：只验槽位/滞回/spin，不依赖真 GLB） ----------
function fakeLoader(opts = {}) {
  const src = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.7, 0.25), new THREE.MeshStandardMaterial());
  mesh.name = 'fake_magnet';
  src.add(mesh);
  return {
    loader: {
      hasPrefab: (r) => r === 'item_magnet' || (opts.extraPrefab ? r === opts.extraPrefab : false),
      model: (r) => (r === 'item_magnet' || r === opts.extraPrefab ? src : null),
      spins: (r) => r === 'item_magnet', // item_magnet 转；extraPrefab 不转
    },
    src,
  };
}
const pickup = (itemRef, worldZ, lane = 0, taken = false) => ({ itemRef, worldZ, lane, taken });

test('层：近距换模（35m 内 3D / 远距贴图箱）与滞回（进 -35 出 -40 不跳变）', () => {
  const { loader } = fakeLoader();
  const scene = new THREE.Scene();
  const layer = createPickupLayer(scene, 2.2, loader);
  const boxes = scene.children.filter(c => c.isMesh);
  const groups = scene.children.filter(c => c.isGroup);
  assert.equal(boxes.length, 8, '箱槽 8 个');
  assert.equal(groups.length, 8, '模型槽 8 个');

  // 远距（-100m）：只显示箱
  layer.update([pickup('item_magnet', 100)], 0, 1);
  assert.equal(boxes[0].visible, true, '远距应显示贴图箱');
  assert.equal(groups[0].visible, false, '远距不应显示模型');

  // 同一道具逼近（worldZ 固定 134，dist 增长，z=dist-worldZ 递增）
  const p = pickup('item_magnet', 134);
  layer.update([p], 98, 1);   // z=-36：阈值外 → 箱
  assert.equal(groups[0].visible, false, '-36m 未进 35m 窗口');
  layer.update([p], 100, 1);  // z=-34：进窗口 → 换模型，箱隐藏
  assert.equal(groups[0].visible, true, '-34m 应换 3D 模型');
  assert.equal(boxes[0].visible, false, '换模型后同槽箱隐藏');
  assert.equal(groups[0].children.length, 1, '模型槽应挂 1 个 clone');
  assert.ok(Math.abs(groups[0].position.z - (-34)) < 1e-6, '模型 z 应等于 dist-worldZ');
  assert.ok(Math.abs(groups[0].position.x - 0) < 1e-6, '模型 x 应等于 lane*laneWidth');

  // 滞回（dist 回退的防御路径；正常对局 z 单调递增走不到，但阈值抖动时必须不跳变）：
  // 已显示状态下 z 在 -35~-40 滞回带内保持模型，退出 -40 才回箱
  layer.update([p], 99, 1);   // z=-35：带内 → 仍模型
  assert.equal(groups[0].visible, true, '-35m 在滞回带内应保持模型（不来回跳变）');
  layer.update([p], 96, 1);   // z=-38：带内 → 仍模型
  assert.equal(groups[0].visible, true, '-38m 在滞回带内应保持模型（不来回跳变）');
  layer.update([p], 93, 1);   // z=-41：退出 → 回箱
  assert.equal(groups[0].visible, false, '-41m 退出滞回应回贴图箱');
  assert.equal(boxes[0].visible, true, '退出后箱恢复');
});

test('层：spin 消费（item_magnet 绕 Y 递进 / 不转道具恒 0）与浮动同箱口径', () => {
  const { loader } = fakeLoader({ extraPrefab: 'item_board' });
  const scene = new THREE.Scene();
  const layer = createPickupLayer(scene, 2.2, loader);
  const groups = scene.children.filter(c => c.isGroup);
  layer.update([pickup('item_magnet', 30), pickup('item_board', 30, 1)], 0, 2);
  assert.ok(groups[0].rotation.y > 0, `spin=true 应递进（t*0.9+worldZ），实测 ${groups[0].rotation.y}`);
  assert.ok(Math.abs(groups[0].rotation.y - (2 * 0.9 + 30)) < 1e-6, '自转角 = t*0.9 + worldZ（相位错开）');
  assert.equal(groups[1].rotation.y, 0, 'spin=false 不自转（资产已面朝玩家）');
  // 浮动与箱同口径：PICKUP_CENTER_Y + sin(t*2+worldZ)*0.09
  const expectY = PICKUP_CENTER_Y + Math.sin(2 * 2 + 30) * 0.09;
  assert.ok(Math.abs(groups[0].position.y - expectY) < 1e-6, '模型浮动与箱同口径');
});

test('层：无加载器（wx/无 extras）与文件缺失道具都走贴图箱，不抛不空白', () => {
  const scene = new THREE.Scene();
  const layer = createPickupLayer(scene, 2.2); // 不传 loader
  const boxes = scene.children.filter(c => c.isMesh);
  layer.update([pickup('item_magnet', 10), pickup('item_shield', 12, 1)], 0, 1);
  assert.equal(boxes[0].visible, true, '磁铁近距也走箱');
  assert.equal(boxes[1].visible, true, '护盾走箱');
  // 有 loader 但道具无文件：同样回箱
  const { loader } = fakeLoader();
  const scene2 = new THREE.Scene();
  const layer2 = createPickupLayer(scene2, 2.2, loader);
  const boxes2 = scene2.children.filter(c => c.isMesh);
  const groups2 = scene2.children.filter(c => c.isGroup);
  layer2.update([pickup('item_shield', 10)], 0, 1);
  assert.equal(boxes2[0].visible, true, '文件缺失道具回箱');
  assert.equal(groups2[0].visible, false, '文件缺失不占模型槽');
});

test('层：taken 不占槽、混合近远各走各路、槽位复用不串味', () => {
  const { loader } = fakeLoader();
  const scene = new THREE.Scene();
  const layer = createPickupLayer(scene, 2.2, loader);
  const boxes = scene.children.filter(c => c.isMesh);
  const groups = scene.children.filter(c => c.isGroup);
  // 近磁铁 + 远磁铁 + taken 磁铁：模型槽 0 给近的，箱槽 0 给远的，taken 不占
  layer.update([pickup('item_magnet', 10), pickup('item_magnet', 100), pickup('item_magnet', 12, 1, true)], 0, 1);
  assert.equal(groups[0].visible, true, '近的走模型');
  assert.equal(boxes[0].visible, true, '远的走箱');
  assert.equal(boxes[1].visible, false, 'taken 不占箱槽');
  assert.equal(groups[1].visible, false, 'taken 不占模型槽');
  // 槽位复用：下一帧近的消失了 → 模型槽 0 应隐藏（不残留）
  layer.update([pickup('item_magnet', 100)], 0, 1.1);
  assert.equal(groups[0].visible, false, '道具离去后模型槽隐藏');
});
