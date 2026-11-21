import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRewardWalletStore, REWARD_WALLET_KEY } from '@tr/game/flow/missionRewardWallet.js';
import { buyItemUpgrade, buyThemeUnlock, characterLevel, isThemeUnlocked, itemUpgradeCount,
  runEnhance, themeCardState, themeUnlockPrice, walletBalance, COINS_KEY, KEYS_KEY,
  SHARD_PREFIX, THEME_KEY, UNLOCKS_KEY } from '@tr/game/flow/localEconomy.js';
import { buyShardPack, isCharacterGated, syncShardAutoSynth, synthesizeCharacter,
  unlockCharacter, unlockedCharacterIds, upgradeCharacter } from '@tr/game/flow/unlock.js';
import { openChest } from '@tr/game/flow/chest.js';
import { createSettingsScene } from '@tr/game/flow/settingsScene.js';
import { createShopScene } from '@tr/game/flow/shopScene.js';

const content = Object.fromEntries(['game', 'characters', 'skills', 'items', 'economy', 'events', 'themes', 'obstacles']
  .map(name => [name, JSON.parse(readFileSync(new URL(`../config/${name}.json`, import.meta.url), 'utf8'))]));
const gated = structuredClone(content);
gated.characters.items.find(role => role.id === 'char_ama').unlock = { type: 'coin', cost: 4500 };
gated.characters.items.find(role => role.id === 'char_mambo').unlock = { type: 'loot' };
gated.economy.params.lootTables.push({ id: 'loot_chest_test', cost: { key: 1 }, draws: 1,
  entries: [{ ref: 'shard_ama:2', weight: 1, rarity: 'rare' }], pity: { everyN: 8 } });
const date = new Date(2026, 10, 21, 12);

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

const operations = [
  { name: 'item duration upgrade', initial: { [COINS_KEY]: '1000' },
    run: wallet => buyItemUpgrade(wallet, content, 'item_magnet'),
    verify(wallet) { assert.equal(walletBalance(wallet, 'coin'), 0); assert.equal(itemUpgradeCount(wallet, 'item_magnet'), 1); } },
  { name: 'free character level upgrade', initial: { [SHARD_PREFIX + 'shard_ama']: '50' },
    run: wallet => upgradeCharacter(wallet, content, 'char_ama'),
    verify(wallet) { assert.equal(walletBalance(wallet, 'shard_ama'), 0); assert.equal(characterLevel(wallet, 'char_ama'), 2); } },
  { name: 'paid character unlock fixture', initial: { [COINS_KEY]: '4500' },
    run: (wallet, hook) => unlockCharacter(wallet, gated, 'char_ama', date, hook), unlock: 'char_ama',
    verify(wallet) { assert.equal(walletBalance(wallet, 'coin'), 0); assert.ok(unlockedCharacterIds(wallet).has('char_ama')); } },
  { name: 'manual shard synthesis fixture', initial: { [SHARD_PREFIX + 'shard_ama']: '50' },
    run: (wallet, hook) => synthesizeCharacter(wallet, gated, 'char_ama', hook), unlock: 'char_ama',
    verify(wallet) { assert.equal(walletBalance(wallet, 'shard_ama'), 0); assert.ok(unlockedCharacterIds(wallet).has('char_ama')); } },
  { name: 'shard pack and automatic synthesis fixture', initial: { [COINS_KEY]: '1200', [SHARD_PREFIX + 'shard_mambo']: '45' },
    run: (wallet, hook) => buyShardPack(wallet, gated, 'char_mambo', date, { onUnlocked: hook }), unlock: 'char_mambo',
    verify(wallet) { assert.equal(walletBalance(wallet, 'coin'), 0); assert.equal(walletBalance(wallet, 'shard_mambo'), 0);
      assert.ok(unlockedCharacterIds(wallet).has('char_mambo')); } },
  { name: 'explicitly priced scene', initial: { [COINS_KEY]: '1000' },
    run: wallet => buyThemeUnlock(wallet, content, 'theme_rain_konbini'),
    verify(wallet) { assert.equal(walletBalance(wallet, 'coin'), 0); assert.ok(isThemeUnlocked(wallet, 'theme_rain_konbini', content)); } },
  { name: 'chest cost, reward, pity and automatic synthesis fixture', initial: { [KEYS_KEY]: '1', [SHARD_PREFIX + 'shard_ama']: '48' },
    run: (wallet, hook) => openChest(wallet, gated, 'loot_chest_test', () => 0, { onUnlocked: hook }), unlock: 'char_ama',
    verify(wallet) { assert.equal(walletBalance(wallet, 'key'), 0); assert.equal(walletBalance(wallet, 'shard_ama'), 0);
      assert.equal(wallet.get('thunderrun:loot-pity:loot_chest_test'), '1'); assert.ok(unlockedCharacterIds(wallet).has('char_ama')); } },
];

