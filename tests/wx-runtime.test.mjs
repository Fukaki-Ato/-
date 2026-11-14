import test from 'node:test';
import assert from 'node:assert/strict';
import { NoColorSpace } from 'three';
import { readFileSync } from 'node:fs';
import { Label, findBox } from '../packages/framework/dist/ui/index.js';
import { createWxFrameLoop } from '../apps/wx/build/frameLoop.js';
import { createWxUiResources } from '../apps/wx/build/platform/uiResources.js';
import { bindWxUiInput } from '../apps/wx/build/platform/uiInput.js';
import { bootWxGame } from '../apps/wx/build/bootstrap.js';
import { getWxUiInsets } from '../apps/wx/build/platform/uiInsets.js';

function fixture() {
  let time = 0, id = 0;
  const pending = new Map(), input = new Set(), visibility = new Set(), resize = new Set(), storage = new Map();
  const subscribe = (set, callback) => { set.add(callback); return () => set.delete(callback); };
  const adapter = {
    version: 2, env: 'wx', now: () => time,
    requestFrame(callback) { pending.set(++id, callback); return id; },
    cancelFrame(id) { pending.delete(id); },
    onInput: callback => subscribe(input, callback),
    onVisibility: callback => subscribe(visibility, callback),
    canvas: {
      mainCanvas: () => ({}),
      windowSize: () => ({ width: 390, height: 844, dpr: 2 }),
      onResize: callback => subscribe(resize, callback),
    },
    storage: { get: key => storage.get(key) ?? null, set: (key, value) => storage.set(key, value), remove: key => storage.delete(key) },
    fetchJson: () => assert.fail('package config must not use wx.request'),
  };
  return {
    adapter, pending, input, visibility, resize,
    advance() {
      time += 50;
      const frame = [...pending];
      for (const [id, callback] of frame) { if (pending.delete(id)) callback(time); }
    },
    hide(hidden) { for (const callback of [...visibility]) callback(hidden); },
  };
}

test('WX 单帧按游戏→UI排序；回调中新增任务留到下一帧，取消即时生效', () => {
  const f = fixture(), loop = createWxFrameLoop(f.adapter), events = [];
  const cancelled = loop.ui.requestFrame(() => assert.fail('cancelled UI frame'));
  loop.ui.requestFrame(() => events.push('ui'));
  loop.game.requestFrame(() => {
    events.push('game'); loop.ui.cancelFrame(cancelled);
    loop.game.requestFrame(() => events.push('next game'));
  });
  assert.equal(f.pending.size, 1, 'only one native frame is scheduled');
  f.advance(); assert.deepEqual(events, ['game', 'ui']);
  assert.equal(f.pending.size, 1);
  f.advance(); assert.deepEqual(events, ['game', 'ui', 'next game']);
  assert.equal(f.pending.size, 0);
  loop.dispose(); assert.equal(f.visibility.size, 0);
});

test('WX 帧调度在后台暂停，恢复后继续；销毁会取消待执行工作', () => {
  const f = fixture(), loop = createWxFrameLoop(f.adapter);
  let calls = 0;
  loop.ui.requestFrame(() => calls++);
  f.hide(true); assert.equal(f.pending.size, 0); f.advance(); assert.equal(calls, 0);
  f.hide(false); f.advance(); assert.equal(calls, 1);
  loop.game.requestFrame(() => calls++);
  loop.dispose(); f.advance(); assert.equal(calls, 1);
  assert.equal(loop.game.requestFrame(() => calls++), 0);
});

test('WX 图像加载使用分包路径，等待原生解码并在失败时拒绝', async () => {
  const images = [];
  const resources = createWxUiResources({ createImage() { const image = { width: 32, height: 48 }; images.push(image); return image; } });
  const good = resources.loadImage('assets/fonts/cjk.png');
  assert.equal(images[0].src, 'pkg-assets/assets/fonts/cjk.png');
  images[0].onload(); assert.equal(await good, images[0]);
  assert.equal(images[0].onload, null);
  const bad = resources.loadImage('https://example.invalid/image.png');
  assert.equal(images[1].src, 'https://example.invalid/image.png');
  images[1].onerror(); await assert.rejects(bad, /图片加载失败/);
  assert.equal(images[1].onerror, null);
});

