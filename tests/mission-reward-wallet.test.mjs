import test from 'node:test';
import assert from 'node:assert/strict';
import { createRewardWalletStore, REWARD_WALLET_KEY } from '@tr/game/flow/missionRewardWallet.js';
import { walletBalance, addBalance, spend, COINS_KEY, DIAMOND_KEY, KEYS_KEY, SHARD_PREFIX, ITEM_PREFIX } from '@tr/game/flow/localEconomy.js';
import { MissionApiCore, MISSION_QUEUE_KEY } from '@tr/game/flow/missionApiCore.js';

function fixture(initial = {}) {
  const data = new Map(Object.entries(initial));
  const storage = { get: key => data.get(key) ?? null, set: (key, value) => data.set(key, value), remove: key => data.delete(key) };
  return { data, storage, wallet: createRewardWalletStore(storage) };
}
const snapshot = (wallet, rewardLedgerId = 'account-a') => ({ rewardLedgerId, wallet,
  serverTime: 123, daily: { periodId: 'd', resetsAt: 0, missions: [] }, weekly: { periodId: 'w', resetsAt: 0, missions: [] } });

test('all reward currencies migrate legacy funds and are spendable without refill on reload', () => {
  const { storage, wallet, data } = fixture({ [COINS_KEY]: '125', [DIAMOND_KEY]: '3', [KEYS_KEY]: '2',
    [SHARD_PREFIX + 'shard_volt']: '7', [ITEM_PREFIX + 'item_shield']: '2' });
  const snap = snapshot({ coin: 400, diamond: 10, key: 2, shard_volt: 5 });
  wallet.syncRewards(snap);
  assert.deepEqual(['coin', 'diamond', 'key', 'shard_volt', 'item_shield'].map(id => walletBalance(wallet, id)), [525, 13, 4, 12, 2]);
  assert.equal(spend(wallet, { coin: 500, diamond: 12, key: 3, shard_volt: 10 }), true);
  addBalance(wallet, 'item_shield', -1);
  // Unrelated storage retains its original interface and key.
  wallet.set('thunderrun:profile', 'profile');
  assert.equal(data.get('thunderrun:profile'), 'profile');
  const reloaded = createRewardWalletStore(storage);
  for (let i = 0; i < 3; i++) reloaded.syncRewards(snap);
  assert.deepEqual(['coin', 'diamond', 'key', 'shard_volt', 'item_shield'].map(id => walletBalance(reloaded, id)), [25, 1, 1, 2, 1]);
  assert.equal(data.get(COINS_KEY), '125', 'legacy data is preserved, but never read over migrated funds');
  reloaded.remove(COINS_KEY);
  assert.equal(walletBalance(reloaded, 'coin'), 0, 'removal must not resurrect the legacy value');
});

test('out-of-order snapshots, new rewards and stable account identities use independent high-water marks', () => {
  const { wallet, storage } = fixture();
  wallet.syncRewards(snapshot({ coin: 100, key: 3 }));
  spend(wallet, { coin: 100, key: 3 });
  wallet.syncRewards(snapshot({ coin: 50 }));
  wallet.syncRewards(snapshot({ coin: 120, key: 3 }));
  assert.equal(walletBalance(wallet, 'coin'), 20);
  wallet.syncRewards(snapshot({ coin: 10 }, 'account-b'));
  const loggedInAgain = createRewardWalletStore(storage);
  loggedInAgain.syncRewards(snapshot({ coin: 120, key: 3 }));
  assert.equal(walletBalance(loggedInAgain, 'coin'), 30);
  assert.equal(walletBalance(loggedInAgain, 'key'), 0);
  // Multiple live clients always read current state rather than cached balances/cursors.
  spend(wallet, { coin: 15 });
  loggedInAgain.syncRewards(snapshot({ coin: 125, key: 3 }));
  assert.equal(walletBalance(wallet, 'coin'), 20);
});

