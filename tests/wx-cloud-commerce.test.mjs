import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as simulation from '../cloudfunctions/thunder-api/simulation-entry.mjs';
import { connectWxCloud } from '../apps/wx/build/platform/cloudClient.js';
const require = createRequire(import.meta.url);
const { createCloudBaseStore, COLLECTION } = require('../cloudfunctions/thunder-api/cloudbase-store.cjs');
const { createRunHandler } = require('../cloudfunctions/thunder-api/run-api.cjs');
const { createProfileHandler, initialContent, playerIdFor } = require('../cloudfunctions/thunder-api/profile.cjs');
const { PURCHASES } = require('../cloudfunctions/thunder-api/market-store.cjs');
const { receiptIdFor } = require('../cloudfunctions/thunder-api/market-policy.cjs');
const { createCatalog } = require('../cloudfunctions/thunder-api/market-catalog.cjs');
// Production is fully free. Keep purchase/ownership security coverage using explicit paid test content.
const paidSimulation = { ...simulation, content: structuredClone(simulation.content) };
const paidGates = {
  char_ama: { type: 'coin', cost: 4500 }, char_kaze: { type: 'coin', cost: 6000 },
  char_rina: { type: 'loot', lootRef: 'loot_thunder_box' },
  char_bolt: { type: 'event', eventRef: 'event_thunder_beast_siege' },
  char_frog: { type: 'coin', cost: 5000 }, char_mambo: { type: 'coin', cost: 7000 },
  char_niu: { type: 'loot', lootRef: 'loot_thunder_box' },
  char_whale: { type: 'coin', cost: 3200 }, char_penguin: { type: 'coin', cost: 3200 },
};
for (const character of paidSimulation.content.characters.items) {
  if (paidGates[character.id]) character.unlock = paidGates[character.id];
}
const start = Date.parse('2026-11-06T00:00:00Z');

function memoryDatabase() {
  const rows = new Map(), versions = new Map(), state = { failWrite: 0, failCommit: false, conflicts: 0 };
  const document = (table, id, snapshot = rows, staged, reads, seen = versions) => {
    const key = `${table}/${id}`, data = () => structuredClone(staged?.get(key) ?? snapshot.get(key));
    const write = value => { assert.equal(value._id, undefined, 'full writes must strip SDK metadata');
      if (--state.failWrite === 0) throw new Error('private credential detail'); staged.set(key, structuredClone(value)); };
    return { async get() { reads?.set(key, seen.get(key) ?? 0); const value = data(); return { data: value ? { ...value, _id: id } : null }; },
      async set({ data: value }) { write(value); }, async update({ data: value }) { write({ ...data(), ...value }); } };
  };
  const db = { collection: table => ({ doc: id => document(table, id) }), async runTransaction(callback) {
    for (let attempt = 0; attempt < 20; attempt++) {
      const staged = new Map(), reads = new Map(), snapshot = structuredClone(rows), seen = new Map(versions);
      const result = await callback({ collection: table => ({ doc: id => document(table, id, snapshot, staged, reads, seen) }) });
      if (state.failCommit) throw new Error('private commit detail');
      if ([...reads].some(([key, version]) => version !== (versions.get(key) ?? 0))) { state.conflicts++; continue; }
      for (const [key, value] of staged) { rows.set(key, value); versions.set(key, (versions.get(key) ?? 0) + 1); }
      return structuredClone(result);
    }
    throw new Error('conflicts exhausted');
  } };
  return { rows, state, db };
}