test('new economy operations commit their price and all progress in one local write; callbacks see committed data', () => {
  for (const op of operations) {
    const f = fixture(op.initial), callbacks = [];
    const result = op.run(f.wallet, id => {
      op.verify(createRewardWalletStore(f.storage));
      callbacks.push(id);
    });
    assert.equal(result.ok, true, op.name);
    assert.deepEqual(f.writes, [REWARD_WALLET_KEY], op.name);
    op.verify(createRewardWalletStore(f.storage));
    assert.deepEqual(callbacks, op.unlock ? [op.unlock] : [], op.name);
    for (const [key, value] of Object.entries(op.initial)) assert.equal(f.data.get(key), value, 'legacy migration inputs remain intact');
  }
});

for (const mode of ['throw', 'silent']) test(`new economy operations preserve all funds/progress and callbacks on ${mode} persistence failure`, () => {
  for (const op of operations) {
    const f = fixture(op.initial), callbacks = [], before = [...f.data];
    f.fail(mode);
    if (op.name.startsWith('chest')) {
      const result = op.run(f.wallet, id => callbacks.push(id));
      assert.equal(result.ok, false); assert.deepEqual(result.rewards, []);
    } else assert.throws(() => op.run(f.wallet, id => callbacks.push(id)), undefined, op.name);
    assert.deepEqual([...f.data], before, op.name);
    assert.deepEqual(callbacks, [], op.name);
    f.fail('');
    assert.equal(op.run(f.wallet, id => callbacks.push(id)).ok, true, op.name);
    op.verify(createRewardWalletStore(f.storage));
    assert.deepEqual(callbacks, op.unlock ? [op.unlock] : [], op.name);
  }
});

test('chest whole-character rewards unlock once, never mint item:char inventory, and keep callback after commit', () => {
  const c = structuredClone(gated);
  c.economy.params.lootTables.push({ id: 'loot_chest_card', cost: { key: 1 }, draws: 2,
    entries: [{ ref: 'char_ama', weight: 1, rarity: 'ssr' }] });
  const f = fixture({ [KEYS_KEY]: '3' }), callbacks = [];
  const hooks = { onUnlocked(id) { assert.ok(unlockedCharacterIds(createRewardWalletStore(f.storage)).has(id)); callbacks.push(id); } };
  assert.equal(openChest(f.wallet, c, 'loot_chest_card', () => 0, hooks).rewards.length, 2);
  assert.equal(openChest(f.wallet, c, 'loot_chest_card', () => 0, hooks).ok, true);
  assert.deepEqual(callbacks, ['char_ama']);
  assert.equal(walletBalance(f.wallet, 'key'), 1);
  assert.equal(walletBalance(f.wallet, 'char_ama'), 0);
  assert.equal(f.wallet.get('thunderrun:item:char_ama'), null);
});

test('ten shipped characters remain free; their shards are retained for upgrades instead of automatic re-unlocks', () => {
  const chars = content.characters.items.filter(role => role.id.startsWith('char_'));
  assert.equal(chars.length, 10);
  const f = fixture(Object.fromEntries(chars.map(role => [SHARD_PREFIX + role.id.replace('char_', 'shard_'), '50'])));
  for (const role of chars) {
    assert.equal(role.unlock.type, 'free');
    assert.equal(isCharacterGated(content, role.id, f.wallet), false);
  }
  assert.deepEqual(syncShardAutoSynth(f.wallet, content), []);
  assert.equal(f.wallet.get(UNLOCKS_KEY), null);
  assert.equal(f.writes.length, 0);
  assert.equal(upgradeCharacter(f.wallet, content, 'char_ama').ok, true);
  assert.equal(characterLevel(f.wallet, 'char_ama'), 2);
});

