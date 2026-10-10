/**
 * 设置页场景切换测试（2026-10-10）：
 * - 页面级（headless UiHost，同 pages.test 口径）：场景列表来自配置、当前项标记、点选回传、返回；
 * - 流程级（fake views + 真实配置）：大厅「设置」入口 → settings 场景 → 点选写 THEME_KEY
 *   → 下一局 run 渲染场景收到所选主题；脏存档在 boot 时清除回默认；Esc 从设置页回大厅。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Box, Button, Label, defaultUiConfig, findBox } from '../packages/framework/dist/ui/index.js';
import { UiHost } from '../packages/framework/dist/ui/host.js';
import { createOverlayViews } from '../packages/game/dist/ui/overlayViews.js';
import { createGameFlow, DEFAULT_CHAR, THEME_KEY } from '../packages/game/dist/flow/mainFlow.js';
import { loadTestFontSet } from './ui-helpers.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const W = 800, H = 600;

const readConfig = name => JSON.parse(readFileSync(join(root, 'config', `${name}.json`), 'utf8'));

/** 真实配置 + 追加一条演示主题（测试内构造，不改仓库配置）：让「切换场景」至少有两个可选 */
function themesWithDemo() {
  const themes = readConfig('themes');
  const base = themes.items[0];
  themes.items = [...themes.items, { ...base, id: 'theme_demo_night', name: { 'zh-CN': '演示夜景' } }];
  return themes;
}

// ---------------- 页面级（headless） ----------------

function hostFixture() {
  const store = new Map();
  const adapter = {
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
  };
  const host = new UiHost({
    adapter,
    overlayHost: { renderer: null, width: W, height: H, dpr: 1 },
    fonts: loadTestFontSet(),
    config: defaultUiConfig,
  });
  return { host, adapter, store };
}

function texts(host) {
  const out = [];
  host.overlay.current?.root.visit(w => { if (w instanceof Label) out.push(w.getText()); });
  return out.filter(t => t !== '');
}

function findWidget(host, pred) {
  let found = null;
  host.overlay.current?.root.visit(w => { if (!found && pred(w)) found = w; });
  return found;
}

/** 按行内可见名称找场景行（与 pages.test 的 cellOf 同口径：直接子 Label 文本匹配） */
const cellOf = text => w => w instanceof Box && w.children.some(ch => ch instanceof Label && ch.getText() === text);

/** 场景行右端的「使用中／选择」标记＝行内最后一个 Label */
function markerOf(host, name) {
  const row = findWidget(host, cellOf(name));
  return row.children.filter(c => c instanceof Label).at(-1).getText();
}

function clickWidget(host, w, tree = host.overlay.tree) {
  const box = findBox(tree, w.id);
  const x = box.rect.x + box.rect.w / 2, y = box.rect.y + box.rect.h / 2;
  host.pushInput({ type: 'down', x, y, t: 0 });
  host.pushInput({ type: 'up', x, y, t: 0.05 });
}

test('设置页：场景列表来自配置、当前项标「使用中」、点选回传流程、返回可回大厅', () => {
  const { host } = hostFixture();
  const views = createOverlayViews({ host });
  const seen = [];
  views.renderSettings(
    { themes: themesWithDemo() },
    { onBack: () => seen.push('back'), onSelectTheme: id => { seen.push(id); return true; } },
    'theme_seaside_day',
  );
  host.overlay.current.relayout();

  const t = texts(host);
  for (const s of ['设置', '跑酷场景', '点选即保存，下一局生效', '晴湾小镇', '演示夜景']) {
    assert.ok(t.includes(s), `设置页含「${s}」，实得 ${JSON.stringify(t)}`);
  }
  assert.equal(markerOf(host, '晴湾小镇'), '使用中', '当前主题标记');
  assert.equal(markerOf(host, '演示夜景'), '选择');

  clickWidget(host, findWidget(host, cellOf('演示夜景')));
  assert.deepEqual(seen, ['theme_demo_night'], '点选回传主题 id');
  assert.equal(markerOf(host, '演示夜景'), '使用中', '标记迁到新主题');
  assert.equal(markerOf(host, '晴湾小镇'), '选择');

  clickWidget(host, findWidget(host, cellOf('演示夜景')));
  assert.deepEqual(seen, ['theme_demo_night'], '重复点已选主题不重复回调');

  clickWidget(host, findWidget(host, w => w instanceof Button && w.label.getText() === '返回'));
  assert.deepEqual(seen, ['theme_demo_night', 'back']);
  host.dispose();
});

test('设置页：流程拒绝的主题不落标（保持原选择）', () => {
  const { host } = hostFixture();
  const views = createOverlayViews({ host });
  let calls = 0;
  views.renderSettings(
    { themes: themesWithDemo() },
    { onBack() {}, onSelectTheme: () => { calls++; return false; } },
    'theme_seaside_day',
  );
  host.overlay.current.relayout();
  clickWidget(host, findWidget(host, cellOf('演示夜景')));
  assert.equal(calls, 1);
  assert.equal(markerOf(host, '演示夜景'), '选择', '流程拒绝后不标使用中');
  assert.equal(markerOf(host, '晴湾小镇'), '使用中');
  host.dispose();
});

