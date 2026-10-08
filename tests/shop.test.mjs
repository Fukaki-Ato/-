import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Button, Label, List, defaultUiConfig, findBox } from '../packages/framework/dist/ui/index.js';
import { UiHost } from '../packages/framework/dist/ui/host.js';
import { createOverlayViews } from '../packages/game/dist/ui/overlayViews.js';
import { buildShopCatalog, filterShopCatalog, SHOP_CATEGORIES, SHOP_PAGE_SIZE, shopListingBadgeText } from '../packages/game/dist/ui/shopView.js';
import { cropUvCoordinates, SHOP_SPRITE_CROPS, ShopImage } from '../packages/game/dist/ui/shopImage.js';
import { createGameFlow, CHAR_KEY } from '../packages/game/dist/flow/mainFlow.js';
import { CONTENT_NAMES } from '../packages/game/dist/core/config/configTypes.js';
import { loadAllConfig } from '../packages/game/dist/core/config/configLoader.js';
import { createShopAssetLoader } from '../apps/web/build/shopAssets.js';
import { createShellCleanupController } from '../apps/web/build/uiShell.js';
import { SHOP_CUSTOM_GLYPHS } from '../apps/web/build/shopText.js';
import { buildLoadout, playableCharacters } from '../packages/game/dist/core/sim/character.js';
import { loadTestFontSet, readJson, repoRoot } from './ui-helpers.mjs';

const charsetPath = join(repoRoot, 'assets/fonts/charset.txt');

function makeHost(width = 800, height = 600) {
  const store = new Map();
  const adapter = {
    version: 2,
    env: 'web',
    canvas: {
      mainCanvas: () => ({}),
      createOffscreenCanvas: () => ({}),
      windowSize: () => ({ width, height, dpr: 1 }),
      onResize: () => () => {},
    },
    onInput: () => () => {},
    storage: { get: key => store.get(key) ?? null, set: (key, value) => store.set(key, value), remove: key => store.delete(key) },
    fetchJson: async () => { throw new Error('node 环境不联网'); },
    requestFrame: () => 0,
    cancelFrame: () => {},
    onVisibility: () => () => {},
    now: () => 0,
  };
  const host = new UiHost({
    adapter,
    overlayHost: { renderer: null, width, height, dpr: 1 },
    fonts: loadTestFontSet(),
    config: defaultUiConfig,
  });
  return { host, adapter, store };
}

function makeShopAssets() {
  const texture = new THREE.Texture();
  return {
    assets: {
      sheet: { texture, width: 1024, height: 1536 },
      coin: { texture, width: 290, height: 290 },
      gem: { texture, width: 76, height: 79 },
    },
    dispose: () => texture.dispose(),
  };
}

