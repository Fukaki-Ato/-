import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Box, Button, Label, defaultUiConfig, findBox } from '../packages/framework/dist/ui/index.js';
import { UiHost } from '../packages/framework/dist/ui/host.js';
import { createOverlayViews } from '../packages/game/dist/ui/overlayViews.js';
import { buildShopCatalog, filterShopCatalog, SHOP_CATEGORIES, SHOP_PAGE_SIZE, shopListingBadgeText } from '../packages/game/dist/ui/shopCatalog.js';
import { loadAllConfig } from '../packages/game/dist/core/config/configLoader.js';
import { readJson, loadTestFontSet } from './ui-helpers.mjs';

const W = 800, H = 600;
function makeHost() {
  const store = new Map();
  const adapter = {
    version: 2, env: 'web',
    canvas: {
      mainCanvas: () => ({}), createOffscreenCanvas: () => ({}),
      windowSize: () => ({ width: W, height: H, dpr: 1 }), onResize: () => () => {},
    },
    onInput: () => () => {},
    storage: { get: key => store.get(key) ?? null, set: (key, value) => store.set(key, value), remove: key => store.delete(key) },
    fetchJson: async () => { throw new Error('node 环境不联网'); },
    requestFrame: () => 0, cancelFrame() {}, onVisibility: () => () => {}, now: () => 0,
  };
  const host = new UiHost({
    adapter, overlayHost: { renderer: null, width: W, height: H, dpr: 1 },
    fonts: loadTestFontSet(), config: defaultUiConfig,
  });
  return host;
}

async function loadContent() {
  const report = await loadAllConfig(
    { fetchJson: async url => readJson(url.replace(/^\.?\/?/, 'config/').replace(/\.json$/, '.json')), cacheGet: () => null, cacheSet: () => {} },
    name => `./${name}.json`,
  );
  assert.equal(report.ok, true, report.errors.join('; '));
  return report.content;
}

function labels(host) {
  const result = [];
  host.overlay.current?.root.visit(widget => { if (widget instanceof Label) result.push(widget.getText()); });
  return result.filter(Boolean);
}
function buttons(host) {
  const result = [];
  host.overlay.current?.root.visit(widget => { if (widget instanceof Button) result.push(widget); });
  return result;
}
function findButton(host, label) {
  return buttons(host).find(button => button.label.getText() === label) ?? null;
}
function findButtonOptional(host, label) {
  return findButton(host, label);
}
function findWidget(host, predicate) {
  let found = null;
  host.overlay.current?.root.visit(widget => { if (!found && predicate(widget)) found = widget; });
  return found;
}
function click(host, widget) {
  assert.ok(widget, 'interactive widget exists');
  const tree = host.overlay.current.relayout();
  const box = findBox(tree, widget.id);
  const x = box.rect.x + box.rect.w / 2, y = box.rect.y + box.rect.h / 2;
  host.pushInput({ type: 'down', x, y, t: 0 });
  host.pushInput({ type: 'up', x, y, t: 0.05 });
}

test('lobby shop slot dispatches to the flow action', async () => {
  const content = await loadContent();
  const host = makeHost();
  let opened = 0;
  const views = createOverlayViews({ host });
  views.renderSelect(content, { onStartRun() {}, onBack() {}, onShop() { opened++; } }, 'char_volt', null);
  host.overlay.current.relayout();
  const shop = findWidget(host, widget => widget instanceof Box
    && widget.children.some(child => child instanceof Label && child.getText() === '商店'));
  click(host, shop);
  assert.equal(opened, 1);
  views.dispose();
  host.dispose();
});

