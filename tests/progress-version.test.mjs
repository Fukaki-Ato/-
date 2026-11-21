import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRewardWalletStore, REWARD_WALLET_KEY } from '@tr/game/flow/missionRewardWallet.js';
import { renameLocalProfile } from '@tr/game/flow/localProfileActions.js';
import { buyOffer, spend, walletBalance, COINS_KEY, DIAMOND_KEY } from '@tr/game/flow/localEconomy.js';
import { loadProfile, profileParamsFrom, PLAYER_ID_KEY, PLAYER_NAME_KEY, PLAYER_RENAMES_KEY } from '@tr/game/core/profile/playerProfile.js';
import { importWebModule } from './dom-fixture.mjs';

const legacy = await importWebModule('./fixtures/reward-wallet-38d5116.ts');
const content = Object.fromEntries(['game','characters','skills','items','economy','events','themes','obstacles'].map(name =>
  [name, JSON.parse(readFileSync(new URL(`../config/${name}.json`, import.meta.url), 'utf8'))]));
const params = profileParamsFrom(content.game.params.profile);
function fixture() {
  const data = new Map([[PLAYER_ID_KEY, '1234567890'], [PLAYER_NAME_KEY, '小跑者'], [PLAYER_RENAMES_KEY, '1'],
    [COINS_KEY, '1200'], [DIAMOND_KEY, '60']]);
  const storage = { get: key => data.get(key) ?? null, set: (key, value) => data.set(key, value), remove: key => data.delete(key) };
  return { data, storage, wallet: createRewardWalletStore(storage) };
}

test('new local metadata makes the published legacy wallet reject financial writes instead of using stale profile keys', t => {
  const f = fixture();
  const result = renameLocalProfile(f.wallet, loadProfile(f.wallet, params), params, '闪电少年');
  assert.equal(result.ok, true);
  const older = legacy.createRewardWalletStore(f.storage);
  let oldReadRejected = false;
  try { older.get(DIAMOND_KEY); } catch { oldReadRejected = true; }
  t.diagnostic(JSON.stringify({ format: JSON.parse(f.storage.get(REWARD_WALLET_KEY)).version,
    currentName: f.wallet.get(PLAYER_NAME_KEY), legacyName: older.get(PLAYER_NAME_KEY), oldReadRejected }));
  assert.equal(oldReadRejected, true, 'a v1 reader does not understand authoritative local metadata');
  assert.equal(JSON.parse(f.storage.get(REWARD_WALLET_KEY)).version, 2);
  const before = [...f.data];
  assert.throws(() => buyOffer(older, content, 'offer_shard_volt', new Date()), /损坏/);
  assert.deepEqual([...f.data], before, 'an older financial path must fail before changing any state');
  assert.equal(loadProfile(createRewardWalletStore(f.storage), params).name, '闪电少年');
  assert.equal(walletBalance(f.wallet, 'diamond'), 40);
});

test('old v1 records stay readable and only metadata-bearing writes require format 2', () => {
  const f = fixture();
  f.storage.set(REWARD_WALLET_KEY, JSON.stringify({ version: 1, values: { [COINS_KEY]: '1200' }, ledgers: {} }));
  assert.equal(walletBalance(f.wallet, 'coin'), 1200);
  spend(f.wallet, { coin: 1 });
  assert.equal(JSON.parse(f.storage.get(REWARD_WALLET_KEY)).version, 1);
  assert.equal(walletBalance(legacy.createRewardWalletStore(f.storage), 'coin'), 1199);
  renameLocalProfile(f.wallet, loadProfile(f.wallet, params), params, '闪电少年');
  assert.equal(JSON.parse(f.storage.get(REWARD_WALLET_KEY)).version, 2);
});

test('unpublished B02 v1-local records preserve their values and upgrade on the next write', () => {
  const f = fixture();
  f.storage.set(REWARD_WALLET_KEY, JSON.stringify({ version: 1, values: { [DIAMOND_KEY]: '40' },
    local: { [PLAYER_NAME_KEY]: '闪电少年', [PLAYER_RENAMES_KEY]: '2' }, ledgers: {} }));
  assert.equal(loadProfile(f.wallet, params).name, '闪电少年');
  assert.equal(walletBalance(f.wallet, 'diamond'), 40);
  spend(f.wallet, { diamond: 1 });
  assert.equal(JSON.parse(f.storage.get(REWARD_WALLET_KEY)).version, 2);
  assert.equal(loadProfile(createRewardWalletStore(f.storage), params).renames, 2);
  assert.equal(walletBalance(f.wallet, 'diamond'), 39);
});

test('future progress versions fail closed without clearing or minting a wallet', () => {
  const f = fixture();
  const future = JSON.stringify({ version: 3, values: { [DIAMOND_KEY]: '999' }, ledgers: {} });
  f.storage.set(REWARD_WALLET_KEY, future);
  assert.throws(() => f.wallet.get(DIAMOND_KEY), /损坏/);
  assert.equal(f.storage.get(REWARD_WALLET_KEY), future);
});
