import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { createWxModelLoader } from '../apps/wx/build/platform/gltfTextures.js';
import { installWxTextDecoder } from '../apps/wx/build/platform/textDecoder.js';
import { disposeModel } from '../packages/game/dist/render/modelLoader.js';
import { createAvatar } from '../packages/game/dist/render/avatarRig.js';
import { createAnimAvatar } from '../packages/game/dist/render/animAvatar.js';
import { createPickupModelLoader } from '../packages/game/dist/render/pickupModels.js';
import { createRunnerScene } from '../packages/game/dist/render/runnerScene.js';
import { RunnerSim } from '../packages/game/dist/core/sim/runnerSim.js';
import { buildLoadout } from '../packages/game/dist/core/sim/character.js';
import { loadContent } from '../tools/replay/runner.mjs';

const content = loadContent(), flush = () => new Promise(setImmediate);
function asset(path) {
  const bytes = readFileSync(path), length = bytes.readUInt32LE(12), bin = 28 + length;
  const json = JSON.parse(bytes.toString('utf8', 20, 20 + length));
  const pngs = (json.images ?? []).map(image => {
    const view = json.bufferViews[image.bufferView], start = bin + (view.byteOffset ?? 0);
    return bytes.subarray(start, start + view.byteLength);
  });
  return { bytes, json, pngs, buffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
}
const models = ['characters/bball', 'characters/frog', 'characters/niu', 'characters/pony', 'characters/whale', 'pickups/magnet']
  .map(name => ({ name, ...asset(`assets/${name}.glb`) }));
models.push(...content.characters.items.filter(c => c.id.startsWith('char_') && c.status === 'live')
  .map(c => ({ name: c.model.prefab, ...asset(c.model.prefab) })));
models.push(...content.items.items.filter(item => item.kind === 'pickup')
  .map(item => ({ name: item.model.prefab, ...asset(item.model.prefab) })));
const frog = models.find(model => model.name === 'characters/frog');
const bball = models[0];

async function minimalHost(run) {
  const names = ['document', 'window', 'self', 'navigator', 'URL', 'Blob', 'Image', 'createImageBitmap', 'fetch', 'TextDecoder', 'btoa'];
  const descriptors = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names) delete globalThis[name];
  installWxTextDecoder();
  try { await run(); }
  finally {
    for (const [name, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
}

/** 图片 IO 替身：逐字节校验实际 PNG，再触发原生回调；仅读取 IHDR，未模拟像素解码。 */
function imageIo(pngs, { deferred = false } = {}) {
  const images = [], received = [];
  function finish(index, fail = false) {
    const image = images[index];
    if (!fail) image.loaded = true;
    const callback = fail ? image.onerror : image.onload;
    assert.equal(typeof callback, 'function'); callback();
  }
  const wx = { createImage() {
    let src = '';
    const index = images.length;
    const image = { width: 0, height: 0, onload: null, onerror: null, loaded: false,
      get src() { return src; },
      set src(value) {
        src = value;
        if (value === '') return;
        assert.ok(value.startsWith('data:image/png;base64,'));
        const bytes = Buffer.from(value.slice('data:image/png;base64,'.length), 'base64');
        assert.ok(pngs.some(png => png.equals(bytes)), 'wx Image must receive exact embedded PNG bytes');
        assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
        image.bytes = bytes;
        image.width = bytes.readUInt32BE(16); image.height = bytes.readUInt32BE(20);
        received.push(value);
        if (!deferred) queueMicrotask(() => finish(index));
      },
    };
    images.push(image); return image;
  } };
  return { wx, images, received, finish };
}

function materialMaps(gltf) {
  const maps = new Set();
  gltf.scene.traverse(node => {
    for (const material of Array.isArray(node.material) ? node.material : node.material ? [node.material] : []) {
      if (material.map) maps.add(material.map);
      const reference = gltf.parser.associations.get(material);
      const expected = gltf.parser.json.materials[reference?.materials]?.pbrMetallicRoughness?.baseColorTexture;
      if (expected) {
        assert.ok(material.map, `${material.name}: configured baseColorTexture must not disappear`);
        assert.equal(gltf.parser.associations.get(material.map).textures, expected.index);
      }
    }
  });
  return maps;
}

test('最小宿主加载当前角色/补给及legacy GLB：PNG经WX图片IO，材质含应有map，动画驱动真实骨骼', async () => {
  await minimalHost(async () => {
    for (const model of models) {
      const io = imageIo(model.pngs), loader = createWxModelLoader(io.wx);
      const gltf = await loader.parseAsync(model.buffer, '');
      const maps = materialMaps(gltf);
      try {
        assert.equal(io.received.length, model.pngs.length);
        assert.equal(maps.size, model.pngs.length);
        assert.equal(gltf.animations.length, (model.json.animations ?? []).length);
        let vertices = 0;
        gltf.scene.traverse(node => { vertices += node.geometry?.attributes.position.count ?? 0; });
        assert.ok(vertices > 0);
        for (const map of maps) {
          const index = gltf.parser.associations.get(map).textures;
          assert.ok(map.isTexture && map.version > 0);
          assert.equal(map.flipY, false);
          assert.equal(map.colorSpace, THREE.SRGBColorSpace);
          assert.equal(map.wrapS, THREE.RepeatWrapping); assert.equal(map.wrapT, THREE.RepeatWrapping);
          assert.equal(map.magFilter, THREE.LinearFilter); assert.equal(map.minFilter, THREE.LinearMipmapLinearFilter);
          assert.ok(io.images.includes(map.image) && map.image.loaded);
          assert.deepEqual(map.image.bytes, model.pngs[model.json.textures[index].source]);
          assert.equal(map.image.onload, null); assert.equal(map.image.onerror, null);
        }
        const run = gltf.animations.find(clip => clip.name === 'Run');
        if (run) {
          const mixer = new THREE.AnimationMixer(gltf.scene), pose = () => {
            const result = [];
            gltf.scene.traverse(node => { if (node.isBone) result.push(...node.position.toArray(), ...node.quaternion.toArray()); });
            return result;
          };
          mixer.clipAction(run).play(); mixer.setTime(0);
          const initial = pose(); mixer.setTime(run.duration * 0.37);
          assert.notDeepEqual(pose(), initial, model.name);
          mixer.stopAllAction(); mixer.uncacheRoot(gltf.scene);
        }
      } finally { disposeModel(gltf.scene); }
      for (const map of maps) assert.equal(map.image, null, 'disposed texture releases native image reference');
      for (const image of io.images) assert.equal(image.src, '', 'disposed image releases data URI');
    }
    for (const name of ['document', 'self', 'URL', 'Blob', 'createImageBitmap', 'btoa']) assert.equal(globalThis[name], undefined);
  });
});

function repack(model, edit) {
  const json = structuredClone(model.json); edit(json);
  const text = Buffer.from(JSON.stringify(json));
  const padded = Buffer.alloc(Math.ceil(text.length / 4) * 4, 0x20); text.copy(padded);
  const binChunk = model.bytes.subarray(20 + model.bytes.readUInt32LE(12));
  const bytes = Buffer.alloc(20 + padded.length + binChunk.length);
  bytes.write('glTF'); bytes.writeUInt32LE(2, 4); bytes.writeUInt32LE(bytes.length, 8);
  bytes.writeUInt32LE(padded.length, 12); bytes.writeUInt32LE(0x4e4f534a, 16);
  padded.copy(bytes, 20); binChunk.copy(bytes, 20 + padded.length);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

test('WX 插件应用非默认 sampler；不支持的图片 URI 明确拒绝，不进入 DOM 回退', async () => {
  await minimalHost(async () => {
    const io = imageIo(frog.pngs);
    const buffer = repack(frog, json => { json.samplers[0] = { magFilter: 9728, minFilter: 9984, wrapS: 33071, wrapT: 33648 }; });
    const gltf = await createWxModelLoader(io.wx).parseAsync(buffer, '');
    try {
      const [map] = materialMaps(gltf);
      assert.equal(map.magFilter, THREE.NearestFilter); assert.equal(map.minFilter, THREE.NearestMipmapNearestFilter);
      assert.equal(map.wrapS, THREE.ClampToEdgeWrapping); assert.equal(map.wrapT, THREE.MirroredRepeatWrapping);
    } finally { disposeModel(gltf.scene); }
    const unsupported = repack(frog, json => { json.images[0] = { uri: 'external.png' }; });
    const failureIo = imageIo(frog.pngs);
    await assert.rejects(createWxModelLoader(failureIo.wx).parseAsync(unsupported, ''), /仅支持内嵌 PNG/);
    assert.equal(failureIo.images.length, 0);
  });
});

test('图片解码失败拒绝整个 GLB，释放先成功纹理并清理其它迟到图片', async () => {
  await minimalHost(async () => {
    const io = imageIo(bball.pngs, { deferred: true });
    let parser;
    const loader = createWxModelLoader(io.wx).register(value => { parser = value; return { name: 'TEST_OBSERVE_PARSER' }; });
    const parsing = loader.parseAsync(bball.buffer, '');
    const rejected = assert.rejects(parsing, /PNG 解码失败/);
    await flush(); assert.equal(io.images.length, 5);
    const first = io.images.findIndex(image => image.bytes.equals(bball.pngs[bball.json.textures[0].source]));
    const texturePromise = parser.getDependency('texture', 0);
    io.finish(first);
    const texture = await texturePromise;
    let disposed = 0; texture.addEventListener('dispose', () => disposed++);
    const failing = (first + 1) % io.images.length;
    io.finish(failing, true); await rejected;
    for (let i = 0; i < io.images.length; i++) if (i !== first && i !== failing) io.finish(i);
    await flush();
    assert.equal(disposed, 1); assert.equal(texture.image, null);
    for (const image of io.images) {
      assert.equal(image.src, ''); assert.equal(image.onload, null); assert.equal(image.onerror, null);
    }
  });
});

test('WX 图片 src 写入同步异常通过 parseAsync 拒绝并解绑回调', async () => {
  await minimalHost(async () => {
    let image;
    const wx = { createImage() {
      image = { width: 0, height: 0, onload: null, onerror: null,
        set src(value) { if (value) throw new Error('WX image IO unavailable'); },
      }; return image;
    } };
    await assert.rejects(createWxModelLoader(wx).parseAsync(frog.buffer, ''), /WX image IO unavailable/);
    assert.equal(image.onload, null); assert.equal(image.onerror, null);
  });
});

test('avatarRig 在 PNG IO 未结束时 dispose：迟到模型不挂回场景，纹理与几何被释放', async () => {
  await minimalHost(async () => {
    const io = imageIo(frog.pngs, { deferred: true }), scene = new THREE.Scene();
    let parsed, released = 0;
    const factory = () => createWxModelLoader(io.wx).register(() => ({ name: 'TEST_OBSERVE_MODEL', afterRoot(gltf) {
      parsed = gltf;
      gltf.scene.traverse(node => node.geometry?.addEventListener('dispose', () => released++));
      return null;
    } }));
    const rig = createAvatar(scene, 2.2, buildLoadout(content, 'char_frog'),
      { extras: { readBinary: async () => frog.buffer } }, factory);
    await flush(); assert.equal(io.images.length, 1);
    rig.dispose(); const remaining = [...scene.children];
    io.finish(0); await flush();
    assert.deepEqual(scene.children, remaining);
    assert.equal(parsed.scene.parent, null); assert.ok(released > 0);
    assert.equal(io.images[0].src, '');
    for (const map of materialMaps(parsed)) assert.equal(map.image, null);
    disposeModel(scene);
  });
});

test('道具加载器在 PNG IO 未结束时 dispose：不缓存迟到模型，释放纹理且不重新加载', async () => {
  await minimalHost(async () => {
    const io = imageIo(frog.pngs, { deferred: true });
    let reads = 0, parsed;
    const factory = () => createWxModelLoader(io.wx).register(() => ({ name: 'TEST_OBSERVE_PICKUP', afterRoot(gltf) { parsed = gltf; return null; } }));
    const loader = createPickupModelLoader({ items: { items: [{ id: 'item_test', model: { prefab: 'frog.glb' } }] } },
      { extras: { readBinary: async () => { reads++; return frog.buffer; } } }, factory);
    assert.equal(loader.model('item_test'), null);
    await flush(); assert.equal(io.images.length, 1);
    loader.dispose(); io.finish(0); await flush();
    assert.equal(loader.model('item_test'), null); assert.equal(reads, 1);
    assert.equal(parsed.scene.parent, null); assert.equal(io.images[0].src, '');
    for (const map of materialMaps(parsed)) assert.equal(map.image, null);
  });
});

test('动画装配失败释放已解析纹理；Web 缺省工厂之外可显式注入 WX 工厂', async () => {
  await minimalHost(async () => {
    const io = imageIo(frog.pngs);
    const incomplete = repack(frog, json => { json.animations = json.animations.filter(clip => clip.name !== 'Run'); });
    const avatar = await createAnimAvatar({ extras: { readBinary: async () => incomplete } }, 'frog.glb', 1, null,
      undefined, () => createWxModelLoader(io.wx));
    assert.equal(avatar, null); assert.equal(io.images[0].src, '');
  });
});

test('runner opts 将 WX 工厂接入角色与道具；正常结束释放模型图片并保留共享 renderer', async () => {
  await minimalHost(async () => {
    const sim = new RunnerSim(content, 101, 'char_volt'), current = asset(sim.loadout.prefab);
    const io = imageIo(current.pngs);
    const frames = new Map(); let id = 0, factories = 0, parses = 0, rendererDisposed = 0;
    const factory = () => { factories++; return createWxModelLoader(io.wx).register(() => ({
      name: 'TEST_RUNNER_LOADS', afterRoot() { parses++; return null; },
    })); };
    const adapter = { now: () => 0, onInput: () => () => {}, onVisibility: () => () => {},
      requestFrame(cb) { frames.set(++id, cb); return id; }, cancelFrame(id) { frames.delete(id); },
      canvas: { onResize: () => () => {} }, extras: { readBinary: async path => asset(path).buffer },
    };
    const renderer = { setPixelRatio() {}, setSize() {}, render() {}, dispose() { rendererDisposed++; } };
    const runner = createRunnerScene({ canvas: {}, size: { width: 360, height: 640, dpr: 2 } }, adapter, sim, content,
      { onHud() {}, onEnd() {} }, { renderer, createModelLoader: factory });
    sim.pickupsArr.push({ itemRef: 'item_magnet', worldZ: 5, lane: 0, taken: false });
    const [frameId, callback] = frames.entries().next().value;
    frames.delete(frameId); callback(50);
    await flush();
    assert.equal(factories, 2); assert.equal(parses, 2, 'character + real magnet GLB parsed');
    runner.dispose(); assert.equal(rendererDisposed, 0); assert.equal(frames.size, 0);
    assert.equal(current.pngs.length, 2, 'cloth is vertex-coloured; ball and shoes retain their original image material');
    assert.equal(io.received.length, current.pngs.length);
    for (const image of io.images) assert.equal(image.src, '');
  });
});