test('canvas shop shows catalog, prices, availability, working category and page controls with purchase actions', async () => {
  const content = await loadContent();
  const catalog = buildShopCatalog(content);
  assert.ok(catalog.length > SHOP_PAGE_SIZE);
  assert.deepEqual(SHOP_CATEGORIES.map(category => category.label), ['场景', '货币', '道具', '角色']);
  const host = makeHost();
  const views = createOverlayViews({ host });
  const bought = [];
  views.renderShop(content, {
    onBack() {},
    wallet: () => ({ coins: 100, keys: 2, diamonds: 0 }),
    onBuy: offerId => { bought.push(offerId); return { ok: true, message: '购买成功' }; },
  });
  host.overlay.current.relayout();

  let visible = labels(host);
  assert.ok(visible.includes('商店'));
  assert.ok(visible.some(text => text.includes('余额：金币 100')), 'wallet line visible');
  // 默认分类=场景：全部场景上架（雨夜便利店已转 live 开放购买），单页无需分页
  const sceneListings = catalog.filter(listing => listing.kind === 'theme');
  assert.equal(sceneListings.length, 3, 'all scenes listed');
  assert.ok(sceneListings.every(listing => listing.availability === 'purchasable'), 'all scenes purchasable');
  assert.ok(visible.includes('白日海景') && visible.includes('雨夜便利店') && visible.includes('黄昏渔港'), 'scene cards visible');
  assert.equal(findButton(host, '上一页').state, 'disabled');
  assert.equal(findButton(host, '下一页').state, 'disabled');
  // 货币分类：唯一带价商品 refill，badge 与标价可见
  click(host, findButton(host, '货币'));
  visible = labels(host);
  const priced = catalog.find(listing => listing.kind === 'offer' && listing.id === 'offer_refill_coin');
  assert.ok(priced);
  assert.ok(visible.includes(`标价：${priced.priceText}`));
  assert.ok(visible.includes(shopListingBadgeText(priced)), 'offer badge visible');
  // 可购买商品走「购买 → 确认」两步：第一步只进确认态，不下单
  assert.ok(findButtonOptional(host, '购买'), 'buyable offer shows a buy button');
  click(host, findButton(host, '购买'));
  assert.deepEqual(bought, [], 'no purchase before confirm');
  assert.ok(findButtonOptional(host, '✔ 确认购买'), 'confirm button replaces buy');
  click(host, findButton(host, '取消'));
  assert.deepEqual(bought, [], 'cancel aborts the purchase');
  assert.ok(findButtonOptional(host, '购买'), 'buy button restored after cancel');
  click(host, findButton(host, '购买'));
  click(host, findButton(host, '✔ 确认购买'));
  assert.deepEqual(bought, [priced.id]);
  // 确认成功静默完成（不回显成功文案）；余额/库存刷新即反馈
  assert.ok(!labels(host).some(text => text.includes('购买成功')), 'no success message after confirm');

  const rewards = catalog.map(listing => listing.rewardText);
  assert.ok(buttons(host).every(button => !rewards.includes(button.label.getText())), 'catalog offers are never buttons');
  // 道具分类：全部时长道具的强化卡（7 张），不可强化的静态预览卡已移除
  click(host, findButton(host, '道具'));
  assert.ok(labels(host).some(text => text.includes('磁暴手套 · 强化')), 'upgrade cards under items tab');
  assert.equal(catalog.filter(listing => listing.kind === 'itemUpgrade').length, 7, 'all timed items upgradeable');
  assert.equal(catalog.filter(listing => listing.statusText === '道具 · 非商店').length, 0, 'static previews removed');
  assert.ok(catalog.some(listing => listing.refId === 'item_jetpack'), 'jetpack upgrade card present');
  assert.ok(catalog.some(listing => listing.refId === 'item_helmet'), 'helmet upgrade card present');
  click(host, findButton(host, '下一页'));
  // 宝箱三档配置导览卡加入道具分类后总页数动态变化，只锚定「翻页推进 + 回首页」语义
  const afterNext = labels(host).find(text => /\d+\/\d+ 页/.test(text));
  assert.ok(afterNext && afterNext.startsWith('2/'), `下一页推进到第 2 页，实得 ${afterNext}`);
  assert.equal(findButton(host, '上一页').state, 'normal');
  click(host, findButton(host, '上一页'));
  assert.ok(labels(host).some(text => /^1\/\d+ 页$/.test(text.trim())), '上一页回首页');
  // 角色分类：全部角色本体 + 碎片卡
  click(host, findButton(host, '角色'));
  const specialListings = filterShopCatalog(catalog, 'special');
  assert.equal(specialListings.filter(listing => listing.kind === 'character').length, 10, 'all characters listed');
  assert.equal(specialListings.filter(listing => listing.kind === 'shard').length, 10, 'all shard cards listed');
  assert.ok(labels(host).some(text => text.includes('阿玛拉')), 'character card visible');
  click(host, findButton(host, '下一页'));
  assert.ok(labels(host).some(text => text.includes('阿玛拉碎片')), 'shard card visible on next page');
  views.dispose();
  host.dispose();
});

