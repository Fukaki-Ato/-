/**
 * platform-wx 适配实现测试（PlatformAdapter v2 §4 wx 列 + D11/D12 + S11 路线 B 垫片）。
 * 用注入的 mock WxLike 在 node 下直测（垫片「可测试」要求），无需真机 wx 全局。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWxAdapter } from '../apps/wx/build/platform/wxPlatform.js';
import { installCanvasShim } from '../apps/wx/build/platform/shim.js';
import { createWxStorage } from '../apps/wx/build/platform/storage.js';

/** 可编程 wx mock：时钟、存储、触摸/生命周期回调、rAF、request、文件系统。 */
function makeWxMock() {
  const state = { clock: 1000, perf: true };
  const store = new Map();
  const touch = { start: [], end: [], cancel: [] };
  const life = { show: [], hide: [] };
  const raf = { next: 1, cbs: new Map() };
  const requests = [];
  const files = new Map();
  let shareArg = null;
  const wx = {
    createCanvas() {
      return { width: 300, height: 150, getContext: (id) => ({ __ctx: id }) };
    },
    getWindowInfo: () => ({ windowWidth: 390, windowHeight: 844, pixelRatio: 2.625 }),
    onWindowResize() {}, offWindowResize() {},
    onTouchStart: cb => touch.start.push(cb),
    onTouchEnd: cb => touch.end.push(cb),
    onTouchCancel: cb => touch.cancel.push(cb),
    offTouchStart() {}, offTouchEnd() {}, offTouchCancel() {},
    getStorageSync: k => (store.has(k) ? store.get(k) : ''),
    setStorageSync: (k, v) => store.set(k, v),
    removeStorageSync: k => store.delete(k),
    request(opts) { requests.push(opts); return { abort() {} }; },
    downloadFile(opts) { requests.push(opts); return { abort() {} }; },
    getFileSystemManager: () => ({
      readFile: opts => {
        const data = files.get(opts.filePath);
        if (data === undefined) return opts.fail?.({ errMsg: 'no such file' });
        opts.success?.({ data: opts.encoding ? String(data) : new TextEncoder().encode(String(data)).buffer });
      },
    }),
    onShow: cb => life.show.push(cb),
    onHide: cb => life.hide.push(cb),
    offShow() {}, offHide() {},
    getPerformance: state.perf ? () => ({ now: () => state.clock }) : undefined,
    requestAnimationFrame: cb => { const h = raf.next++; raf.cbs.set(h, cb); return h; },
    cancelAnimationFrame: h => raf.cbs.delete(h),
    login: opts => opts.success?.({ code: 'wx-code-abcdef123456' }),
    shareAppMessage: a => { shareArg = a; },
  };
  return {
    wx, state, store, touch, life, raf, requests, files,
    get shareArg() { return shareArg; },
    fireTouch(kind, x, y) {
      const ev = { touches: [{ identifier: 0, clientX: x, clientY: y }], changedTouches: [{ identifier: 0, clientX: x, clientY: y }], timeStamp: 0 };
      (kind === 'down' ? touch.start : kind === 'up' ? touch.end : touch.cancel).forEach(cb => cb(ev));
    },
    flushRaf(h, bogus) { const cb = raf.cbs.get(h); if (cb) cb(bogus); },
  };
}

test('v2 标识与 env', () => {
  const { wx } = makeWxMock();
  const a = createWxAdapter({ wx });
  assert.equal(a.version, 2);
  assert.equal(a.env, 'wx');
  assert.ok(a.extras, 'wx 实现必须提供 extras');
});

test('主画布幂等单例 + 离屏独立（D1）', () => {
  const { wx } = makeWxMock();
  let created = 0;
  wx.createCanvas = () => { created++; return { width: 300, height: 150, getContext: (id) => ({ __ctx: id }) }; };
  const a = createWxAdapter({ wx });
  const m1 = a.canvas.mainCanvas();
  const m2 = a.canvas.mainCanvas();
  assert.equal(m1, m2, 'mainCanvas 必须返回同一实例');
  assert.equal(created, 1, '幂等：只 createCanvas 一次');
  const off1 = a.canvas.createOffscreenCanvas(64, 32);
  const off2 = a.canvas.createOffscreenCanvas(64, 32);
  assert.notEqual(off1, off2);
  assert.equal(created, 3);
  assert.equal(off1.width, 64);
  assert.equal(off1.height, 32);
});

test('windowSize 封顶 dpr（K6：2.625 → 2）', () => {
  const { wx } = makeWxMock();
  const s = createWxAdapter({ wx }).canvas.windowSize();
  assert.equal(s.width, 390);
  assert.equal(s.height, 844);
  assert.equal(s.dpr, 2);
});