function fixture(runtime = paidSimulation, factory) {
  const memory = memoryDatabase(); let time = start, user = 'alice', serial = 0;
  const store = factory ? factory(memory) : createCloudBaseStore({ database: () => memory.db });
  const player = () => playerIdFor('wx-commerce', user);
  const content = initialContent(runtime.content.characters, runtime.themes);
  const call = createProfileHandler({ store, content, getAppId: () => 'wx-commerce',
    getWXContext: () => ({ APPID: 'wx-commerce', OPENID: user }), now: () => new Date(time).toISOString(),
    handleAction: createRunHandler({ store, content, loadSimulation: () => runtime, now: () => time,
      issue: () => ({ runId: `${++serial}`.padStart(43, 'A'), seed: 42 }) }) });
  return { ...memory, call, runtime, player, as: id => { user = id; }, advance: ms => { time += ms; },
    profile: () => memory.rows.get(`${COLLECTION}/${player()}`),
    async market() { const result = await call({ action: 'market.get' }); assert.equal(result.ok, true); return result.market; },
    async buy(offerId, requestId, version) { return call({ action: 'market.buy', offerId, requestId,
      catalogVersion: version ?? (await this.market()).catalogVersion }); },
    async begin() { return (await call({ action: 'run.begin', charId: 'char_volt', rulesId: runtime.rulesId })).ticket; } };
}
const error = result => { assert.equal(result.ok, false); assert.equal(typeof result.error.message, 'string'); return result.error.code; };
const offer = (market, id) => market.offers.find(item => item.id === id);
async function funded(runtime, factory) {
  const f = fixture(runtime, factory); await f.market();
  // Test-only trusted setup, never an API or a real cloud balance mutation.
  f.profile().wallet.coin = 30000; f.profile().inventory.items = { key: 10, shard_ama: 60 };
  return f;
}
const quit = ticket => ({ action: 'run.finish', runId: ticket.runId, frames: 600,
  inputs: [{ frame: 30, action: 'jump' }], finishReason: 'quit' });

async function legacyFreeAccount() {
  const f = await funded(simulation);
  await f.call({ action: 'welfare.get' });
  f.profile().inventory.characters = ['char_volt', 'char_ama', 'char_historical_paid'];
  f.profile().inventory.items.ticket = 3;
  f.profile().preferences = { characterId: 'char_ama', themeId: 'theme_rain_konbini' };
  f.profile().commerce = { once: { old_purchase: true }, daily: { periodId: '2026-11-06', counts: {} } };
  return f;
}

test('production free roster reconciles legacy accounts on market reads, no-op equip/theme and direct run.begin', async () => {
  for (const event of [{ action: 'market.get' }, { action: 'character.equip', characterId: 'char_ama' },
    { action: 'theme.select', themeId: 'theme_rain_konbini' },
    { action: 'run.begin', charId: 'char_penguin', rulesId: simulation.rulesId }]) {
    const f = await legacyFreeAccount(), before = structuredClone(f.profile());
    const response = await f.call(event); assert.equal(response.ok, true, event.action);
    const expected = { ...before, revision: before.revision + 1,
      inventory: { ...before.inventory, characters: [...before.inventory.characters,
        ...simulation.content.characters.items.filter(item => item.id.startsWith('char_') && item.status === 'live'
          && item.unlock.type === 'free' && !before.inventory.characters.includes(item.id)).map(item => item.id)] } };
    assert.deepEqual(f.profile(), expected, event.action);
    const market = await f.market(); assert.ok(market.characters.every(character => character.owned));
    assert.equal(f.profile().revision, expected.revision);
    assert.ok(market.offers.filter(item => item.category === 'character').every(item => !item.canPurchase));
  }
});

test('legacy direct requests cannot charge coin or shards for already-free characters', async () => {
  const f = await legacyFreeAccount(), before = structuredClone(f.rows);
  const version = createCatalog(simulation).version;
  for (const id of ['offer_character_rina', 'offer_character_niu', 'offer_character_bolt', 'unlock_shard_char_ama']) {
    assert.equal(error(await f.buy(id, `free-${id}`, version)), 'ALREADY_OWNED');
    assert.deepEqual(f.rows, before, 'rejected purchases cannot debit or write a receipt');
  }
  const market = await f.market();
  assert.equal(market.characters.length, 10); assert.ok(market.characters.every(character => character.owned));
  assert.deepEqual(f.profile().wallet, before.get(`${COLLECTION}/${f.player()}`).wallet);
  assert.deepEqual(f.profile().inventory.items, before.get(`${COLLECTION}/${f.player()}`).inventory.items);
});

