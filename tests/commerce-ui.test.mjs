import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import ts from 'typescript';
import { Texture, NoColorSpace } from 'three';

// Source-only, memory-only compilation; no shared dist or tsbuildinfo writes.
const root = fileURLToPath(new URL('../', import.meta.url));
const { outputFiles } = await build({
  stdin: { contents: `export * from './packages/game/src/ui/commerceView.ts';
    export * from './packages/game/src/ui/commerceCards.ts';
    export * from './packages/game/src/ui/commerceArtwork.ts';
    export { buildLoadout } from './packages/game/src/core/sim/character.ts';
    export * from './packages/framework/src/ui/index.ts';
    export * from './packages/framework/src/ui/host.ts';`, resolveDir: root },
  alias: { '@tr/framework': `${root}packages/framework/src` },
  bundle: true, platform: 'node', format: 'esm', write: false,
});
const ui = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
const readJson = path => JSON.parse(readFileSync(`${root}${path}`, 'utf8'));
const content = Object.fromEntries(['game', 'characters', 'skills', 'items', 'obstacles', 'themes', 'events', 'economy']
  .map(name => [name, readJson(`config/${name}.json`)]));
const roster = content.characters.items.filter(entry => entry.id.startsWith('char_') && entry.status === 'live');
function artwork(t) {
  const portraits = Object.fromEntries(roster.map(character => {
    const bytes = readFileSync(`${root}assets/ui/portraits/${character.id}.png`);
    assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
    const texture = new Texture(); texture.colorSpace = NoColorSpace;
    t.after(() => texture.dispose());
    return [character.id, { texture, texSize: { w: bytes.readUInt32BE(16), h: bytes.readUInt32BE(20) },
      insets: { left: 0, right: 0, top: 0, bottom: 0 } }];
  }));
  return { content, portraits };
}
const fonts = ui.createFontSet(['latin', 'cjk'].map(name => ui.createFontAtlas(readJson(`assets/fonts/noto/${name}.metrics.json`))));
const flush = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function snapshot() {
  return {
    catalogVersion: 'catalog-v1',
    profile: { schemaVersion: 1, revision: 1, playerId: 'p1', wallet: { coin: 1000, diamond: 50 },
      inventory: { characters: ['char_volt', 'char_ama'], items: { key: 2, shard_volt: 5 } },
      preferences: { characterId: 'char_volt', themeId: 'theme_day' }, createdAt: '', updatedAt: '' },
    characters: [
      { id: 'char_volt', name: '牢大', tagline: '最便宜的伙伴，最稳的发挥', rarity: 'R', owned: true, equipped: true },
      { id: 'char_ama', name: '阿玛拉', tagline: '金币见了她，自己会排队', rarity: 'SR', owned: true, equipped: false },
      { id: 'char_kaze', name: '风剃', tagline: '别人绕路，他抄近路', rarity: 'SR', owned: false, equipped: false },
    ],
    items: [{ id: 'key', name: '钥匙', amount: 2 }, { id: 'shard_volt', name: '角色碎片', amount: 5 }],
    themes: [{ id: 'theme_day', name: '白日海景', selected: true }, { id: 'theme_night', name: '雨夜便利店', selected: false }],
    offers: [
      { id: 'offer_kaze', category: 'character', title: '风剃', description: '别人绕路，他抄近路', price: { diamond: 30 }, priceText: '30 钻石',
        grants: [{ item: 'char_kaze', amount: 1, name: '风剃' }], remaining: 1, owned: false, canPurchase: true, unavailableReason: null },
      { id: 'offer_ama', category: 'character', title: '阿玛拉', description: '金币见了她，自己会排队', price: { coin: 4500 }, priceText: '4500 金币',
        grants: [{ item: 'char_ama', amount: 1, name: '阿玛拉' }], remaining: 1, owned: true, canPurchase: false, unavailableReason: '已拥有' },
      { id: 'offer_coin', category: 'exchange', title: '金币补给', description: '兑换金币', price: { diamond: 100 }, priceText: '100 钻石',
        grants: [{ item: 'coin', amount: 1000, name: '金币' }], remaining: null, owned: false, canPurchase: false, unavailableReason: '余额不足' },
      { id: 'offer_key', category: 'exchange', title: '钥匙补给', description: '兑换钥匙', price: { coin: 100 }, priceText: '100 金币',
        grants: [{ item: 'key', amount: 1, name: '钥匙' }], remaining: 0, owned: false, canPurchase: false, unavailableReason: '限购已用完' },
      { id: 'offer_shard', category: 'exchange', title: '角色碎片补给', description: '兑换角色碎片', price: { coin: 100 }, priceText: '100 金币',
        grants: [{ item: 'shard_volt', amount: 5, name: '角色碎片' }], remaining: 2, owned: false, canPurchase: true, unavailableReason: null },
    ],
  };
}
function service(overrides = {}) {
  let n = 0;
  return { load: async () => snapshot(), newRequestId: () => `request-${++n}`,
    buy: async () => snapshot(), equip: async () => snapshot(), selectTheme: async () => snapshot(), ...overrides };
}
function makeHost(t, width = 375, height = 812) {
  const renderer = { autoClear: true, render() {} };
  const adapter = { canvas: { onResize: () => () => {} }, onInput: () => () => {}, now: () => 0 };
  const host = new ui.UiHost({ adapter, inputMode: 'raw', fonts, config: ui.defaultUiConfig,
    overlayHost: { renderer, width, height, dpr: 1 } });
  t.after(() => host.dispose()); return host;
}
function widgets(host, Type) {
  const all = []; host.overlay.current.root.visit(widget => { if (widget instanceof Type) all.push(widget); }); return all;
}
const labels = host => widgets(host, ui.Label).map(label => label.getText());
const action = (host, title, index = 0) => widgets(host, ui.WelfareAction).filter(control => control.label.getText() === title)[index];
function settle(host) { for (let i = 0; i < 8; i++) host.overlay.tick(0); return host.overlay.tree; }
function tap(host, rect, t = 1) {
  const x = rect.x + rect.w / 2, y = rect.y + rect.h / 2;
  host.pushInput({ type: 'down', x, y, t }); host.pushInput({ type: 'up', x, y, t: t + 0.05 });
}
function click(host, control) {
  assert.ok(control, 'control exists'); settle(host);
  const scroll = widgets(host, ui.ScrollView)[0];
  let rect = ui.findBox(host.overlay.tree, control.id).rect;
  const sb = ui.findBox(host.overlay.tree, scroll.id);
  if (ui.findBox(sb, control.id) && (rect.y < sb.rect.y || rect.y + rect.h > sb.rect.y + sb.rect.h)) {
    scroll.physics.snapTo(scroll.physics.offset + rect.y - sb.rect.y - 8);
    host.overlay.current.invalidate(); settle(host); rect = ui.findBox(host.overlay.tree, control.id).rect;
  }
  tap(host, rect); return rect;
}
function setEquipped(data, id) {
  data.profile.preferences.characterId = id;
  for (const character of data.characters) character.equipped = character.id === id;
  return data;
}