test('canvas shop reflects purchase limits: remaining badge, sold-out and once states', async () => {
  const content = await loadContent();
  const catalog = buildShopCatalog(content);
  const priced = catalog.find(listing => listing.availability === 'purchasable' && listing.priceText);
  assert.ok(priced, 'a purchasable priced offer exists');
  const host = makeHost();
  const views = createOverlayViews({ host });
  const states = new Map();
  states.set(priced.id, { remaining: 2, perDay: 5, boughtToday: 3, oncePurchased: false });
  views.renderShop(content, {
    onBack() {},
    wallet: () => ({ coins: 100, keys: 2, diamonds: 0 }),
    onBuy: () => ({ ok: true, message: '购买成功' }),
    purchaseState: offerId => states.get(offerId) ?? { remaining: null, perDay: null, boughtToday: 0, oncePurchased: false },
  });
  host.overlay.current.relayout();
  click(host, findButton(host, '货币')); // priced=offer_refill_coin 在货币分类；默认分类是场景
  assert.ok(labels(host).some(text => text.includes(`今日剩余 2/5`)), 'remaining quota visible in badge');
  // 购买确认后重查 purchaseState：余量与徽标同步刷新
  states.set(priced.id, { remaining: 1, perDay: 5, boughtToday: 4, oncePurchased: false });
  click(host, findButton(host, '购买'));
  click(host, findButton(host, '✔ 确认购买'));
  assert.ok(labels(host).some(text => text.includes(`今日剩余 1/5`)), 'remaining quota refreshed after buy');
  // perDay 售罄 → 按钮禁用为「今日已购完」；once 型 → 「已购入」
  states.set(priced.id, { remaining: 0, perDay: 5, boughtToday: 5, oncePurchased: false });
  click(host, findButton(host, '✔ 货币')); // 货币分类已激活，再点触发重渲染
  assert.equal(findButton(host, '今日已购完').state, 'disabled');
  states.set(priced.id, { remaining: 0, perDay: null, boughtToday: 0, oncePurchased: true });
  click(host, findButton(host, '✔ 货币')); // 分类已激活，label 为 ✔ 货币，再点只为触发重渲染
  assert.equal(findButton(host, '已购入').state, 'disabled');
  views.dispose();
  host.dispose();
});

