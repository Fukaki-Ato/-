import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import ts from 'typescript';

// Bundle source in memory: this slice never writes shared build outputs.
const root = fileURLToPath(new URL('../', import.meta.url));
const { outputFiles } = await build({
  stdin: { contents: `export * from './packages/game/src/ui/welfareView.ts';
    export * from './packages/game/src/ui/welfareCards.ts';
    export * from './packages/framework/src/ui/index.ts';
    export * from './packages/framework/src/ui/host.ts';`, resolveDir: root },
  alias: { '@tr/framework': `${root}packages/framework/src` },
  bundle: true, platform: 'node', format: 'esm', write: false,
});
const ui = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
const fontMetrics = ['latin', 'cjk'].map(name => JSON.parse(readFileSync(`${root}assets/fonts/noto/${name}.metrics.json`, 'utf8')));
const fonts = ui.createFontSet(fontMetrics.map(metrics => ui.createFontAtlas(metrics)));
const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const mission = (id, progress, target = 10) => ({ id, title: `累计跑酷 ${id}`, metric: 'runs', progress, target, reward: { coin: 30 }, claimed: false });
function snapshot() {
  return {
    profile: { schemaVersion: 1, revision: 1, playerId: 'p1', wallet: { coin: 120, diamond: 8 },
      inventory: { characters: ['char_volt'], items: {} }, preferences: { characterId: 'char_volt', themeId: 'coast' }, createdAt: '', updatedAt: '' },
    serverTime: Date.UTC(2026, 10, 6), minRunSeconds: 10,
    daily: { periodId: '2026-11-06', resetsAt: Date.UTC(2026, 10, 7), missions: [mission('daily-ready', 10), mission('daily-progress', 3)] },
    weekly: { periodId: '2026-W45', resetsAt: Date.UTC(2026, 10, 9), missions: [mission('weekly-ready', 10)] },
    handbook: [
      { ...mission('chapter-ready', 10), title: '初次出发', description: '完成一场有效跑酷', unlocked: true, reward: { diamond: 3, key: 1, shard: 'shard_volt:5' } },
      { ...mission('chapter-locked', 10), title: '海岸探索', description: '累计前进1000米', unlocked: false },
      { ...mission('chapter-progress', 3), title: '金币收藏', description: '累计获得金币', unlocked: true },
    ],
  };
}
function makeHost(t, width = 375, height = 812) {
  const renderer = { autoClear: true, render() {} };
  const adapter = { canvas: { onResize: () => () => {} }, onInput: () => () => {}, now: () => 0 };
  const host = new ui.UiHost({ adapter, inputMode: 'raw', fonts, config: ui.defaultUiConfig,
    overlayHost: { renderer, width, height, dpr: 1 } });
  t.after(() => host.dispose());
  return host;
}
function widgets(host, Type) {
  const all = [];
  host.overlay.current.root.visit(widget => { if (widget instanceof Type) all.push(widget); });
  return all;
}
const labels = host => widgets(host, ui.Label).map(label => label.getText());
const action = (host, title, n = 0) => widgets(host, ui.WelfareAction).filter(button => button.label.getText() === title)[n];
function settle(host) { for (let i = 0; i < 8; i++) host.overlay.tick(0); return host.overlay.tree; }
function click(host, button) {
  assert.ok(button, 'control exists');
  settle(host);
  const scroll = widgets(host, ui.ScrollView)[0];
  let rect = ui.findBox(host.overlay.tree, button.id).rect;
  const sb = ui.findBox(host.overlay.tree, scroll.id);
  if (ui.findBox(sb, button.id) && (rect.y < sb.rect.y || rect.y + rect.h > sb.rect.y + sb.rect.h)) {
    scroll.physics.snapTo(scroll.physics.offset + rect.y - sb.rect.y - 8);
    host.overlay.current.invalidate(); settle(host);
    rect = ui.findBox(host.overlay.tree, button.id).rect;
  }
  const x = rect.x + rect.w / 2, y = rect.y + rect.h / 2;
  host.pushInput({ type: 'down', x, y, t: 1 });
  host.pushInput({ type: 'up', x, y, t: 1.05 });
  return rect;
}