test('free roster migration racing a paid resource exchange preserves credits, limits and preferences', async () => {
  const f = await legacyFreeAccount(), before = structuredClone(f.profile()), version = createCatalog(simulation).version;
  const responses = await Promise.all([f.call({ action: 'profile.get' }), f.call({ action: 'market.get' }),
    f.buy('offer_refill_coin', 'migration-exchange', version)]);
  assert.ok(responses.every(result => result.ok));
  assert.equal(f.profile().wallet.coin, before.wallet.coin + 1500);
  assert.equal(f.profile().inventory.items.key, before.inventory.items.key - 1);
  assert.equal(f.profile().inventory.characters.length, 11);
  assert.deepEqual(f.profile().preferences, before.preferences);
  assert.deepEqual(f.profile().welfare, before.welfare);
  const persisted = structuredClone(f.profile());
  assert.equal((await f.buy('offer_refill_coin', 'migration-exchange', version)).ok, true);
  assert.deepEqual(f.profile(), persisted);
});

test('open-run settlement and confirmed settlement retry reconcile free roles without repeating income', async () => {
  for (const alreadyFinished of [false, true]) {
    const f = await legacyFreeAccount(), ticket = await f.begin(); f.advance(10001);
    const event = quit(ticket);
    if (alreadyFinished) assert.equal((await f.call(event)).ok, true);
    f.profile().inventory.characters = ['char_volt', 'char_ama', 'char_historical_paid'];
    const before = structuredClone(f.profile()), result = await f.call(event);
    assert.equal(result.ok, true); assert.equal(result.profile.inventory.characters.length, 11);
    assert.equal(result.profile.revision, before.revision + 1);
    assert.deepEqual(result.profile.inventory.items, before.inventory.items);
    assert.deepEqual(result.profile.preferences, before.preferences);
    if (alreadyFinished) {
      assert.deepEqual(result.profile.wallet, before.wallet);
      assert.deepEqual(result.profile.stats, before.stats);
    } else {
      assert.equal(result.profile.stats.runs, 1);
      assert.equal(result.profile.wallet.coin, before.wallet.coin + result.profile.stats.coins);
    }
    const persisted = structuredClone(f.profile());
    assert.deepEqual(await f.call(event), result); assert.deepEqual(f.profile(), persisted);
  }
});

test('CommerceSnapshot uses exact DTO fields, live roster, readable inventory and draft theme whitelist', async () => {
  const f = await funded(), market = await f.market();
  assert.deepEqual(Object.keys(market).sort(), ['catalogVersion', 'characters', 'items', 'offers', 'profile', 'themes']);
  assert.deepEqual(Object.keys(market.offers[0]).sort(), ['canPurchase', 'category', 'description', 'grants', 'id',
    'owned', 'price', 'priceText', 'remaining', 'title', 'unavailableReason']);
  assert.deepEqual(Object.keys(market.offers[0].grants[0]).sort(), ['amount', 'item', 'name']);
  assert.equal(market.characters.find(character => character.id === 'char_volt').equipped, true);
  assert.equal(market.characters.filter(character => character.owned).length, 1);
  assert.ok(market.items.some(item => item.id === 'shard_ama' && item.name === '阿玛拉碎片'));
  assert.ok(market.themes.some(theme => theme.id === 'theme_rain_konbini'));
  for (const id of ['offer_xp_card', 'offer_skin_bolt_storm']) {
    assert.equal(offer(market, id).canPurchase, false); assert.ok(offer(market, id).unavailableReason);
    assert.equal(error(await f.buy(id, id)), 'OFFER_UNAVAILABLE');
  }
  for (const [id, cost] of [['rina', 9000], ['niu', 9000], ['bolt', 12000]]) {
    assert.equal(offer(market, `offer_character_${id}`).price.coin, cost);
  }
});

