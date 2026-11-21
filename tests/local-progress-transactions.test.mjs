import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRewardWalletStore, REWARD_WALLET_KEY } from '@tr/game/flow/missionRewardWallet.js';
import { buyOffer, shopActions, spend, walletBalance, equippedItems, COINS_KEY, DIAMOND_KEY, EQUIP_KEY } from '@tr/game/flow/localEconomy.js';
import { renameLocalProfile } from '@tr/game/flow/localProfileActions.js';
import { loadProfile, profileParamsFrom, PLAYER_ID_KEY, PLAYER_NAME_KEY, PLAYER_RENAMES_KEY } from '@tr/game/core/profile/playerProfile.js';

const content = Object.fromEntries(['game','characters','skills','items','economy','events','themes','obstacles'].map(name =>
  [name, JSON.parse(readFileSync(new URL(`../config/${name}.json`, import.meta.url), 'utf8'))]));
const params = profileParamsFrom(content.game.params.profile);
const date = new Date(2026, 10, 11, 12);
const helmetContent = structuredClone(content);
helmetContent.economy.params.shop.offers.push({ id: 'offer_helmet_test', price: { coin: 100, diamond: 10 },
  give: [{ item: 'item_helmet', n: 1 }], limit: { once: true } });

function fixture(initial = {}) {
  const data = new Map(Object.entries(initial)), writes = [];
  let failure = '';
  const storage = { get: key => data.get(key) ?? null, remove: key => data.delete(key), set(key, value) {
    writes.push(key);
    if (key === REWARD_WALLET_KEY && failure) {
      if (failure === 'throw') throw new Error('quota');
      return;
    }
    data.set(key, value);
  } };
  return { data, writes, storage, wallet: createRewardWalletStore(storage), fail: mode => { failure = mode; } };
}

test('one purchase commits every price, grant, limit and equipment in one canonical write', () => {
  const f = fixture({ [COINS_KEY]: '200', [DIAMOND_KEY]: '40', [EQUIP_KEY]: '[]' });
  assert.deepEqual(buyOffer(f.wallet, helmetContent, 'offer_helmet_test', date), { ok: true, message: '购买成功，已装备到下一局' });
  assert.deepEqual(f.writes, [REWARD_WALLET_KEY]);
  const restored = createRewardWalletStore(f.storage);
  assert.equal(walletBalance(restored, 'coin'), 100); assert.equal(walletBalance(restored, 'diamond'), 30);
  assert.equal(walletBalance(restored, 'item_helmet'), 1);
  assert.deepEqual(equippedItems(restored), ['item_helmet']);
  assert.equal(restored.get('thunderrun:shop-once:offer_helmet_test'), '1');
  const saved = f.data.get(REWARD_WALLET_KEY);
  assert.equal(buyOffer(restored, helmetContent, 'offer_helmet_test', date).ok, false);
  assert.equal(f.data.get(REWARD_WALLET_KEY), saved, 'a rejected repeat must neither charge nor rewrite progress');
  assert.equal(f.data.get(COINS_KEY), '200', 'preserve legacy inputs instead of destructively migrating them');
});

