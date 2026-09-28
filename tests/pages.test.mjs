/**
 * S5 页面流转测试（node 端 view model：不渲染像素、不建 WebGL 上下文）。
 * 覆盖：UiHost+页面构造器（headless，three 对象只建不画）、五页面信息与交互逐项对照
 * screens.ts 的等价断言（登录校验/openid 注入、菜单可滑动 List 选角色、HUD onHud 推送、
 * 结算含技能释放次数）、createGameFlow 真实主流程（boot→login→menu→result，run 需 GL 不进 node）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Button, Label, List, defaultUiConfig, findBox } from '../packages/framework/dist/ui/index.js';
import { UiHost } from '../packages/framework/dist/ui/host.js';
import { createOverlayViews } from '../packages/game/dist/ui/overlayViews.js';
import { buildLoginPage } from '../packages/game/dist/ui/loginView.js';
import { keyToEdit, applyKeyEdit } from '../packages/game/dist/ui/keys.js';
import { createGameFlow, BEST_KEY, CHAR_KEY } from '../packages/game/dist/flow/mainFlow.js';
import { loadAllConfig } from '../packages/game/dist/core/config/configLoader.js';
import { CONTENT_NAMES } from '../packages/game/dist/core/config/configTypes.js';
import { buildLoadout, playableCharacters } from '../packages/game/dist/core/sim/character.js';
import { readJson, loadTestFontSet } from './ui-helpers.mjs';

const W = 800, H = 600;

function makeHost() {
  const store = new Map();
  return {
    store,
    adapter: {
      version: 2,
      env: 'web',
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

function hostFixture() {
  const { store, adapter } = makeHost();
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

// ---------------- keys.ts：code→编辑指令 ----------------

test('keys：字母数字/连字符/退格/回车；未映射键返回 null', () => {
  assert.deepEqual(keyToEdit('KeyA'), { type: 'insert', ch: 'a' });
  assert.deepEqual(keyToEdit('Digit7'), { type: 'insert', ch: '7' });
  assert.deepEqual(keyToEdit('Minus'), { type: 'insert', ch: '-' });
  assert.deepEqual(keyToEdit('Backspace'), { type: 'backspace' });
  assert.deepEqual(keyToEdit('Enter'), { type: 'enter' });
  assert.equal(keyToEdit('Escape'), null);
  assert.equal(applyKeyEdit('abc', { type: 'backspace' }), 'ab');
  assert.equal(applyKeyEdit('abc', { type: 'insert', ch: 'd' }, 3), 'abc', 'maxLen 截断');
});

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

// ---------------- login 页 ----------------

test('login 页：手输 openid + Enter 提交 + lastUser 落本机', async () => {
  const { host, adapter } = hostFixture();
  let guest = 0;
  const page = buildLoginPage(host, { actions: { onGuest: () => { guest++; } } });
  host.mount(page.view, { frame: page.frame });
  for (const code of ['KeyO', 'Digit1', 'Digit2', 'Minus', 'KeyA', 'KeyB']) page.onKey(code);
  assert.equal(page.fieldValue(), 'o12-ab');
  page.onKey('Enter');
  assert.equal(guest, 1, 'Enter 提交 → onGuest');
  assert.equal(adapter.storage.get('thunderrun:lastUser'), 'o12-ab');
});

test('login 页：非法输入显示校验错误；游客按钮直通', () => {
  const { host } = hostFixture();
  let guest = 0;
  const page = buildLoginPage(host, { actions: { onGuest: () => { guest++; } } });
  host.mount(page.view);
  page.onKey('Enter'); // 空输入 → 校验失败
  assert.equal(guest, 0);
  assert.ok(texts(host).some(t => t.includes('4-64')), '错误提示上树');
  clickWidget(host, findButton(host, '游客进入（进度存本机）'));
  assert.equal(guest, 1);
});

test('login 页：wx 注入差异——autoLogin 自动填 openid（同一 view）', async () => {
  const { host } = hostFixture();
  let guest = 0;
  const page = buildLoginPage(host, {
    actions: { onGuest: () => { guest++; } },
    autoLogin: async () => 'ox_wxguest_001',
  });
  host.mount(page.view);
  await new Promise(r => setImmediate(r)); // 等注入 promise
  assert.equal(page.fieldValue(), 'ox_wxguest_001');
  page.handle.submit();
  assert.equal(guest, 1);
});

// ---------------- menu 页（可滑动 List） ----------------

test('menu 页：List 渲染角色卡、点选换角色写本机、开始按钮回传所选', async () => {
  const { host, adapter } = hostFixture();
  const report = await loadContent();
  const chars = playableCharacters(report.content);
  assert.ok(chars.length >= 2, '夹具需 ≥2 个可出战角色');
  let started = '';
  const views = createOverlayViews({ host });
  views.renderMenu(report.content, report.sources, {
    onStartRun: id => { started = id; },
    onClearCache: () => {},
  }, chars[0].id);
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
    { onRetry: () => acts.push('retry'), onMenu: () => acts.push('menu') },
  );
  const t = texts(host);
  assert.ok(t.includes('新纪录！'), 'score>best 且 >0 → 新纪录（同分不算）');
  assert.ok(t.includes('999'), '大分数行');
  assert.ok(t.some(x => x === '3 次 · char_volt'), `技能释放行，实得 ${JSON.stringify(t)}`);
  assert.ok(t.some(x => x === '800 m' || x.includes('800 m')));
  assert.ok(t.includes('999'), '历史最佳=刷新后');
  clickWidget(host, findButton(host, '再跑一次'));
  clickWidget(host, findButton(host, '回主菜单'));
  assert.deepEqual(acts, ['retry', 'menu']);
});

// ---------------- mainFlow 真实主流程（不进 run：node 无 GL） ----------------

test('flow：boot→login→(游客)→menu→(go result)→menu，views 全走 overlay 版', async () => {
  const { host, adapter } = hostFixture();
  const views = createOverlayViews({ host });
  const flow = createGameFlow({ adapter, views, configResolve: name => `./${name}.json` });
  // boot：网络失败 → configLoader 落到 storage 缓存（预置全部 config 进内存 storage）
  for (const name of CONTENT_NAMES) {
    adapter.storage.set(`thunderrun:config:${name}`, JSON.stringify(readJson(`config/${name}.json`)));
  }
  await flow.boot();
  assert.equal(flow.machine.current(), 'login');
  assert.ok(texts(host).includes('进入新澪市'));

  views.submitLogin(); // 空输入：应被校验拦下，仍停登录
  assert.equal(flow.machine.current(), 'login');

  clickWidget(host, findButton(host, '游客进入（进度存本机）'));
  assert.equal(flow.machine.current(), 'menu');
  assert.ok(texts(host).includes('主菜单'));

  flow.machine.go('result', {
    t: 10, distance: 300, coins: 5, nearMiss: 1, hits: 0, score: 120, alive: false, casts: 1, charId: 'char_volt',
  });
  assert.equal(flow.machine.current(), 'result');
  assert.equal(adapter.storage.get(BEST_KEY), '120', '结算写最佳');
  clickWidget(host, findButton(host, '回主菜单'));
  assert.equal(flow.machine.current(), 'menu');
});

test('flow：配置全缺 → 停在 boot 并显示错误（不静默吞错）', async () => {
  const { host, adapter } = hostFixture();
  const views = createOverlayViews({ host });
  const flow = createGameFlow({ adapter, views, configResolve: n => `./${n}.json` });
  await flow.boot();
  assert.equal(flow.machine.current(), 'boot');
  assert.ok(texts(host).some(t => t.includes('配置加载失败')));
});