test('all modes handle missing service, first load/failure/retry, refresh failure and actual empty lists', async t => {
  for (const mode of ['shop', 'inventory', 'characters', 'settings']) {
    const host = makeHost(t); let backs = 0;
    ui.mountCommercePage(host, undefined, mode, { onBack: () => backs++ });
    assert.ok(labels(host).some(label => label.includes('云服务未配置')));
    assert.equal(action(host, '刷新').enabled, false); click(host, action(host, '返回')); assert.equal(backs, 1);
    const wait = deferred(); let loads = 0;
    const empty = snapshot(); empty.offers = []; empty.characters = []; empty.items = []; empty.themes = [];
    ui.mountCommercePage(host, service({ load: () => { loads++; return loads === 1 ? wait.promise : loads === 2 ? Promise.resolve(empty) : Promise.reject(Error('offline')); } }), mode, { onBack() {} });
    assert.ok(labels(host).includes('加载中…')); assert.equal(action(host, '刷新').enabled, false);
    wait.reject(Error('offline')); await flush(); assert.ok(labels(host).includes('加载失败，请重试。'));
    click(host, action(host, '重试加载')); await flush();
    assert.ok(labels(host).includes({ shop: '暂无商品', inventory: '暂无道具', characters: '暂无角色', settings: '暂无可选主题' }[mode]));
    click(host, action(host, '刷新')); await flush();
    assert.ok(labels(host).includes('刷新失败，已保留当前内容。')); assert.ok(labels(host).includes('金币 1000  ·  钻石 50'));
  }
});

