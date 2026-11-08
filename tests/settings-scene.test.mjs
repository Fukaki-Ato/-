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
import { themeOptions } from '../packages/game/dist/ui/settingsView.js';
import { VolumeSlider } from '../packages/game/dist/ui/volumeSlider.js';
import { MUSIC_VOLUME_KEY, SFX_VOLUME_KEY, themeMusic } from '../packages/game/dist/flow/settingsScene.js';
import { loadTestFontSet } from './ui-helpers.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const W = 800, H = 600;

const readConfig = name => JSON.parse(readFileSync(join(root, 'config', `${name}.json`), 'utf8'));

test('当前主题配置让设置页提供白日海景、雨夜便利店、黄昏渔港与天穹雷脊', () => {
  const options = themeOptions({ themes: readConfig('themes') });
  assert.deepEqual(options.map(option => option.id), ['theme_seaside_day', 'theme_rain_konbini', 'theme_dusk_harbor', 'theme_stormspire']);
  assert.deepEqual(options.map(option => option.name), ['白日海景', '雨夜便利店', '黄昏渔港', '天穹雷脊']);

  const glyphs = new Set(JSON.parse(readFileSync(join(root, 'assets/fonts/cjk.metrics.json'), 'utf8')).glyphs.map(g => g.char));
  for (const label of [...options.map(option => option.name), '龙']) {
    for (const ch of label) assert.ok(glyphs.has(ch), `字体图集缺少设置/选角文案字形「${ch}」`);
  }
});

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
  return valueOf(rowOf(host, name));
}

/** 按行内可见名称找行（主题行/音量行同口径：直接子 Label 文本匹配） */
const rowOf = (host, name) => findWidget(host, cellOf(name));

/** 音量行右端的 < / > 步进按钮 */
const stepButton = (row, glyph) => row.children.filter(c => c instanceof Button).find(b => b.label.getText() === glyph);

/** 行内最后一个直接子 Label（主题行＝使用中标记，音量行＝百分比） */
const valueOf = row => row.children.filter(c => c instanceof Label).at(-1).getText();

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
  for (const s of ['设置', '跑酷场景', '点选即保存，下一局生效', '白日海景', '演示夜景']) {
    assert.ok(t.includes(s), `设置页含「${s}」，实得 ${JSON.stringify(t)}`);
  }
  assert.equal(markerOf(host, '白日海景'), '使用中', '当前主题标记');
  assert.equal(markerOf(host, '演示夜景'), '选择');

  clickWidget(host, findWidget(host, cellOf('演示夜景')));
  assert.deepEqual(seen, ['theme_demo_night'], '点选回传主题 id');
  assert.equal(markerOf(host, '演示夜景'), '使用中', '标记迁到新主题');
  assert.equal(markerOf(host, '白日海景'), '选择');

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
  assert.equal(markerOf(host, '白日海景'), '使用中');
  host.dispose();
});

test('设置页：音量行按生效值展示，< > 步进 10% 回传流程，端点与拒绝都不落值', () => {
  const { host } = hostFixture();
  const views = createOverlayViews({ host });
  const calls = [];
  let allow = true;
  views.renderSettings(
    { themes: themesWithDemo() },
    {
      onBack() {},
      onSelectTheme: () => true,
      onSetVolume: (kind, value) => { calls.push([kind, value]); return allow; },
    },
    'theme_seaside_day',
    { music: 0.7, sfx: 1 },
  );
  host.overlay.current.relayout();

  const t = texts(host);
  for (const s of ['音量', '音乐音量', '音效音量', '70%', '100%']) {
    assert.ok(t.includes(s), `设置页含「${s}」，实得 ${JSON.stringify(t)}`);
  }
  // 音量行用字必须在字体图集里（canvas 文案缺字形＝占宽不出墨；♪♬ 为行图标字形）
  const cjk = new Set(JSON.parse(readFileSync(join(root, 'assets/fonts/cjk.metrics.json'), 'utf8')).glyphs.map(g => g.char));
  for (const ch of [...'音量音乐效拖动或点按，立即生效♪♬']) assert.ok(cjk.has(ch), `cjk 图集缺少音量文案字形「${ch}」`);

  clickWidget(host, stepButton(rowOf(host, '音乐音量'), '<'));
  assert.deepEqual(calls, [['music', 0.6]], '< 步进回调 0..1 值');
  assert.equal(valueOf(rowOf(host, '音乐音量')), '60%', '行内即时更新');

  clickWidget(host, stepButton(rowOf(host, '音效音量'), '>'));
  assert.deepEqual(calls, [['music', 0.6]], '100% 再点 > 已在端点，不回调');
  assert.equal(valueOf(rowOf(host, '音效音量')), '100%');

  for (let i = 0; i < 6; i++) clickWidget(host, stepButton(rowOf(host, '音乐音量'), '<'));
  assert.equal(valueOf(rowOf(host, '音乐音量')), '0%', '连点 6 次到静音');
  clickWidget(host, stepButton(rowOf(host, '音乐音量'), '<'));
  assert.equal(calls.at(-1)[1], 0, '0% 再点 < 不回调');

  allow = false;
  clickWidget(host, stepButton(rowOf(host, '音乐音量'), '>'));
  assert.deepEqual(calls.at(-1), ['music', 0.1], '端点内点击仍回传流程');
  assert.equal(valueOf(rowOf(host, '音乐音量')), '0%', '流程拒绝不落值');
  host.dispose();
});