function texts(host) {
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

function findCategory(host, label) {
  return buttons(host).find(button => button.label.getText() === label || button.label.getText() === `✔ ${label}`) ?? null;
}

function findWidget(host, predicate) {
  let found = null;
  host.overlay.current?.root.visit(widget => { if (!found && predicate(widget)) found = widget; });
  return found;
}

function shopArtwork(host) {
  const found = [];
  host.overlay.current?.root.visit(widget => {
    if (widget instanceof ShopImage && widget.artwork !== 'coinIcon' && widget.artwork !== 'gemIcon') found.push(widget);
  });
  return found;
}

function click(host, widget) {
  assert.ok(widget, '目标按钮应存在');
  const box = findBox(host.overlay.tree, widget.id);
  const x = box.rect.x + box.rect.w / 2;
  const y = box.rect.y + box.rect.h / 2;
  host.pushInput({ type: 'down', x, y, t: 0 });
  host.pushInput({ type: 'up', x, y, t: 0.05 });
}

function clickListItem(host, list, index, itemExtent) {
  const box = findBox(host.overlay.tree, list.id);
  const x = box.contentRect.x + itemExtent * (index + 0.5);
  const y = box.contentRect.y + 20;
  host.pushInput({ type: 'down', x, y, t: 0 });
  host.pushInput({ type: 'up', x, y, t: 0.05 });
}

function relayout(host) {
  host.overlay.current?.relayout();
  host.overlay.current?.relayout();
}

function assertWithinViewport(host, width, height) {
  const tree = host.overlay.current?.relayout();
  assert.ok(tree, '页面应挂载');
  for (const button of buttons(host)) {
    const box = findBox(tree, button.id);
    assert.ok(box.rect.x >= 0 && box.rect.x + box.rect.w <= width, `${button.label.getText()} 超出窄屏宽度`);
    assert.ok(box.rect.y >= 0 && box.rect.y + box.rect.h <= height, `${button.label.getText()} 超出窄屏高度`);
  }
  host.overlay.current.root.visit(widget => {
    if (widget instanceof ShopImage) {
      const box = findBox(tree, widget.id);
      assert.ok(box.rect.x >= 0 && box.rect.x + box.rect.w <= width, `${widget.artwork} 插画超出视口宽度`);
      assert.ok(box.rect.y >= 0 && box.rect.y + box.rect.h <= height, `${widget.artwork} 插画超出视口高度`);
    }
    if (!(widget instanceof Label)) return;
    const box = findBox(tree, widget.id);
    assert.ok(box.rect.x >= 0 && box.rect.x + box.rect.w <= width, `${widget.getText()} 超出窄屏宽度`);
    assert.ok(box.rect.y >= 0 && box.rect.y + box.rect.h <= height, `${widget.getText()} 超出窄屏高度`);
  });
}

async function loadContent() {
  const report = await loadAllConfig(
    {
      fetchJson: async url => readJson(url.replace(/^\.?\/?/, 'config/').replace(/\.json$/, '.json')),
      cacheGet: () => null,
      cacheSet: () => {},
    },
    name => `./${name}.json`,
  );
  assert.equal(report.ok, true, `config 应加载成功：${report.errors.join(';')}`);
  return report.content;
}

function seedConfigCache(adapter) {
  for (const name of CONTENT_NAMES) {
    adapter.storage.set(`thunderrun:config:${name}`, JSON.stringify(readJson(`config/${name}.json`)));
  }
}

test('shop catalog maps every configured reward, category, price, and draft reference', async () => {
  const content = await loadContent();
  const catalog = buildShopCatalog(content);
  assert.equal(catalog.length, 10);
  assert.equal(SHOP_PAGE_SIZE, 6);
  assert.deepEqual(SHOP_CATEGORIES.map(category => category.label), ['全部', '货币', '道具', '角色']);
  assert.deepEqual(filterShopCatalog(catalog, 'special').map(listing => listing.id), ['offer_shard_volt', 'offer_skin_bolt_storm']);
  assert.equal(shopListingBadgeText(catalog.find(listing => listing.id === 'offer_skin_bolt_storm')), '皮肤 · 待开放');
  const byId = new Map(catalog.map(listing => [listing.id, listing]));

  assert.deepEqual(byId.get('offer_refill_coin'), {
    id: 'offer_refill_coin', category: 'currency', categories: ['currency'], rewardText: '能量币 ×1500',
    description: '单局收集货币，结算转入钱包', priceText: '雷霆之钥 ×1', priceIcon: 'gemIcon',
    statusText: null, illustration: 'coinBag',
  });
  assert.equal(byId.get('offer_xp_card').rewardText, '经验加速卡 ×1');
  assert.equal(byId.get('offer_xp_card').category, 'items');
  assert.equal(byId.get('offer_xp_card').priceText, '能量币 ×1200');
  assert.equal(byId.get('offer_xp_card').priceIcon, 'coinIcon');
  assert.equal(byId.get('offer_shard_volt').rewardText, '小电碎片 ×5');
  assert.equal(byId.get('offer_shard_volt').category, 'shards');
  assert.equal(byId.get('offer_shard_volt').priceText, '能量币 ×600');
  assert.equal(byId.get('offer_skin_bolt_storm').rewardText, '风暴警长 ×1');
  assert.equal(byId.get('offer_skin_bolt_storm').category, 'skins');
  assert.equal(byId.get('offer_skin_bolt_storm').statusText, '待开放');

  assert.equal(byId.get('preview_item_magnet').illustration, 'magnet');
  assert.equal(byId.get('preview_item_magnet').priceText, '');
  assert.equal(byId.get('preview_item_magnet').statusText, '道具 · 非商店');
  assert.equal(byId.get('preview_item_boots').illustration, 'boots');
  assert.equal(byId.get('preview_item_shield').illustration, 'shield');
  assert.equal(byId.get('preview_loot_coin_chest').illustration, 'chest');
  assert.equal(byId.get('preview_loot_coin_chest').priceText, '能量币 ×2000');
  assert.equal(byId.get('preview_loot_thunder_box').priceText, '雷霆之钥 ×3');
  assert.equal(byId.get('preview_compass').illustration, 'compass');
  assert.equal(byId.get('preview_compass').statusText, '待补充');
  assert.equal(byId.get('preview_compass').priceText, '');
  assert.equal(byId.get('offer_refill_coin').rewardText, '能量币 ×1500');
  assert.equal(byId.get('offer_refill_coin').priceText, '雷霆之钥 ×1', '雷霆之钥价格文本不改称钻石');
});

test('shop sprite crops use the atlas pixel coordinates and stay within its source bounds', () => {
  assert.deepEqual(cropUvCoordinates(SHOP_SPRITE_CROPS.magnet, 1024, 1536), [
    96 / 1024, 494 / 1536, 294 / 1024, 494 / 1536,
    294 / 1024, 718 / 1536, 96 / 1024, 718 / 1536,
  ]);
  assert.deepEqual(SHOP_SPRITE_CROPS.boots, { x: 515, y: 489, w: 204, h: 229 });
  assert.deepEqual(SHOP_SPRITE_CROPS.compass, { x: 98, y: 1078, w: 198, h: 232 });
  const maxRight = { magnet: 294, boots: 719, shield: 296, coinBag: 716, compass: 296, chest: 715 };
  for (const [name, crop] of Object.entries(SHOP_SPRITE_CROPS)) {
    assert.equal(crop.x + crop.w <= 1024 && crop.y + crop.h <= 1536, true);
    assert.ok(crop.x + crop.w <= maxRight[name], `${name} 裁切不可触及价格控件区域`);
  }
  assert.throws(() => cropUvCoordinates({ x: 1000, y: 0, w: 25, h: 10 }, 1024, 1536), RangeError);
});

test('shop asset loading is lazy, cleans partial failures, and releases textures on dispose', async () => {
  const calls = [];
  let disposed = 0;
  let released = 0;
  const loader = createShopAssetLoader(async path => {
    calls.push(path);
    if (path === 'gem') throw new Error('missing gem');
    const texture = new THREE.Texture();
    texture.addEventListener('dispose', () => disposed++);
    return { texture, width: 8, height: 8, release: () => released++ };
  }, { sheet: 'sheet', coin: 'coin', gem: 'gem' });
  assert.deepEqual(calls, [], '创建壳时不启动商店素材请求');
  assert.equal(await loader.load(), undefined, '单张图片失败降级为无图');
  assert.deepEqual(calls, ['sheet', 'coin', 'gem']);
  assert.equal(disposed, 2);
  assert.equal(released, 2);
  assert.equal(await loader.load(), undefined);
  assert.equal(calls.length, 3, '失败结果缓存，不重复请求');
  loader.dispose();

  const successful = createShopAssetLoader(async () => {
    const texture = new THREE.Texture();
    texture.addEventListener('dispose', () => disposed++);
    return { texture, width: 8, height: 8, release: () => released++ };
  }, { sheet: 'sheet', coin: 'coin', gem: 'gem' });
  assert.ok(await successful.load());
  successful.dispose();
  assert.equal(disposed, 5, '正常销毁释放全部三张纹理');
  assert.equal(released, 5, '正常销毁释放所有 ImageBitmap');
});

test('disposing an in-flight shop load aborts immediately and releases late textures once', async () => {
  let disposed = 0;
  let released = 0;
  let coinSignal;
  let resolveCoin;
  const calls = [];
  const tracked = () => {
    const texture = new THREE.Texture();
    texture.addEventListener('dispose', () => disposed++);
    return { texture, width: 8, height: 8, release: () => released++ };
  };
  const sheet = tracked();
  const pendingCoin = new Promise(resolve => { resolveCoin = resolve; });
  const loader = createShopAssetLoader((path, signal) => {
    calls.push(path);
    if (path === 'sheet') return Promise.resolve(sheet);
    if (path === 'coin') {
      coinSignal = signal;
      return pendingCoin;
    }
    throw new Error('gem request should not start after dispose');
  }, { sheet: 'sheet', coin: 'coin', gem: 'gem' });

  const pending = loader.load();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, ['sheet', 'coin']);
  assert.equal(coinSignal.aborted, false);

  loader.dispose();
  assert.equal(coinSignal.aborted, true, 'dispose 立即 abort 当前 fetch');
  assert.equal(disposed, 1, 'dispose 立即释放已完成的 sheet 纹理');
  assert.equal(released, 1, 'dispose 立即关闭已完成的 sheet 位图');

  resolveCoin(tracked());
  assert.equal(await pending, undefined);
  assert.deepEqual(calls, ['sheet', 'coin'], '迟到解码完成后不再请求 gem');
  assert.equal(disposed, 2, '迟到 coin 纹理立即且仅释放一次');
  assert.equal(released, 2, '迟到 coin 位图立即且仅关闭一次');
  loader.dispose();
  assert.equal(disposed, 2);
  assert.equal(released, 2);
});

