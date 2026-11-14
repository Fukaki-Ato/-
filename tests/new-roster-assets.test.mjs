import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, stat } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const root = new URL('../', import.meta.url);
const ids = ['ama', 'kaze', 'rina', 'bolt'];
const core = ['Idle', 'Run', 'Slide', 'Jump', 'TurnLeft', 'TurnRight', 'Fly', 'Land', 'Hit', 'Death', 'Wave'];
const bones = ['Root', 'Hips', 'Spine', 'Chest', 'Neck', 'Head',
  ...['ArmUpper', 'ArmLower', 'Hand', 'LegUpper', 'LegLower', 'Foot'].flatMap(n => [n + 'L', n + 'R'])];

async function load(id) {
  const bytes = await readFile(new URL(`assets/characters/coastal/${id}.glb`, root));
  assert.equal(bytes.toString('ascii', 0, 4), 'glTF');
  assert.equal(bytes.readUInt32LE(4), 2);
  assert.equal(bytes.readUInt32LE(8), bytes.length);
  const json = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)));
  const array = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const gltf = await new GLTFLoader().parseAsync(array, '');
  const meshes = [];
  gltf.scene.traverse(o => { if (o.isSkinnedMesh) meshes.push(o); });
  return { bytes, json, gltf, meshes };
}

