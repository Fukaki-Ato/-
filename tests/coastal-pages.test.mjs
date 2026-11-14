import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));
const paths = ['coastalLobby', 'coastalResult', 'coastalWidgets'].map(name => `packages/game/src/ui/${name}.ts`);
const { outputFiles } = await build({
  stdin: { contents: `${paths.map(path => `export * from './${path}';`).join('\n')}
    export * from './packages/framework/src/ui/index.ts';
    export * from './packages/framework/src/ui/host.ts';`, resolveDir: root },
  alias: { '@tr/framework': `${root}packages/framework/src`, '@tr/game': `${root}packages/game/src` },
  bundle: true, platform: 'node', format: 'esm', write: false,
});
const ui = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
const metrics = ['latin', 'cjk'].map(name => JSON.parse(readFileSync(`${root}assets/fonts/noto/${name}.metrics.json`, 'utf8')));
const fonts = ui.createFontSet(metrics.map(ui.createFontAtlas));
const content = Object.fromEntries(['game', 'characters', 'skills', 'items', 'obstacles', 'economy']
  .map(name => [name, JSON.parse(readFileSync(`${root}config/${name}.json`, 'utf8'))]));
const chars = content.characters.items.filter(item => item.id.startsWith('char_') && item.status !== 'draft' && item.status !== 'retired');
const current = chars.find(item => item.locked !== true && item.status !== 'locked').id;
function hostFor(t, width = 375, height = 812) {
  const host = new ui.UiHost({
    adapter: { canvas: { onResize: () => () => {} }, onInput: () => () => {}, now: () => 0 },
    inputMode: 'raw', fonts, config: ui.defaultUiConfig,
    overlayHost: { renderer: { autoClear: true, render() {} }, width, height, dpr: 1 },
  });
  t.after(() => host.dispose()); return host;
}
function widgets(host, Type) {
  const result = [];
  host.overlay.current.root.visit(widget => { if (widget instanceof Type) result.push(widget); });
  return result;
}
const texts = host => widgets(host, ui.Label).map(label => label.getText());
const action = (host, title) => widgets(host, ui.CoastalAction).find(control => control.label.getText() === title);
function settle(host) { for (let i = 0; i < 10; i++) host.overlay.tick(0); return host.overlay.tree; }
function tap(host, control) {
  assert.ok(control, 'control exists'); settle(host);
  for (const scroll of widgets(host, ui.ScrollView)) {
    const subtree = ui.findBox(host.overlay.tree, scroll.id);
    if (!subtree) continue;
    const box = ui.findBox(subtree, control.id);
    if (!box) continue;
    if (box.rect.y < subtree.rect.y || box.rect.y + box.rect.h > subtree.rect.y + subtree.rect.h) {
      scroll.physics.snapTo(scroll.physics.offset + box.rect.y - subtree.rect.y - 4);
      host.overlay.current.invalidate(); settle(host);
    }
  }
  const rect = ui.findBox(host.overlay.tree, control.id).rect;
  const x = rect.x + rect.w / 2, y = rect.y + rect.h / 2;
  assert.ok(y >= 0 && y <= host.overlay.current.height, `reachable: ${control.label.getText()}`);
  host.pushInput({ type: 'down', x, y, t: 1 }); host.pushInput({ type: 'up', x, y, t: 1.05 });
  return rect;
}
const lobbyActions = overrides => ({ onStartRun() {}, onChooseCharacter: () => true, onBack() {}, ...overrides });
const summary = overrides => ({ score: 1200, distance: 432.9, coins: 17, nearMiss: 4, hits: 2, casts: 3,
  charId: current, charName: '小电', ...overrides });
function mountLobby(host, overrides = {}) {
  const page = ui.buildCoastalLobby(host, { content, currentCharId: current, actions: lobbyActions(), ...overrides });
  host.mount(page.view); settle(host); return page;
}
function mountResult(host, data = summary(), best = 1000, actions = { onRetry() {}, onSelect() {} }) {
  const page = ui.buildCoastalResult(host, { summary: data, best, actions });
  host.mount(page.view); settle(host); return page;
}

