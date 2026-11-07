import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { buyOffer, consumeEquipped, walletBalance } from '../packages/game/dist/flow/localEconomy.js';
import { buildShopCatalog } from '../packages/game/dist/ui/shopCatalog.js';

const names = ['game', 'characters', 'skills', 'items', 'obstacles', 'themes', 'events', 'economy'];
const content = Object.fromEntries(names.map(name => [name,
  JSON.parse(readFileSync(new URL(`../config/${name}.json`, import.meta.url), 'utf8'))]));
function store(initial = {}) {
  const values = new Map(Object.entries(initial));
  return { values, get: key => values.get(key) ?? null, set: (key, value) => values.set(key, value), remove: key => values.delete(key) };
}

test('unimplemented experience cards cannot be bought or consumed, including saved equipment', () => {
  const s = store({
    'thunderrun:coins-total': '2400', 'thunderrun:item:item_xp_card': '2',
    'thunderrun:item:item_helmet': '1',
    'thunderrun:equipped': JSON.stringify(['item_xp_card', 'item_helmet', 'item_helmet']),
  });
  const before = [...s.values];
  assert.deepEqual(buyOffer(s, content, 'offer_xp_card', new Date()), { ok: false, message: '道具未开放' });
  assert.deepEqual([...s.values], before, 'no charge, grant, equipment, or limit mutation');
  assert.equal(buildShopCatalog(content).find(offer => offer.id === 'offer_xp_card').statusText, '待开放');
  assert.deepEqual(consumeEquipped(s, content), ['item_helmet']);
  assert.equal(walletBalance(s, 'item_xp_card'), 2, 'previously obtained cards remain in inventory');
  assert.equal(walletBalance(s, 'item_helmet'), 0, 'supported equipment is consumed only once');
});

test('shop daily limits reset at the device-local midnight under UTC, Shanghai, and Los Angeles', () => {
  const moduleUrl = new URL('../packages/game/dist/flow/localEconomy.js', import.meta.url).href;
  const script = `
    import assert from 'node:assert/strict';
    import { buyOffer } from ${JSON.stringify(moduleUrl)};
    const content = ${JSON.stringify(content)};
    const values = new Map([['thunderrun:coins-total', '12000']]);
    const store = { get: k => values.get(k) ?? null, set: (k, v) => values.set(k, v), remove: k => values.delete(k) };
    for (let i = 0; i < 5; i++) assert.equal(buyOffer(store, content, 'offer_shard_volt', new Date(2026, 10, 5, 12)).ok, true);
    assert.equal(buyOffer(store, content, 'offer_shard_volt', new Date(2026, 10, 5, 23, 59, 59)).ok, false);
    assert.equal(buyOffer(store, content, 'offer_shard_volt', new Date(2026, 10, 6, 0, 0, 1)).ok, true);
    assert.equal(values.get('thunderrun:shop-limit:offer_shard_volt:2026-11-05'), '5');
    assert.equal(values.get('thunderrun:shop-limit:offer_shard_volt:2026-11-06'), '1');
  `;
  for (const TZ of ['UTC', 'Asia/Shanghai', 'America/Los_Angeles']) {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      env: { ...process.env, TZ }, encoding: 'utf8', timeout: 10000,
    });
    assert.equal(result.status, 0, `${TZ}: ${result.stderr || result.error || result.stdout}`);
  }
});
