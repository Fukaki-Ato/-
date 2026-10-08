/**
 * S5 页面流转测试（node 端 view model：不渲染像素、不建 WebGL 上下文）。
 * 覆盖：UiHost+页面构造器（headless，three 对象只建不画）、页面信息与交互断言
 * （兼容开始页组件、主菜单启动/可选角色页/商店、HUD onHud 推送、结算含技能释放次数）、
 * createGameFlow 真实主流程（boot→主菜单→run/result/主菜单，测试 run 使用假场景）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Button, Label, List, defaultUiConfig, findBox } from '../packages/framework/dist/ui/index.js';
import { UiHost } from '../packages/framework/dist/ui/host.js';
import { createOverlayViews } from '../packages/game/dist/ui/overlayViews.js';
import { createGameFlow, BEST_KEY, CHAR_KEY } from '../packages/game/dist/flow/mainFlow.js';
import { ENTRY_KEY } from '../packages/game/dist/flow/session.js';
import { loadAllConfig } from '../packages/game/dist/core/config/configLoader.js';
import { CONTENT_NAMES } from '../packages/game/dist/core/config/configTypes.js';
import { buildLoadout, playableCharacters } from '../packages/game/dist/core/sim/character.js';
import { readJson, loadTestFontSet } from './ui-helpers.mjs';

const W = 800, H = 600;

function makeHost(env = 'web', extras = undefined) {
  const store = new Map();
  return {
    store,
    adapter: {
      version: 2,
      env,
      extras,
      canvas: {
        mainCanvas: () => ({}),
        createOffscreenCanvas: () => ({}),
        windowSize: () => ({ width: W, height: H, dpr: 1 }),
        onResize: () => () => {},
      },
      onInput: () => () => {},
      storage: { get: k => store.get(k) ?? null, set: (k, v) => store.set(k, v), remove: k => store.delete(k) },
      fetchJson: async () => { throw new Error('node 环境不联网'); },
      requestFrame: () => 0,
      cancelFrame: () => {},
      onVisibility: () => () => {},
      now: () => 0,
    },
  };
}

function hostFixture({ env, extras } = {}) {
  const { store, adapter } = makeHost(env, extras);
  const host = new UiHost({
    adapter,
    overlayHost: { renderer: null, width: W, height: H, dpr: 1 }, // headless：tick/render 不被调用
    fonts: loadTestFontSet(),
    config: defaultUiConfig,
  });
  return { host, adapter, store };
}

/** 收集当前树上全部 Label 文本（HUD toast 用） */
function texts(host) {
  const out = [];
  host.overlay.current?.root.visit(w => { if (w instanceof Label) out.push(w.getText()); });
  return out.filter(t => t !== '');
}

function findButton(host, label) {
  let found = null;
  host.overlay.current?.root.visit(w => { if (w instanceof Button && w.label.getText() === label) found = w; });
  return found;
}

function allButtons(host) {
  const out = [];
  host.overlay.current?.root.visit(w => { if (w instanceof Button) out.push(w.label.getText()); });
  return out;
}

/** 预置全部 config 进内存 storage：boot 网络失败 → configLoader 落到缓存 */
function seedConfigCache(adapter) {
  for (const name of CONTENT_NAMES) {
    adapter.storage.set(`thunderrun:config:${name}`, JSON.stringify(readJson(`config/${name}.json`)));
  }
}

function clickWidget(host, w) {
  const box = findBox(host.overlay.tree, w.id);
  const x = box.rect.x + box.rect.w / 2, y = box.rect.y + box.rect.h / 2;
  host.pushInput({ type: 'down', x, y, t: 0 });
  host.pushInput({ type: 'up', x, y, t: 0.05 });
}

async function loadContent() {
  const report = await loadAllConfig(
    { fetchJson: async url => readJson(url.replace(/^\.?\/?/, 'config/').replace(/\.json$/, '.json')), cacheGet: () => null, cacheSet: () => {} },
    name => `./${name}.json`,
  );
  assert.equal(report.ok, true, `config 应加载成功：${report.errors.join(';')}`);
  return report;
}

// ---------------- boot 页 ----------------