/** 收集页面上的音量滑条（visit 顺序＝行顺序：音乐在前、音效在后） */
function slidersOf(host) {
  const out = [];
  host.overlay.current?.root.visit(w => { if (w instanceof VolumeSlider) out.push(w); });
  return out;
}

/** 在滑条上模拟「按下 fromFrac 处 → 拖到 toFrac 处 → 松开」的原始指针流 */
function dragSlider(host, slider, fromFrac, toFrac) {
  const box = findBox(host.overlay.tree, slider.id);
  const y = box.rect.y + box.rect.h / 2;
  const x0 = box.rect.x + box.rect.w * fromFrac;
  const x1 = box.rect.x + box.rect.w * toFrac;
  host.pushInput({ type: 'down', x: x0, y, t: 0 });
  host.pushInput({ type: 'move', x: x1, y, t: 0.1 }); // 超过 slop：按压态取消但 move 继续沿锁定路径分发
  host.pushInput({ type: 'up', x: x1, y, t: 0.2 });
}

test('设置页：滑条拖动 1% 粒度回传流程、与百分比和步进按钮联动、被拒绝时保持原值', () => {
  const { host } = hostFixture();
  const views = createOverlayViews({ host });
  const calls = [];
  let allow = true;
  views.renderSettings(
    { themes: themesWithDemo() },
    {
      onBack() {},
      onSelectTheme: () => true,
      onSetVolume: (kind, value) => { calls.push([kind, value]); return allow; },
    },
    'theme_seaside_day',
    { music: 0.7, sfx: 1 },
  );
  host.overlay.current.relayout();

  const [musicSlider, sfxSlider] = slidersOf(host);
  assert.ok(musicSlider && sfxSlider, '两行各一个滑条');
  assert.equal(Math.round(musicSlider.value * 100), 70, '初始值来自流程解析的生效音量');

  dragSlider(host, musicSlider, 0.3, 0.8);
  assert.deepEqual(calls, [['music', 0.3], ['music', 0.8]], '按下取 30%，拖到 80%（1% 量化）');
  assert.equal(valueOf(rowOf(host, '音乐音量')), '80%', '百分比标签跟随拖动');

  clickWidget(host, stepButton(rowOf(host, '音乐音量'), '<'));
  assert.deepEqual(calls.at(-1), ['music', 0.7], '按钮步进与滑条共用同一状态');
  assert.equal(Math.round(musicSlider.value * 100), 70, '步进后滑条同步回 70%');

  dragSlider(host, musicSlider, 0.37, 0.37);
  clickWidget(host, stepButton(rowOf(host, '音乐音量'), '>'));
  assert.deepEqual(calls.at(-1), ['music', 0.47], '37% 加 10 个百分点保持 1% 精度');
  assert.equal(valueOf(rowOf(host, '音乐音量')), '47%');
  clickWidget(host, stepButton(rowOf(host, '音乐音量'), '<'));
  assert.deepEqual(calls.at(-1), ['music', 0.37], '减 10 个百分点返回原值');
  assert.equal(Math.round(musicSlider.value * 100), 37);

  allow = false;
  dragSlider(host, sfxSlider, 0.5, 0.5);
  assert.deepEqual(calls.at(-1), ['sfx', 0.5], '按下仍回传流程');
  assert.equal(Math.round(sfxSlider.value * 100), 100, '被拒绝的滑条保持原值');
  assert.equal(valueOf(rowOf(host, '音效音量')), '100%', '百分比标签不落值');
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

function makeFlow({ themes, storedTheme, storedVolumes } = {}) {
  const store = new Map();
  if (storedTheme !== null && storedTheme !== undefined) store.set(THEME_KEY, storedTheme);
  for (const [k, v] of Object.entries(storedVolumes ?? {})) store.set(k, v);
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
    renderSettings: (content, actions, currentThemeId, volumePrefs) =>
      seen.settings.push({ content, actions, currentThemeId, volumePrefs }),
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

  // 音量：0..1 入参落盘整数百分比；越界夹到 100%；未知声道不生效
  assert.deepEqual(page.volumePrefs, { music: 0.7, sfx: 1 }, '生效音量＝配置默认（真实配置无 volume 段）');
  assert.equal(page.actions.onSetVolume('music', 0.6), true);
  assert.equal(store.get(MUSIC_VOLUME_KEY), '60');
  assert.equal(page.actions.onSetVolume('sfx', 1), true);
  assert.equal(store.get(SFX_VOLUME_KEY), '100');
  assert.equal(page.actions.onSetVolume('music', 1.5), true);
  assert.equal(store.get(MUSIC_VOLUME_KEY), '100', '越界夹到 100%');
  assert.equal(page.actions.onSetVolume('nope', 0.5), false, '未知声道不生效');
  assert.equal(store.get(MUSIC_VOLUME_KEY), '100');

  page.actions.onBack();
  assert.equal(flow.machine.current(), 'select');
  seen.select.at(-1).actions.onSettings();
  assert.equal(seen.settings.at(-1).currentThemeId, 'theme_demo_night', '重进设置页保持所选');
});

test('流程：音量存档驱动设置页展示；脏音量进页清理；重进保持所选', async () => {
  const { flow, store, seen } = makeFlow({ storedVolumes: { [MUSIC_VOLUME_KEY]: '40', [SFX_VOLUME_KEY]: 'abc' } });
  await flow.boot();
  seen.select.at(-1).actions.onSettings();
  const page = seen.settings.at(-1);
  assert.deepEqual(page.volumePrefs, { music: 0.4, sfx: 1 }, '音乐用存档 40%，音效脏值回配置默认');
  assert.equal(store.has(SFX_VOLUME_KEY), false, '脏音量存档进设置页即清');

  page.actions.onSetVolume('music', 0.5);
  page.actions.onBack();
  seen.select.at(-1).actions.onSettings(); // 重进（场景机不重入同状态，先回大厅）
  assert.deepEqual(seen.settings.at(-1).volumePrefs, { music: 0.5, sfx: 1 }, '重进设置页保持所选音量');
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

test('themeMusic：进局 BGM 跟着设置页所选主题走（脏存档与缺省都回首个 live 主题）', () => {
  const content = { themes: JSON.parse(readFileSync(join(root, 'config/themes.json'), 'utf8')) };
  const storage = (theme) => {
    const store = new Map(theme ? [[THEME_KEY, theme]] : []);
    return { get: k => store.get(k) ?? null, set: (k, v) => store.set(k, v), remove: k => store.delete(k) };
  };
  assert.equal(themeMusic(storage(null), content), 'assets/audio/bgm/run.mp3', '未选过＝默认主题（白日海景）的 BGM');
  assert.equal(themeMusic(storage('theme_rain_konbini'), content), 'assets/audio/bgm/run_rain.mp3',
    '选「雨夜便利店」＝换成本主题专属雨声 BGM');
  assert.equal(themeMusic(storage('theme_已删除'), content), 'assets/audio/bgm/run.mp3', '存档指向不存在的主题要回退，不能不响');
  const noMusic = { themes: { items: [{ id: 't', status: 'live' }] } };
  assert.equal(themeMusic(storage(null), noMusic), null, '主题没配 music 就交回音频层回退全局 run');
});