test('coin unlock and shard exchange grant once, retain welfare, and never charge an owned character', async () => {
  const f = await funded(); await f.call({ action: 'welfare.get' });
  const privateWelfare = structuredClone(f.profile().welfare), revision = f.profile().revision;
  const result = await f.buy('unlock_coin_char_ama', 'coin-unlock'); assert.equal(result.ok, true);
  assert.equal(result.market.profile.wallet.coin, 25500); assert.ok(result.market.profile.inventory.characters.includes('char_ama'));
  assert.equal(result.market.profile.revision, revision + 1); assert.equal(result.market.profile.welfare, undefined);
  assert.deepEqual(f.profile().welfare, privateWelfare); assert.equal(f.profile()._id, undefined);
  assert.equal(result.market.profile.commerce, undefined);
  assert.equal(error(await f.buy('unlock_shard_char_ama', 'already-owned')), 'ALREADY_OWNED');
  f.profile().inventory.items.shard_kaze = 60;
  const shard = await f.buy('unlock_shard_char_kaze', 'shard-unlock'); assert.equal(shard.ok, true);
  assert.equal(shard.market.profile.inventory.items.shard_kaze, 0);
  assert.ok(shard.market.profile.inventory.characters.includes('char_kaze'));
  assert.ok(!shard.market.items.some(item => item.id === 'shard_kaze'));
});

test('key-for-coins and coin-for-shards follow configured daily caps and keep a single Beijing day bucket', async () => {
  const f = await funded();
  for (let i = 0; i < 5; i++) assert.equal((await f.buy('offer_refill_coin', `day-${i}`)).ok, true);
  assert.equal(f.profile().wallet.coin, 37500); assert.equal(f.profile().inventory.items.key, 5);
  assert.equal(error(await f.buy('offer_refill_coin', 'day-limit')), 'PURCHASE_LIMIT');
  assert.equal(offer(await f.market(), 'offer_refill_coin').remaining, 0);
  const version = (await f.market()).catalogVersion, revision = f.profile().revision;
  f.advance(16 * 60 * 60 * 1000 + 1); assert.equal(offer(await f.market(), 'offer_refill_coin').remaining, 5);
  assert.equal(f.profile().revision, revision);
  assert.equal((await f.buy('offer_refill_coin', 'next-day', version)).ok, true);
  assert.deepEqual(f.profile().commerce.daily, { periodId: '2026-11-07', counts: { offer_refill_coin: 1 } });
  assert.equal((await f.buy('offer_shard_volt', 'buy-shards')).ok, true);
  assert.equal(f.profile().inventory.items.shard_volt, 5);
});

test('角色已拥有后的碎片仍能按配置回收金币，购买再回收没有套利', async () => {
  const f = await funded(), before = f.profile().wallet.coin;
  const rates = simulation.economy.params.shop.shardRecycling;
  await f.buy('offer_shard_volt', 'buy-volt-material');
  const exchange = await f.buy('recycle_shard_volt', 'recycle-material');
  assert.equal(exchange.ok, true);
  assert.equal(f.profile().inventory.items.shard_volt, 0);
  assert.equal(f.profile().wallet.coin, before - 600 + rates.coin);
  assert.ok(f.profile().wallet.coin < before);
  assert.equal(error(await f.buy('recycle_shard_volt', 'empty-material')), 'INSUFFICIENT_FUNDS');
});

test('免费手册钻石可按配置换金币，重复交易不重复消耗', async () => {
  const f = await funded(); f.profile().wallet.diamond = 10;
  const configured = simulation.economy.params.shop.offers.find(item => item.id === 'offer_diamond_coin');
  const before = f.profile().wallet.coin;
  const result = await f.buy(configured.id, 'handbook-diamond');
  assert.equal(result.ok, true);
  assert.equal(result.market.profile.wallet.diamond, 10 - configured.price.diamond);
  assert.equal(result.market.profile.wallet.coin, before + configured.give[0].n);
  await f.buy(configured.id, 'handbook-diamond');
  assert.equal(f.profile().wallet.diamond, 10 - configured.price.diamond);
});