test('shop uses server prices/grants/limits; categories reuse snapshot and unavailable offers stay disabled', async t => {
  const host = makeHost(t); let loads = 0, ids = 0, purchases = 0;
  ui.mountCommercePage(host, service({ load: async () => { loads++; return snapshot(); }, newRequestId: () => { ids++; return 'id'; }, buy: async () => { purchases++; return snapshot(); } }), 'shop', { onBack() {} });
  await flush();
  for (const value of ['报价：30 钻石', '风剃 ×1', '剩余限购 1', '已拥有']) assert.ok(labels(host).includes(value));
  assert.equal(action(host, '已拥有').enabled, false); click(host, action(host, '已拥有'));
  click(host, action(host, '兑换'));
  for (const value of ['余额不足', '限购已用完', '不限购', '剩余限购 2', '角色碎片 ×5']) assert.ok(labels(host).includes(value));
  assert.equal(action(host, '不可购买', 0).enabled, false); assert.equal(action(host, '不可购买', 1).enabled, false);
  click(host, action(host, '不可购买', 0)); click(host, action(host, '不可购买', 1));
  click(host, action(host, '角色'));
  assert.equal(loads, 1); assert.equal(ids, 0); assert.equal(purchases, 0);
});

test('purchase has real confirmation/cancellation; double taps serialize and success uses server wallet/ownership', async t => {
  const host = makeHost(t), wait = deferred(); let ids = 0, backs = 0; const purchases = [];
  ui.mountCommercePage(host, service({ newRequestId: () => `id-${++ids}`, buy: (...args) => { purchases.push(args); return wait.promise; } }), 'shop', { onBack: () => backs++ });
  await flush(); click(host, action(host, '购买'));
  assert.ok(labels(host).includes('确认本次补给')); assert.ok(labels(host).includes('报价：30 钻石')); assert.ok(labels(host).includes('风剃 ×1'));
  assert.equal(ids, 0); assert.equal(purchases.length, 0);
  click(host, action(host, '返回商店')); assert.equal(ids, 0); assert.equal(purchases.length, 0);
  click(host, action(host, '购买')); const rect = click(host, action(host, '确认购买')); tap(host, rect, 2);
  assert.equal(ids, 1); assert.deepEqual(purchases, [['offer_kaze', 'id-1', 'catalog-v1']]);
  assert.equal(action(host, '取消').enabled, false); assert.equal(action(host, '返回商店').enabled, false); assert.equal(action(host, '刷新').enabled, false);
  click(host, action(host, '取消')); click(host, action(host, '返回商店')); assert.equal(backs, 0);
  assert.ok(labels(host).includes('金币 1000  ·  钻石 50'));
  const next = snapshot(); next.profile.wallet.diamond = 20; next.profile.inventory.characters.push('char_kaze'); next.characters[2].owned = true;
  next.offers[0].owned = true; next.offers[0].canPurchase = false;
  wait.resolve(next); await flush();
  assert.ok(labels(host).includes('购买完成，余额与仓库已更新。')); assert.ok(labels(host).includes('金币 1000  ·  钻石 20'));
  assert.equal(widgets(host, ui.WelfareAction).filter(control => control.label.getText() === '已拥有').length, 2);
  assert.equal(action(host, '确认购买'), undefined); assert.equal(action(host, '返回').enabled, true);
});

test('failed purchase retry reuses offer/request/catalog triple and never changes inventory or wallet optimistically', async t => {
  const host = makeHost(t); const first = deferred(), second = deferred(); const purchases = []; let ids = 0;
  ui.mountCommercePage(host, service({ newRequestId: () => `id-${++ids}`, buy: (...args) => {
    purchases.push(args); return purchases.length === 1 ? first.promise : second.promise;
  } }), 'shop', { onBack() {} });
  await flush(); click(host, action(host, '兑换')); click(host, action(host, '购买')); click(host, action(host, '确认购买'));
  first.reject(Error('failed')); await flush();
  assert.ok(labels(host).includes('购买结果尚未确认，请重试或刷新后再离开。')); assert.ok(labels(host).includes('金币 1000  ·  钻石 50'));
  assert.equal(action(host, '返回商店').enabled, false);
  const rect = click(host, action(host, '重试购买')); tap(host, rect, 3);
  assert.equal(ids, 1); assert.deepEqual(purchases, [['offer_shard', 'id-1', 'catalog-v1'], ['offer_shard', 'id-1', 'catalog-v1']]);
  const next = snapshot(); next.profile.wallet.coin = 900; next.profile.inventory.items.shard_volt = 10; next.items[1].amount = 10; next.offers[4].remaining = 1;
  second.resolve(next); await flush();
  assert.ok(labels(host).includes('金币 900  ·  钻石 50')); assert.ok(labels(host).includes('剩余限购 1'));
  assert.equal(ids, 1);
});