test('only explicitly priced non-default scenes are gated; seven scenes and grandfathered selections remain usable', () => {
  const f = fixture({ [THEME_KEY]: 'theme_rain_konbini' });
  assert.equal(content.themes.items.length, 7);
  assert.deepEqual(content.themes.items.filter(theme => theme.price).map(theme => theme.id),
    ['theme_seaside_day', 'theme_rain_konbini', 'theme_dusk_harbor']);
  assert.equal(isThemeUnlocked(f.wallet, 'theme_rain_konbini', content), true);
  assert.equal(isThemeUnlocked(f.wallet, 'theme_seaside_day', content), true);
  assert.equal(isThemeUnlocked(f.wallet, 'theme_dusk_harbor', content), false);
  for (const theme of content.themes.items.filter(theme => !theme.price)) {
    assert.equal(isThemeUnlocked(f.wallet, theme.id, content), true);
    assert.equal(themeUnlockPrice(content, theme.id), 0);
    assert.equal(themeCardState(f.wallet, content, theme.id).owned, true);
  }
  let actions;
  const scene = createSettingsScene({ storage: f.wallet, content: () => content, goSelect() {}, stopDeathMusic() {},
    views: { renderSettings(_content, a) { actions = a; }, toast() {} } });
  scene.onEnter();
  assert.equal(actions.onSelectTheme('theme_dusk_harbor'), false);
  assert.equal(actions.onSelectTheme('theme_stormspire'), true, 'unpriced draft preserves published playability');
  assert.equal(actions.onSelectTheme('theme_rain_konbini'), true, 'switching away retains the previously used priced theme');
  assert.equal(f.wallet.get(THEME_KEY), 'theme_rain_konbini');
  assert.equal(walletBalance(f.wallet, 'coin'), 0);
  const fresh = fixture();
  assert.equal(themeCardState(fresh.wallet, content, 'theme_seaside_day').active, true);
});

test('new local metadata preserves cumulative mission/achievement reward cursors', () => {
  const f = fixture(), snapshot = { rewardLedgerId: 'shared-account', wallet: { coin: 1000, key: 1 } };
  f.wallet.syncRewards(snapshot);
  assert.equal(buyItemUpgrade(f.wallet, content, 'item_magnet').ok, true);
  assert.equal(openChest(f.wallet, gated, 'loot_chest_test', () => 0).ok, true);
  const restored = createRewardWalletStore(f.storage);
  restored.syncRewards(snapshot);
  assert.equal(walletBalance(restored, 'coin'), 0); assert.equal(walletBalance(restored, 'key'), 0);
  assert.equal(itemUpgradeCount(restored, 'item_magnet'), 1);
  assert.equal(walletBalance(restored, 'shard_ama'), 2);
  restored.transaction(draft => draft.set('thunderrun:ach-claimed-v1', '["local_test"]'));
  assert.equal(createRewardWalletStore(f.storage).get('thunderrun:ach-claimed-v1'), '["local_test"]');
});

test('runEnhance is absent without effective bonuses and retains the shared shape for skill-only/item-only bonuses', () => {
  assert.equal(runEnhance(fixture().wallet, content, 'char_ama'), undefined);
  const skill = runEnhance(fixture({ 'thunderrun:char-level:char_ama': '3' }).wallet, content, 'char_ama');
  assert.equal(skill.skillScale, 1.1); assert.equal(skill.itemBonusS('item_magnet'), 0);
  const item = runEnhance(fixture({ 'thunderrun:item-upgrade:item_magnet': '2' }).wallet, content, 'char_ama');
  assert.equal(item.skillScale, 1); assert.equal(item.itemBonusS('item_magnet'), 1);
  assert.equal(runEnhance(fixture({ 'thunderrun:item-upgrade:item_xp_card': '2' }).wallet, content, 'char_ama'), undefined);
});

test('shop preserves the inventory return route', () => {
  let actions; const calls = [];
  const scene = createShopScene({ adapter: { storage: fixture().wallet }, content: () => content,
    views: { renderShop(_content, a) { actions = a; } }, onCharacterUnlocked() {},
    goShopBack: (...args) => calls.push(args) });
  scene.onEnter({ returnTo: 'inventory', characterId: 'char_ama' }); actions.onBack();
  assert.deepEqual(calls, [['inventory', 'char_ama']]);
});