test('failed shop images keep placeholders and late loads cannot replace the page after return', async () => {
  const content = await loadContent();
  const { host } = makeHost();
  const views = createOverlayViews({ host, loadShopAssets: async () => undefined });
  views.renderShop(content, { onBack() {} });
  await Promise.resolve();
  assert.ok(texts(host).includes('暂无图片'));
  assert.equal(findWidget(host, widget => widget instanceof ShopImage), null);
  host.dispose();

  const { host: secondHost } = makeHost();
  const { assets, dispose } = makeShopAssets();
  let resolveAssets;
  const pending = new Promise(resolve => { resolveAssets = resolve; });
  const secondViews = createOverlayViews({ host: secondHost, loadShopAssets: () => pending });
  secondViews.renderShop(content, { onBack() {} });
  secondViews.renderSelect(content, { onStartRun() {}, onBack() {}, onShop() {} }, 'char_volt', null);
  relayout(secondHost);
  resolveAssets(assets);
  await pending;
  await Promise.resolve();
  assert.ok(texts(secondHost).includes('选择角色'));
  assert.equal(findWidget(secondHost, widget => widget instanceof ShopImage), null);
  secondHost.dispose();
  dispose();
});

test('web shop renderer stays on a transparent host and is disposed when the scene changes', async () => {
  const content = await loadContent();
  const { host } = makeHost();
  let renders = 0;
  let disposals = 0;
  const views = createOverlayViews({
    host,
    shopRenderer: (received, actions) => {
      assert.equal(received, content);
      assert.equal(typeof actions.onBack, 'function');
      renders++;
      return () => { disposals++; };
    },
  });

  views.renderShop(content, { onBack() {} });
  assert.equal(renders, 1);
  assert.equal(disposals, 0);
  assert.equal(host.overlay.scene.background, null);
  views.renderSelect(content, { onStartRun() {}, onBack() {}, onShop() {} }, 'char_volt', null);
  assert.equal(disposals, 1);
  assert.ok(texts(host).includes('选择角色'));

  views.renderShop(content, { onBack() {} });
  views.renderStart({ wechatAvailable: false, onWechat() {}, onGuest() {} });
  assert.equal(renders, 2);
  assert.equal(disposals, 2);
  host.dispose();
});

