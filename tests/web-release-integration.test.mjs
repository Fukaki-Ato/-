import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeDom, importWebModule } from './dom-fixture.mjs';

const { createMobileLobby } = await importWebModule('../apps/web/src/mobileLobby.ts');
const { createChestOverlay } = await importWebModule('../apps/web/src/chestOverlay.ts');
const { createShopOverlay } = await importWebModule('../apps/web/src/shopOverlay.ts');

function setup(t) {
  const dom = fakeDom(t);
  const prototype = Object.getPrototypeOf(dom.body);
  const original = prototype.querySelectorAll;
  prototype.querySelectorAll = function (selector) {
    if (selector === 'button') return dom.all(this).filter(node => node.tagName === 'button');
    const attr = selector.match(/^\[data-([\w-]+)="([^"]+)"\](?:\.([\w-]+))?$/);
    if (!attr) return original.call(this, selector);
    const key = attr[1].replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    return dom.all(this).filter(node => node.dataset[key] === attr[2]
      && (!attr[3] || node.classList.contains(attr[3])));
  };
  prototype.prepend = function (...children) {
    for (const child of children) child.parent = this;
    this.children.unshift(...children);
  };
  return { ...dom, nodes: name => dom.byClass(dom.body, name), node: name => dom.byClass(dom.body, name)[0] };
}

test('seaside lobby keeps warehouse and settings entries while wiring achievements, chest and existing navigation', t => {
  const f = setup(t), calls = [];
  const actions = Object.fromEntries(['Shop', 'Handbook', 'Inventory', 'Chest', 'CharacterSelect', 'Events', 'Tasks', 'Achievements', 'Leaderboard', 'Settings']
    .map(name => [`on${name}`, () => calls.push(name)]));
  const dispose = createMobileLobby(f.content, { ...actions, onStartRun() {} }, 'char_volt', { coins: 23, diamonds: 4 });
  assert.match(f.node('lobby-brand').textContent, /SEASIDE RUN CLUB/);
  const nav = f.nodes('lobby-nav-button');
  assert.deepEqual(nav.map(button => button.textContent), ['商店', '福利手册', '仓库', '宝箱', '角色']);
  for (const button of [...nav, ...f.nodes('lobby-shortcut'), f.node('lobby-settings')]) button.click();
  assert.deepEqual(calls, ['Shop', 'Handbook', 'Inventory', 'Chest', 'CharacterSelect', 'Events', 'Tasks', 'Achievements', 'Leaderboard', 'Settings']);
  assert.equal(f.node('lobby-diamond-amount').textContent, '4');
  dispose();
  assert.equal(f.node('mobile-lobby'), undefined);
});

for (const pityTriggered of [false, true]) {
  test(`DOM chest confirms a specific tier and ${pityTriggered ? 'announces actual pity' : 'does not call a natural SR drop pity'}`, t => {
    const f = setup(t), calls = [];
    let keys = 2;
    const actions = {
      onBack() {}, wallet: () => ({ coins: 0, keys, diamonds: 0 }),
      chests: () => [{ tableId: 'loot_chest_bronze', tier: 'bronze', name: '铜宝箱', costKeys: 1, draws: 1, pityEveryN: 8 }],
      onOpen(id) {
        calls.push(id); keys--;
        return { ok: true, message: '开启成功', pityTriggered, rewards: [{ ref: 'coin:200', item: 'coin', count: 200, rarity: 'sr' }] };
      },
    };
    const dispose = createChestOverlay(f.content, actions);
    f.node('chest-action').click();
    assert.deepEqual(calls, [], 'first click does not spend keys');
    f.node('chest-cancel-action').click();
    assert.deepEqual(calls, []);
    f.node('chest-action').click(); f.node('is-confirm').click();
    assert.deepEqual(calls, ['loot_chest_bronze']);
    assert.match(f.node('chest-wallet').textContent, /钥匙 1/);
    assert.match(f.node('chest-rewards').textContent, /能量币×200/);
    assert.equal(f.node('chest-reward-tag').textContent, '高级');
    assert.equal(f.node('chest-feedback').getAttribute('role'), 'status');
    assert.equal(f.node('chest-feedback').textContent.includes('保底触发'), pityTriggered);
    assert.match(f.node('chest-feedback').textContent, /开启成功/);
    dispose();
  });
}