test('definite purchase rejection restores navigation; uncertain result can be manually refreshed to a server snapshot', async t => {
  const host = makeHost(t); let backs = 0, loads = 0;
  ui.mountCommercePage(host, service({ buy: async () => { throw Object.assign(Error('insufficient'), { code: 'INSUFFICIENT_FUNDS' }); } }), 'shop', { onBack: () => backs++ });
  await flush(); click(host, action(host, '购买')); click(host, action(host, '确认购买')); await flush();
  assert.ok(labels(host).includes('购买失败，可重试或刷新。')); assert.equal(action(host, '返回商店').enabled, true);
  click(host, action(host, '返回商店')); click(host, action(host, '返回')); assert.equal(backs, 1);
  const next = snapshot(); next.profile.wallet.diamond = 20; next.offers[0].owned = true; next.offers[0].canPurchase = false;
  ui.mountCommercePage(host, service({ load: async () => ++loads === 1 ? snapshot() : next,
    buy: async () => { throw Object.assign(Error('offline'), { code: 'NETWORK_UNAVAILABLE' }); },
  }), 'shop', { onBack() {} });
  await flush(); click(host, action(host, '购买')); click(host, action(host, '确认购买')); await flush();
  assert.equal(action(host, '取消').enabled, false); assert.equal(action(host, '刷新').enabled, true);
  click(host, action(host, '刷新')); await flush();
  assert.ok(labels(host).includes('金币 1000  ·  钻石 20')); assert.equal(action(host, '返回').enabled, true);
});

test('CATALOG_CHANGED requires refresh and a fresh confirmation before new pricing is submitted', async t => {
  const host = makeHost(t); const purchases = []; let loads = 0, ids = 0;
  const changed = snapshot(); changed.catalogVersion = 'catalog-v2'; changed.offers[0].priceText = '25 钻石'; changed.offers[0].price.diamond = 25;
  ui.mountCommercePage(host, service({ load: async () => ++loads === 1 ? snapshot() : changed, newRequestId: () => `id-${++ids}`,
    buy: async (...args) => { purchases.push(args); if (purchases.length === 1) throw Object.assign(Error('changed'), { code: 'CATALOG_CHANGED' }); return changed; },
  }), 'shop', { onBack() {} });
  await flush(); click(host, action(host, '购买')); click(host, action(host, '确认购买')); await flush();
  assert.ok(labels(host).includes('商品报价已更新，请刷新后重新确认购买。'));
  assert.equal(action(host, '购买').enabled, false); assert.equal(action(host, '重试购买'), undefined);
  click(host, action(host, '购买')); assert.equal(purchases.length, 1);
  click(host, action(host, '刷新')); await flush(); assert.ok(labels(host).includes('报价：25 钻石')); assert.equal(purchases.length, 1);
  click(host, action(host, '购买')); assert.ok(labels(host).includes('报价：25 钻石')); assert.equal(ids, 1);
  click(host, action(host, '确认购买')); await flush();
  assert.deepEqual(purchases, [['offer_kaze', 'id-1', 'catalog-v1'], ['offer_kaze', 'id-2', 'catalog-v2']]);
});

test('characters show server ownership/rarity/tagline; equip failure keeps old runner, retries then starts equipped runner', async t => {
  const host = makeHost(t), first = deferred(), second = deferred(); const equips = [], selected = [], started = []; let backs = 0;
  ui.mountCommercePage(host, service({ equip: id => { equips.push(id); return equips.length === 1 ? first.promise : second.promise; } }), 'characters', {
    onBack: () => backs++, onStartRun: id => started.push(id), onSelected: id => selected.push(id), onShop() {},
  });
  await flush();
  for (const value of ['牢大', '阿玛拉', '风剃', 'SR · 未拥有', 'SR · 已拥有', 'R · 当前出战', '别人绕路，他抄近路']) assert.ok(labels(host).includes(value));
  const rect = click(host, action(host, '出战')); tap(host, rect, 2);
  assert.deepEqual(equips, ['char_ama']); assert.deepEqual(selected, []);
  assert.equal(action(host, '返回').enabled, false); assert.equal(action(host, '开始跑酷').enabled, false);
  click(host, action(host, '返回')); click(host, action(host, '开始跑酷')); assert.equal(backs, 0); assert.equal(started.length, 0);
  first.reject(Error('offline')); await flush();
  assert.ok(labels(host).includes('出战保存失败，请重试或刷新。')); assert.ok(labels(host).includes('当前出战：牢大')); assert.deepEqual(selected, []);
  click(host, action(host, '重试出战')); second.resolve(setEquipped(snapshot(), 'char_ama')); await flush();
  assert.deepEqual(equips, ['char_ama', 'char_ama']); assert.deepEqual(selected, ['char_ama']); assert.ok(labels(host).includes('当前出战：阿玛拉'));
  click(host, action(host, '开始跑酷')); assert.deepEqual(started, ['char_ama']);
});

