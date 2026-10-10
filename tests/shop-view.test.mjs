import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Box, Button, Label, defaultUiConfig, findBox } from '../packages/framework/dist/ui/index.js';
import { UiHost } from '../packages/framework/dist/ui/host.js';
import { createOverlayViews } from '../packages/game/dist/ui/overlayViews.js';
import { buildShopCatalog, filterShopCatalog, SHOP_CATEGORIES, SHOP_PAGE_SIZE, shopListingBadgeText } from '../packages/game/dist/ui/shopView.js';
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

test('canvas shop shows catalog, prices, availability, working category and page controls without purchase actions', async () => {
  const content = await loadContent();
  const catalog = buildShopCatalog(content);
  assert.ok(catalog.length > SHOP_PAGE_SIZE);
  const pageCount = Math.ceil(catalog.length / SHOP_PAGE_SIZE);
  assert.deepEqual(SHOP_CATEGORIES.map(category => category.label), ['全部', '货币', '道具', '角色']);
  const host = makeHost();
  const views = createOverlayViews({ host });
  views.renderShop(content, { onBack() {} });
  host.overlay.current.relayout();

  let visible = labels(host);
  assert.ok(visible.includes('商店'));
  assert.ok(visible.some(text => text.includes('仅供浏览')));
  assert.ok(visible.includes(`1/${pageCount} 页`));
  const priced = catalog.slice(0, SHOP_PAGE_SIZE).find(listing => listing.priceText);
  assert.ok(priced);
  assert.ok(visible.includes(`标价：${priced.priceText}`));
  for (const listing of catalog.slice(0, SHOP_PAGE_SIZE)) {
    assert.ok(visible.includes(shopListingBadgeText(listing)), `${listing.id} status is visible`);
  }
  assert.equal(findButton(host, '上一页').state, 'disabled');
  assert.equal(findButton(host, '下一页').state, 'normal');

  const rewards = catalog.map(listing => listing.rewardText);
  assert.ok(buttons(host).every(button => !rewards.includes(button.label.getText())), 'catalog offers are never buttons');
  click(host, findButton(host, '下一页'));
  assert.ok(labels(host).includes(`2/${pageCount} 页`));
  assert.equal(findButton(host, '上一页').state, 'normal');
  click(host, findButton(host, '上一页'));
  assert.ok(labels(host).includes(`1/${pageCount} 页`));

  click(host, findButton(host, '货币'));
  const firstCurrency = filterShopCatalog(catalog, 'currency')[0];
  assert.ok(firstCurrency && labels(host).includes(firstCurrency.rewardText));
  assert.ok(buttons(host).some(button => button.label.getText() === '✔ 货币'));
  click(host, findButton(host, '道具'));
  visible = labels(host);
  const firstItem = filterShopCatalog(catalog, 'items')[0];
  assert.ok(firstItem && visible.includes(firstItem.rewardText));
  assert.ok(buttons(host).some(button => button.label.getText() === '✔ 道具'));
  click(host, findButton(host, '角色'));
  const firstSpecial = filterShopCatalog(catalog, 'special')[0];
  assert.ok(firstSpecial && labels(host).includes(firstSpecial.rewardText));
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
  assert.match(shopSource, /document\.removeEventListener\('keydown', onKeyDown\)/);
  assert.match(shopSource, /window\.removeEventListener\('resize', resize\)/);
  assert.match(shopSource, /visualViewport\?\.removeEventListener\('resize', resize\)/);
  assert.match(shopSource, /shop-close-button', '返回上一页'/);
  assert.match(shopSource, /event\.key === 'Escape'\) actions\.onBack\(\)/);

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