test('first load, missing cloud, failure retry and empty states stay honest and return works', async t => {
  const host = makeHost(t);
  let backs = 0;
  ui.mountWelfarePage(host, undefined, 'tasks', () => backs++);
  assert.ok(labels(host).some(label => label.includes('云服务未配置')));
  assert.equal(action(host, '领取奖励'), undefined);
  click(host, action(host, '返回')); assert.equal(backs, 1);
  const wait = deferred(); let loads = 0;
  ui.mountWelfarePage(host, { load: () => { loads++; return loads === 1 ? wait.promise : Promise.resolve({ ...snapshot(), handbook: [] }); } }, 'handbook', () => {});
  assert.ok(labels(host).includes('加载中…'));
  assert.equal(action(host,'刷新').enabled,false,'pending initial load cannot be refreshed again');
  wait.reject(Error('offline')); await flush();
  assert.equal(action(host,'刷新').enabled,true,'failed loading restores refresh');
  assert.ok(labels(host).includes('加载失败，请重试。'));
  click(host, action(host, '重试加载')); await flush();
  assert.equal(loads, 2); assert.ok(labels(host).includes('暂无手册章节'));
  assert.ok(labels(host).includes('已达标 0/0  ·  可领取 0  ·  已领取 0'));
  const empty = snapshot(); empty.daily.missions = [];
  ui.mountWelfarePage(host, { load: async () => empty }, 'tasks', () => {}); await flush();
  assert.ok(labels(host).includes('本期暂无任务'));
});

test('daily/weekly tabs reuse one snapshot, use server reset and valid run rules', async t => {
  const host = makeHost(t); let loads = 0, claims = 0;
  ui.mountWelfarePage(host, { load: async () => { loads++; return snapshot(); }, claimMission: async () => { claims++; return snapshot(); } }, 'tasks', () => {});
  await flush();
  assert.ok(labels(host).includes('金币 120  ·  钻石 8'));
  assert.ok(labels(host).some(label => label.includes('有效跑局至少 10 秒')));
  assert.ok(labels(host).includes('服务器重置：2026-11-07 08:00（北京时间）'));
  assert.ok(labels(host).includes('已达标 1/2  ·  可领取 1  ·  已领取 0'));
  click(host, action(host, '未达标')); assert.equal(claims, 0);
  click(host, action(host, '每周任务'));
  assert.ok(labels(host).includes('累计跑酷 weekly-ready'));
  assert.ok(!labels(host).includes('累计跑酷 daily-ready'));
  assert.ok(labels(host).includes('服务器重置：2026-11-09 08:00（北京时间）'));
  click(host, action(host, '每日任务')); assert.equal(loads, 1);
});

