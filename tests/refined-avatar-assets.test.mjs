import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { createAnimAvatar } from '../packages/game/dist/render/animAvatar.js';
import { initialRunnerState } from '../packages/game/dist/core/sim/simTypes.js';

const content = JSON.parse(readFileSync('config/characters.json', 'utf8'));
const roster = content.items.filter(c => c.id.startsWith('char_') && c.status === 'live');
const originals = ['bball', 'frog', 'pony', 'niu', 'whale'];
const core = ['Idle', 'Run', 'Slide', 'Jump', 'TurnLeft', 'TurnRight', 'Fly', 'Land', 'Hit', 'Death'];
const fx = { flyT: 0, invincible: false, magnetT: 0, helmetT: 0, shieldLayers: 0 };
const binary = path => { const b = readFileSync(path); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
const json = path => { const b = readFileSync(path); return JSON.parse(b.toString('utf8', 20, 20 + b.readUInt32LE(12))); };
// Actual geometry and animations; native PNG pixels still require the WX device acceptance.
const loader = () => new GLTFLoader().register(() => ({ name: 'OFFLINE_GEOMETRY_ONLY', loadTexture: () => Promise.resolve(null) }));
const adapter = { extras: { readBinary: async path => binary(path) } };
const release = root => root.traverse(o => { o.geometry?.dispose(); for (const m of Array.isArray(o.material) ? o.material : o.material ? [o.material] : []) m.dispose(); });
const sampleBones = root => {
  root.updateMatrixWorld(true);
  return ['Hips', 'Chest', 'Head', 'FootL', 'FootR', 'HandL', 'HandR'].map(name => {
    const bone = root.getObjectByName(name);
    assert.ok(bone?.isBone, `${name}: retained named joint`);
    return { p: bone.getWorldPosition(new THREE.Vector3()), q: bone.getWorldQuaternion(new THREE.Quaternion()) };
  });
};
const step = (avatar, state, dt = 1/60) => {
  state.prevDistance = state.distance; state.distance += 12*dt; state.t += dt;
  avatar.group.position.set(state.x, state.y, 0); avatar.update(dt, state, fx);
};

test('all nine live roles resolve to real coastal skins, with core clips and bounded material batches', () => {
  assert.equal(roster.length, 9);
  for (const role of roster) {
    assert.match(role.model.prefab, /^assets\/characters\/coastal\/.+\.glb$/);
    const data = json(role.model.prefab);
    assert.ok(data.nodes.some(n => n.extras?.thunderMotionVersion === 2));
    assert.deepEqual(data.extensionsRequired ?? [], []);
    assert.ok(data.skins.length > 0);
    assert.ok(core.every(name => data.animations.some(a => a.name === name)));
    assert.ok(data.animations.some(a => ['Wave', 'Laugh', 'Basketball'].includes(a.name)));
    assert.ok(data.meshes.reduce((n, m) => n + m.primitives.length, 0) <= 12);
    const skin = content.items.find(c => c.id === role.skins[0]);
    assert.equal(skin.model.prefab, role.model.prefab, 'default skin and selected role share the actual asset');
  }
});

test('refined legacy meshes contain real topology work and fewer draw batches while preserving original input assets', () => {
  for (const name of originals) {
    const before = json(`assets/characters/${name}.glb`), after = json(`assets/characters/coastal/${name}.glb`);
    const count = j => j.meshes.reduce((n, m) => n + m.primitives.length, 0);
    const triangles = j => j.meshes.reduce((n, m) => n + m.primitives.reduce((v, p) => v + j.accessors[p.indices].count/3, 0), 0);
    assert.ok(count(after) < count(before), name);
    assert.notEqual(triangles(after), triangles(before), `${name}: changed actual geometry, not just a tint`);
    assert.deepEqual(after.animations.map(a => a.name), before.animations.map(a => a.name));
  }
});

test('authored Run and Idle loop seamlessly on real bones; all skinned vertex weights remain normalized', async () => {
  for (const role of roster) {
    const gltf = await loader().parseAsync(binary(role.model.prefab), '');
    try {
      gltf.scene.traverse(mesh => {
        if (!mesh.isSkinnedMesh) return;
        const weights = mesh.geometry.getAttribute('skinWeight');
        for (let i = 0; i < weights.count; i++) {
          const sum = weights.getX(i)+weights.getY(i)+weights.getZ(i)+weights.getW(i);
          assert.ok(Math.abs(sum-1) < .002, `${role.id}: normalized skin weight ${sum}`);
        }
      });
      const mixer = new THREE.AnimationMixer(gltf.scene);
      for (const name of ['Run', 'Idle']) {
        const clip = gltf.animations.find(c => c.name === name);
        const action = mixer.clipAction(clip).setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true; action.reset().play();
        mixer.setTime(0); const first = sampleBones(gltf.scene);
        mixer.setTime(clip.duration); const last = sampleBones(gltf.scene);
        for (let i = 0; i < first.length; i++) {
          assert.ok(first[i].p.distanceTo(last[i].p) < .004, `${role.id} ${name} joint ${i}: loop position seam`);
          assert.ok(first[i].q.angleTo(last[i].q) < .008, `${role.id} ${name} joint ${i}: loop rotation seam`);
        }
        mixer.stopAllAction();
      }
    } finally { release(gltf.scene); }
  }
});

test('real configured avatars run at 120Hz with alternating feet, grounded contact events and no Idle resets', async () => {
  for (const role of roster) {
    const avatar = await createAnimAvatar(adapter, role.model.prefab, role.model.scale, new URLSearchParams('debug'), undefined, loader);
    assert.ok(avatar, role.id);
    try {
      const state = initialRunnerState(); state.y = state.supportY = 2.4;
      const contacts = [], left = [], right = [];
      avatar.setFootfallHandler((x,y,z) => contacts.push({x,y,z}));
      for (let i=0;i<600;i++) {
        // Simulation advances at 60Hz, rendering at 120Hz (same scheduler relationship as WX).
        if (i%2===0) { state.prevDistance=state.distance; state.distance+=12/60; state.t+=1/60; }
        avatar.group.position.set(0,state.y,0); avatar.update(1/120,state,fx);
        if (i>60) {
          left.push(avatar.getBone('FootL').getWorldPosition(new THREE.Vector3()).clone());
          right.push(avatar.getBone('FootR').getWorldPosition(new THREE.Vector3()).clone());
        }
      }
      assert.deepEqual(globalThis.__trAnim.log.map(e=>e.clip), ['Idle','Run'], role.id);
      assert.ok(contacts.length>=6 && contacts.length<=28, `${role.id}: ${contacts.length} contact events in 5s`);
      assert.ok(contacts.every(c=>Math.abs(c.y-2.43)<1e-6 && Math.abs(c.x)<1.1 && Math.abs(c.z)<1.1));
      const range = values => Math.max(...values)-Math.min(...values);
      assert.ok(range(left.map(p=>p.z))>.10 && range(right.map(p=>p.z))>.10, `${role.id}: visible stride on both legs`);
      assert.ok(Math.min(...left.map(p=>p.y),...right.map(p=>p.y))>2.38, `${role.id}: ankle not below support`);
      const lMean=left.reduce((sum,p)=>sum+p.z,0)/left.length, rMean=right.reduce((sum,p)=>sum+p.z,0)/right.length;
      const covariance=left.reduce((sum,p,i)=>sum+(p.z-lMean)*(right[i].z-rMean),0);
      assert.ok(covariance<0, `${role.id}: opposite leg phases`);
    } finally { avatar.dispose(); delete globalThis.__trAnim; }
  }
});

test('authored Run retains its gait phase across a lane-change clip instead of restarting the same foot', async () => {
  const avatar = await createAnimAvatar(adapter, roster[0].model.prefab, 1, new URLSearchParams('debug'), undefined, loader);
  try {
    const state=initialRunnerState();
    for(let i=0;i<137;i++) step(avatar,state);
    const previous=globalThis.__trAnim.act.time;
    state.lane=-1;
    let frames=0;
    do {step(avatar,state);frames++;} while(globalThis.__trAnim.current!=='Run' && frames<40);
    assert.ok(frames>3 && frames<40);
    const expected=(previous+frames/60*1.4)%.8, actual=globalThis.__trAnim.act.time;
    const delta=Math.abs(expected-actual);
    assert.ok(Math.min(delta,.8-delta)<.04, `phase ${actual} expected ${expected}; not a reset to zero`);
  } finally {avatar.dispose();delete globalThis.__trAnim;}
});