test('shell teardown disposes the active seaside renderer once before host and renderer resources', async () => {
  const content = await loadContent();
  const { host } = makeHost();
  const listeners = new Set();
  const overlay = { attached: false };
  let rendererDisposals = 0;
  let resourcesDisposed = 0;
  const views = createOverlayViews({
    host,
    shopRenderer: () => {
      overlay.attached = true;
      for (const type of ['resize', 'visualViewport:resize', 'keydown']) listeners.add(type);
      return () => {
        rendererDisposals++;
        overlay.attached = false;
        listeners.clear();
      };
    },
  });
  const shell = createShellCleanupController(() => {
    assert.equal(overlay.attached, false, 'shop DOM cleanup precedes host/renderer disposal');
    assert.equal(listeners.size, 0, 'shop listeners are detached before host/renderer disposal');
    resourcesDisposed++;
    host.dispose();
  });
  shell.registerCleanup(views.dispose);

  views.renderShop(content, { onBack() {} });
  assert.equal(overlay.attached, true);
  assert.equal(listeners.size, 3);
  shell.destroy();
  assert.equal(rendererDisposals, 1);
  assert.equal(overlay.attached, false);
  assert.equal(listeners.size, 0);
  assert.equal(resourcesDisposed, 1);
  views.dispose();
  shell.destroy();
  assert.equal(rendererDisposals, 1, 'overlay cleanup is idempotent');
  assert.equal(resourcesDisposed, 1, 'shell teardown is idempotent');
});