test('DOM chest with no keys disables opening and never creates a confirmation', t => {
  const f = setup(t);
  const dispose = createChestOverlay(f.content, {
    onBack() {}, wallet: () => ({ coins: 0, keys: 0, diamonds: 0 }),
    chests: () => [{ tableId: 'loot_chest_bronze', tier: 'bronze', name: '铜宝箱', costKeys: 1, draws: 1, pityEveryN: 8 }],
    onOpen() { assert.fail('insufficient keys cannot spend'); },
  });
  assert.equal(f.node('chest-action').disabled, true);
  f.node('chest-action').click();
  assert.equal(f.node('is-confirm'), undefined);
  dispose();
});

function shopFor(t, overrides = {}) {
  const f = setup(t), calls = [];
  const actions = {
    onBack() {}, wallet: () => ({ coins: 100000, keys: 10, diamonds: 0 }), onBuy: id => buy('offer', id),
    themeCardState: themeId => ({ themeId, owned: false, active: false, priceCoin: 1000 }), onBuyTheme: id => buy('theme', id),
    characterCardState: charId => ({ charId, owned: false, unlockKind: 'coin', priceText: '1000 金币' }), onUnlockCharacter: id => buy('character', id),
    itemUpgradeState: () => ({ count: 0, max: 10, priceCoin: 1000, bonusS: 0 }), onBuyItemUpgrade: id => buy('upgrade', id),
    shardCardState: charId => ({ charId, owned: false, level: 1, maxLevel: 10, shards: 0, step: 50, packSize: 10, packPriceCoin: 1000 }),
    onBuyShardPack: id => buy('shard', id),
    ...overrides,
  };
  function buy(kind, id) { calls.push([kind, id]); return { ok: true, message: '已购买' }; }
  const dispose = createShopOverlay(f.content, actions, {});
  const card = prefix => f.nodes('shop-product-card').find(node => node.dataset.listingId.startsWith(prefix));
  const click = (root, label) => {
    const button = f.byClass(root, 'shop-product-action').find(node => node.textContent === label);
    assert.ok(button, `${label} button exists`); button.click();
  };
  const tab = label => f.nodes('shop-tab').find(button => button.textContent === label).click();
  return { ...f, calls, dispose, card, click, tab };
}

test('DOM shop preserves directed confirmation and dispatches scenes, characters and upgrades to their own APIs', t => {
  const f = shopFor(t);
  const theme = f.card('scene_');
  assert.ok(theme, 'scene cards appear on entry');
  const themeId = theme.dataset.listingId.slice('scene_'.length);
  f.click(theme, '解锁');
  assert.deepEqual(f.calls, []);
  const confirm = f.byClass(f.card('scene_'), 'shop-product-action').find(button => button.textContent === '✔ 确认购买');
  assert.match(confirm.getAttribute('aria-label'), /^确认购买.+/);
  confirm.click();
  assert.deepEqual(f.calls, [['theme', themeId]]);
  assert.match(f.node('shop-feedback').textContent, /已购买/);
  f.tab('道具');
  let upgrade = f.card('upgrade_');
  const upgradeId = upgrade.dataset.listingId.slice('upgrade_'.length);
  f.click(upgrade, '强化');
  assert.equal(f.calls.length, 1);
  f.tab('场景'); f.tab('道具');
  assert.equal(f.nodes('shop-product-confirm').length, 0, 'switching category cancels the pending purchase');
  f.click(f.card('upgrade_'), '强化'); f.click(f.card('upgrade_'), '✔ 确认购买');
  assert.deepEqual(f.calls.at(-1), ['upgrade', upgradeId]);
  f.tab('角色');
  const character = f.card('character_');
  const charId = character.dataset.listingId.slice('character_'.length);
  f.click(character, '解锁'); f.click(f.card('character_'), '取消');
  assert.equal(f.calls.length, 2, 'cancel does not unlock');
  f.click(f.card('character_'), '解锁'); f.click(f.card('character_'), '✔ 确认购买');
  assert.deepEqual(f.calls.at(-1), ['character', charId]);
  f.dispose();
});

test('DOM shop reports failed confirmation without claiming success and allows the same target to retry', t => {
  let attempts = 0;
  const f = shopFor(t, { onBuyTheme: () => {
    attempts++;
    return { ok: false, message: '金币不足' };
  } });
  f.click(f.card('scene_'), '解锁'); f.click(f.card('scene_'), '✔ 确认购买');
  assert.equal(attempts, 1);
  assert.equal(f.node('shop-feedback').getAttribute('role'), 'status');
  assert.match(f.node('shop-feedback').textContent, /金币不足/);
  assert.doesNotMatch(f.node('shop-feedback').textContent, /已购买|已解锁/);
  f.click(f.card('scene_'), '解锁'); f.click(f.card('scene_'), '✔ 确认购买');
  assert.equal(attempts, 2);
  f.dispose();
});
