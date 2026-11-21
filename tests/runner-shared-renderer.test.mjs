import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { loadContent } from '../tools/replay/runner.mjs';
import { RunnerSim } from '../packages/game/dist/core/sim/runnerSim.js';
import { createRunnerScene } from '../packages/game/dist/render/runnerScene.js';
import { createRendererSurface } from '../packages/game/dist/render/rendererSurface.js';

function rendererStub() {
  return {
    sizes: [], ratios: [], disposals: 0, renders: [],
    setPixelRatio(dpr) { this.ratios.push(dpr); },
    setSize(...args) { this.sizes.push(args); },
    render(scene, camera) { this.renders.push({ scene, camera }); },
    dispose() { this.disposals++; },
  };
}
const size = { width: 360, height: 640, dpr: 2 };

test('共享 renderer 不调用创建工厂，初始化/缩放更新像素比与逻辑尺寸，销毁保留 renderer', () => {
  const renderer = rendererStub();
  const surface = createRendererSurface(size, () => assert.fail('must not create a second renderer'), renderer);
  assert.equal(surface.renderer, renderer);
  surface.resize({ width: 640, height: 360, dpr: 3 });
  assert.deepEqual(renderer.ratios, [2, 3]);
  assert.deepEqual(renderer.sizes, [[360, 640, false], [640, 360, false]]);
  surface.dispose();
  assert.equal(renderer.disposals, 0);
});

test('未注入 renderer 时仅创建一次，并释放自有 renderer', () => {
  const renderer = rendererStub();
  let creations = 0;
  const surface = createRendererSurface(size, () => { creations++; return renderer; });
  assert.equal(creations, 1);
  assert.equal(surface.renderer, renderer);
  assert.deepEqual(renderer.ratios, [2]);
  assert.deepEqual(renderer.sizes, [[360, 640, false]]);
  surface.dispose();
  assert.equal(renderer.disposals, 1);
});

function fixture() {
  const content = loadContent();
  const sim = new RunnerSim(content, 101, 'char_volt');
  const frames = new Map(), listeners = { input: new Set(), resize: new Set(), visibility: new Set() };
  let nextFrame = 0, now = 0;
  const subscribe = (name, cb) => { listeners[name].add(cb); return () => listeners[name].delete(cb); };
  const adapter = {
    now: () => now,
    requestFrame(cb) { frames.set(++nextFrame, cb); return nextFrame; },
    cancelFrame(id) { frames.delete(id); },
    onInput: cb => subscribe('input', cb),
    onVisibility: cb => subscribe('visibility', cb),
    canvas: { onResize: cb => subscribe('resize', cb) },
  };
  return {
    sim, content, adapter, frames, listeners, host: { canvas: {}, size },
    advance() {
      assert.equal(frames.size, 1, 'one runner callback pending');
      const [id, cb] = frames.entries().next().value;
      frames.delete(id); now += 50; cb(now);
    },
  };
}

test('真实 runner 复用外部 renderer，更新相机尺寸并释放本局几何/材质与订阅', () => {
  const f = fixture(), renderer = rendererStub();
  const runner = createRunnerScene(f.host, f.adapter, f.sim, f.content,
    { onHud() {}, onEnd() {} }, { renderer });
  f.advance();
  const { scene, camera } = renderer.renders[0];
  let geometryDisposals = 0, materialDisposals = 0;
  scene.traverse(object => {
    object.geometry?.addEventListener('dispose', () => geometryDisposals++);
    for (const material of Array.isArray(object.material) ? object.material : object.material ? [object.material] : []) {
      material.addEventListener('dispose', () => materialDisposals++);
    }
  });
  for (const cb of f.listeners.resize) cb({ width: 640, height: 360, dpr: 3 });
  assert.equal(camera.aspect, 640 / 360);
  assert.deepEqual(renderer.sizes.at(-1), [640, 360, false]);
  runner.dispose();
  assert.ok(geometryDisposals > 0);
  assert.ok(materialDisposals > 0);
  assert.equal(renderer.disposals, 0);
  assert.equal(f.frames.size, 0);
  for (const handlers of Object.values(f.listeners)) assert.equal(handlers.size, 0);
  const count = geometryDisposals;
  runner.dispose();
  assert.equal(geometryDisposals, count, 'repeated disposal does not release resources twice');

  const second = createRunnerScene(f.host, f.adapter, f.sim, f.content,
    { onHud() {}, onEnd() {} }, { renderer });
  f.advance();
  assert.notEqual(renderer.renders.at(-1).scene, scene, 'next run uses a new scene on the same renderer');
  second.dispose();
  assert.equal(renderer.disposals, 0);
});