test('start uses only owned equipped runner; unowned character navigates to shop with exact id', async t => {
  const host = makeHost(t); const started = [], shops = [];
  ui.mountCommercePage(host, service(), 'characters', { onBack() {}, onStartRun: id => started.push(id), onShop: id => shops.push(id) });
  await flush(); click(host, action(host, '开始跑酷')); assert.deepEqual(started, ['char_volt']);
  ui.mountCommercePage(host, service(), 'characters', { onBack() {}, onStartRun: id => started.push(id), onShop: id => shops.push(id) });
  await flush(); click(host, action(host, '前往商店')); assert.deepEqual(shops, ['char_kaze']);
  const unselected = snapshot(); unselected.characters.forEach(character => { character.equipped = false; });
  ui.mountCommercePage(host, service({ load: async () => unselected }), 'characters', { onBack() {}, onStartRun: id => started.push(id) });
  await flush(); assert.equal(action(host, '开始跑酷').enabled, false); click(host, action(host, '开始跑酷')); assert.deepEqual(started, ['char_volt']);
});

test('inventory shows actual items/owned characters and equip snapshot changes, with no fake item use', async t => {
  const host = makeHost(t), wait = deferred(); const selected = [];
  ui.mountCommercePage(host, service({ equip: () => wait.promise }), 'inventory', { onBack() {}, onSelected: id => selected.push(id) });
  await flush();
  for (const value of ['拥有角色 2', '道具 2', '钥匙', '数量 2', '角色碎片', '数量 5', '已出战', '出战']) assert.ok(labels(host).includes(value));
  assert.ok(!labels(host).includes('风剃')); assert.ok(widgets(host, ui.WelfareAction).every(control => !control.label.getText().includes('使用')));
  click(host, action(host, '出战')); assert.deepEqual(selected, []);
  const next = setEquipped(snapshot(), 'char_ama'); next.items[0].amount = 3; next.profile.inventory.items.key = 3;
  wait.resolve(next); await flush(); assert.deepEqual(selected, ['char_ama']); assert.ok(labels(host).includes('数量 3'));
});

test('theme remains unchanged on failure and callback runs only after saved server snapshot', async t => {
  const host = makeHost(t), first = deferred(), second = deferred(); const calls = [], applied = [];
  ui.mountCommercePage(host, service({ selectTheme: id => { calls.push(id); return calls.length === 1 ? first.promise : second.promise; } }), 'settings', {
    onBack() {}, onThemeSelected: id => { assert.ok(labels(host).includes('主题已保存。')); applied.push(id); return false; },
  });
  await flush(); assert.equal(action(host, '已选择').enabled, false);
  const rect = click(host, action(host, '选择主题')); tap(host, rect, 2); assert.deepEqual(calls, ['theme_night']); assert.deepEqual(applied, []);
  first.reject(Error('offline')); await flush(); assert.ok(labels(host).includes('主题保存失败，请重试或刷新。')); assert.deepEqual(applied, []);
  click(host, action(host, '重试保存'));
  const next = snapshot(); next.profile.preferences.themeId = 'theme_night'; next.themes[0].selected = false; next.themes[1].selected = true;
  second.resolve(next); await flush();
  assert.deepEqual(calls, ['theme_night', 'theme_night']); assert.deepEqual(applied, ['theme_night']);
  assert.ok(labels(host).includes('主题已保存，当前场景暂未更新。'));
  assert.equal(action(host, '已选择').enabled, false);
});

test('late load after back, and pending buy/equip/theme after host replacement cannot paint/callback on new page', async t => {
  for (const stage of ['load', 'buy', 'equip', 'theme']) {
    const host = makeHost(t), wait = deferred(); let cleanup, callbacks = 0;
    const mode = { load: 'inventory', buy: 'shop', equip: 'characters', theme: 'settings' }[stage];
    const mountNew = () => { const page = host.makeView(); page.add(new ui.Label({ text: '大厅' })); host.mount(page); };
    cleanup = ui.mountCommercePage(host, service({ load: () => stage === 'load' ? wait.promise : Promise.resolve(snapshot()),
      buy: () => wait.promise, equip: () => wait.promise, selectTheme: () => wait.promise,
    }), mode, { onBack: () => { cleanup(); mountNew(); }, onSelected: () => callbacks++, onThemeSelected: () => { callbacks++; } });
    if (stage === 'load') click(host, action(host, '返回'));
    else {
      await flush();
      if (stage === 'buy') { click(host, action(host, '购买')); click(host, action(host, '确认购买')); }
      else click(host, action(host, stage === 'equip' ? '出战' : '选择主题'));
      mountNew();
    }
    const page = host.overlay.current; wait.resolve(setEquipped(snapshot(), 'char_ama')); await flush();
    assert.equal(host.overlay.current, page); assert.deepEqual(labels(host), ['大厅']); assert.equal(callbacks, 0);
  }
});