test('insufficient funds, stale quote and caller-supplied price/grants/identity cannot write', async () => {
  const f = fixture(), market = await f.market(), before = structuredClone(f.rows);
  assert.equal(error(await f.buy('unlock_coin_char_ama', 'poor')), 'INSUFFICIENT_FUNDS');
  assert.equal(error(await f.buy('unlock_coin_char_ama', 'old', 'old-version')), 'CATALOG_CHANGED');
  for (const extra of [{ price: { coin: 0 } }, { grants: [{ item: 'coin', amount: 999 }] }, { openid: 'bob' }]) {
    assert.equal(error(await f.call({ action: 'market.buy', offerId: 'offer_refill_coin', requestId: 'forged',
      catalogVersion: market.catalogVersion, ...extra })), 'INVALID_REQUEST');
  }
  assert.deepEqual(f.rows, before);
});

test('concurrent same request commits once; a changed body conflicts, original receipt survives repricing/removal', async () => {
  const runtime = { ...paidSimulation, economy: structuredClone(simulation.economy) }, f = await funded(runtime);
  const version = (await f.market()).catalogVersion, revision = f.profile().revision;
  const results = await Promise.all(Array.from({ length: 8 }, () => f.buy('offer_refill_coin', 'confirmed-request', version)));
  assert.ok(results.every(result => result.ok)); assert.ok(f.state.conflicts > 0);
  assert.equal(f.profile().wallet.coin, 31500); assert.equal(f.profile().inventory.items.key, 9);
  assert.equal(f.profile().revision, revision + 1);
  assert.equal([...f.rows.keys()].filter(key => key.startsWith(`${PURCHASES}/`)).length, 1);
  assert.equal(error(await f.buy('offer_shard_volt', 'confirmed-request', version)), 'PURCHASE_CONFLICT');
  runtime.economy.params.shop.offers.find(item => item.id === 'offer_refill_coin').price.key = 2;
  const updatedVersion = (await f.market()).catalogVersion; assert.notEqual(updatedVersion, version);
  assert.equal(error(await f.buy('offer_refill_coin', 'confirmed-request', updatedVersion)), 'PURCHASE_CONFLICT');
  assert.equal(error(await f.buy('offer_refill_coin', 'new-stale', version)), 'CATALOG_CHANGED');
  assert.equal((await f.buy('offer_refill_coin', 'confirmed-request', version)).ok, true);
  runtime.economy.params.shop.offers = runtime.economy.params.shop.offers.filter(item => item.id !== 'offer_refill_coin');
  assert.equal((await f.buy('offer_refill_coin', 'confirmed-request', version)).ok, true);
  assert.equal(f.profile().wallet.coin, 31500); assert.equal(f.profile().revision, revision + 1);
});

test('once offers and simultaneous different requests cannot overspend or bypass caps', async () => {
  const runtime = { ...paidSimulation, economy: structuredClone(simulation.economy) };
  runtime.economy.params.shop.offers.push({ id: 'test_once_key', give: [{ item: 'key', n: 1 }], price: { coin: 1 }, limit: { once: true } });
  const f = await funded(runtime); assert.equal((await f.buy('test_once_key', 'once')).ok, true);
  assert.equal(error(await f.buy('test_once_key', 'twice')), 'PURCHASE_LIMIT');
  f.profile().wallet.coin = 600;
  const results = await Promise.all(['one', 'two'].map(id => f.buy('offer_shard_volt', id)));
  assert.equal(results.filter(result => result.ok).length, 1);
  assert.equal(f.profile().wallet.coin, 0); assert.equal(f.profile().inventory.items.shard_volt, 5);
});

test('same requestId in another player has a different receipt and charges only that player', async () => {
  const f = await funded(); await f.buy('offer_shard_volt', 'same-request'); const alice = f.player();
  f.as('bob'); await f.market(); f.profile().wallet.coin = 1000;
  assert.equal((await f.buy('offer_shard_volt', 'same-request')).ok, true);
  assert.equal(f.profile().wallet.coin, 400);
  assert.notEqual(receiptIdFor(alice, 'same-request'), receiptIdFor(f.player(), 'same-request'));
  assert.equal([...f.rows.keys()].filter(key => key.startsWith(`${PURCHASES}/`)).length, 2);
});