test('boot 页：setStatus 普通/错误文案上树', () => {
  const { host } = hostFixture();
  const views = createOverlayViews({ host });
  const boot = views.renderBoot();
  assert.ok(texts(host).includes('雷霆酷跑'), '标题');
  boot.setStatus('配置加载失败：\nbad file', true);
  const t = texts(host);
  assert.ok(t.some(x => x.includes('配置加载失败')), `错误文案上树，实得 ${JSON.stringify(t)}`);
});

// ---------------- start 页（品牌封面 + 两个入口） ----------------

test('start 页：品牌标题 + 恰好两个入口按钮，无输入框/校验文案', () => {
  const { host } = hostFixture();
  const views = createOverlayViews({ host });
  views.renderStart({ wechatAvailable: true, onWechat() {}, onGuest() {} });
  assert.equal(host.overlay.scene.background, null, '开始页叠在 Web 海滨背景上');
  assert.ok(texts(host).includes('雷霆酷跑'), '品牌标题');
  assert.ok(texts(host).includes('THUNDER RUN · 清风快跑'));
  assert.ok(!texts(host).some(t => t.includes('霓虹雷暴')));
  assert.deepEqual(allButtons(host), ['WeChat 登录', '游客登录'], '只有两个入口');
  assert.ok(!texts(host).some(t => t.includes('openid') || t.includes('4-64')), '无账号输入/校验残留');
});

test('start 页：wechatAvailable=false（web）→ 微信登录置灰不回调；游客登录可点', () => {
  const { host } = hostFixture();
  const views = createOverlayViews({ host });
  const acts = [];
  views.renderStart({ wechatAvailable: false, onWechat: () => acts.push('wx'), onGuest: () => acts.push('guest') });
  assert.equal(findButton(host, 'WeChat 登录').state, 'disabled');
  clickWidget(host, findButton(host, 'WeChat 登录'));
  clickWidget(host, findButton(host, '游客登录'));
  assert.deepEqual(acts, ['guest']);
  assert.ok(texts(host).some(t => t.includes('Web 不支持 WeChat 登录，选择游客登录')), '置灰原因可见');
});

test('start 页：setBusy 锁两个按钮、setFeedback 错误文案上树', () => {
  const { host } = hostFixture();
  const views = createOverlayViews({ host });
  const handle = views.renderStart({ wechatAvailable: true, onWechat() {}, onGuest() {} });
  handle.setBusy(true);
  assert.equal(findButton(host, 'WeChat 登录').state, 'disabled');
  assert.equal(findButton(host, '游客登录').state, 'disabled');
  handle.setBusy(false);
  assert.equal(findButton(host, 'WeChat 登录').state, 'normal');
  assert.equal(findButton(host, '游客登录').state, 'normal');
  handle.setFeedback('微信登录失败：网络异常', true);
  assert.ok(texts(host).includes('微信登录失败：网络异常'));
});

// ---------------- select 页（可滑动 List） ----------------

test('select 页：List 渲染角色卡、点选换角色写本机、开始按钮回传所选', async () => {
  const { host, adapter } = hostFixture();
  const report = await loadContent();
  const chars = playableCharacters(report.content);
  assert.ok(chars.length >= 2, '夹具需 ≥2 个可出战角色');
  let started = '';
  const views = createOverlayViews({ host });
  views.renderSelect(report.content, {
    onStartRun: id => { started = id; },
    onBack: () => {},
    onShop: () => {},
  }, chars[0].id, 'guest');
  assert.equal(host.overlay.scene.background, null, '选角页叠在 Web 海滨背景上');
  view2Pass(host);

  const list = findWidget(host, w => w instanceof List);
  assert.ok(list, '角色行 = List 控件');
  assert.ok(list.visibleWindow.end - list.visibleWindow.start >= 2, '横向窗口至少渲染 2 张卡');
  assert.equal(adapter.storage.get(CHAR_KEY), chars[0].id);

  // 点第二张卡：内容坐标 = List 视口左缘 + itemExtent*1.5
  const box = findBox(host.overlay.tree, list.id);
  host.pushInput({ type: 'down', x: box.contentRect.x + 220 * 1.5, y: box.contentRect.y + 20, t: 0 });
  host.pushInput({ type: 'up', x: box.contentRect.x + 220 * 1.5, y: box.contentRect.y + 20, t: 0.05 });
  assert.equal(adapter.storage.get(CHAR_KEY), chars[1].id, '点卡片即写本机（与 DOM 版一致）');
  assert.ok(texts(host).some(t => t.includes(`「${buildLoadout(report.content, chars[1].id).name}」`)), '技能提示行随所选刷新');

  clickWidget(host, findButton(host, '开始 · 跑酷！'));
  assert.equal(started, chars[1].id);
});