test('lobby dispatches real entries, starts current owned id, renders real currency without empty plus/actions', t => {
  const host = hostFor(t); const calls = [];
  const handlers = Object.fromEntries(['CharacterSelect', 'Shop', 'Inventory', 'Tasks', 'Handbook', 'Leaderboard', 'Settings']
    .map(name => [`on${name}`, () => calls.push(name)]));
  mountLobby(host, { actions: lobbyActions({ ...handlers, onStartRun: id => calls.push(id) }), extras: { coins: 7351, diamonds: 49 } });
  for (const title of ['角色', '商店', '仓库', '任务', '免费福利手册', '榜单', '设置', '开始酷跑']) tap(host, action(host, title));
  assert.deepEqual(calls, ['CharacterSelect', 'Shop', 'Inventory', 'Tasks', 'Handbook', 'Leaderboard', 'Settings', current]);
  assert.ok(texts(host).includes('7351')); assert.ok(texts(host).includes('49'));
  for (const title of ['活动', '成就', '+']) assert.ok(!texts(host).includes(title));
  const expected = chars.find(char => char.id === current);
  assert.ok(texts(host).includes(expected.name['zh-CN'] ?? expected.name));
  assert.ok(texts(host).includes(expected.tagline['zh-CN'] ?? expected.tagline));
});

test('missing handlers are visibly disabled; local roster persists validated selection and cannot pick locked roles', t => {
  const host = hostFor(t); const started = [], chosen = [];
  const local = structuredClone(content);
  const ids = chars.slice(0, 3).map(char => char.id);
  for (const char of local.characters.items) if (ids.includes(char.id)) { char.status = 'live'; char.locked = char.id === ids[2]; }
  mountLobby(host, { content: local, currentCharId: ids[2], actions: lobbyActions({
    onStartRun: id => started.push(id), onChooseCharacter: id => { chosen.push(id); return chosen.length > 1; },
  }) });
  for (const title of ['商店', '仓库', '任务', '免费福利手册', '榜单', '设置']) {
    assert.equal(action(host, title).enabled, false); assert.equal(action(host, title).handlers(), undefined);
  }
  assert.ok(texts(host).includes('暂不可用'));
  tap(host, action(host, '开始酷跑')); assert.deepEqual(started, [ids[0]]);
  tap(host, action(host, '角色'));
  const second = () => widgets(host, ui.CoastalAction).find(control => control.label.getText().endsWith(' · 出战') && control.enabled);
  tap(host, second()); tap(host, action(host, '开始酷跑')); assert.equal(started.at(-1), ids[0], 'rejected choice is not activated');
  tap(host, second()); tap(host, action(host, '开始酷跑')); assert.equal(started.at(-1), ids[1]);
  const locked = widgets(host, ui.CoastalAction).find(control => control.label.getText().endsWith(' · 未拥有'));
  assert.equal(locked.enabled, false); assert.deepEqual(chosen, [ids[1], ids[1]]);
});

test('result uses all real stats; equal or zero scores do not become new records', t => {
  const host = hostFor(t); const calls = [];
  mountResult(host, summary(), 1000, { onRetry: () => calls.push('run'), onSelect: () => calls.push('lobby'),
    onLeaderboard: () => calls.push('rank') });
  for (const value of ['新纪录！', '1,200', '432 m', '17', '4 次', '2 次', '3 次 · 小电', '小电', '历史最佳 1,200', '本局采集金币']) {
    assert.ok(texts(host).includes(value), value);
  }
  assert.ok(texts(host).some(value => value.includes('云端奖励未确认')));
  for (const title of ['再跑一次', '返回大厅', '查看榜单']) tap(host, action(host, title));
  assert.deepEqual(calls, ['run', 'lobby', 'rank']);
  mountResult(host, summary(), 1200); assert.ok(!texts(host).includes('新纪录！'));
  mountResult(host, summary({ score: 0 }), -1); assert.ok(!texts(host).includes('新纪录！'));
});