test('canvas shop shows item upgrade progress and shard synthesis states', async () => {
  const content = await loadContent();
  const catalog = buildShopCatalog(content);
  const upgradeListing = catalog.find(listing => listing.kind === 'itemUpgrade');
  const shardListing = catalog.find(listing => listing.kind === 'shard');
  assert.ok(upgradeListing && shardListing, 'upgrade and shard cards exist');
  assert.ok(!catalog.some(listing => listing.kind === 'offer' && listing.id.startsWith('offer_shard_')), 'shard offers render as shard cards only');
  const host = makeHost();
  const views = createOverlayViews({ host });
  const upgrades = new Map();
  const shards = new Map();
  const bought = [];
  const upgraded = [];
  views.renderShop(content, {
    onBack() {},
    wallet: () => ({ coins: 50000, keys: 0, diamonds: 0 }),
    onBuy: offerId => { bought.push(offerId); return { ok: true, message: '购买成功' }; },
    onBuyItemUpgrade: itemId => {
      bought.push(itemId);
      upgrades.set(itemId, (upgrades.get(itemId) ?? 0) + 1);
      return { ok: true, message: '强化成功：时长 +0.5 秒' };
    },
    itemUpgradeState: itemId => {
      const count = upgrades.get(itemId) ?? 0;
      return { count, max: 10, priceCoin: 1000 + count * 2000, bonusS: count * 0.5 };
    },
    onBuyShardPack: charId => {
      bought.push(charId);
      shards.set(charId, Math.min((shards.get(charId) ?? 0) + 5, 50));
      return { ok: true, message: '购买成功' };
    },
    onUpgradeCharacter: charId => {
      upgraded.push(charId);
      shards.set(charId, Math.max(0, (shards.get(charId) ?? 0) - 50));
      return { ok: true, message: '升级成功：Lv.2' };
    },
    // 测试壳模拟 flow 语义：碎片攒满 50 → 自动合成（扣 50 解锁），余额保留在 owned 档内继续攒升级
    shardCardState: charId => {
      const n = shards.get(charId) ?? 0;
      const owned = n >= 50;
      return { charId, owned, level: owned ? 1 : 0, maxLevel: 10, shards: owned ? n - 50 : n, step: 50, packSize: 5, packPriceCoin: 1200 };
    },
  });
  host.overlay.current.relayout();
  // 强化卡（道具分类）：0/10 进度 + 首购阶梯价；「强化 → 确认」后进度与价格同步刷新
  click(host, findButton(host, '道具'));
  assert.ok(labels(host).some(text => text.includes('磁暴手套 · 强化')), 'upgrade card visible');
  assert.ok(labels(host).some(text => text.includes('0/10')), 'upgrade progress visible');
  assert.ok(labels(host).some(text => text.includes('能量币 ×1000')), 'first upgrade price');
  click(host, findButton(host, '强化'));
  assert.deepEqual(bought, [], 'no upgrade before confirm');
  click(host, findButton(host, '✔ 确认购买'));
  assert.deepEqual(bought, [upgradeListing.refId]);
  assert.ok(labels(host).some(text => text.includes('1/10')), 'upgrade progress refreshed');
  assert.ok(labels(host).some(text => text.includes('能量币 ×3000')), 'price steps up after purchase');
  // 碎片卡（角色分类第二页，角色本体卡排在前面）：买一包 5/50；模拟攒满 50 自动合成 → 已拥有态出现升级按钮
  click(host, findButton(host, '角色'));
  assert.ok(labels(host).some(text => text.includes('阿玛拉')), 'character cards under special tab');
  click(host, findButton(host, '下一页'));
  assert.ok(labels(host).some(text => text.includes('碎片')), 'shard cards listed under special tab');
  const shardBuy = findButton(host, '买碎片');
  assert.ok(shardBuy, 'shard buy button visible');
  click(host, shardBuy);
  click(host, findButton(host, '✔ 确认购买'));
  assert.ok(labels(host).some(text => text.includes('5/50')), 'shard progress after one pack');
  shards.set(shardListing.refId, 50);
  click(host, findButton(host, '✔ 角色')); // 分类点击复位 page
  click(host, findButton(host, '下一页')); // 回到碎片卡所在的第 2 页
  assert.ok(labels(host).some(text => text.includes('已拥有 Lv.1/10')), 'owned state shown in shop');
  const upgrade = findButton(host, '升级 Lv.2');
  assert.ok(upgrade, 'upgrade button appears after synthesis');
  assert.equal(upgrade.state, 'disabled', 'upgrade disabled until another 50 shards');
  click(host, findButton(host, '买碎片'));
  click(host, findButton(host, '✔ 确认购买')); // owned 后余额 5/50，仍不足升级
  assert.equal(findButton(host, '升级 Lv.2').state, 'disabled');
  shards.set(shardListing.refId, 100);
  click(host, findButton(host, '✔ 角色'));
  click(host, findButton(host, '下一页'));
  click(host, findButton(host, '升级 Lv.2'));
  assert.deepEqual(upgraded, [shardListing.refId]);
  assert.ok(labels(host).some(text => text.includes('升级成功：Lv.2')), 'upgrade result hint visible');
  views.dispose();
  host.dispose();
});