test('failed or silently dropped persistence cannot partially grant funds or consume a cursor', () => {
  for (const silent of [false, true]) {
    const { storage, data } = fixture({ [COINS_KEY]: '5' });
    let fail = true;
    const broken = { ...storage, set(key, value) { if (fail) { if (silent) return; throw new Error('quota'); } storage.set(key, value); } };
    const wallet = createRewardWalletStore(broken);
    assert.throws(() => wallet.syncRewards(snapshot({ coin: 100, diamond: 5 })));
    assert.equal(data.has(REWARD_WALLET_KEY), false);
    assert.equal(walletBalance(wallet, 'coin'), 5);
    fail = false;
    wallet.syncRewards(snapshot({ coin: 100, diamond: 5 }));
    wallet.syncRewards(snapshot({ coin: 100, diamond: 5 }));
    assert.equal(walletBalance(wallet, 'coin'), 105);
    assert.equal(walletBalance(wallet, 'diamond'), 5);
    fail = true;
    assert.throws(() => spend(wallet, { coin: 20 }));
    assert.equal(walletBalance(wallet, 'coin'), 105);
  }
});

test('invalid snapshots and damaged persisted cursors fail closed without granting any currency', () => {
  const { wallet, data } = fixture();
  for (const snap of [snapshot({ coin: 2, diamond: -1 }), snapshot({ coin: 1.1 }), snapshot({ coin: 5 }, ''),
    snapshot({ unknown: 2 }), snapshot({ coin: Number.MAX_SAFE_INTEGER + 1 })]) {
    assert.throws(() => wallet.syncRewards(snap));
    assert.equal(data.has(REWARD_WALLET_KEY), false);
  }
  data.set(REWARD_WALLET_KEY, '{');
  assert.throws(() => wallet.syncRewards(snapshot({ coin: 5 })), /损坏/);
  assert.equal(data.get(REWARD_WALLET_KEY), '{');
});

test('load, repeated claim responses, finish retries and reconnect import once through the API callback', async () => {
  const { wallet, storage } = fixture();
  let current = snapshot({ coin: 10 }), rejectSession = false;
  const transport = { async request(path) {
    if (rejectSession && path === '') { rejectSession = false; return { status: 401, data: { error: 'expired' } }; }
    return { status: 200, data: path === '/session' ? { ok: true } : current };
  } };
  const api = new MissionApiCore(transport, storage, s => wallet.syncRewards(s));
  await api.load();
  current = snapshot({ coin: 20, key: 1, diamond: 5, shard_volt: 3 });
  await api.claim('daily', 'd', 'm');
  await api.claim('daily', 'd', 'm');
  assert.equal(walletBalance(wallet, 'coin'), 20);
  spend(wallet, { coin: 20, diamond: 5, key: 1, shard_volt: 3 });
  rejectSession = true;
  await assert.rejects(api.load(), /expired/);
  await api.load();
  await api.finish({ runId: 'run', frames: 1, actions: [] });
  assert.equal(walletBalance(wallet, 'coin'), 0);
  assert.equal(walletBalance(wallet, 'diamond'), 0);
  assert.deepEqual(JSON.parse(storage.get(MISSION_QUEUE_KEY)), []);
});

test('a locally failed claim import remains retryable after the server committed it', async () => {
  const { storage } = fixture();
  let fails = true;
  const disk = { ...storage, set(key, value) { if (key === REWARD_WALLET_KEY && fails) throw new Error('quota'); storage.set(key, value); } };
  const wallet = createRewardWalletStore(disk);
  const api = new MissionApiCore({ request: async path => ({ status: 200, data: path === '/session' ? {} : snapshot({ coin: 20 }) }) }, disk, s => wallet.syncRewards(s));
  await assert.rejects(api.claim('daily', 'd', 'm'), /quota/);
  assert.equal(api.snapshot, null);
  fails = false;
  await api.load();
  await api.claim('daily', 'd', 'm');
  assert.equal(walletBalance(wallet, 'coin'), 20);
});
