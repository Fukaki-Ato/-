import type { GameContent } from '@tr/game/core/config/configTypes.js';
import type { ShopActions } from '@tr/game/flow/views.js';
import type { FontSet } from '@tr/framework/ui/text/metrics.js';
import { SHOP_SPRITE_CROPS } from '@tr/game/ui/shopImage.js';
import {
  buildShopCatalog, filterShopCatalog, SHOP_CATEGORIES, SHOP_PAGE_SIZE, shopListingBadgeText,
  type ShopFilterCategory, type ShopListing,
} from '@tr/game/ui/shopView.js';
import { mountMobilePage, pageHeader, pageLifecycle, uiButton, uiText } from './mobileUi.js';
import './shopOverlay.css';

function makeCard(listing: ShopListing): HTMLElement {
  const card = uiText('article', '', 'shop-product-card ui-panel');
  card.dataset.listingId = listing.id;
  const art = uiText('div', '', 'shop-product-art');
  art.setAttribute('aria-hidden', 'true');
  const artwork = listing.illustration;
  if (artwork && artwork !== 'coinIcon' && artwork !== 'gemIcon') {
    const crop = SHOP_SPRITE_CROPS[artwork];
    art.style.backgroundImage = `url("${import.meta.env.BASE_URL}assets/ui/shop-popup-generated.png")`;
    art.style.backgroundSize = `${1024 / crop.w * 100}% ${1536 / crop.h * 100}%`;
    art.style.backgroundPosition = `${crop.x / (1024 - crop.w) * 100}% ${crop.y / (1536 - crop.h) * 100}%`;
  } else {
    art.classList.add('is-placeholder');
    art.append(uiText('span', listing.category === 'currency' ? '◇' : '✦'));
  }
  const details = uiText('div', '', 'shop-product-details');
  details.append(uiText('span', shopListingBadgeText(listing), 'shop-product-status'), uiText('h2', listing.rewardText), uiText('p', listing.description, 'shop-product-desc'));
  const price = uiText('div', listing.priceText || '暂无标价', 'shop-product-price');
  if (listing.priceIcon && listing.priceText) {
    const icon = document.createElement('img');
    icon.src = `${import.meta.env.BASE_URL}assets/ui/${listing.priceIcon === 'coinIcon' ? 'icon_gold.png' : 'icon_diamond.png'}`;
    icon.alt = '';
    price.prepend(icon);
  }
  const actionLabel = listing.statusText === '待开放' || listing.statusText === '待补充' ? listing.statusText : '仅供浏览';
  const action = uiButton(actionLabel, 'shop-product-action');
  action.disabled = true;
  action.title = '仅展示配置，不执行购买或兑换';
  details.append(price, action);
  card.append(art, details);
  return card;
}

export function createShopOverlay(content: GameContent, actions: ShopActions, _fonts: FontSet): () => void {
  const { root, frame } = mountMobilePage('商店浏览', 'tr-shop-overlay');
  const header = pageHeader('海风补给站', 'SUPPLY SHOP / 商店', actions.onBack);
  header.querySelector('button')!.classList.add('shop-close-button');
  header.querySelector('button')!.setAttribute('aria-label', '返回上一页');
  const note = uiText('p', '旅途的小帮手，都在这里。', 'shop-intro');
  const notice = uiText('div', '预览商店 · 仅供浏览，暂不支持购买或兑换', 'shop-browse-notice');
  const tabBar = uiText('nav', '', 'shop-tabs');
  tabBar.setAttribute('aria-label', '商品分类');
  const tabs = new Map<ShopFilterCategory, HTMLButtonElement>();
  let activeCategory: ShopFilterCategory = 'all';
  let page = 0;
  const catalog = buildShopCatalog(content);
  for (const category of SHOP_CATEGORIES) {
    const button = uiButton(category.label, 'shop-tab', () => { activeCategory = category.id; page = 0; render(); });
    tabs.set(category.id, button);
    tabBar.append(button);
  }
  const cards = uiText('div', '', 'shop-card-layer');
  cards.setAttribute('aria-label', '商品列表');
  const pageNav = uiText('nav', '', 'shop-page-nav');
  pageNav.setAttribute('aria-label', '商品分页');
  const previous = uiButton('‹ 上一页', 'shop-page-button', () => { page--; render(); });
  const next = uiButton('下一页 ›', 'shop-page-button', () => { page++; render(); });
  const pageText = uiText('span', '', 'shop-page-label');
  pageText.setAttribute('aria-live', 'polite');
  pageNav.append(previous, pageText, next);
  frame.append(header, note, notice, tabBar, cards, pageNav);

  function render(): void {
    const shown = filterShopCatalog(catalog, activeCategory);
    const pageCount = Math.max(1, Math.ceil(shown.length / SHOP_PAGE_SIZE));
    page = Math.max(0, Math.min(page, pageCount - 1));
    previous.disabled = page === 0;
    next.disabled = page + 1 >= pageCount;
    pageText.textContent = `${page + 1} / ${pageCount}`;
    for (const [category, button] of tabs) {
      const selected = category === activeCategory;
      button.classList.toggle('is-active', selected);
      button.setAttribute('aria-pressed', String(selected));
    }
    cards.replaceChildren(...shown.slice(page * SHOP_PAGE_SIZE, (page + 1) * SHOP_PAGE_SIZE).map(makeCard));
    if (!shown.length) cards.append(uiText('p', '暂无可浏览的配置', 'shop-empty-message ui-panel'));
  }
  render();
  return pageLifecycle(root, actions.onBack);
}