test('canvas shop unlocks scenes and characters with confirm flow', async () => {
  const content = await loadContent();
  const catalog = buildShopCatalog(content);
  const liveScene = catalog.find(listing => listing.kind === 'theme' && listing.availability === 'purchasable');
  const coinChar = catalog.find(listing => listing.kind === 'character' && listing.refId === 'char_ama');
  const eventChar = catalog.find(listing => listing.kind === 'character' && listing.refId === 'char_bolt');
  assert.ok(liveScene && coinChar && eventChar, 'scene and character cards exist');
  assert.equal(catalog.filter(listing => listing.kind === 'theme').every(listing => listing.availability === 'purchasable'), true, 'all scenes purchasable');
  const host = makeHost();
  const views = createOverlayViews({ host });
  const unlocked = { themes: new Set(), chars: new Set() };
  const bought = [];
  views.renderShop(content, {
    onBack() {},
    wallet: () => ({ coins: 50000, keys: 0, diamonds: 0 }),
    onBuy: offerId => { bought.push(offerId); return { ok: true, message: '购买成功' }; },
    themeCardState: themeId => ({ themeId, owned: unlocked.themes.has(themeId), active: false, priceCoin: 1000 }),
    onBuyTheme: themeId => { bought.push(themeId); unlocked.themes.add(themeId); return { ok: true, message: '解锁成功，可在设置页切换' }; },
    characterCardState: charId => ({
      charId,
      owned: unlocked.chars.has(charId) || charId === 'char_volt',
      unlockKind: charId === 'char_bolt' ? 'event' : charId === 'char_volt' ? 'free' : 'coin',
      priceText: charId === 'char_bolt' ? '活动解锁' : charId === 'char_volt' ? '初始伙伴' : '4500金币',
    }),
    onUnlockCharacter: charId => { bought.push(charId); unlocked.chars.add(charId); return { ok: true, message: '解锁成功' }; },
  });
  host.overlay.current.relayout();
  // 默认场景分类：live 场景可解锁（两步确认），draft 待开放禁用
  assert.ok(labels(host).some(text => text.includes('能量币 ×1000')), 'scene price visible');
  click(host, findButton(host, '解锁'));
  assert.deepEqual(bought, [], 'no unlock before confirm');
  click(host, findButton(host, '✔ 确认购买'));
  assert.deepEqual(bought, [liveScene.refId]);
  assert.equal(findButton(host, '已解锁')?.state, 'disabled', 'scene shows owned after unlock');
  assert.equal(findButton(host, '解锁', 1)?.state, 'normal', 'second scene still unlockable');
  // 角色分类：coin 型角色直接解锁；活动角色只展示途径引导
  click(host, findButton(host, '角色'));
  assert.ok(labels(host).some(text => text.includes('标价：4500金币')), 'character unlock price visible');
  click(host, findButton(host, '解锁'));
  click(host, findButton(host, '✔ 确认购买'));
  assert.deepEqual(bought, [liveScene.refId, coinChar.refId]);
  assert.equal(findButton(host, '已拥有')?.state, 'disabled', 'character shows owned after unlock');
  assert.equal(findButton(host, '活动解锁 · 可攒碎片').state, 'disabled', 'event character shows guidance only');
  views.dispose();
  host.dispose();
});

test('Web shop offers are disabled and renderer cleanup runs on navigation and teardown', async () => {
  const content = await loadContent();
  const shopSource = readFileSync(new URL('../apps/web/src/shopOverlay.ts', import.meta.url), 'utf8');
  const characterSource = readFileSync(new URL('../apps/web/src/characterSelectOverlay.ts', import.meta.url), 'utf8');
  assert.match(characterSource, /shopButton\.addEventListener\('click', \(\) => \{ if \(chosen\) actions\.onShop\(chosen\); \}\)/);
  assert.match(shopSource, /action\.disabled = true/);
  assert.match(shopSource, /仅展示配置，不执行购买或兑换/);
  assert.doesNotMatch(shopSource, /action\.addEventListener\(/);
  // The responsive DOM page delegates Escape/focus/cleanup to the shared lifecycle.
  // Its actual listener behavior is covered in mobile-ui.test.mjs.
  assert.match(shopSource, /return pageLifecycle\(root, actions\.onBack\)/);
  assert.match(shopSource, /classList\.add\('shop-close-button'\)/);
  assert.match(shopSource, /setAttribute\('aria-label', '返回上一页'\)/);

  const host = makeHost();
  let disposals = 0;
  let characterDisposals = 0;
  const listeners = new Set();
  const views = createOverlayViews({
    host,
    selectRenderer: () => () => { characterDisposals++; },
    shopRenderer: () => {
      listeners.add('resize'); listeners.add('keydown');
      return () => { disposals++; listeners.clear(); };
    },
  });
  views.renderCharacterSelectPage(content, { onSelect() {}, onStartRun() {}, onBack() {}, onShop() {} }, 'char_volt', null);
  views.renderShop(content, { onBack() {} });
  assert.equal(characterDisposals, 1, 'entering shop disposes character-page listeners');
  assert.equal(listeners.size, 2);
  views.renderStart({ wechatAvailable: false, onWechat() {}, onGuest() {} });
  assert.equal(disposals, 1);
  assert.equal(listeners.size, 0);
  views.renderShop(content, { onBack() {} });
  views.dispose();
  views.dispose();
  assert.equal(disposals, 2);
  assert.equal(listeners.size, 0);
  host.dispose();
});