test('垫片补 addEventListener/removeEventListener + style（S11 路线 B / D13）', () => {
  const raw = { width: 0, height: 0, getContext: () => null };
  const h = installCanvasShim(raw);
  assert.equal(typeof h.gl.addEventListener, 'function');
  assert.equal(typeof h.gl.style, 'object');
  let fired = 0;
  h.gl.addEventListener('webglcontextlost', () => { fired++; });
  assert.equal(h.listeners().get('webglcontextlost').length, 1);
  h.dispatch('webglcontextlost'); // K5：无原生事件源，靠恢复逻辑手动触发
  assert.equal(fired, 1);
});

test('requestFrame 与 now() 同基准，忽略原生回调入参（D12/K12）', () => {
  const m = makeWxMock();
  m.state.clock = 5000;
  const a = createWxAdapter({ wx: m.wx });
  let seen = -1;
  const h = a.requestFrame(t => { seen = t; });
  m.flushRaf(h, 999999); // 传一个明显错误的 bogus 时间戳
  assert.equal(seen, 5000, '回调时间应为 now()，非原生入参');
});

test('now() 缺 getPerformance 时退化 Date.now（S10 §4）', () => {
  const m = makeWxMock();
  m.wx.getPerformance = undefined;
  const before = Date.now();
  const t = createWxAdapter({ wx: m.wx }).now();
  assert.ok(t >= before && t <= Date.now() + 5);
});

test('storage 空串歧义归一化（D11）', () => {
  const m = makeWxMock();
  const s = createWxStorage(m.wx);
  assert.equal(s.get('missing'), null, '无记录 → null');
  s.set('k', '');
  assert.equal(s.get('k'), '', '存过空串 → 空串（与无记录可区分）');
  s.set('n', '{"a":1}');
  assert.equal(s.get('n'), '{"a":1}');
  s.remove('k');
  assert.equal(s.get('k'), null);
  // 非本包写入的历史裸值：原样返回，不静默丢数据
  m.store.set('legacy', 'raw-value');
  assert.equal(s.get('legacy'), 'raw-value');
});

test('fetchJson 非 2xx reject，2xx resolve（两端一致）', async () => {
  const m = makeWxMock();
  const a = createWxAdapter({ wx: m.wx });
  const p200 = a.fetchJson('https://x/a.json');
  m.requests.at(-1).success({ statusCode: 200, data: { ok: 1 } });
  assert.deepEqual(await p200, { ok: 1 });
  const p404 = a.fetchJson('https://x/b.json');
  m.requests.at(-1).success({ statusCode: 404, data: {} });
  await assert.rejects(p404, /HTTP 404/);
  const pf = a.fetchJson('https://x/c.json');
  m.requests.at(-1).fail({ errMsg: 'url not in domain list' });
  await assert.rejects(pf, /url not in domain list/);
});

test('onInput：wx 触点折算共享分类器 → swipe/tap，多播退订幂等（§6/K13）', () => {
  const m = makeWxMock();
  const a = createWxAdapter({ wx: m.wx });
  const gotA = [];
  const gotB = [];
  const offA = a.onInput(e => gotA.push(e));
  a.onInput(e => gotB.push(e));
  // 滑动：down(200,100) → up(200,20)，向左滑
  m.state.clock = 0; m.fireTouch('down', 200, 100);
  m.state.clock = 60; m.fireTouch('up', 100, 100);
  assert.equal(gotA[0].type, 'swipe');
  assert.equal(gotA[0].dir, 'left');
  assert.deepEqual({ x: gotA[0].x, y: gotA[0].y }, { x: 200, y: 100 });
  assert.equal(gotB.length, 1, '两个订阅者都收到');
  // 单击
  m.state.clock = 100; m.fireTouch('down', 50, 60);
  m.state.clock = 150; m.fireTouch('up', 50, 60);
  assert.equal(gotA[1].type, 'tap');
  offA();
  offA(); // 幂等
  m.state.clock = 200; m.fireTouch('down', 200, 100);
  m.state.clock = 260; m.fireTouch('up', 50, 100);
  assert.equal(gotA.length, 2, '退订后不再收到');
  assert.equal(gotB.length, 3);
});

test('onVisibility：onHide→cb(true) 且打断触点，onShow→cb(false)', () => {
  const m = makeWxMock();
  const a = createWxAdapter({ wx: m.wx });
  const events = [];
  a.onInput(e => events.push(e));
  const seen = [];
  const off = a.onVisibility(hidden => seen.push(hidden));
  m.state.clock = 0; m.fireTouch('down', 200, 100); // 半程按下未抬起
  m.life.hide.forEach(cb => cb());
  assert.deepEqual(seen, [true]);
  m.state.clock = 60; m.fireTouch('up', 50, 100); // 抬起时 down 已被 reset 清除
  assert.equal(events.length, 0, 'reset 后残留 up 不产生事件');
  m.life.show.forEach(cb => cb());
  assert.deepEqual(seen, [true, false]);
  off();
});