test('WX 原始触控支持拖动、主指跟踪、后台取消和完整解绑', () => {
  const listeners = {}, wx = {};
  for (const name of ['TouchStart', 'TouchMove', 'TouchEnd', 'TouchCancel', 'Hide']) {
    wx[`on${name}`] = callback => { listeners[name] = callback; };
    wx[`off${name}`] = callback => { assert.equal(callback, listeners[name]); delete listeners[name]; };
  }
  const events = [], unbind = bindWxUiInput(wx, event => events.push(event), () => 1000);
  const touch = (identifier, clientX, clientY) => ({ changedTouches: [{ identifier, clientX, clientY }] });
  listeners.TouchStart(touch(1, 10, 20));
  listeners.TouchStart(touch(2, 99, 99));
  listeners.TouchMove(touch(2, 90, 90));
  listeners.TouchMove(touch(1, 40, 50));
  listeners.Hide(); listeners.TouchEnd(touch(1, 60, 60));
  assert.deepEqual(events.map(e => [e.type, e.x, e.y, e.t]), [
    ['down', 10, 20, 1], ['move', 40, 50, 1], ['cancel', 40, 50, 1],
  ]);
  listeners.TouchStart(touch(3, 30, 40)); listeners.TouchEnd(touch(3, 32, 42));
  assert.equal(events.at(-1).type, 'up');
  unbind(); assert.deepEqual(listeners, {});
});

function resourcesFixture() {
  const jsonPaths = [];
  return {
    jsonPaths,
    async loadJson(path) {
      jsonPaths.push(path);
      if (path === 'cloud.config.json') return { envId: '', functionName: 'thunder-api' };
      return JSON.parse(readFileSync(new URL(`../${path.replace(/^pkg-assets\//, '')}`, import.meta.url), 'utf8'));
    },
    async loadImage(path) {
      const bytes = readFileSync(new URL(`../${path}`, import.meta.url));
      return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), src: path };
    },
  };
}

function rendererFixture() {
  return {
    autoClear: true, renders: [], disposals: 0, sizes: [], viewports: [],
    setPixelRatio() {}, setSize(...size) { this.sizes.push(size); }, setViewport(...rect) { this.viewports.push(rect); },
    render(scene, camera) { this.renders.push(camera.isPerspectiveCamera ? 'game' : 'ui'); },
    dispose() { this.disposals++; },
  };
}

function findWidget(host, predicate) {
  let found;
  host.overlay.current.root.visit(w => { if (predicate(w)) found = w; });
  assert.ok(found, 'expected widget is mounted');
  return found;
}

function layoutPath(box, id) {
  if (box.id === id) return [box];
  for (const child of box.children) {
    const path = layoutPath(child, id);
    if (path) return [box, ...path];
  }
}

let inputTime = 1;
function reveal(host, widget) {
  host.overlay.tick(0);
  for (let attempt = 0; attempt < 20; attempt++) {
    const path = layoutPath(host.overlay.tree, widget.id);
    assert.ok(path, 'action is in the visible layout tree');
    const { rect } = path.at(-1), cy = rect.y + rect.h / 2;
    const scroll = path.find(box => box.scroll && (cy < box.clip.y + 4 || cy >= box.clip.y + box.clip.h - 4));
    if (!scroll) return;
    const clip = scroll.clip;
    const delta = Math.max(-clip.h / 2, Math.min(clip.h / 2, clip.y + clip.h / 2 - cy));
    const x = clip.x + clip.w / 2, y = clip.y + clip.h / 2;
    // 真正经过触控路由及 ScrollView 的拖动/裁剪，不直接调用 action 或点击屏幕外矩形。
    host.pushInput({ type: 'down', x, y, t: inputTime });
    host.pushInput({ type: 'move', x, y: y + delta, t: inputTime + .1 });
    host.pushInput({ type: 'move', x, y: y + delta, t: inputTime + .3 });
    host.pushInput({ type: 'up', x, y: y + delta, t: inputTime + .31 });
    inputTime += 1;
    host.overlay.tick(0);
  }
  assert.fail('action did not scroll into the viewport');
}

function click(host, widget) {
  reveal(host, widget);
  const { rect } = findBox(host.overlay.tree, widget.id);
  assert.ok(rect.w > 0 && rect.h > 0, 'target has a real layout rectangle');
  const p = { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2, t: inputTime++ };
  host.pushInput({ type: 'down', ...p }); host.pushInput({ type: 'up', ...p });
}