test('320px layouts and long quotes/names/rewards wrap without horizontal overflow; all touch targets >=44px', async t => {
  for (const mode of ['shop', 'inventory', 'characters', 'settings']) {
    const host = makeHost(t, 320, 568), data = snapshot();
    const long = '完成海岸探索获得角色碎片奖励'.repeat(6);
    for (const offer of data.offers) { offer.title = long; offer.description = long; offer.priceText = `123456789 金币 · ${long}`; offer.grants[0].name = long; }
    for (const character of data.characters) { character.name = long; character.tagline = long; }
    for (const theme of data.themes) theme.name = long;
    data.items[0].name = long;
    ui.mountCommercePage(host, service({ load: async () => data }), mode, { onBack() {}, onShop() {}, onStartRun() {} }); await flush();
    const verify = () => {
      const tree = settle(host), all = box => [box, ...box.children.flatMap(all)];
      for (const box of all(tree)) {
        assert.ok(Number.isFinite(box.rect.x + box.rect.y + box.rect.w + box.rect.h));
        assert.ok(box.rect.x >= -0.01 && box.rect.x + box.rect.w <= 320.01, `${mode} overflow ${box.id}`);
      }
      for (const control of widgets(host, ui.WelfareAction)) {
        const rect = ui.findBox(tree, control.id).rect; assert.ok(rect.w >= 44 && rect.h >= 44, `${mode} ${control.label.getText()}`);
      }
      const title = widgets(host, ui.Label).find(label => label.getText() === long);
      assert.ok(ui.findBox(tree, title.id).rect.h > 40);
      assert.ok(widgets(host, ui.ScrollView)[0].physics.maxOffset > 0);
    };
    verify(); assert.equal(ui.findBox(host.overlay.tree, action(host, '返回').id).rect.y, 14);
    if (mode === 'shop') { click(host, action(host, '购买')); verify(); }
  }
});

test('new commerce literal copy has glyphs in real font metrics', () => {
  const chars = new Set();
  for (const path of ['packages/game/src/ui/commerceView.ts', 'packages/game/src/ui/commerceCards.ts', 'packages/game/src/ui/commerceArtwork.ts']) {
    const source = ts.createSourceFile(path, readFileSync(`${root}${path}`, 'utf8'), ts.ScriptTarget.Latest, true);
    const scan = node => {
      if (ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
        for (const char of node.text) if (/[^\x00-\x7f\s]/u.test(char)) chars.add(char);
      }
      ts.forEachChild(node, scan);
    };
    scan(source);
  }
  for (const character of readJson('config/characters.json').items.filter(item => item.kind !== 'skin')) {
    for (const value of [character.name?.['zh-CN'], character.tagline?.['zh-CN']]) for (const char of value ?? '') if (/[^\x00-\x7f\s]/u.test(char)) chars.add(char);
  }
  for (const theme of readJson('config/themes.json').items) for (const char of theme.name['zh-CN']) if (/[^\x00-\x7f\s]/u.test(char)) chars.add(char);
  for (const character of roster) {
    const load = ui.buildLoadout(content, character.id);
    for (const value of [load.skill?.label, load.skill?.desc, load.talentLabel, load.talentDesc]) {
      for (const char of value ?? '') if (/[^\x00-\x7f\s]/u.test(char)) chars.add(char);
    }
  }
  const missing = [...chars].filter(char => !fonts.lookup(char.codePointAt(0)));
  assert.deepEqual(missing, [], `字体需主代理补齐：${missing.join('')}`);
});