test('result separates total-run statistics from the exact pre-first-coin record, without claiming cloud acceptance',t=>{
  const host=hostFor(t);
  mountResult(host,summary({beforeFirstCoin:{distance:123.456,score:789,stoppedByCoin:true}}));
  assert.ok(texts(host).includes('1,200'));assert.ok(texts(host).includes('432 m'));
  assert.ok(texts(host).includes('首次金币前成绩'));assert.ok(texts(host).includes('123.46 m · 789 分'));
  assert.ok(texts(host).some(s=>s.includes('是否入榜以云端确认为准')));
  mountResult(host,summary({beforeFirstCoin:{distance:432.9,score:1200,stoppedByCoin:false}}));
  assert.ok(texts(host).some(s=>s.includes('结束前未拾取金币')));
  mountResult(host);assert.ok(!texts(host).includes('首次金币前成绩'),'old summary does not invent a missing checkpoint');
  mountLobby(host);assert.ok(texts(host).includes('操作指南'));
  assert.ok(texts(host).some(s=>s.includes('左右划切换车道')));assert.ok(texts(host).some(s=>s.includes('双击屏幕释放角色技能')));
});

test('pending gates every result exit; stale controls also consult current pending state', t => {
  const host = hostFor(t); const calls = [];
  const ranking = { pending: true, message: '服务端验证原回放中', subscribe: () => () => {} };
  const data = summary({ ranking });
  const actions = { onRetry: () => calls.push('run'), onSelect: () => calls.push('lobby'), onLeaderboard: () => calls.push('rank') };
  mountResult(host, data, 1000, actions);
  for (const title of ['再跑一次', '返回大厅', '查看榜单']) { assert.equal(action(host, title).enabled, false); tap(host, action(host, title)); }
  assert.deepEqual(calls, []); assert.ok(texts(host).includes(ranking.message));
  ranking.pending = false; mountResult(host, data, 1000, actions);
  ranking.pending = true; tap(host, action(host, '再跑一次')); tap(host, action(host, '返回大厅'));
  assert.deepEqual(calls, []);
});

test('failed settlement retries the supplied original replay once while pending; exit requires explicit forfeiture', t => {
  const host = hostFor(t); const calls = [];
  const originalReplay = { runId: 'same-ticket', frames: 800, inputs: [{ frame: 30, action: 'jump' }] };
  const ranking = { pending: false, message: '上传失败，请重试；离开将放弃本局奖励', subscribe: () => () => {},
    retry() { calls.push(originalReplay); ranking.pending = true; } };
  const data = summary({ ranking });
  const actions = { onRetry: () => calls.push('run'), onSelect: () => calls.push('lobby') };
  mountResult(host, data, 1000, actions);
  tap(host, action(host, '重试上传')); tap(host, action(host, '重试上传'));
  assert.deepEqual(calls, [originalReplay]);
  ranking.pending = false; mountResult(host, data, 1000, actions);
  tap(host, action(host, '返回大厅')); assert.deepEqual(calls, [originalReplay]);
  assert.ok(ui.findBox(settle(host), action(host, '确认离开').id));
  tap(host, action(host, '留在本页')); assert.deepEqual(calls, [originalReplay]);
  tap(host, action(host, '再跑一次')); tap(host, action(host, '确认离开'));
  assert.deepEqual(calls, [originalReplay, 'run']);
  mountResult(host, data, 1000, actions);
  tap(host, action(host, '返回大厅')); tap(host, action(host, '确认离开')); assert.equal(calls.at(-1), 'lobby');
});