test('select 页：显示入口方式与技能/被动详情、返回回调，无配置来源/清缓存杂项', async () => {
  const { host } = hostFixture();
  const report = await loadContent();
  const chars = playableCharacters(report.content);
  let back = 0;
  const views = createOverlayViews({ host });
  views.renderSelect(report.content, { onStartRun() {}, onBack: () => { back++; }, onShop() {} }, chars[0].id, 'wechat');
  view2Pass(host);
  const t = texts(host);
  assert.ok(t.includes('选择角色'));
  assert.ok(t.includes('THUNDER RUN · 清风出发'));
  assert.ok(t.includes('登录方式：微信登录'), `入口方式可见，实得 ${JSON.stringify(t)}`);
  assert.ok(t.some(x => x.startsWith('技能：')) && t.some(x => x.startsWith('被动：')), '卡片技能/被动详情');
  assert.ok(!t.some(x => x.includes('配置来源')), '无开发期配置来源行');
  assert.equal(findButton(host, '清除本机缓存'), null, '无清缓存按钮');
  assert.deepEqual(allButtons(host).filter(b => b === '返回' || b === '开始 · 跑酷！'), ['返回', '开始 · 跑酷！']);
  clickWidget(host, findButton(host, '返回'));
  assert.equal(back, 1);
});

function findWidget(host, pred) {
  let found = null;
  host.overlay.current?.root.visit(w => { if (!found && pred(w)) found = w; });
  return found;
}

/** Label 两遍收敛 + List 视口测量回填：再排一遍拿稳定树 */
function view2Pass(host) {
  host.overlay.current?.relayout();
  host.overlay.current?.relayout();
}

// ---------------- HUD（onHud 推送数据源） ----------------

test('HUD：分数/金币/里程/爱心 + buff 同名合并 + 技能三态文案', () => {
  const { host } = hostFixture();
  const views = createOverlayViews({ host });
  const hud = views.mountHud();
  hud.update({ score: 1234, coins: 9, distance: 105.2, hits: 1, lives: 3, buffs: [], skill: null });
  const line = texts(host).find(t => t.includes('分 ·'));
  assert.ok(line.includes('1,234 分') && line.includes('9 金币') && line.includes('105 m') && line.includes('❤'), line);
  assert.ok(line.includes('♡'), '受击掉心');
  hud.update({
    score: 2000, coins: 10, distance: 200, hits: 0, lives: 3,
    buffs: [{ name: '雷神护体', left: 5 }, { name: '雷神护体', left: 8 }, { name: '永固', left: Infinity }],
    skill: { label: '雷霆瞬步', energy: 0.5, cd: 0, ready: false },
  });
  const t2 = texts(host);
  assert.ok(t2.some(x => x.includes('雷神护体 8s') && !x.includes('5s')), '同名 buff 取最长剩余');
  assert.ok(t2.some(x => x.includes('永固') && !/永固 \d/.test(x)), '永久被动不显倒计时');
  assert.ok(t2.some(x => x === '雷霆瞬步：能量 50%'), '技能能量态');
  hud.update({ score: 2000, coins: 10, distance: 200, hits: 0, lives: 3, buffs: [], skill: { label: '雷霆瞬步', energy: 1, cd: 2.5, ready: false } });
  assert.ok(texts(host).some(x => x.startsWith('雷霆瞬步：冷却 2.5s')));
  hud.update({ score: 2000, coins: 10, distance: 200, hits: 0, lives: 3, buffs: [], skill: { label: '雷霆瞬步', energy: 1, cd: 0, ready: true } });
  assert.ok(texts(host).some(x => x.includes('就绪（双击 / E）')));
  hud.dispose();
  assert.equal(host.overlay.current, null, 'dispose 即卸页');
});

// ---------------- result 页 ----------------