test('大厅「设置」徽标把导航交给流程（未注入时仍是空入口）', () => {
  const { host } = hostFixture();
  const views = createOverlayViews({ host });
  const content = { game: readConfig('game'), characters: readConfig('characters'), themes: themesWithDemo() };
  let opened = 0;
  views.renderSelect(content, {
    onStartRun() {}, onChooseCharacter: () => true, onBack() {}, onSettings: () => { opened++; },
  }, 'char_volt', 'guest');
  host.overlay.current.relayout();
  host.overlay.current.relayout();
  clickWidget(host, findWidget(host, cellOf('设置')), host.overlay.current.relayout());
  assert.equal(opened, 1);
  host.dispose();
});

// ---------------- 流程级（fake views + 真实配置） ----------------

function makeFlow({ themes, storedTheme } = {}) {
  const store = new Map();
  if (storedTheme !== null && storedTheme !== undefined) store.set(THEME_KEY, storedTheme);
  const inputs = [];
  const seen = { select: [], settings: [], scenes: [], toasts: [] };
  const adapter = {
    env: 'web',
    storage: {
      get: k => (store.has(k) ? store.get(k) : null),
      set: (k, v) => { store.set(k, v); },
      remove: k => { store.delete(k); },
    },
    fetchJson: async name => (name === 'themes' && themes ? themes : readConfig(name)),
    canvas: { mainCanvas: () => ({}), windowSize: () => ({ width: 390, height: 844, dpr: 2 }) },
    onInput: cb => { inputs.push(cb); return () => {}; },
  };
  const views = {
    renderBoot: () => ({ setStatus() {} }),
    renderStart: () => ({ setBusy() {}, setFeedback() {} }),
    renderSelect: (_c, actions) => seen.select.push({ actions }),
    renderSettings: (content, actions, currentThemeId) => seen.settings.push({ content, actions, currentThemeId }),
    mountHud: () => ({ update() {}, dispose() {} }),
    renderResult() {},
    toast: msg => seen.toasts.push(msg),
  };
  const createScene = (_host, _adapter, sim, _content, _cb, opts) => {
    seen.scenes.push({ sim, opts });
    return { dispose() {} };
  };
  const flow = createGameFlow({ adapter, views, configResolve: n => n, createScene, audioRandom: () => 0 });
  const key = code => inputs.forEach(cb => cb({ type: 'key', code, phase: 'down' }));
  return { flow, store, seen, key };
}

test('流程：设置入口 → 设置页（当前＝默认主题）→ 点选写本机记忆 + toast → 返回大厅', async () => {
  const { flow, store, seen } = makeFlow({ themes: themesWithDemo() });
  await flow.boot();
  assert.equal(flow.machine.current(), 'select');

  seen.select.at(-1).actions.onSettings();
  assert.equal(flow.machine.current(), 'settings');
  const page = seen.settings.at(-1);
  assert.ok(page.content, '设置页拿到配置');
  assert.equal(page.currentThemeId, 'theme_seaside_day', '未存过 → 首个 live 主题');

  assert.equal(page.actions.onSelectTheme('theme_demo_night'), true);
  assert.equal(store.get(THEME_KEY), 'theme_demo_night');
  assert.ok(seen.toasts.at(-1)?.includes('演示夜景') && seen.toasts.at(-1)?.includes('下一局生效'),
    `切换提示带上场景名与生效时机，实得 ${JSON.stringify(seen.toasts.at(-1))}`);

  assert.equal(page.actions.onSelectTheme('theme_missing'), false, '未知主题不生效');
  assert.equal(store.get(THEME_KEY), 'theme_demo_night');

  page.actions.onBack();
  assert.equal(flow.machine.current(), 'select');
  seen.select.at(-1).actions.onSettings();
  assert.equal(seen.settings.at(-1).currentThemeId, 'theme_demo_night', '重进设置页保持所选');
});

test('流程：脏存档（主题已删）在 boot 时清除回默认，不把无效 id 带进渲染', async () => {
  const { flow, store, seen } = makeFlow({ themes: themesWithDemo(), storedTheme: 'theme_deleted' });
  await flow.boot();
  assert.equal(store.has(THEME_KEY), false, '脏值清掉');

  seen.select.at(-1).actions.onStartRun(DEFAULT_CHAR);
  assert.equal(flow.machine.current(), 'run');
  assert.equal(seen.scenes.at(-1).opts.themeId, 'theme_seaside_day', '进局注入首个 live 主题');
});

test('流程：合法存档进局时注入所选主题；切换后下一局生效', async () => {
  const { flow, seen, key } = makeFlow({ themes: themesWithDemo(), storedTheme: 'theme_demo_night' });
  await flow.boot();

  seen.select.at(-1).actions.onStartRun(DEFAULT_CHAR);
  assert.equal(seen.scenes.at(-1).opts.themeId, 'theme_demo_night', '存档主题直接生效');

  key('Escape'); // 中途退出回大厅
  assert.equal(flow.machine.current(), 'select');
  seen.select.at(-1).actions.onSettings();
  seen.settings.at(-1).actions.onSelectTheme('theme_seaside_day');
  seen.settings.at(-1).actions.onBack();
  seen.select.at(-1).actions.onStartRun(DEFAULT_CHAR);
  assert.equal(seen.scenes.at(-1).opts.themeId, 'theme_seaside_day', '下一局用新选的场景');
});

test('流程：设置页 Esc 回大厅', async () => {
  const { flow, seen, key } = makeFlow({ themes: themesWithDemo() });
  await flow.boot();
  seen.select.at(-1).actions.onSettings();
  assert.equal(flow.machine.current(), 'settings');
  key('Escape');
  assert.equal(flow.machine.current(), 'select');
});