function action(host, title) {
  return findWidget(host, w => !!w.handlers()?.onClick &&
    (w.label instanceof Label ? w.label.getText() === title :
      w.children?.some(child => child instanceof Label && child.getText() === title)));
}

function clickAction(host, title) {
  click(host, action(host, title));
}

test('WX 启动使用包内配置；实际大厅→选角弹层→跑局→结算→重开共用renderer', async t => {
  t.mock.method(Date, 'now', () => 1793958400000);
  const f = fixture(), resources = resourcesFixture(), renderer = rendererFixture();
  let loaded = 0, bound = 0;
  const app = await bootWxGame({
    adapter: f.adapter, resources,
    connectCloud: async () => null,
    async loadAssets() { loaded++; return 0; },
    bindInput() { bound++; return () => { bound--; }; },
  }, renderer);
  assert.equal(loaded, 1); assert.equal(bound, 1);
  assert.equal(app.flow.machine.current(), 'select');
  assert.equal(resources.jsonPaths.filter(p => p === 'pkg-assets/config/game.json').length, 1);
  assert.equal(resources.jsonPaths.filter(p => p.startsWith('pkg-assets/config/')).length, 8);
  assert.ok(resources.jsonPaths.includes('assets/fonts/noto/latin.metrics.json'));
  assert.ok(resources.jsonPaths.includes('assets/fonts/noto/cjk.metrics.json'));
  assert.ok(!resources.jsonPaths.includes('assets/fonts/cjk.metrics.json'),'legacy mixed-font atlas is not a WX runtime input');
  f.advance(); assert.deepEqual(renderer.renders, ['ui']); renderer.renders = [];
  const portraits = [];
  app.host.overlay.scene.traverse(node => {
    const texture = node.material?.uniforms?.uMap?.value;
    if (texture?.image?.src?.includes('/portraits/')) portraits.push(texture);
  });
  assert.ok(portraits.length > 0, 'the actual current-role portrait reaches the UI material');
  for (const texture of portraits) assert.equal(texture.colorSpace, NoColorSpace, 'direct UI shader must preserve PNG sRGB bytes without implicit decode');
  clickAction(app.host, '角色'); f.advance();
  clickAction(app.host, '收起角色'); f.advance();
  clickAction(app.host, '开始酷跑');
  assert.equal(app.flow.machine.current(), 'run');
  renderer.renders = []; f.advance();
  assert.deepEqual(renderer.renders, ['game', 'ui'], 'game and HUD render in one ordered native frame');
  let frames = 0;
  while (app.flow.machine.current() === 'run' && frames++ < 2000) { renderer.renders = []; f.advance(); }
  assert.equal(app.flow.machine.current(), 'result', 'real simulation reaches death and result');
  assert.equal(renderer.disposals, 0, 'ending a run preserves the shared renderer');
  clickAction(app.host, '再跑一次'); assert.equal(app.flow.machine.current(), 'run');
  renderer.renders = []; f.advance(); assert.deepEqual(renderer.renders, ['game', 'ui']);
  app.dispose();
  assert.equal(f.pending.size, 0); assert.equal(f.input.size, 0);
  assert.equal(f.resize.size, 0); assert.equal(f.visibility.size, 0); assert.equal(bound, 0);
  assert.equal(renderer.disposals, 0, 'test-injected renderer remains caller-owned');
});

test('WX 分包失败不建立主流程；必须的菜单图片失败不留下循环或订阅', async () => {
  const f = fixture(), renderer = rendererFixture(), resources = resourcesFixture();
  const runtime = {
    adapter: f.adapter, resources, bindInput: () => assert.fail('must not bind on startup failure'),
    connectCloud: async () => null,
    loadAssets: async () => { throw new Error('subpackage failed'); },
  };
  await assert.rejects(bootWxGame(runtime, renderer), /subpackage failed/);
  runtime.loadAssets = async () => 0;
  const load = resources.loadImage;
  resources.loadImage = async path => {
    if (path.endsWith('/portraits/char_volt.png')) throw new Error('volt portrait missing');
    return load(path);
  };
  await assert.rejects(bootWxGame(runtime, renderer), /volt portrait missing/);
  assert.equal(f.pending.size, 0); assert.equal(f.resize.size, 0); assert.equal(f.visibility.size, 0);
});