test('result：新纪录标题/大分/技能释放次数/历史最佳 + 两按钮回调', () => {
  const { host } = hostFixture();
  const views = createOverlayViews({ host });
  const acts = [];
  views.renderResult(
    { t: 61.5, distance: 800.4, coins: 40, nearMiss: 7, hits: 2, score: 999, alive: false, casts: 3, charId: 'char_volt' },
    500,
    { onRetry: () => acts.push('retry'), onSelect: () => acts.push('select') },
  );
  const t = texts(host);
  assert.ok(t.includes('新纪录！'), 'score>best 且 >0 → 新纪录（同分不算）');
  assert.ok(t.includes('999'), '大分数行');
  assert.ok(t.some(x => x === '3 次 · char_volt'), `技能释放行，实得 ${JSON.stringify(t)}`);
  assert.ok(t.some(x => x === '800 m' || x.includes('800 m')));
  assert.ok(t.includes('999'), '历史最佳=刷新后');
  clickWidget(host, findButton(host, '再跑一次'));
  clickWidget(host, findButton(host, '返回主界面'));
  assert.deepEqual(acts, ['retry', 'select']);
});

// ---------------- mainFlow 真实主流程（不进 run：node 无 GL） ----------------

test('flow（web）：boot 直达主菜单；开始跑酷使用默认角色；角色入口开发中、商店和结算返回主菜单', async () => {
  const { host, adapter } = hostFixture();
  const views = createOverlayViews({ host });
  const scenes = [];
  const flow = createGameFlow({
    adapter,
    views,
    configResolve: name => `./${name}.json`,
    createScene: (_runHost, _adapter, sim, _content, callbacks) => {
      const scene = { sim, callbacks, disposed: false, dispose() { scene.disposed = true; } };
      scenes.push(scene);
      return scene;
    },
  });
  seedConfigCache(adapter);
  await flow.boot();
  assert.equal(flow.machine.current(), 'start');
  assert.ok(allButtons(host).includes('开始酷跑'));
  assert.ok(!allButtons(host).some(label => label.includes('登录')));
  assert.ok(!texts(host).includes('选择角色'));

  clickWidget(host, findButton(host, '开始酷跑'));
  assert.equal(flow.machine.current(), 'run');
  assert.equal(scenes[0].sim.loadout.charId, 'char_volt', '主菜单开始使用当前默认角色');
  scenes[0].callbacks.onEnd({
    t: 10, distance: 300, coins: 5, nearMiss: 1, hits: 0, score: 120, alive: false, casts: 1, charId: 'char_volt',
  });
  assert.equal(flow.machine.current(), 'result');
  assert.equal(adapter.storage.get(BEST_KEY), '120', '结算写最佳');
  clickWidget(host, findButton(host, '返回主界面'));
  assert.equal(flow.machine.current(), 'start');

  clickWidget(host, findButton(host, '角色'));
  assert.equal(flow.machine.current(), 'start', '角色页尚未支持时留在主菜单');
  assert.ok(texts(host).includes('开发中'));

  clickWidget(host, findButton(host, '商店'));
  assert.equal(flow.machine.current(), 'shop');
  assert.ok(texts(host).includes('商店'));
  clickWidget(host, findButton(host, '返回'));
  assert.equal(flow.machine.current(), 'start', '从主菜单商店返回主菜单');
});

test('flow（wx）：即使提供 login 也直接进入主菜单，不自动登录', async () => {
  let calls = 0;
  const extras = { login: async () => { calls++; return { openid: 'wx-guest-abc', isGuest: true }; } };
  const { host, adapter } = hostFixture({ env: 'wx', extras });
  const views = createOverlayViews({ host });
  const flow = createGameFlow({ adapter, views, configResolve: name => `./${name}.json` });
  seedConfigCache(adapter);
  await flow.boot();
  assert.equal(flow.machine.current(), 'start');
  assert.ok(allButtons(host).includes('开始酷跑'));
  assert.ok(!allButtons(host).some(label => label.includes('登录')));
  clickWidget(host, findButton(host, '角色'));
  assert.equal(flow.machine.current(), 'start');
  assert.equal(calls, 0);
  assert.equal(adapter.storage.get(ENTRY_KEY), null);
  assert.ok(texts(host).includes('开发中'));
});

test('flow：配置全缺 → 停在 boot 并显示错误（不静默吞错）', async () => {
  const { host, adapter } = hostFixture();
  const views = createOverlayViews({ host });
  const flow = createGameFlow({ adapter, views, configResolve: n => `./${n}.json` });
  await flow.boot();
  assert.equal(flow.machine.current(), 'boot');
  assert.ok(texts(host).some(t => t.includes('配置加载失败')));
});
