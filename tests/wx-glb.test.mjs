import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { WxUtf8TextDecoder, installWxTextDecoder } from '../apps/wx/build/platform/textDecoder.js';

const NativeTextDecoder = globalThis.TextDecoder;
const legacySpecs = [
  ['characters/bball', 5, 11], ['characters/frog', 1, 11], ['characters/niu', 0, 12],
  ['characters/pony', 0, 11], ['characters/whale', 5, 11],
].map(spec => [...spec, ['KHR_materials_specular']]);
legacySpecs.push(['pickups/magnet',0,0,[]]);
const packagedSpecs = [
  ['bball', 2, 11], ['ama', 0, 11], ['kaze', 0, 11], ['rina', 0, 11], ['bolt', 0, 11],
  ['frog', 1, 11], ['niu', 0, 12], ['pony', 0, 11], ['whale', 5, 11],
].map(([name, images, animations]) => [`characters/coastal/${name}`, images, animations,
  ['bball', 'frog', 'whale'].includes(name) ? ['KHR_materials_specular'] : []]);
packagedSpecs.push(['pickups/coastal/magnet', 0, 0, []]);
packagedSpecs.push(...['shield','jetpack','board','multiplier','boots','helmet'].map(name => [`pickups/coastal/${name}`, 0, 0, []]));
packagedSpecs.push(['characters/penguin', 0, 14, ['KHR_materials_specular']]);
packagedSpecs.push(...['consumables/xp_card', 'pickups/coin', 'pickups/key'].map(name => [name, 0, 0, []]));
const assets = [...legacySpecs, ...packagedSpecs].map(([name, images, animations, extensions]) => {
  const path = `assets/${name}.glb`, bytes = readFileSync(path);
  assert.equal(bytes.toString('ascii', 0, 4), 'glTF');
  assert.equal(bytes.readUInt32LE(4), 2);
  assert.equal(bytes.readUInt32LE(8), bytes.length);
  assert.equal(bytes.readUInt32LE(16), 0x4e4f534a);
  const jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength));
  assert.equal(bytes.readUInt32LE(24 + jsonLength), 0x004e4942);
  return { path, images, animations, extensions, bytes, json, binOffset: 28 + jsonLength };
});
const buffer = asset => asset.bytes.buffer.slice(asset.bytes.byteOffset, asset.bytes.byteOffset + asset.bytes.byteLength);