function sample(gltf, name, t) {
  const mixer = new THREE.AnimationMixer(gltf.scene);
  const clip = gltf.animations.find(c => c.name === name);
  const action = mixer.clipAction(clip);
  action.setLoop(THREE.LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();
  mixer.setTime(t);
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse(o => { if (o.isSkinnedMesh) o.skeleton.update(); });
  const positions = new Map();
  gltf.scene.traverse(o => { if (o.isBone) positions.set(o.name, o.getWorldPosition(new THREE.Vector3())); });
  return { mixer, clip, positions };
}

function bounds(meshes) {
  const box = new THREE.Box3();
  const p = new THREE.Vector3();
  for (const mesh of meshes) {
    for (let i = 0; i < mesh.geometry.attributes.position.count; i++) {
      mesh.getVertexPosition(i, p).applyMatrix4(mesh.matrixWorld);
      assert.ok(Number.isFinite(p.x + p.y + p.z), 'finite actual skinned vertex');
      box.expandByPoint(p);
    }
  }
  return box;
}

for (const id of ids) {
  test(`${id}: original editable geometry, true skin, material and animation contracts`, async () => {
    const { bytes, json, gltf, meshes } = await load(id);
    assert.ok(bytes.length < 900_000, 'compact uncompressed low-texture GLB');
    assert.equal(json.images?.length ?? 0, 0, 'does not depend on downloaded textures');
    assert.ok((json.scenes?.some(s => s.extras?.thunderMotionVersion === 2)) ||
      json.nodes.some(n => n.extras?.thunderMotionVersion === 2));
    const jointNames = new Set(json.skins.flatMap(s => s.joints.map(j => json.nodes[j].name)));
    for (const name of bones) assert.ok(jointNames.has(name), name);
    const primitives = json.meshes.flatMap(m => m.primitives);
    assert.ok(primitives.length <= 12);
    const tris = primitives.reduce((sum, p) => sum + json.accessors[p.indices].count / 3, 0);
    assert.ok(tris >= 6000 && tris <= 12000, `triangle count ${tris}`);
    for (const p of primitives) {
      assert.ok(p.attributes.JOINTS_0 !== undefined);
      assert.ok(p.attributes.WEIGHTS_0 !== undefined);
    }
    let blended = 0;
    for (const mesh of meshes) {
      const w = mesh.geometry.attributes.skinWeight;
      for (let i = 0; i < w.count; i++) {
        assert.ok(Math.abs(w.getX(i) + w.getY(i) + w.getZ(i) + w.getW(i) - 1) < .002);
        if (w.getY(i) > .01) blended++;
      }
    }
    assert.ok(blended > 200, `real blended elbow/knee/torso deformation (${blended})`);
    assert.deepEqual(gltf.animations.map(c => c.name).sort(), [...core].sort());
    for (const clip of gltf.animations) assert.ok(clip.tracks.length >= bones.length);
    const rest = sample(gltf, 'Idle', 0);
    const box = bounds(meshes);
    assert.ok(Math.abs(box.min.y) < .004, `sole at origin ${box.min.y}`);
    assert.ok(box.max.y > 1.60 && box.max.y < 1.72, `height ${box.max.y}`);
    assert.ok(box.max.x - box.min.x < .9, 'standing silhouette <= 0.9m');
    rest.mixer.stopAllAction();
    const blend = await readFile(new URL(`art-source/coastal/${id}.blend`, root));
    assert.equal(blend.toString('ascii', 0, 7), 'BLENDER');
    assert.ok((await stat(new URL(`art-source/coastal/${id}.blend`, root))).size > 100_000);
  });

  test(`${id}: actual Three skin run alternates, folds knees, loops and remains grounded`, async () => {
    const { gltf, meshes } = await load(id);
    const duration = gltf.animations.find(c => c.name === 'Run').duration;
    assert.ok(duration >= .72 && duration <= .9);
    const series = [];
    for (let i = 0; i <= 24; i++) {
      const s = sample(gltf, 'Run', duration * i / 24);
      const p = s.positions;
      const box = bounds(meshes);
      const knee = side => {
        const a = p.get('LegUpper' + side).clone().sub(p.get('LegLower' + side)).normalize();
        const b = p.get('Foot' + side).clone().sub(p.get('LegLower' + side)).normalize();
        return 180 - THREE.MathUtils.radToDeg(a.angleTo(b));
      };
      assert.ok(box.min.y > -.012 && box.min.y < .085, `sole floor at ${i}: ${box.min.y}`);
      series.push({ p, fold: Math.max(knee('L'), knee('R')) });
      s.mixer.stopAllAction();
    }
    const separation = series.map(s => s.p.get('FootL').z - s.p.get('FootR').z);
    assert.ok(Math.min(...separation) < -.45 && Math.max(...separation) > .45, 'alternating forward stride');
    assert.ok(Math.max(...series.map(s => s.fold)) > 70, 'actual knee recovery folds >70deg');
    for (const name of bones) {
      assert.ok(series[0].p.get(name).distanceTo(series.at(-1).p.get(name)) < .0001, `Run seam: ${name}`);
    }
    for (const clip of ['Idle', 'Slide', 'Fly', 'Wave']) {
      const head = sample(gltf, clip, 0);
      const start = head.positions;
      const time = head.clip.duration;
      head.mixer.stopAllAction();
      const tail = sample(gltf, clip, time);
      for (const name of bones) assert.ok(start.get(name).distanceTo(tail.positions.get(name)) < .0001, `${clip} seam: ${name}`);
      tail.mixer.stopAllAction();
    }
    const wave = sample(gltf, 'Wave', .4);
    assert.ok(wave.positions.get('HandL').y > wave.positions.get('Head').y + .15, 'Wave actually raises hand above head');
    wave.mixer.stopAllAction();
    const fly = sample(gltf, 'Fly', .4);
    assert.ok(fly.positions.get('HandL').distanceTo(fly.positions.get('HandR')) > 1, 'Fly arms actually spread');
    fly.mixer.stopAllAction();
    const slide = sample(gltf, 'Slide', .4);
    const slideBox = bounds(meshes);
    assert.ok(slideBox.max.y < 1.1, `Slide is a real low pose (${slideBox.max.y}m)`);
    assert.ok(Math.abs(slideBox.min.y) < .01, 'Slide actual sole contact');
    slide.mixer.stopAllAction();
    const idle = sample(gltf, 'Idle', 0);
    const resting = idle.positions;
    idle.mixer.stopAllAction();
    const jump = sample(gltf, 'Jump', .35);
    assert.ok(jump.positions.get('HandL').y > resting.get('HandL').y + .15, 'Jump arms help takeoff');
    jump.mixer.stopAllAction();
    const land = sample(gltf, 'Land', 0);
    assert.ok(land.positions.get('Hips').y < resting.get('Hips').y - .06, 'Land visibly absorbs impact (~8cm compression)');
    land.mixer.stopAllAction();
    const hit = sample(gltf, 'Hit', .25);
    assert.ok(hit.positions.get('Head').distanceTo(resting.get('Head')) > .1, 'Hit visibly recoils');
    hit.mixer.stopAllAction();
    const left = sample(gltf, 'TurnLeft', .15);
    const lx = left.positions.get('Head').x;
    left.mixer.stopAllAction();
    const right = sample(gltf, 'TurnRight', .15);
    assert.ok(lx * right.positions.get('Head').x < 0 && Math.abs(lx) > .08, 'Turns lean opposite ways');
    right.mixer.stopAllAction();
    const death = sample(gltf, 'Death', 1.1);
    assert.ok(death.positions.get('Head').y < .65, 'Death actually falls');
    death.mixer.stopAllAction();
    for (const name of core) {
      const clip = gltf.animations.find(c => c.name === name);
      for (const fraction of [0, .5, 1]) {
        const s = sample(gltf, name, clip.duration * fraction);
        assert.ok(bounds(meshes).min.y > -.012, `${name}: actual skin does not bury itself`);
        assert.ok(Math.abs(s.positions.get('Root').x) < .001 && Math.abs(s.positions.get('Root').z) < .001,
          `${name}: no horizontal root drift`);
        s.mixer.stopAllAction();
      }
    }
  });
}