test('extras.login 占位游客身份（本机持久，S9 换 code2session）', async () => {
  const m = makeWxMock();
  const x = createWxAdapter({ wx: m.wx }).extras;
  const id1 = await x.login();
  assert.equal(id1.isGuest, true);
  assert.match(id1.openid, /^wx-guest-/);
  const id2 = await x.login();
  assert.equal(id1.openid, id2.openid, '同一设备 openid 稳定');
});

test('extras.cloud 占位：save/loadProgress 落本地，callFunction/submitScore reject', async () => {
  const m = makeWxMock();
  const cloud = createWxAdapter({ wx: m.wx }).extras.cloud;
  await cloud.saveProgress('run', { best: 100 });
  assert.deepEqual(await cloud.loadProgress('run'), { best: 100 });
  assert.equal(await cloud.loadProgress('nope'), null);
  await assert.rejects(cloud.callFunction('f'), /unsupported/);
  await assert.rejects(cloud.submitScore(1), /unsupported/);
});

test('extras.readJson 包内路径 + http URL（downloadFile 中转）', async () => {
  const m = makeWxMock();
  m.files.set('config/game.json', JSON.stringify({ hello: '世界' }));
  const x = createWxAdapter({ wx: m.wx }).extras;
  assert.deepEqual(await x.readJson('config/game.json'), { hello: '世界' });
  const p = x.readJson('https://cdn/x/levels.json');
  const req = m.requests.at(-1);
  assert.equal(typeof req.url, 'string');
  req.success({ statusCode: 200, tempFilePath: 'config/game.json' });
  assert.deepEqual(await p, { hello: '世界' });
});

test('extras.readBinary 在下载非 2xx 时 reject', async () => {
  const m = makeWxMock();
  const p = createWxAdapter({ wx: m.wx }).extras.readBinary('https://cdn/x/font.png');
  m.requests.at(-1).success({ statusCode: 404, tempFilePath: 'missing.png' });
  await assert.rejects(p, /HTTP 404/);
});

test('extras.share 透传 wx.shareAppMessage（S9 编排带分口令）', () => {
  const m = makeWxMock();
  createWxAdapter({ wx: m.wx }).extras.share({ title: '我跑了 1234 分', query: 'score=1234' });
  assert.equal(m.shareArg.title, '我跑了 1234 分');
  assert.equal(m.shareArg.query, 'score=1234');
});

// 微信小游戏实测：rAF/cAF 在 GameGlobal 上，wx 对象上根本没有这两个方法。
// 下面的 mock 特意保留了 wx.requestAnimationFrame，用来验证「有全局就用全局」这条优先级。
test('requestFrame 优先用 GameGlobal 的 rAF，不用 wx.requestAnimationFrame', () => {
  const m = makeWxMock();
  let globalCalls = 0;
  globalThis.requestAnimationFrame = () => { globalCalls++; return 9999; };
  globalThis.cancelAnimationFrame = () => {};
  try {
    createWxAdapter({ wx: m.wx }).requestFrame(() => {});
    assert.equal(globalCalls, 1, '必须走全局 rAF');
    assert.equal(m.raf.cbs.size, 0, '不该再走 wx.requestAnimationFrame');
  } finally {
    delete globalThis.requestAnimationFrame;
    delete globalThis.cancelAnimationFrame;
  }
});

test('无全局 rAF 时回落注入的 wx（node 单测与旧基础库路径）', () => {
  const m = makeWxMock();
  createWxAdapter({ wx: m.wx }).requestFrame(() => {});
  assert.equal(m.raf.cbs.size, 1, '回落时仍由注入的 wx 驱动');
});

// three 判定 isWebGL2 用的是「全局类存在 && 上下文构造器名 === WebGL2RenderingContext」，
// 而微信不暴露那个全局类 → 适配器必须补，但只能补真 WebGL2 上下文。
test('mainCanvas 仅在上下文构造器名匹配时暴露 WebGL2RenderingContext', () => {
  const saved = globalThis.WebGL2RenderingContext;
  delete globalThis.WebGL2RenderingContext;
  try {
    const neg = makeWxMock();
    createWxAdapter({ wx: neg.wx }).canvas.mainCanvas();
    assert.equal(globalThis.WebGL2RenderingContext, undefined, '普通对象不能被当成 WebGL2 上下文暴露出去');

    const FakeCtor = { name: 'WebGL2RenderingContext' };
    const pos = makeWxMock();
    pos.wx.createCanvas = () => ({ width: 300, height: 150, getContext: () => ({ constructor: FakeCtor }) });
    createWxAdapter({ wx: pos.wx }).canvas.mainCanvas();
    assert.equal(globalThis.WebGL2RenderingContext, FakeCtor, '真 WebGL2 上下文必须补上全局类');
  } finally {
    if (saved) globalThis.WebGL2RenderingContext = saved;
    else delete globalThis.WebGL2RenderingContext;
  }
});
