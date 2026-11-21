import test from 'node:test';
import assert from 'node:assert/strict';
import { connectWxCloud } from '../apps/wx/build/platform/cloudClient.js';
import { parseCommerceSnapshot } from '../apps/wx/build/platform/commerceProtocol.js';
import { createWxStorage } from '../apps/wx/build/platform/storage.js';

const config = { envId: 'isolated-commerce', functionName: 'thunder-api' };
const profile = () => ({ schemaVersion: 1, revision: 0, playerId: `p_${'a'.repeat(64)}`,
  wallet: { coin: 5000, diamond: 0 }, inventory: { characters: ['char_volt'], items: { key: 2 } },
  preferences: { characterId: 'char_volt', themeId: 'theme_seaside_day' },
  createdAt: '2026-11-06T00:00:00.000Z', updatedAt: '2026-11-06T00:00:00.000Z' });
function market(p = profile()) {
  return { profile: p, catalogVersion: 'market-v1',
    offers: [{ id: 'ama', category: 'character', title: '阿玛拉', description: '解锁角色',
      price: { coin: 4500 }, priceText: '金币 ×4500', grants: [{ item: 'char_ama', name: '阿玛拉', amount: 1 }],
      remaining: 1, owned: false, canPurchase: true, unavailableReason: null }],
    characters: [{ id: 'char_volt', name: '牢大', tagline: '跑酷伙伴', rarity: 'R', owned: true, equipped: p.preferences.characterId === 'char_volt' },
      { id: 'char_ama', name: '阿玛拉', tagline: '跑酷伙伴', rarity: 'SR', owned: p.inventory.characters.includes('char_ama'), equipped: p.preferences.characterId === 'char_ama' }],
    items: [{ id: 'key', name: '钥匙', amount: p.inventory.items.key }],
    themes: [{ id: 'theme_seaside_day', name: '白日海景', selected: p.preferences.themeId === 'theme_seaside_day' },
      { id: 'theme_rain_konbini', name: '雨夜便利店', selected: p.preferences.themeId === 'theme_rain_konbini' }] };
}
function storageFixture() {
  const values = new Map();
  return { values, get: key => values.get(key) ?? null, set: (key, value) => values.set(key, value), remove: key => values.delete(key) };
}
function transport(handler) {
  const calls = [];
  return { calls, wx: { cloud: { init() {}, async callFunction({ name, data }) {
    assert.equal(name, config.functionName); calls.push(data); return { result: await handler(data) };
  } } } };
}

test('商店请求仅发送服务端报价标识；确认返回后统一钱包、角色和主题快照才更新', async () => {
  const p = profile();
  const f = transport(data => {
    if (data.action === 'profile.get') return { ok: true, profile: structuredClone(p) };
    if (data.action === 'market.buy') { p.revision++; p.wallet.coin -= 4500; p.inventory.characters.push('char_ama'); }
    if (data.action === 'character.equip') { p.revision++; p.preferences.characterId = data.characterId; }
    if (data.action === 'theme.select') { p.revision++; p.preferences.themeId = data.themeId; }
    return { ok: true, market: market(structuredClone(p)) };
  });
  const store = storageFixture(), client = await connectWxCloud(f.wx, config, store);
  assert.equal((await client.commerce.load()).catalogVersion, 'market-v1');
  const id = client.commerce.newRequestId(); assert.notEqual(id, client.commerce.newRequestId());
  await client.commerce.buy('ama', id, 'market-v1');
  assert.deepEqual(f.calls.at(-1), { action: 'market.buy', offerId: 'ama', requestId: id, catalogVersion: 'market-v1' });
  assert.equal(client.read().wallet.coin, 500); assert.ok(client.read().inventory.characters.includes('char_ama'));
  assert.equal(store.values.size, 0);
  await client.commerce.equip('char_ama'); assert.equal(client.read().preferences.characterId, 'char_ama');
  assert.deepEqual(f.calls.at(-1), { action: 'character.equip', characterId: 'char_ama' });
  await client.commerce.selectTheme('theme_rain_konbini');
  assert.equal(client.read().preferences.themeId, 'theme_rain_konbini');
});