test('320–430px short safe viewport: long content wraps, touch targets >=44px, scrolling reaches entries and fixed CTAs', t => {
  for (const [width, height] of [[320, 360], [320, 568], [430, 700]]) {
    const host = hostFor(t, width, height); const long = structuredClone(content);
    long.characters.items.find(char => char.id === current).name = '海岸俱乐部超长角色名称'.repeat(4);
    long.characters.items.find(char => char.id === current).tagline = '晴日海湾探索跑酷'.repeat(8);
    const pages = [() => mountLobby(host, { content: long }),
      () => mountResult(host, summary({ charName: '海岸俱乐部超长角色名称'.repeat(4),
        ranking: { pending: false, message: '服务器验证中'.repeat(30), retry() {}, subscribe: () => () => {} } }))];
    for (const mount of pages) {
      mount(); const tree = settle(host);
      const all = box => [box, ...box.children.flatMap(all)];
      for (const box of all(tree)) {
        assert.ok(Number.isFinite(box.rect.x + box.rect.y + box.rect.w + box.rect.h));
        assert.ok(box.rect.x >= -.01 && box.rect.x + box.rect.w <= width + .01, `overflow ${box.id}`);
      }
      for (const control of widgets(host, ui.CoastalAction)) {
        const box = ui.findBox(tree, control.id); if (!box) continue;
        assert.ok(box.rect.w >= 44 && box.rect.h >= 44, control.label.getText());
      }
      assert.ok(widgets(host, ui.ScrollView)[0].physics.maxOffset > 0);
      const scroll = widgets(host, ui.ScrollView)[0];
      const viewport = ui.findBox(tree, scroll.id).rect;
      const x = viewport.x + viewport.w / 2, y = viewport.y + viewport.h * .75;
      host.pushInput({ type: 'down', x, y, t: 2 });
      host.pushInput({ type: 'move', x, y: y - 60, t: 2.1 });
      host.pushInput({ type: 'up', x, y: y - 60, t: 2.2 }); settle(host);
      assert.ok(scroll.physics.offset > 0, 'physical drag scrolls the page');
      const longName = widgets(host, ui.Label).find(label => label.getText() === '海岸俱乐部超长角色名称'.repeat(4));
      assert.ok(ui.findBox(tree, longName.id).rect.h > 50, 'long role names get measured multiline height');
      for (const title of ['开始酷跑', '再跑一次', '返回大厅']) {
        const control = action(host, title); if (!control) continue;
        const r = ui.findBox(tree, control.id).rect;
        assert.ok(r.y >= 0 && r.y + r.h <= height, 'fixed primary action is on screen');
      }
      if (action(host, '开始酷跑')) { tap(host, action(host, '免费福利手册')); tap(host, action(host, '角色')); }
      else { tap(host, action(host, '重试上传')); tap(host, action(host, '返回大厅')); tap(host, action(host, '留在本页')); }
    }
  }
});

test('portrait sources are reused verbatim, retain aspect ratio and never create synthetic loading/person art', t => {
  const host = hostFor(t); const source = { ...host.solidSkin, texSize: { w: 128, h: 256 },
    insets: { top: 0, right: 0, bottom: 0, left: 0 } };
  const data = { content, currentCharId: current, actions: lobbyActions(), portraits: { [current]: source } };
  for (const page of [ui.buildCoastalLobby(host, data), ui.buildCoastalResult(host, {
    summary: summary(), best: 0, actions: { onRetry() {}, onSelect() {} }, portraits: data.portraits,
  })]) {
    host.mount(page.view); settle(host);
    const boxes = widgets(host, ui.Box).filter(box => box.opts.background === source);
    assert.equal(boxes.length, 1); const r = ui.findBox(host.overlay.tree, boxes[0].id).rect;
    assert.equal(r.w / r.h, .5); assert.equal(boxes[0].opts.background, source);
  }
  mountLobby(host); assert.equal(widgets(host, ui.CoastalBay).length, 1);
  assert.ok(!texts(host).some(value => /加载|立绘|头像/.test(value)));
});

test('new UI literal font coverage (reports missing glyphs for owner supplement)', t => {
  const glyphs = new Set();
  for (const path of paths) {
    const source = ts.createSourceFile(path, readFileSync(`${root}${path}`, 'utf8'), ts.ScriptTarget.Latest, true);
    const scan = node => {
      if (ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
        for (const char of node.text) if (/[^\x00-\x7f\s]/u.test(char)) glyphs.add(char);
      }
      ts.forEachChild(node, scan);
    }; scan(source);
  }
  for (const character of chars) {
    for (const char of JSON.stringify([character.name, character.tagline])) {
      if (/[^\x00-\x7f\s]/u.test(char)) glyphs.add(char);
    }
  }
  const missing = [...glyphs].filter(char => !fonts.lookup(char.codePointAt(0)));
  t.diagnostic(`主代理字体补齐清单：${missing.join('') || '无'}`);
  assert.deepEqual(missing, [], `字体需主代理补齐：${missing.join('')}`);
});