test('all nine real portraits reuse exact NoColorSpace sources and each id gets its own configured skill and talent', t => {
  const host = makeHost(t, 320, 480), art = artwork(t);
  assert.equal(roster.length, 9);
  for (const character of roster) {
    const load = ui.buildLoadout(content, character.id), view = host.makeView();
    const card = ui.characterCard(host, { id: character.id, name: load.name, tagline: load.tagline,
      rarity: load.rarity, owned: true, equipped: false }, false, () => {}, undefined, art);
    view.add(card); host.mount(view); const tree = settle(host);
    const images = widgets(host, ui.Box).filter(box => box.opts.background === art.portraits[character.id]);
    assert.equal(images.length, 1); assert.equal(images[0].opts.background.texture, art.portraits[character.id].texture);
    assert.equal(art.portraits[character.id].texture.colorSpace, NoColorSpace);
    const rect = ui.findBox(tree, images[0].id).rect;
    assert.ok(rect.w <= 64 && rect.h <= 86);
    assert.ok(Math.abs(rect.w / rect.h - art.portraits[character.id].texSize.w / art.portraits[character.id].texSize.h) < 0.001);
    const copy = labels(host);
    if (load.skill) {
      assert.ok(copy.includes(`技能：${load.skill.label}`)); assert.ok(copy.includes(load.skill.desc));
      assert.ok(copy.some(value => value.includes('双击屏幕触发') && value.includes(`冷却 ${load.skill.cooldownS}s`)));
      if (load.skill.chargeSlides > 0) assert.ok(copy.some(value => value.includes(`主动下滑 ${load.skill.chargeSlides} 次`)));
    }
    if (load.talentLabel) { assert.ok(copy.includes(`天赋：${load.talentLabel}`)); assert.ok(copy.includes(load.talentDesc)); }
    assert.ok(!copy.some(value => /升级|养成|等级/.test(value)));
  }
});

test('unknown or art-missing ids never borrow another portrait, skill, talent or a default model', t => {
  const art = artwork(t);
  assert.equal(ui.characterPortrait('char_unknown', art), undefined);
  assert.deepEqual(ui.characterAbilities('char_unknown', art), []);
  assert.equal(ui.characterPortrait('char_ama', { portraits: { char_volt: art.portraits.char_volt } }), undefined);
  const host = makeHost(t), view = host.makeView();
  view.add(ui.characterCard(host, { id: 'char_unknown', name: '未知角色', tagline: '未知', rarity: 'R', owned: false, equipped: false },
    false, () => {}, undefined, art)); host.mount(view); settle(host);
  assert.ok(!labels(host).some(value => value.startsWith('技能：') || value.startsWith('天赋：')));
  assert.ok(widgets(host, ui.Box).every(box => !Object.values(art.portraits).includes(box.opts.background)));
});

test('offer portrait/abilities follow the char_ grant, while confirmation keeps the authoritative server quote', async t => {
  const host = makeHost(t), art = artwork(t), data = snapshot();
  data.offers[0].id = 'offer_not_a_character_id'; data.offers[0].title = '服务器专属补给';
  data.offers[0].grants = [{ item: 'key', amount: 7, name: '钥匙' }, { item: 'char_ama', amount: 1, name: '阿玛拉' }];
  data.offers[0].priceText = '17 钻石'; data.offers[0].price = { coin: 999999 };
  ui.mountCommercePage(host, service({ load: async () => data }), 'shop', { onBack() {} }, art);
  await flush(); click(host, action(host, '购买')); settle(host);
  const sources = widgets(host, ui.Box).map(box => box.opts.background);
  assert.ok(sources.includes(art.portraits.char_ama)); assert.ok(!sources.includes(art.portraits.char_kaze));
  assert.ok(labels(host).includes(`技能：${ui.buildLoadout(content, 'char_ama').skill.label}`));
  for (const value of ['报价：17 钻石', '钥匙 ×7', '阿玛拉 ×1']) assert.ok(labels(host).includes(value));
  assert.ok(!labels(host).some(value => value.includes('999999')));
});