test('购买响应丢失后持久保存原三元组，重建连接再进商店仍只重试原交易', async () => {
  const p = profile(), store = storageFixture(); let charged = 0, lost = true;
  const receipts = new Map();
  const f = transport(data => {
    if (data.action === 'profile.get') return { ok: true, profile: structuredClone(p) };
    if (data.action === 'market.buy') {
      if (!receipts.has(data.requestId)) { charged++; p.revision++; p.wallet.coin -= 4500; p.inventory.characters.push('char_ama'); receipts.set(data.requestId, true); }
      if (lost) { lost = false; throw Error('response lost after commit'); }
    }
    return { ok: true, market: market(structuredClone(p)) };
  });
  const first = await connectWxCloud(f.wx, config, store);
  await assert.rejects(first.commerce.buy('ama', 'confirmed-order', 'market-v1'), { code: 'NETWORK_UNAVAILABLE' });
  assert.equal(first.read().wallet.coin, 5000); assert.equal(store.values.size, 1);
  await assert.rejects(first.commerce.buy('other', 'other-order', 'market-v1'), { code: 'PENDING_PURCHASE' });
  const second = await connectWxCloud(f.wx, config, store);
  await second.commerce.load();
  assert.equal(charged, 1); assert.equal(second.read().wallet.coin, 500); assert.equal(store.values.size, 0);
  const buys = f.calls.filter(c => c.action === 'market.buy');
  assert.equal(buys.length, 2); assert.deepEqual(buys[0], buys[1]);
});

test('同一购买连点共享请求；确定拒绝后可刷新新报价，不自动按新报价买', async () => {
  const store = storageFixture(); let finish, tries = 0;
  const f = transport(data => {
    if (data.action === 'profile.get') return { ok: true, profile: profile() };
    if (data.action === 'market.buy') { tries++; return new Promise(resolve => { finish = resolve; }); }
    return { ok: true, market: market() };
  });
  const client = await connectWxCloud(f.wx, config, store);
  const a = client.commerce.buy('ama', 'order-1', 'old');
  const b = client.commerce.buy('ama', 'order-1', 'old');
  assert.equal(tries, 1);
  finish({ ok: false, error: { code: 'CATALOG_CHANGED', message: '报价已更新' } });
  for (const result of await Promise.allSettled([a, b])) { assert.equal(result.status, 'rejected'); assert.equal(result.reason.code, 'CATALOG_CHANGED'); }
  assert.equal(store.values.size, 0);
  await client.commerce.load(); assert.equal(f.calls.at(-1).action, 'market.get'); assert.equal(tries, 1);
});

test('未确认交易按环境和玩家隔离；坏报价不会被当成成功交易', async () => {
  const store = storageFixture();
  const f = transport(data => data.action === 'profile.get' ? { ok: true, profile: profile() } : Promise.reject(Error('offline')));
  const a = await connectWxCloud(f.wx, config, store);
  await assert.rejects(a.commerce.buy('ama', 'order-1', 'market-v1'));
  const secondCalls = [];
  const b = transport(data => { secondCalls.push(data); return data.action === 'profile.get'
    ? { ok: true, profile: { ...profile(), playerId: `p_${'b'.repeat(64)}` } }
    : { ok: true, market: market({ ...profile(), playerId: `p_${'b'.repeat(64)}` }) }; });
  const other = await connectWxCloud(b.wx, config, store); await other.commerce.load();
  assert.equal(secondCalls.at(-1).action, 'market.get'); assert.equal(store.values.size, 1);
  const otherEnv = transport(data => data.action === 'profile.get'
    ? { ok: true, profile: profile() } : { ok: true, market: market() });
  const isolated = await connectWxCloud(otherEnv.wx, { ...config, envId: 'another-env' }, store);
  await isolated.commerce.load(); assert.equal(otherEnv.calls.at(-1).action, 'market.get');
  const malformed = market(); malformed.offers[0].price.coin = -1;
  assert.throws(() => parseCommerceSnapshot(malformed), { code: 'INVALID_RESPONSE' });
});

test('真实WX适配的严格交易存储失败会中止购买，不向云端发送扣款请求', async () => {
  const f = transport(data => data.action === 'profile.get'
    ? { ok: true, profile: profile() } : { ok: true, market: market() });
  const raw = { getStorageSync: () => '', setStorageSync: () => { throw Error('quota full'); }, removeStorageSync() {} };
  assert.doesNotThrow(() => createWxStorage(raw).set('ordinary-cache', 'value'), 'ordinary caches keep legacy best-effort semantics');
  const client = await connectWxCloud(f.wx, config, createWxStorage(raw, { strict: true }));
  await assert.rejects(client.commerce.buy('ama', 'not-durable', 'market-v1'), { code: 'PURCHASE_NOT_SAVED' });
  assert.equal(f.calls.filter(call => call.action === 'market.buy').length, 0);
  assert.equal(client.read().wallet.coin, 5000);
  const badRead = { ...raw, getStorageSync: () => { throw Error('storage unavailable'); } };
  await assert.rejects(connectWxCloud(f.wx, config, createWxStorage(badRead, { strict: true })), /storage unavailable/);
  assert.equal(f.calls.filter(call => call.action === 'market.buy').length, 0);
});