test('handbook displays real locked/progress/reward states; double tap sends one claim and server wallet wins', async t => {
  const host = makeHost(t); const wait = deferred(); const calls = [];
  ui.mountWelfarePage(host, { load: async () => snapshot(), claimChapter: id => { calls.push(id); return wait.promise; } }, 'handbook', () => {});
  await flush();
  const visible = labels(host);
  for (const value of ['第 1 章', '初次出发', '完成一场有效跑酷', '锁定', '进行中', '进度 3 / 10', '完成并领取上一章后解锁']) assert.ok(visible.includes(value), value);
  assert.ok(visible.includes('奖励：钻石 ×3 · 钥匙 ×1 · 角色碎片 ×5'));
  click(host, action(host, '未解锁')); click(host, action(host, '未达标')); assert.equal(calls.length, 0);
  const ready = action(host, '领取奖励');
  const rect = click(host, ready);
  // A second physical tap at the same screen location, before the response.
  for (const type of ['down', 'up']) host.pushInput({ type, x: rect.x + rect.w / 2, y: rect.y + rect.h / 2, t: 2 });
  assert.deepEqual(calls, ['chapter-ready']); assert.ok(labels(host).includes('领取中…'));
  assert.equal(action(host,'刷新').enabled,false,'a pending claim visibly disables refresh');
  assert.ok(labels(host).includes('金币 120  ·  钻石 8'), 'no optimistic wallet changes');
  const next = snapshot(); next.profile.wallet = { coin: 153, diamond: 11 }; next.handbook[0].claimed = true; next.handbook[1].unlocked = true;
  wait.resolve(next); await flush();
  assert.equal(action(host,'刷新').enabled,true,'confirmed result restores refresh');
  assert.ok(labels(host).includes('金币 153  ·  钻石 11')); assert.ok(labels(host).includes('已领取'));
  assert.ok(!labels(host).includes('锁定')); assert.equal(action(host, '已领取').enabled, false);
  click(host, action(host, '已领取')); assert.deepEqual(calls, ['chapter-ready']);
});

test('claim failure preserves data; tab navigation and retry keep the original period identity', async t => {
  const host = makeHost(t); const failed = deferred(), success = deferred(); const calls = [];
  ui.mountWelfarePage(host, { load: async () => snapshot(), claimMission: (...args) => {
    calls.push(args); return calls.length === 1 ? failed.promise : success.promise;
  } }, 'tasks', () => {});
  await flush(); click(host, action(host, '领取奖励'));
  click(host, action(host, '每周任务'));
  failed.reject(Error('offline')); await flush();
  assert.ok(labels(host).includes('领取失败，可重试或刷新进度。'));
  assert.ok(labels(host).includes('累计跑酷 weekly-ready')); assert.ok(labels(host).includes('金币 120  ·  钻石 8'));
  click(host, action(host, '重试领取')); click(host, action(host, '领取奖励'));
  assert.deepEqual(calls, [['daily', '2026-11-06', 'daily-ready'], ['daily', '2026-11-06', 'daily-ready']]);
  const next = snapshot(); next.daily.missions[0].claimed = true; next.profile.wallet.coin = 150;
  success.resolve(next); await flush();
  assert.ok(labels(host).includes('累计跑酷 weekly-ready'));
  click(host, action(host, '每日任务')); assert.ok(labels(host).includes('已领取'));
  assert.ok(labels(host).includes('金币 150  ·  钻石 8'));
});

test('a refreshed period can replace an expired claim instead of retrying it forever', async t => {
  const host = makeHost(t); let loads = 0; const claims = [];
  const next = snapshot(); next.daily.periodId = '2026-11-07'; next.daily.missions = [mission('new-day', 10)];
  ui.mountWelfarePage(host, {
    load: async () => ++loads === 1 ? snapshot() : next,
    claimMission: async (...args) => { claims.push(args); throw Error('PERIOD_EXPIRED'); },
  }, 'tasks', () => {});
  await flush(); click(host, action(host, '领取奖励')); await flush();
  click(host, action(host, '刷新')); await flush();
  assert.equal(loads, 2); assert.ok(labels(host).includes('累计跑酷 new-day'));
  assert.equal(action(host, '重试领取'), undefined);
  click(host, action(host, '领取奖励')); await flush();
  assert.deepEqual(claims.at(-1), ['daily', '2026-11-07', 'new-day']);
});