test('mixed-reward offer appears in every matching filter with one price and draft status', async () => {
  const content = await loadContent();
  const mixed = structuredClone(content);
  mixed.economy.params.shop.offers = [{
    id: 'offer_mixed',
    give: [
      { item: 'coin', n: 1500 },
      { item: 'item_xp_card', n: 1 },
      { item: 'shard_volt', n: 5 },
      { item: 'skin_bolt_storm', n: 1 },
    ],
    price: { key: 2 },
    requiresEvent: 'event_thunder_beast_siege',
  }];
  const listing = buildShopCatalog(mixed).find(item => item.id === 'offer_mixed');
  assert.ok(listing);
  assert.deepEqual(listing.categories, ['currency', 'items', 'shards', 'skins']);
  assert.equal(listing.category, 'currency', '保留原有单类别展示字段');
  assert.equal(listing.priceText, '雷霆之钥 ×2');
  assert.equal(listing.priceIcon, 'gemIcon');
  assert.equal(listing.statusText, '待开放');

  const { host } = makeHost();
  const { assets, dispose } = makeShopAssets();
  const views = createOverlayViews({ host, shopAssets: assets });
  views.renderShop(mixed, { onBack() {} });
  relayout(host);
  for (const category of ['货币', '道具', '角色']) {
    click(host, findCategory(host, category));
    const visible = texts(host);
    assert.ok(visible.includes(listing.rewardText), `${category} 分类应显示混合 offer`);
    assert.equal(visible.filter(text => text === '标价：雷霆之钥 ×2').length, 1, `${category} 中价格只显示一次`);
    assert.equal(visible.filter(text => text.includes('待开放')).length, 1, `${category} 中 draft 状态只显示一次`);
  }
  host.dispose();
  dispose();
});

test('shop labels, categories, stable pages, reset, disabled bounds, and font coverage', async () => {
  const content = await loadContent();
  const { host } = makeHost(1365, 900);
  const { assets, dispose } = makeShopAssets();
  const views = createOverlayViews({ host, shopAssets: assets });
  views.renderShop(content, { onBack() {} });
  relayout(host);
  const visibleText = new Set();
  const remember = () => {
    texts(host).forEach(text => visibleText.add(text));
    relayout(host);
    assertWithinViewport(host, 1365, 900);
  };

  let current = texts(host);
  remember();
  assert.ok(current.includes('商店'));
  assert.ok(current.includes('仅供浏览，暂不支持兑换'));
  assert.ok(current.includes('1/2 页'));
  assert.ok(current.includes('能量币 ×1500') && current.includes('经验加速卡 ×1'));
  assert.ok(current.includes('磁暴手套') && current.includes('弹跳鞋') && current.includes('球形护盾'));
  assert.ok(current.includes('标价：雷霆之钥 ×1') && current.includes('标价：能量币 ×1200'));
  assert.ok(!current.some(text => text.includes('图标')));
  assert.equal(findButton(host, '上一页').state, 'disabled');
  assert.equal(findButton(host, '下一页').state, 'normal');
  assert.equal(findButton(host, '✔ 全部') !== null, true);
  assert.equal(findButton(host, '购买'), null, '浏览页面不提供购买按钮');
  assert.ok(findWidget(host, widget => widget instanceof ShopImage && widget.artwork === 'coinBag'));
  assert.ok(findWidget(host, widget => widget instanceof ShopImage && widget.artwork === 'gemIcon'));
  assert.ok(findWidget(host, widget => widget instanceof ShopImage && widget.artwork === 'coinIcon'));
  assert.deepEqual(shopArtwork(host).map(image => image.artwork), ['coinBag', 'magnet', 'boots', 'shield']);
  for (const image of shopArtwork(host)) assert.equal(findBox(host.overlay.tree, image.id).rect.h, 64);

  click(host, findButton(host, '下一页'));
  current = texts(host);
  remember();
  assert.ok(current.includes('2/2 页'));
  assert.ok(current.includes('雷霆箱（配置）') && current.includes('方向标（素材）'));
  assert.ok(current.some(text => text.includes('待补充')));
  assert.equal(findButton(host, '上一页').state, 'normal');
  assert.equal(findButton(host, '下一页').state, 'disabled');
  click(host, findButton(host, '下一页'));
  assert.ok(texts(host).includes('2/2 页'), '末页不会越界');
  relayout(host);
  click(host, findButton(host, '上一页'));
  assert.ok(texts(host).includes('1/2 页'));
  assert.equal(findButton(host, '上一页').state, 'disabled');
  assert.equal(findButton(host, '下一页').state, 'normal');

  click(host, findCategory(host, '角色'));
  current = texts(host);
  remember();
  assert.ok(current.includes('1/1 页') && current.includes('小电碎片 ×5') && current.includes('风暴警长 ×1'));
  assert.ok(current.includes('碎片') && current.includes('皮肤 · 待开放'));
  assert.ok(!current.includes('能量币 ×1500'));
  click(host, findCategory(host, '全部'));
  current = texts(host);
  remember();
  assert.ok(current.includes('1/2 页') && current.includes('能量币 ×1500'));
  assert.ok(!current.includes('雷霆箱（配置）'), '切回分类后从第一页稳定显示');

  click(host, findCategory(host, '货币'));
  current = texts(host);
  remember();
  assert.ok(current.includes('能量币 ×1500'));
  click(host, findCategory(host, '道具'));
  current = texts(host);
  remember();
  assert.ok(current.includes('经验加速卡 ×1') && current.includes('磁暴手套'));
  assert.equal(findButton(host, '下一页').state, 'normal');
  click(host, findCategory(host, '角色'));
  current = texts(host);
  remember();
  assert.ok(current.includes('风暴警长 ×1') && current.includes('小电碎片 ×5'));

  const glyphs = new Set(readFileSync(charsetPath, 'utf8').replace(/\r/g, '').split('\n').filter(glyph => glyph.length === 1));
  const customGlyphs = new Set(SHOP_CUSTOM_GLYPHS);
  const missing = [...new Set([...visibleText].join('').split('').filter(glyph => !glyphs.has(glyph) && !customGlyphs.has(glyph)))];
  assert.deepEqual(missing, [], `可见文字使用了字库未覆盖字形：${missing.join('')}`);
  host.dispose();
  dispose();
});

