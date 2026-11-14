import test from 'node:test';
import assert from 'node:assert/strict';
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
