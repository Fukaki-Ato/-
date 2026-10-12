/** PR #41：资产契约测试之外，必须验证真实配置下的显示高度、尘土和 VFX 缩放。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { buildLoadout } from '../packages/game/dist/core/sim/character.js';
import { initialRunnerState } from '../packages/game/dist/core/sim/simTypes.js';

if (typeof globalThis.self === 'undefined') globalThis.self = globalThis;
if (typeof globalThis.createImageBitmap === 'undefined') globalThis.createImageBitmap = async () => ({ width: 1, height: 1, close() {} });
const { createAnimAvatar } = await import('../packages/game/dist/render/animAvatar.js');
const { createAvatar } = await import('../packages/game/dist/render/avatarRig.js');
const content = Object.fromEntries(['characters', 'skills', 'game'].map(name =>
  [name, JSON.parse(readFileSync(`config/${name}.json`, 'utf8'))]));
const look = buildLoadout(content, 'char_niu');
const adapter = { extras: { readBinary: async path => {
  const b = readFileSync(path);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
} } };
const noFx = { flyT: 0, invincible: false, magnetT: 0, helmetT: 0, shieldLayers: 0 };
const dt = 1 / 60;
const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-5, `${label}: ${actual} != ${expected}`);
const step = (avatar, s, fx = noFx) => {
  s.t += dt; s.prevDistance = s.distance; s.distance += 12 * dt;
  avatar.group.position.set(s.x, s.y, 0); avatar.update(dt, s, fx);
};

test('阿牛按真实配置显示约 1.74m，与牢大接近，不再是 1.40m；碰撞与玩法音效不变', async () => {
  assert.equal(look.modelScale, 1.34);
  assert.equal(look.fallbackModelScale, 1.0);
  assert.equal(look.clearance, 1.7, '显示缩放不是碰撞净空，不给站立钻杆的额外能力');
  assert.equal(look.skill.id, 'skill_mama_save');
  assert.equal(content.characters.items.find(c => c.id === 'char_niu').talentRef, 'talent_niu_rush');
  assert.equal(content.game.params.audio.characters.char_niu.sfx.cast, 'assets/audio/sfx/char/char_niu/cast.mp3');
  const niu = await createAnimAvatar(adapter, look.prefab, look.modelScale);
  const voltLook = buildLoadout(content, 'char_volt');
  const volt = await createAnimAvatar(adapter, voltLook.prefab, voltLook.modelScale);
  assert.ok(niu && volt);
  try {
    // Box3 逐节点 updateWorldMatrix 不保证子骨骼先更新；按 renderer 顺序更新整棵树再测量。
    niu.group.updateMatrixWorld(true); volt.group.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(niu.group, true);
    const height = box.max.y - box.min.y;
    const voltBox = new THREE.Box3().setFromObject(volt.group, true);
    assert.ok(height > 1.70 && height < 1.80, `实际身高应约 1.74m，实测 ${height}`);
    assert.ok(Math.abs(height - (voltBox.max.y - voltBox.min.y)) < 0.05, '与牢大身高相近');
    assert.ok(Math.abs(box.min.y) < 0.01, '脚底仍在原点，不能靠抬高模型伪造身高');
    assert.ok(height / (1.297312 * 1.08) > 1.23, '比修复前至少增高 23%');
  } finally { niu.dispose(); volt.dispose(); }
});

test('胸口高度计入 scale，忽略车顶/跳跃世界位移；1.0 缩放的旧模型不变', async () => {
  for (const [prefab, scale, bindChest] of [[look.prefab, look.modelScale, 0.56], ['assets/characters/frog.glb', 1, 0.98]]) {
    const avatar = await createAnimAvatar(adapter, prefab, scale);
    assert.ok(avatar);
    try {
      near(avatar.chestY, bindChest * scale, '缩放后的胸口高度');
      avatar.group.position.set(3, 2.4, -5);
      near(avatar.chestY, bindChest * scale, '不重复叠加支撑面高度');
      const s = initialRunnerState(); s.y = s.supportY = 2.4;
      for (let i = 0; i < 120; i++) {
        step(avatar, s);
        const chestY = avatar.getBone('Chest').getWorldPosition(new THREE.Vector3()).y;
        near(avatar.chestY, chestY - s.y, '动画期间胸口爆点对齐');
      }
    } finally { avatar.dispose(); }
  }
});

test('放大后的真实局内 Run 仍喷落脚尘土；Slide/Death 不因放大深陷地面', async () => {
  const avatar = await createAnimAvatar(adapter, look.prefab, look.modelScale);
  assert.ok(avatar);
  try {
    const events = []; avatar.setFootfallHandler((x, y, z) => events.push({ x, y, z }));
    const s = initialRunnerState(); s.y = s.supportY = 2.4;
    for (let i = 0; i < 240; i++) step(avatar, s);
    assert.ok(events.length >= 4, `真实 scale 下尘土事件不能消失：${events.length}`);
    assert.ok(events.every(e => Math.abs(e.y - 2.43) < 1e-5), '尘土贴支撑面，不乘模型缩放');
  } finally { avatar.dispose(); }
  for (const [clip, duration, minAllowed] of [['Slide', 0.7, -0.08], ['Death', 1.05, -0.40]]) {
    const a = await createAnimAvatar(adapter, look.prefab, look.modelScale, new URLSearchParams(`anim=${clip}`));
    assert.ok(a);
    try {
      const s = initialRunnerState(); let min = Infinity;
      for (let i = 0; i < Math.round(duration / dt); i++) {
        step(a, s);
        a.group.updateMatrixWorld(true);
        const obj = clip === 'Death' ? a.group.getObjectByName('Body') : a.group;
        min = Math.min(min, new THREE.Box3().setFromObject(obj, true).min.y);
      }
      assert.ok(min > minAllowed, `${clip} 实际最低点 ${min} 不应深于 ${minAllowed}m`);
    } finally { a.dispose(); }
  }
});

test('avatarRig 真实装配：头盔/火焰/护盾跟随放大后的 Head/Chest，胸口爆点一致', async () => {
  const scene = new THREE.Scene();
  const rig = createAvatar(scene, 2.2, look, adapter);
  try {
    for (let i = 0; i < 100 && !rig.group.getObjectByName('NostrilL'); i++) await new Promise(setImmediate);
    assert.ok(rig.group.getObjectByName('NostrilL'), '必须从程序化占位热替换到 niu.glb');
    const s = initialRunnerState(); s.y = s.supportY = 2.4;
    rig.update(s, { ...noFx, helmetT: 1, shieldLayers: 1 }, dt);
    const chest = rig.group.getObjectByName('Chest'), head = rig.group.getObjectByName('Head');
    const flame = chest.children.find(o => o.geometry?.type === 'ConeGeometry');
    const shield = chest.children.find(o => o.geometry?.type === 'SphereGeometry' && o.material?.type === 'MeshBasicMaterial');
    const helmet = head.children.find(o => o.geometry?.type === 'SphereGeometry' && o.material?.transparent);
    assert.ok(flame && shield && helmet, '三个 VFX 挂件必须挂在相应骨骼上');
    assert.ok(shield.visible && helmet.visible);
    for (const [mesh, bone, offset] of [[flame, chest, [0, 0.35, 0.30]], [shield, chest, [0, 0.05, 0]], [helmet, head, [0, 0.22, 0]]]) {
      const expected = bone.localToWorld(new THREE.Vector3(...offset));
      assert.ok(mesh.getWorldPosition(new THREE.Vector3()).distanceTo(expected) < 1e-5, '挂件随模型缩放定位');
    }
    near(rig.chestY, chest.getWorldPosition(new THREE.Vector3()).y - s.y, '爆点高度一致');
  } finally {
    rig.dispose();
    scene.traverse(o => { o.geometry?.dispose(); if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose()); });
  }
});

test('阿牛加载前、加载失败和无 GLB 平台：占位保持 1.0 缩放，不能变成 2.27m 巨人', async () => {
  for (const platform of [undefined, { extras: { readBinary: async () => { throw new Error('QA load failure'); } } }]) {
    const scene = new THREE.Scene(), rig = createAvatar(scene, 2.2, look, platform);
    try {
      await new Promise(setImmediate);
      assert.equal(rig.group.scale.y, 1);
      near(rig.chestY, 0.89, '占位胸口高度不使用 GLB 放大倍率');
      assert.equal(rig.group.getObjectByName('NostrilL'), undefined);
    } finally { rig.dispose(); }
  }
  let resolve;
  const slow = { extras: { readBinary: () => new Promise(r => { resolve = r; }) } };
  const scene = new THREE.Scene(), rig = createAvatar(scene, 2.2, look, slow);
  try {
    assert.equal(rig.group.scale.y, 1, '加载期间先显示正常体量的占位');
    resolve(await adapter.extras.readBinary(look.prefab));
    for (let i = 0; i < 100 && !rig.group.getObjectByName('NostrilL'); i++) await new Promise(setImmediate);
    assert.ok(rig.group.getObjectByName('NostrilL'));
    assert.equal(rig.group.scale.y, 1.34, 'GLB 就绪后才用自己的放大倍率');
  } finally { rig.dispose(); }
  const legacy = buildLoadout(content, 'char_bolt');
  assert.equal(legacy.fallbackModelScale, undefined, '其它角色不被新增配置改变');
  const legacyRig = createAvatar(new THREE.Scene(), 2.2, legacy);
  assert.equal(legacyRig.group.scale.y, 1.05, '没有 fallbackScale 时沿用既有语义');
  legacyRig.dispose();
  for (const invalid of [0, -1, Infinity, 'huge']) {
    const edited = structuredClone(content);
    edited.characters.items.find(c => c.id === 'char_niu').model.fallbackScale = invalid;
    assert.equal(buildLoadout(edited, 'char_niu').fallbackModelScale, undefined, '坏字段不能破坏占位缩放');
  }
});