test('different concurrent ids cannot buy the same character twice or exceed the last daily slot', async () => {
  const f = await funded();
  const unlocks = await Promise.all(['unlock-a', 'unlock-b'].map(id => f.buy('unlock_coin_char_ama', id)));
  assert.equal(unlocks.filter(result => result.ok).length, 1);
  assert.equal(error(unlocks.find(result => !result.ok)), 'ALREADY_OWNED');
  assert.equal(f.profile().wallet.coin, 25500);
  assert.equal(f.profile().inventory.characters.filter(id => id === 'char_ama').length, 1);
  for (let i = 0; i < 4; i++) await f.buy('offer_refill_coin', `before-limit-${i}`);
  const last = await Promise.all(['limit-a', 'limit-b'].map(id => f.buy('offer_refill_coin', id)));
  assert.equal(last.filter(result => result.ok).length, 1);
  assert.equal(error(last.find(result => !result.ok)), 'PURCHASE_LIMIT');
});

test('equip and theme selection enforce owned/live and configured nonretired themes; no-ops do not bump revision', async () => {
  const f = await funded();
  assert.equal(error(await f.call({ action: 'character.equip', characterId: 'char_ama' })), 'CHARACTER_NOT_OWNED');
  assert.equal(error(await f.call({ action: 'character.equip', characterId: 'skin_volt_default' })), 'INVALID_CHARACTER');
  await f.buy('unlock_coin_char_ama', 'equip-buy');
  const revision = f.profile().revision;
  assert.equal((await f.call({ action: 'character.equip', characterId: 'char_ama' })).market.profile.revision, revision + 1);
  assert.equal((await f.call({ action: 'character.equip', characterId: 'char_ama' })).market.profile.revision, revision + 1);
  assert.equal((await f.market()).characters.find(character => character.id === 'char_ama').equipped, true);
  assert.equal((await f.call({ action: 'theme.select', themeId: 'theme_rain_konbini' })).ok, true);
  const selectedRevision = f.profile().revision;
  assert.equal((await f.call({ action: 'theme.select', themeId: 'theme_rain_konbini' })).market.profile.revision, selectedRevision);
  assert.equal(error(await f.call({ action: 'theme.select', themeId: 'unknown' })), 'INVALID_THEME');
  assert.equal((await f.call({ action: 'profile.get' })).profile.preferences.themeId, 'theme_rain_konbini');
});

test('failed receipt/profile write or commit rolls back debit, grant, limits, revision and receipt', async () => {
  for (const failure of ['receipt', 'profile', 'commit']) {
    const f = await funded(), version = (await f.market()).catalogVersion, before = structuredClone(f.rows);
    if (failure === 'commit') f.state.failCommit = true; else f.state.failWrite = failure === 'receipt' ? 1 : 2;
    const result = await f.buy('unlock_coin_char_ama', 'failed', version);
    assert.equal(error(result), 'MARKET_UNAVAILABLE'); assert.ok(!JSON.stringify(result).includes('private'));
    assert.deepEqual(f.rows, before); f.state.failCommit = false; f.state.failWrite = 0;
    assert.equal((await f.buy('unlock_coin_char_ama', 'failed', version)).ok, true);
  }
});

test('retired characters and themes remain unavailable even if an old profile owns/selects them', async () => {
  const runtime = { ...paidSimulation, content: structuredClone(paidSimulation.content), themes: structuredClone(simulation.themes) };
  runtime.content.characters.items.find(item => item.id === 'char_ama').status = 'retired';
  runtime.themes.items.find(theme => theme.id === 'theme_rain_konbini').status = 'retired';
  const f = await funded(runtime); f.profile().inventory.characters.push('char_ama');
  assert.equal(error(await f.call({ action: 'character.equip', characterId: 'char_ama' })), 'INVALID_CHARACTER');
  assert.equal(error(await f.call({ action: 'theme.select', themeId: 'theme_rain_konbini' })), 'INVALID_THEME');
  const market = await f.market(); assert.ok(!market.characters.some(character => character.id === 'char_ama'));
  assert.ok(!market.themes.some(theme => theme.id === 'theme_rain_konbini'));
});