test('onEnd 同步 dispose 后不再安排废弃 tick', () => {
  const f = fixture(), renderer = rendererStub();
  let ended = 0, runner;
  const drain = f.sim.drainEvents.bind(f.sim);
  let deathPending = true;
  f.sim.state.alive = false;
  f.sim.drainEvents = () => {
    if (deathPending) { deathPending = false; return [{ type: 'death' }]; }
    return drain();
  };
  runner = createRunnerScene(f.host, f.adapter, f.sim, f.content,
    { onHud() {}, onEnd() { ended++; runner.dispose(); } }, { renderer });
  for (let i = 0; i < 40 && ended === 0; i++) f.advance();
  assert.equal(ended, 1);
  assert.equal(f.frames.size, 0, 'onEnd disposed this run: no replacement frame may be scheduled');
  assert.equal(renderer.disposals, 0);
  for (const handlers of Object.values(f.listeners)) assert.equal(handlers.size, 0);
});

test('真实 runner 的隧道分别处理天空/雾并恢复，瞬间反馈不覆盖安全 HUD，原回调仍接通', t => {
  const f = fixture(), renderer = rendererStub(), hud = [], events = [];
  const theme = f.content.themes.items.find(x => x.id === 'theme_stormspire');
  f.content.themes.items = [{ ...theme, env: null, sky: { ...theme.sky, flashEveryS: [9999, 9999] } }];
  f.sim.step = () => {}; // 冻结玩法，只检验真实 render/HUD 管线消费状态和事件
  f.sim.drainEvents = () => events.splice(0);
  let casts = 0, pickups = 0;
  const runner = createRunnerScene(f.host, f.adapter, f.sim, f.content,
    { onHud: h => hud.push(h), onEnd() {}, onCast: () => casts++, onPickup: () => pickups++ },
    { renderer, themeId: theme.id });
  t.after(() => runner.dispose());
  f.advance();
  const scene = renderer.renders.at(-1).scene;
  assert.equal(scene.background.getHexString(), '16233e'); assert.equal(scene.fog.color.getHexString(), '3d6b8f');
  f.sim.state.warp = 1; f.sim.state.warpRemain = 100;
  for (let i = 0; i < 13; i++) f.advance();
  const purple = new THREE.Color('#1a0b33');
  assert.equal(scene.background.getHex(), new THREE.Color(theme.sky.baseColor).lerp(purple, 0.85).getHex());
  assert.equal(scene.fog.color.getHex(), new THREE.Color(theme.fog.color).lerp(purple, 0.85).getHex());
  f.sim.state.warp = 0; f.sim.state.warpRemain = 0;
  for (let i = 0; i < 13; i++) f.advance();
  assert.equal(scene.background.getHexString(), '16233e'); assert.equal(scene.fog.color.getHexString(), '3d6b8f');
  f.sim.state.chaserDist = 10;
  events.push({ type: 'coinRain', startM: 100 }, { type: 'cast', skillRef: 'test' }, { type: 'pickup', itemRef: 'item_magnet' });
  for (let i = 0; i < 4; i++) f.advance();
  assert.deepEqual(hud.at(-1).alert, { text: '追击者逼近 · 快跑！', urgency: 3 });
  assert.equal(casts, 1); assert.equal(pickups, 1);
});

test('真实 runner 将宿主模型 loader 接到拾取物，销毁只释放一次共享模型资源', async t => {
  const f = fixture(), renderer = rendererStub();
  f.sim.step = () => {}; f.sim.loadout.prefab = undefined;
  const item = f.content.items.items.find(x => x.model?.prefab);
  f.sim.pickupsArr.splice(0, f.sim.pickupsArr.length, { itemRef: item.id, lane: 0, worldZ: 10 });
  const reads = [];
  f.adapter.extras = { readBinary: async path => { reads.push(path); return new ArrayBuffer(0); } };
  const source = new THREE.Group();
  const geo = new THREE.BoxGeometry(), mat = new THREE.MeshStandardMaterial();
  source.add(new THREE.Mesh(geo, mat));
  let factories = 0, parses = 0, geometryDisposals = 0, materialDisposals = 0;
  geo.addEventListener('dispose', () => geometryDisposals++); mat.addEventListener('dispose', () => materialDisposals++);
  const runner = createRunnerScene(f.host, f.adapter, f.sim, f.content, { onHud() {}, onEnd() {} },
    { renderer, createModelLoader: () => { factories++; return { parse(_buffer, _base, done) { parses++; done({ scene: source }); } }; } });
  t.after(() => runner.dispose());
  f.advance(); await new Promise(setImmediate); f.advance();
  assert.equal(factories, 1); assert.equal(parses, 1);
  assert.deepEqual(reads, [item.model.prefab]);
  const rendered = [];
  renderer.renders.at(-1).scene.traverse(o => { if (o.geometry === geo) rendered.push(o); });
  assert.equal(rendered.length, 1, '模型加载后确实挂入拾取槽位');
  runner.dispose();
  assert.equal(geometryDisposals, 1); assert.equal(materialDisposals, 1);
  assert.equal(renderer.disposals, 0, '宿主 renderer 仍归宿主所有');
});