test('WX 非 game 配置失败会拒绝启动、清理实例，修复资源后可重新启动', async () => {
  const f = fixture(), resources = resourcesFixture(), renderer = rendererFixture();
  const load = resources.loadJson;
  let fail = true, bound = 0;
  resources.loadJson = async path => {
    if (fail && path.endsWith('/characters.json')) throw new Error('config temporarily unavailable');
    return load(path);
  };
  const runtime = {
    adapter: f.adapter, resources, loadAssets: async () => 0,
    connectCloud: async () => null,
    bindInput() { bound++; return () => { bound--; }; },
  };
  await assert.rejects(bootWxGame(runtime, renderer), /游戏配置加载失败/);
  assert.equal(bound, 0); assert.equal(f.pending.size, 0); assert.equal(f.input.size, 0);
  assert.equal(f.resize.size, 0); assert.equal(f.visibility.size, 0);
  fail = false;
  const app = await bootWxGame(runtime, renderer);
  assert.equal(app.flow.machine.current(), 'select');
  app.dispose(); assert.equal(bound, 0);
});

test('微信安全区和胶囊坐标按screenTop转换；无safeArea机型仍保留可用窗口', () => {
  assert.deepEqual(getWxUiInsets({
    getWindowInfo: () => ({ windowWidth: 390, windowHeight: 800, pixelRatio: 3, screenTop: 20,
      safeArea: { top: 44, bottom: 790, left: 0, right: 390, width: 390, height: 746 } }),
    getMenuButtonBoundingClientRect: () => ({ top: 48, bottom: 80, left: 290, right: 380, width: 90, height: 32 }),
  }), { top: 68, bottom: 38 });
  assert.deepEqual(getWxUiInsets({ getWindowInfo: () => ({ windowHeight: 600 }) }), { top: 8, bottom: 8 });
});

test('WX任务/手册入口、安全视口触摸与主动结束共用主流程，UI不改变游戏全屏尺寸', async () => {
  const f = fixture(), renderer = rendererFixture();
  let size = { width: 390, height: 844, dpr: 2 }, insets = { top: 50, bottom: 30 }, push;
  f.adapter.canvas.windowSize = () => size;
  const app = await bootWxGame({
    adapter: f.adapter, resources: resourcesFixture(), connectCloud: async () => null,
    loadAssets: async () => 0, uiInsets: () => insets,
    bindInput(callback) { push = callback; return () => {}; },
  }, renderer);
  assert.equal(app.host.adapter.canvas.windowSize().height, 764);
  assert.deepEqual(renderer.sizes.at(-1), [390, 844, false]);
  f.advance(); assert.deepEqual(renderer.viewports.slice(-2), [[0, 30, 390, 764], [0, 0, 390, 844]]);
  const backThroughNativeCoordinates = () => {
    const button = action(app.host, '返回');
    reveal(app.host, button);
    const { rect } = findBox(app.host.overlay.tree, button.id);
    const p = { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 + insets.top, t: 1 };
    push({ type: 'down', ...p }); push({ type: 'up', ...p });
    assert.equal(app.flow.machine.current(), 'select');
  };
  clickAction(app.host, '免费福利手册'); f.advance();
  assert.equal(app.flow.machine.current(), 'handbook');
  backThroughNativeCoordinates();
  clickAction(app.host, '任务'); f.advance(); assert.equal(app.flow.machine.current(), 'tasks');
  backThroughNativeCoordinates();
  clickAction(app.host, '开始酷跑'); f.advance();
  assert.deepEqual(renderer.sizes.at(-1), [390, 844, false], 'runner uses full window, not UI height');
  clickAction(app.host, '结束本局'); assert.equal(app.flow.machine.current(), 'result');
  assert.equal(app.flow.finishRun(), false, 'cannot resubmit from result');
  clickAction(app.host, '返回大厅');
  size = { ...size, height: 900 }; insets = { top: 80, bottom: 40 };
  for (const callback of f.resize) callback(size);
  assert.equal(app.host.adapter.canvas.windowSize().height, 780);
  assert.deepEqual(renderer.sizes.at(-1), [390, 900, false]);
  clickAction(app.host, '免费福利手册'); f.advance();
  assert.deepEqual(renderer.viewports.slice(-2), [[0, 40, 390, 780], [0, 0, 390, 900]]);
  backThroughNativeCoordinates(); app.dispose();
});