test('buy races handbook claim and another real quit settlement without losing income or private welfare', async () => {
  const f = await funded(), first = await f.begin(); f.advance(10001);
  const initialRun = await f.call(quit(first)); assert.equal(initialRun.ok, true);
  const earned = initialRun.profile.wallet.coin - 30000, before = f.profile().revision;
  const second = await f.begin(); f.advance(10001);
  const results = await Promise.all([f.buy('unlock_coin_char_ama', 'race-buy'),
    f.call({ action: 'handbook.claim', chapterId: 'hb_first_run' }), f.call(quit(second))]);
  assert.ok(results.every(result => result.ok)); assert.equal(f.profile().wallet.coin, 30000 + earned * 2 + 200 - 4500);
  assert.equal(f.profile().revision, before + 3); assert.equal(f.profile().stats.runs, 2);
  assert.equal(f.profile().welfare.handbook.claimed.hb_first_run, true);
});

const sdkPath = new URL('../cloudfunctions/thunder-api/node_modules/wx-server-sdk', import.meta.url);
test('real SDK transaction wrappers accept the purchase adapter with isolated transport, not native cloud IO',
  { skip: !existsSync(sdkPath) && 'Install the cloud function SDK dependencies first' }, async () => {
    const sdk = require('../cloudfunctions/thunder-api/node_modules/wx-server-sdk');
    const db = sdk.createNewInstance({ env: 'local-contract-only' }).database({ throwOnNotFound: false });
    const f = await funded(paidSimulation, memory => {
      db._db.runTransaction = callback => memory.db.runTransaction(tx => callback({ collection: table => ({ doc(id) {
        const doc = tx.collection(table).doc(id);
        return { get: () => doc.get(), set: data => doc.set({ data }).then(() => ({ updated: 1 })) };
      } }) }));
      return createCloudBaseStore({ database: () => db });
    });
    const response = await f.buy('unlock_coin_char_ama', 'sdk-adapter');
    assert.equal(response.ok, true); assert.equal(response.market.profile.wallet.coin, 25500);
  assert.equal(f.profile()._id, undefined);
});

test('WX商店客户端贯通云入口、交易与重连出战/主题；限购拒绝不会留下未明交易循环', async () => {
  const f = await funded(), cache = new Map(), calls = [];
  const storage = { get: key => cache.get(key) ?? null, set: (key, value) => cache.set(key, value), remove: key => cache.delete(key) };
  const wx = { cloud: { init() {}, async callFunction({ data }) {
    calls.push(data); return { result: await f.call({ ...data, userInfo: { openId: 'ignored' } }) };
  } } };
  const config = { envId: 'local-test-only', functionName: 'thunder-api' };
  const client = await connectWxCloud(wx, config, storage);
  const catalog = await client.commerce.load();
  await client.commerce.buy('unlock_coin_char_ama', 'client-purchase', catalog.catalogVersion);
  await client.commerce.equip('char_ama'); await client.commerce.selectTheme('theme_rain_konbini');
  const reconnected = await connectWxCloud(wx, config, storage);
  assert.equal(reconnected.read().wallet.coin, 25500);
  assert.deepEqual(reconnected.read().preferences, { characterId: 'char_ama', themeId: 'theme_rain_konbini' });
  for (let i = 0; i < 5; i++) await reconnected.commerce.buy('offer_refill_coin', `client-refill-${i}`, catalog.catalogVersion);
  await assert.rejects(reconnected.commerce.buy('offer_refill_coin', 'client-over-limit', catalog.catalogVersion), { code: 'PURCHASE_LIMIT' });
  assert.equal(cache.size, 0, 'a definite daily cap rejection is not an unresolved debit');
  await reconnected.commerce.load(); assert.equal(calls.at(-1).action, 'market.get');
});