async function minimalHost(run) {
  // Host simulation only: no actual WX/devtools execution or browser image-decoding stub.
  const names = ['TextDecoder', 'document', 'window', 'self', 'navigator', 'createImageBitmap', 'Image', 'Blob', 'URL', 'fetch'];
  const descriptors = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names) delete globalThis[name];
  try { return await run(); }
  finally {
    for (const [name, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
}

function release(gltf) {
  const geometries = new Set(), materials = new Set();
  gltf.scene.traverse(node => {
    if (node.geometry) geometries.add(node.geometry);
    for (const material of Array.isArray(node.material) ? node.material : node.material ? [node.material] : []) materials.add(material);
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
}

function verifyModel(gltf, asset) {
  let vertices = 0, skinned = 0;
  gltf.scene.traverse(node => {
    vertices += node.geometry?.attributes.position.count ?? 0;
    if (node.isSkinnedMesh) skinned++;
  });
  assert.ok(vertices > 0, `${asset.path}: real vertex data`);
  assert.equal(gltf.animations.length, asset.animations);
  assert.deepEqual(gltf.animations.map(clip => clip.name), (asset.json.animations ?? []).map(clip => clip.name));
  for (const [i, clip] of gltf.animations.entries()) {
    assert.equal(clip.tracks.length, asset.json.animations[i].channels.length);
    assert.ok(clip.duration > 0);
    assert.ok(clip.tracks.every(track => track.times.length > 0 && track.values.length > 0));
  }
  if (!asset.animations) return;
  assert.ok(skinned > 0, `${asset.path}: skinned geometry`);
  const mixer = new THREE.AnimationMixer(gltf.scene);
  const run = gltf.animations.find(clip => clip.name === 'Run');
  assert.ok(run);
  const pose = () => {
    const values = [];
    gltf.scene.traverse(node => { if (node.isBone) values.push(...node.position.toArray(), ...node.quaternion.toArray()); });
    return values;
  };
  mixer.clipAction(run).play();
  mixer.setTime(0);
  const first = pose();
  mixer.setTime(run.duration * 0.37);
  assert.notDeepEqual(pose(), first, `${asset.path}: Run changes real bone transforms`);
  mixer.stopAllAction(); mixer.uncacheRoot(gltf.scene);
}

test('WX 九名海滨角色、企鹅、七个海滨掉落及经验卡/金币/钥匙实际打包GLB，并保留legacy：内嵌数据、动画和扩展，不依赖外部URI/解码器', () => {
  const packaged = new Set();
  for (const config of ['characters', 'items']) {
    for (const item of JSON.parse(readFileSync(`config/${config}.json`, 'utf8')).items) {
      if (item.model?.prefab?.endsWith('.glb') && existsSync(item.model.prefab)) packaged.add(item.model.prefab);
    }
  }
  assert.deepEqual([...packaged].sort(), packagedSpecs.map(([name]) => `assets/${name}.glb`).sort());
  for (const asset of assets) {
    const { json } = asset;
    assert.equal(json.asset.version, '2.0');
    assert.equal(json.buffers.length, 1);
    assert.equal(json.buffers[0].uri, undefined);
    assert.deepEqual(json.extensionsRequired ?? [], []);
    assert.deepEqual(json.extensionsUsed ?? [], asset.extensions);
    const nestedExtensions = new Set();
    function inspect(value) {
      if (!value || typeof value !== 'object') return;
      assert.equal(value.uri, undefined, `${asset.path}: no external/data URI dependencies`);
      if (value.extensions) for (const name of Object.keys(value.extensions)) nestedExtensions.add(name);
      for (const child of Object.values(value)) inspect(child);
    }
    inspect(json);
    assert.deepEqual([...nestedExtensions], asset.extensions);
    assert.equal((json.images ?? []).length, asset.images);
    assert.equal((json.textures ?? []).length, asset.images);
    for (const image of json.images ?? []) {
      assert.equal(image.uri, undefined);
      assert.equal(image.mimeType, 'image/png');
      const view = json.bufferViews[image.bufferView];
      assert.equal(view.buffer, 0);
      const offset = asset.binOffset + (view.byteOffset ?? 0);
      assert.ok(view.byteLength > 8 && offset + view.byteLength <= asset.bytes.length);
      const png = asset.bytes.subarray(offset, offset + view.byteLength);
      assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
      // 检查每个真实内嵌 PNG 的完整容器；这里不替代目标端像素解码。
      const chunks = [];
      let cursor = 8;
      while (cursor < png.length) {
        assert.ok(cursor + 12 <= png.length, `${asset.path}: truncated PNG chunk`);
        const length = png.readUInt32BE(cursor), type = png.toString('ascii', cursor + 4, cursor + 8);
        assert.ok(cursor + length + 12 <= png.length, `${asset.path}: PNG chunk bounds`);
        if (type === 'IHDR') {
          assert.equal(length, 13);
          assert.ok(png.readUInt32BE(cursor + 8) > 0 && png.readUInt32BE(cursor + 12) > 0);
        }
        if (type === 'IDAT') assert.ok(length > 0);
        if (type === 'IEND') assert.equal(length, 0);
        chunks.push(type); cursor += length + 12;
      }
      assert.equal(chunks[0], 'IHDR');
      assert.ok(chunks.includes('IDAT'));
      assert.equal(chunks.at(-1), 'IEND');
      assert.equal(cursor, png.length);
    }
  }
});

test('UTF-8：中文、2/3/4 字节、BOM、空输入和带偏移的视图与原生一致', () => {
  const decoder = new WxUtf8TextDecoder();
  for (const text of ['', 'glTF', '雷霆酷跑 Café € 🐸 𐐷', '\u0000\u007f\u0080\u07ff\u0800\ud7ff\ue000\uffff\u{10000}\u{10ffff}', '\ufeff中文', '\ufeff\ufeff中文', '中\ufeff文']) {
    const bytes = Buffer.from(text, 'utf8');
    assert.equal(decoder.decode(bytes), new NativeTextDecoder().decode(bytes));
    assert.equal(decoder.decode(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length)), new NativeTextDecoder().decode(bytes));
  }
  const bytes = Buffer.from('x中文🐸y');
  const view = new DataView(bytes.buffer, bytes.byteOffset + 1, bytes.byteLength - 2);
  assert.equal(decoder.decode(view), '中文🐸');
  assert.equal(decoder.decode(), '');
  assert.equal(decoder.decode(Buffer.from('\ufeff再解码')), '再解码', 'each call decodes a complete buffer independently');
});

test('非法 UTF-8：替代字符消费边界与原生一致；显式拒绝非 UTF8 和 streaming/fatal 选项', () => {
  const decoder = new WxUtf8TextDecoder();
  for (const bytes of [
    [0x80], [0xff], [0xc0, 0xaf], [0xc2], [0xe2, 0x82], [0xf0, 0x9f, 0x90],
    [0xe2, 0x28, 0xa1], [0xe0, 0x80, 0x80], [0xed, 0xa0, 0x80],
    [0xf0, 0x80, 0x80, 0x80], [0xf4, 0x90, 0x80, 0x80], [0xf5, 0x80, 0x80, 0x80],
    [0xe2, 0x82, 0x41], [0xef, 0xbb], [0xf0, 0x9f, 0x90, 0xef, 0xbb, 0xbf],
  ]) {
    const input = new Uint8Array(bytes);
    assert.equal(decoder.decode(input), new NativeTextDecoder().decode(input), bytes.toString());
  }
  assert.throws(() => new WxUtf8TextDecoder('gbk'), RangeError);
  assert.throws(() => new WxUtf8TextDecoder('utf-8', { fatal: true }), /does not support/);
  assert.throws(() => new WxUtf8TextDecoder('utf-8', { ignoreBOM: true }), /does not support/);
  assert.throws(() => decoder.decode(new Uint8Array(), { stream: true }), /streaming/);
});

test('安装钩子只在缺失时安装，保留现有 native TextDecoder', () => {
  const nativeHost = { TextDecoder: NativeTextDecoder };
  assert.equal(installWxTextDecoder(nativeHost), false);
  assert.equal(nativeHost.TextDecoder, NativeTextDecoder);
  const emptyHost = {};
  assert.equal(installWxTextDecoder(emptyHost), true);
  assert.equal(emptyHost.TextDecoder, WxUtf8TextDecoder);
  assert.equal(installWxTextDecoder(emptyHost), false);
});

test('最小宿主中真实 GLB 全部因缺失 TextDecoder 失败；UTF8 补齐后无纹理模型/动画可解析', async () => {
  await minimalHost(async () => {
    for (const asset of assets) {
      await assert.rejects(new GLTFLoader().parseAsync(buffer(asset), ''), /TextDecoder is not defined/, asset.path);
    }
    assert.equal(installWxTextDecoder(), true);
    for (const asset of assets.filter(asset => !asset.images)) {
      const gltf = await new GLTFLoader().parseAsync(buffer(asset), '');
      try { verifyModel(gltf, asset); } finally { release(gltf); }
    }
    // Not solved by UTF8: GLTFLoader.loadImageSource accesses self.URL before PNG decoding.
    for (const asset of assets.filter(asset => asset.images)) {
      await assert.rejects(new GLTFLoader().parseAsync(buffer(asset), ''), /self is not defined/, asset.path);
    }
  });
});

test('当前全部与legacy真实GLB的几何/动画可在无浏览器宿主解析：显式跳过纹理，不声称PNG已解码', async () => {
  await minimalHost(async () => {
    installWxTextDecoder();
    for (const asset of assets) {
      let skippedTextures = 0;
      const loader = new GLTFLoader().register(() => ({
        name: 'WX_TEST_ONLY_SKIP_TEXTURES',
        loadTexture() { skippedTextures++; return Promise.resolve(null); },
      }));
      const gltf = await loader.parseAsync(buffer(asset), '');
      try {
        verifyModel(gltf, asset);
        assert.equal(skippedTextures, asset.images);
      } finally { release(gltf); }
    }
  });
});