for (const mode of ['throw', 'silent']) {
  test(`purchase persistence ${mode} leaves all effects untouched and succeeds once on retry`, () => {
    const f = fixture({ [COINS_KEY]: '200', [DIAMOND_KEY]: '40', [EQUIP_KEY]: '[]' });
    const before = [...f.data]; f.fail(mode);
    const result = shopActions(f.wallet, helmetContent, () => {}).onBuy('offer_helmet_test');
    assert.equal(result.ok, false); assert.match(result.message, /购买未完成/);
    assert.deepEqual([...f.data], before);
    assert.equal(walletBalance(f.wallet, 'item_helmet'), 0); assert.deepEqual(equippedItems(f.wallet), []);
    assert.equal(f.wallet.get('thunderrun:shop-once:offer_helmet_test'), null);
    f.fail(''); assert.equal(buyOffer(f.wallet, helmetContent, 'offer_helmet_test', date).ok, true);
    assert.equal(walletBalance(f.wallet, 'coin'), 100); assert.equal(walletBalance(f.wallet, 'item_helmet'), 1);
  });
  test(`rename persistence ${mode} cannot consume a free-use count or price without the new name`, () => {
    const f = fixture({ [PLAYER_ID_KEY]: '1234567890', [PLAYER_NAME_KEY]: '小跑者',
      [PLAYER_RENAMES_KEY]: '1', [DIAMOND_KEY]: '60' });
    const profile = loadProfile(f.wallet, params), before = [...f.data]; f.fail(mode);
    assert.throws(() => renameLocalProfile(f.wallet, profile, params, '闪电少年'));
    assert.deepEqual([...f.data], before);
    assert.equal(f.wallet.get(PLAYER_NAME_KEY), '小跑者'); assert.equal(f.wallet.get(PLAYER_RENAMES_KEY), '1');
    assert.equal(walletBalance(f.wallet, 'diamond'), 60);
    f.fail(''); const result = renameLocalProfile(f.wallet, profile, params, '闪电少年');
    assert.equal(result.ok, true); assert.equal(result.diamondsLeft, 40);
    const restored = createRewardWalletStore(f.storage);
    assert.equal(loadProfile(restored, params).name, '闪电少年');
    assert.equal(loadProfile(restored, params).renames, 2);
    assert.equal(walletBalance(restored, 'diamond'), 40);
    assert.equal(f.data.get(PLAYER_NAME_KEY), '小跑者', 'original profile keys remain available as migration inputs');
  });
}

test('multi-currency spending is one write and unrelated preferences keep their original storage', () => {
  const f = fixture({ [COINS_KEY]: '200', [DIAMOND_KEY]: '40' });
  assert.equal(spend(f.wallet, { coin: 20, diamond: 5 }), true);
  assert.deepEqual(f.writes, [REWARD_WALLET_KEY]);
  f.wallet.set('thunderrun:theme', 'theme_seaside_day');
  assert.equal(f.data.get('thunderrun:theme'), 'theme_seaside_day');
  const before = [...f.data];
  assert.throws(() => f.wallet.transaction(draft => { draft.set(COINS_KEY, '0'); draft.set('thunderrun:theme', 'x'); }), /不属于/);
  assert.deepEqual([...f.data], before, 'invalid draft scope cannot leak its earlier staged deduction');
});

test('reward import preserves local progress and its high-water marks across a purchase and reload', () => {
  const f = fixture({ [COINS_KEY]: '200', [DIAMOND_KEY]: '40' });
  buyOffer(f.wallet, helmetContent, 'offer_helmet_test', date);
  const reward = { rewardLedgerId: 'same-account', wallet: { coin: 30, diamond: 5 } };
  f.wallet.syncRewards(reward); spend(f.wallet, { coin: 30, diamond: 5 });
  const restored = createRewardWalletStore(f.storage); restored.syncRewards(reward);
  assert.equal(walletBalance(restored, 'coin'), 100); assert.equal(walletBalance(restored, 'diamond'), 30);
  assert.equal(restored.get('thunderrun:shop-once:offer_helmet_test'), '1');
  assert.deepEqual(equippedItems(restored), ['item_helmet']);
});

test('old v1 wallets remain readable; invalid new local metadata fails closed', () => {
  const f = fixture();
  f.data.set(REWARD_WALLET_KEY, JSON.stringify({ version: 1, values: { [COINS_KEY]: '50' }, ledgers: {} }));
  assert.equal(walletBalance(f.wallet, 'coin'), 50);
  const malformed = JSON.stringify({ version: 1, values: {}, ledgers: {}, local: { unrelated: 'x' } });
  f.data.set(REWARD_WALLET_KEY, malformed);
  assert.throws(() => f.wallet.get(PLAYER_NAME_KEY), /损坏/);
  assert.equal(f.data.get(REWARD_WALLET_KEY), malformed);
});

test('currency purchases do not claim that a non-equipment reward was equipped', () => {
  const f = fixture({ [COINS_KEY]: '1200' });
  assert.equal(buyOffer(f.wallet, content, 'offer_shard_volt', date).message, '购买成功，已存入背包');
  assert.equal(walletBalance(f.wallet, 'shard_volt'), 5);
});