test('late load/claim results cannot repaint another page after return or replacement', async t => {
  for (const stage of ['load', 'claim']) {
    const host = makeHost(t); const wait = deferred(); let cleanup;
    const onBack = () => { cleanup(); const v = host.makeView(); v.add(new ui.Label({ text: '大厅' })); host.mount(v); };
    cleanup = ui.mountWelfarePage(host, { load: () => stage === 'load' ? wait.promise : Promise.resolve(snapshot()), claimChapter: () => wait.promise }, 'handbook', onBack);
    if (stage === 'claim') { await flush(); click(host, action(host, '领取奖励')); }
    click(host, action(host, '返回')); const newView = host.overlay.current;
    wait.resolve(snapshot()); await flush(); assert.equal(host.overlay.current, newView); assert.deepEqual(labels(host), ['大厅']);
  }
  const host = makeHost(t), wait = deferred();
  ui.mountWelfarePage(host, { load: () => wait.promise }, 'handbook', () => {});
  ui.mountWelfarePage(host, undefined, 'tasks', () => {});
  const newView = host.overlay.current; wait.reject(Error('late')); await flush();
  assert.equal(host.overlay.current, newView); assert.ok(labels(host).some(label => label.includes('云服务未配置')));
});

test('320px safe viewport wraps long content, draws actual progress and keeps touch rectangles >=44px', async t => {
  const host = makeHost(t, 320, 568); const data = snapshot();
  data.handbook[0].title = '累计完成有效跑酷并探索海岸领取角色碎片奖励'.repeat(4);
  data.handbook[0].description = '有效跑局累计前进1000米'.repeat(5);
  data.handbook[0].reward = { coin: 123456789, diamond: 999, key: 9, shard: 'shard_volt:99' };
  ui.mountWelfarePage(host, { load: async () => data }, 'handbook', () => {}); await flush();
  const tree = settle(host), all = box => [box, ...box.children.flatMap(all)];
  for (const box of all(tree)) {
    assert.ok(Number.isFinite(box.rect.x + box.rect.y + box.rect.w + box.rect.h));
    assert.ok(box.rect.x >= -0.01 && box.rect.x + box.rect.w <= 320.01, `horizontal overflow: ${box.id}`);
  }
  for (const button of widgets(host, ui.WelfareAction)) {
    const { rect } = ui.findBox(tree, button.id); assert.ok(rect.w >= 44 && rect.h >= 44, button.label.getText());
  }
  const back = ui.findBox(tree, action(host, '返回').id).rect;
  assert.equal(back.y, 14, 'host has already excluded capsule/safe area');
  const longLabel = widgets(host, ui.Label).find(label => label.getText() === data.handbook[0].title);
  assert.ok(ui.findBox(tree, longLabel.id).rect.h > 80, 'long title wraps into measured height');
  assert.ok(widgets(host, ui.ScrollView)[0].physics.maxOffset > 0);
  const bars = widgets(host, ui.Box).filter(box => box.node().height === 8 && box.children.length === 1);
  assert.equal(bars.length, 3);
  const progress = ui.findBox(tree, bars[2].id);
  assert.ok(Math.abs(progress.children[0].rect.w / progress.rect.w - 0.3) < 0.001, '3/10 bar has 30% fill');
});

test('all new literal UI copy and handbook configuration have real font glyph coverage', () => {
  const chars = new Set();
  for (const path of ['packages/game/src/ui/welfareView.ts', 'packages/game/src/ui/welfareCards.ts']) {
    const source = ts.createSourceFile(path, readFileSync(`${root}${path}`, 'utf8'), ts.ScriptTarget.Latest, true);
    const scan = node => {
      if (ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
        for (const char of node.text) if (/[^\x00-\x7f\s]/u.test(char)) chars.add(char);
      }
      ts.forEachChild(node, scan);
    };
    scan(source);
  }
  const economy = JSON.parse(readFileSync(`${root}config/economy.json`, 'utf8'));
  for (const chapter of economy.params.handbook.chapters) for (const char of chapter.title + chapter.description) if (/[^\x00-\x7f\s]/u.test(char)) chars.add(char);
  const missing = [...chars].filter(char => !fonts.lookup(char.codePointAt(0)));
  assert.deepEqual(missing, [], `字体需主代理补齐：${missing.join('')}`);
});