test('shop empty state and compact viewport keep pagination and controls in bounds', async () => {
  const content = await loadContent();
  const empty = structuredClone(content);
  empty.economy.params.shop.offers = [];
  const { host } = makeHost(360, 640);
  const { assets, dispose } = makeShopAssets();
  const views = createOverlayViews({ host, shopAssets: assets });
  views.renderShop(empty, { onBack() {} });
  relayout(host);

  assert.ok(texts(host).includes('暂无可浏览的配置'));
  assert.ok(texts(host).includes('1/1 页'));
  assert.equal(findButton(host, '上一页').state, 'disabled');
  assert.equal(findButton(host, '下一页').state, 'disabled');
  assertWithinViewport(host, 360, 640);

  views.renderShop(content, { onBack() {} });
  relayout(host);
  assert.ok(texts(host).includes('能量币 ×1500') && texts(host).includes('磁暴手套') && texts(host).includes('弹跳鞋'));
  assert.ok(texts(host).includes('1/2 页'));
  assert.deepEqual(shopArtwork(host).map(image => image.artwork), ['coinBag', 'magnet', 'boots', 'shield']);
  for (const image of shopArtwork(host)) assert.equal(findBox(host.overlay.tree, image.id).rect.h, 42);
  assertWithinViewport(host, 360, 640);
  click(host, findButton(host, '下一页'));
  assert.ok(texts(host).includes('2/2 页'));
  assert.ok(texts(host).includes('暂无图片'));
  relayout(host);
  assertWithinViewport(host, 360, 640);
  assert.equal(findButton(host, '下一页').state, 'disabled');
  click(host, findCategory(host, '角色'));
  assert.ok(texts(host).includes('1/1 页'));
  assert.ok(texts(host).includes('碎片') && texts(host).includes('皮肤 · 待开放'));
  relayout(host);
  assertWithinViewport(host, 360, 640);
  host.dispose();
  dispose();
});

test('flow opens shop directly from the Cocos menu and returns to the main menu', async () => {
  const { host, adapter } = makeHost();
  const { assets, dispose } = makeShopAssets();
  const views = createOverlayViews({ host, shopAssets: assets });
  const flow = createGameFlow({ adapter, views, configResolve: name => `./${name}.json` });
  seedConfigCache(adapter);
  await flow.boot();
  assert.ok(buttons(host).some(button => button.label.getText() === '开始酷跑'));
  assert.ok(!buttons(host).some(button => button.label.getText().includes('登录')));

  click(host, findButton(host, '商店'));
  assert.equal(flow.machine.current(), 'shop');
  assert.ok(texts(host).includes('商店'));
  click(host, findButton(host, '返回'));
  assert.equal(flow.machine.current(), 'start');
  assert.ok(buttons(host).some(button => button.label.getText() === '开始酷跑'));
  host.dispose();
  dispose();
});