test('320px short viewport keeps start fixed outside scroll and wraps portrait names/taglines/skills without overlap', async t => {
  const host = makeHost(t, 320, 400), art = artwork(t), data = snapshot();
  const long = '海岸探索角色伙伴'.repeat(12);
  art.content = structuredClone(content);
  const entry = art.content.characters.items.find(character => character.id === 'char_volt');
  art.content.skills.items.find(skill => skill.id === entry.skillRef).desc['zh-CN'] = long;
  art.content.skills.items.find(talent => talent.id === entry.talentRef).desc['zh-CN'] = long;
  data.characters[0].name = long; data.characters[0].tagline = long;
  const starts = [], wait = deferred();
  ui.mountCommercePage(host, service({ load: async () => data, equip: () => wait.promise }), 'characters',
    { onBack() {}, onStartRun: id => starts.push(id), onShop() {} }, art);
  await flush(); const tree = settle(host), scroll = widgets(host, ui.ScrollView)[0];
  const sb = ui.findBox(tree, scroll.id), button = action(host, '开始跑酷');
  const fixed = { ...ui.findBox(tree, button.id).rect };
  assert.equal(ui.findBox(sb, button.id), undefined); assert.ok(fixed.y + fixed.h <= 400 && fixed.h >= 44);
  assert.ok(sb.rect.h > 100 && sb.rect.y + sb.rect.h <= fixed.y);
  assert.ok(scroll.physics.maxOffset > 0);
  const check = box => {
    assert.ok(box.rect.x >= 0 && box.rect.x + box.rect.w <= 320.01);
    for (const child of box.children) check(child);
    for (let i = 1; i < box.children.length; i++) {
      const a = box.children[i - 1].rect, b = box.children[i].rect;
      if (!a.w || !a.h || !b.w || !b.h) continue; // Host's zero-width absolute toast anchor has no painted area.
      assert.ok(a.y + a.h <= b.y + 0.01 || a.x + a.w <= b.x + 0.01, `overlap in ${box.id}`);
    }
  };
  check(tree);
  for (const label of widgets(host, ui.Label).filter(label => label.getText() === long)) assert.ok(ui.findBox(tree, label.id).rect.h > 80);
  for (const control of widgets(host, ui.WelfareAction)) {
    const rect = ui.findBox(tree, control.id).rect; assert.ok(rect.w >= 44 && rect.h >= 44);
  }
  scroll.physics.snapTo(scroll.physics.maxOffset); host.overlay.current.invalidate(); settle(host);
  assert.deepEqual(ui.findBox(host.overlay.tree, button.id).rect, fixed);
  click(host, action(host, '出战')); assert.equal(action(host, '保存中…').enabled, false);
  assert.equal(action(host, '开始跑酷').enabled, false); assert.equal(action(host, '前往商店').enabled, false);
  wait.reject(Error('offline')); await flush(); assert.equal(action(host, '开始跑酷').enabled, true);
  click(host, action(host, '开始跑酷')); assert.deepEqual(starts, ['char_volt']);
});

test('inventory puts real quantities before owned portraits and provides a reachable shop action', async t => {
  const host = makeHost(t, 320, 400), art = artwork(t), shops = [];
  ui.mountCommercePage(host, service(), 'inventory', { onBack() {}, onShop: id => shops.push(id) }, art);
  await flush(); const copy = labels(host);
  assert.ok(copy.indexOf('数量 2') < copy.indexOf('拥有角色 2'));
  assert.ok(!copy.includes('风剃'));
  assert.ok(widgets(host, ui.Box).every(box => box.opts.background !== art.portraits.char_kaze));
  click(host, action(host, '前往商店')); assert.deepEqual(shops, ['char_volt']);
});

test('theme swatches use exact config sky/fog/ground values and never add unavailable themes', async t => {
  const host = makeHost(t), art = artwork(t), data = snapshot();
  const configured = structuredClone(content);
  const theme = configured.themes.items[0];
  theme.sky.baseColor = '#123456'; theme.fog.color = '#789abc'; theme.groundColor = '#def012';
  data.themes = [{ id: theme.id, name: '白日海景', selected: true }];
  ui.mountCommercePage(host, service({ load: async () => data }), 'settings', { onBack() {} }, { ...art, content: configured });
  await flush(); settle(host);
  const fills = widgets(host, ui.Box).map(box => box.opts.backgroundColor);
  for (const color of ['#123456', '#789abc', '#def012']) assert.ok(fills.includes(color));
  assert.ok(labels(host).includes('配色预览 · 天空 / 雾 / 地面'));
  assert.ok(!labels(host).includes(content.themes.items[1].name['zh-CN']));
  assert.equal(action(host, '选择主题'), undefined);
  assert.deepEqual(ui.themePalette(host, 'missing-theme', art), []);
});

test('strict-storage rejection keeps the same purchase triple for retry and restores cancellation', async t => {
  const host = makeHost(t), requests = []; let ids = 0;
  ui.mountCommercePage(host, service({ newRequestId: () => `storage-${++ids}`, buy: async (...args) => {
    requests.push(args); throw Object.assign(Error('storage'), { code: 'PURCHASE_NOT_SAVED' });
  } }), 'shop', { onBack() {} });
  await flush(); click(host, action(host, '购买')); click(host, action(host, '确认购买')); await flush();
  assert.ok(labels(host).includes('本地记录保存失败，购买未发送。请检查存储后重试。'));
  assert.equal(action(host, '返回商店').enabled, true);
  click(host, action(host, '重试购买')); await flush();
  assert.equal(ids, 1); assert.deepEqual(requests, [['offer_kaze', 'storage-1', 'catalog-v1'], ['offer_kaze', 'storage-1', 'catalog-v1']]);
});
