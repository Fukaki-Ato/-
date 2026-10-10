import type { GameContent } from '@tr/game/core/config/configTypes.js';
import type { ShopActions } from '@tr/game/flow/views.js';
import type { FontSet } from '@tr/framework/ui/text/metrics.js';
import { SHOP_SPRITE_CROPS, type ShopArtwork, type PixelCrop } from '@tr/game/ui/shopImage.js';
import {
  buildShopCatalog, filterShopCatalog, SHOP_CATEGORIES, SHOP_PAGE_SIZE, shopListingBadgeText,
  type ShopFilterCategory, type ShopListing,
} from '@tr/game/ui/shopView.js';
import { createShopTextRenderer } from './shopText.js';
import './shopOverlay.css';

const ART_WIDTH = 1024;
const ART_HEIGHT = 1536;
const SLOT_ARTWORK: Exclude<ShopArtwork, 'coinIcon' | 'gemIcon'>[] = [
  'magnet', 'boots', 'shield', 'coinBag', 'compass', 'chest',
];
const TAB_RECTS = [
  { left: 96, width: 211 }, { left: 312, width: 200 },
  { left: 516, width: 200 }, { left: 720, width: 208 },
];
const SLOT_ROWS = [484, 790, 1096];
const SLOT_CARDS = [455, 760, 1066];
const assetUrl = (name: string): string => `${import.meta.env.BASE_URL}assets/ui/${name}`;
function makeButton(label: string, className: string, ariaLabel: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `${className} shop-sdf-text`;
  button.textContent = label;
  button.setAttribute('aria-label', ariaLabel);
  button.dataset.sdfColor = className === 'shop-product-action' ? '#fff9e8' : '#59321b';
  return button;
}

function place(element: HTMLElement, left: number, top: number, width: number, height: number): void {
  Object.assign(element.style, {
    left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px`,
  });
}

function setPhysicalFont(element: HTMLElement, preferred: number, minimum: number, scale: number): void {
  element.style.fontSize = `${Math.max(minimum, preferred * scale) / scale}px`;
}

function productCrop(artwork: ShopArtwork | undefined): PixelCrop | null {
  if (!artwork || artwork === 'coinIcon' || artwork === 'gemIcon') return null;
  return SHOP_SPRITE_CROPS[artwork];
}

function makeArtSlot(index: number, listing: ShopListing | undefined, scale: number): HTMLElement {
  const slotArtwork = SLOT_ARTWORK[index]!;
  const target = SHOP_SPRITE_CROPS[slotArtwork];
  const source = listing ? productCrop(listing.illustration) : null;
  if (!source) {
    const placeholder = document.createElement('div');
    placeholder.className = listing ? 'shop-art-placeholder shop-sdf-text' : 'shop-empty-slot shop-sdf-text';
    if (listing) {
      placeholder.textContent = '暂无图片';
      placeholder.dataset.sdfColor = '#805b31';
      placeholder.setAttribute('aria-label', `${listing.rewardText}：暂无匹配图示`);
      place(placeholder, target.x, target.y, target.w, target.h);
      setPhysicalFont(placeholder, 12, 9, scale);
    } else {
      const column = index % 2;
      const row = Math.floor(index / 2);
      place(placeholder, column === 0 ? 96 : 513, SLOT_CARDS[row]!, 410, 285);
      placeholder.textContent = '暂无商品';
      placeholder.dataset.sdfColor = '#80603a';
      setPhysicalFont(placeholder, 15, 10, scale);
    }
    return placeholder;
  }

  const image = document.createElement('div');
  image.className = 'shop-product-art';
  image.dataset.artwork = listing?.illustration;
  image.style.backgroundImage = `url("${assetUrl('shop-popup-generated.png')}")`;
  image.style.backgroundSize = `${ART_WIDTH}px ${ART_HEIGHT}px`;
  image.style.backgroundPosition = `-${source.x}px -${source.y}px`;
  place(image,
    target.x + (target.w - source.w) / 2,
    target.y + (target.h - source.h) / 2,
    source.w,
    source.h,
  );
  image.setAttribute('aria-hidden', 'true');
  return image;
}

function makeProductContent(index: number, listing: ShopListing, scale: number): HTMLElement[] {
  const column = index % 2;
  const row = Math.floor(index / 2);
  const left = column === 0 ? 302 : 720;
  const titleTop = SLOT_ROWS[row]!;
  const statusTop = titleTop + 78;
  const reward = document.createElement('div');
  reward.className = 'shop-product-reward';
  reward.classList.add('shop-sdf-text');
  reward.textContent = listing.rewardText;
  reward.title = listing.rewardText;
  reward.dataset.sdfColor = '#633419';

  const status = document.createElement('div');
  status.className = 'shop-product-status';
  status.classList.add('shop-sdf-text');
  status.textContent = shopListingBadgeText(listing);
  status.title = status.textContent ?? '';
  status.dataset.sdfColor = '#805323';

  const titleBox = document.createElement('div');
  titleBox.className = 'shop-product-title';
  titleBox.append(reward, status);
  titleBox.setAttribute('role', 'group');
  titleBox.setAttribute('aria-label', [listing.rewardText, listing.description, status.textContent].filter(Boolean).join('，'));
  place(titleBox, left, titleTop, 188, 78);
  setPhysicalFont(reward, 14, 10, scale);
  setPhysicalFont(status, 11, 8, scale);

  const priceBadge = document.createElement('div');
  priceBadge.className = 'shop-price-badge';
  place(priceBadge, left + 5, statusTop + 8, 48, 48);
  setPhysicalFont(priceBadge, 12, 9, scale);
  const iconFile = listing.priceIcon === 'coinIcon' ? 'icon_gold.png'
    : listing.priceIcon === 'gemIcon' ? 'icon_diamond.png' : '';
  if (iconFile && listing.priceText) {
    const icon = document.createElement('img');
    icon.src = assetUrl(iconFile);
    icon.alt = '';
    priceBadge.append(icon);
  } else {
    priceBadge.textContent = '—';
    priceBadge.setAttribute('aria-hidden', 'true');
  }

  const price = document.createElement('div');
  price.className = 'shop-product-price';
  price.classList.add('shop-sdf-text');
  price.textContent = listing.priceText || '—';
  price.title = `标价：${listing.priceText || '—'}`;
  price.setAttribute('aria-label', `标价：${listing.priceText || '—'}`);
  price.dataset.sdfColor = '#53351d';
  place(price, left + 58, statusTop + 5, 130, 56);
  setPhysicalFont(price, 11, 9, scale);

  const actionLabel = listing.statusText === '待开放' || listing.statusText === '待补充'
    ? listing.statusText : '仅供浏览';
  const action = makeButton(actionLabel, 'shop-product-action', `${listing.rewardText}，${actionLabel}`);
  action.disabled = true;
  action.title = '仅展示配置，不执行购买或兑换';
  place(action, left, titleTop + 153, 188, 80);
  setPhysicalFont(action, 15, 10, scale);
  return [titleBox, priceBadge, price, action];
}

export function createShopOverlay(content: GameContent, actions: ShopActions, fonts: FontSet): () => void {
  const root = document.createElement('section');
  root.className = 'tr-shop-overlay';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', '商店浏览');
  root.style.backgroundImage = `linear-gradient(rgba(4, 25, 30, 0.38), rgba(4, 25, 30, 0.46)), url("${assetUrl('menu-bg-loop.jpg')}")`;
  const textCanvas = document.createElement('canvas');
  textCanvas.className = 'shop-text-layer';
  textCanvas.setAttribute('aria-hidden', 'true');
  const paintText = createShopTextRenderer(root, textCanvas, fonts);

  const frame = document.createElement('div');
  frame.className = 'tr-shop-frame';
  frame.style.backgroundImage = `url("${assetUrl('shop-popup-generated.png')}")`;
  root.append(frame);

  const title = document.createElement('h1');
  title.className = 'shop-frame-title shop-sdf-text';
  title.dataset.sdfColor = '#633419';
  title.textContent = '商店';
  place(title, 170, 112, 670, 70);
  frame.append(title);

  const summary = document.createElement('p');
  summary.className = 'shop-frame-summary shop-sdf-text';
  summary.dataset.sdfColor = '#633419';
  summary.textContent = '仅供浏览，不支持兑换';
  place(summary, 150, 204, 724, 34);
  frame.append(summary);

  const pageNav = document.createElement('div');
  pageNav.className = 'shop-page-nav';
  place(pageNav, 225, 256, 574, 52);
  const previous = makeButton('上一页', 'shop-page-button', '上一页');
  const pageText = document.createElement('span');
  pageText.className = 'shop-page-label';
  pageText.classList.add('shop-sdf-text');
  pageText.dataset.sdfColor = '#59321b';
  const next = makeButton('下一页', 'shop-page-button', '下一页');
  pageNav.append(previous, pageText, next);
  frame.append(pageNav);

  const close = makeButton('×', 'shop-close-button', '返回主菜单');
  close.classList.remove('shop-sdf-text');
  place(close, 852, 86, 72, 72);
  close.addEventListener('click', actions.onBack);
  frame.append(close);

  const tabs = new Map<ShopFilterCategory, HTMLButtonElement>();
  for (const [index, category] of SHOP_CATEGORIES.entries()) {
    const button = makeButton(category.label, 'shop-tab', category.label);
    button.dataset.sdfColor = '#59321b';
    const bounds = TAB_RECTS[index]!;
    place(button, bounds.left, 329, bounds.width, 94);
    button.addEventListener('click', () => {
      activeCategory = category.id;
      page = 0;
      render();
    });
    tabs.set(category.id, button);
    frame.append(button);
  }

  const cardLayer = document.createElement('div');
  cardLayer.className = 'shop-card-layer';
  frame.append(cardLayer);
  const catalog = buildShopCatalog(content);
  let activeCategory: ShopFilterCategory = 'all';
  let page = 0;
  let viewportWidth = 1;
  let viewportHeight = 1;
  let frameScale = 1;

  function filtered(): ShopListing[] {
    return filterShopCatalog(catalog, activeCategory);
  }

  function render(): void {
    const shown = filtered();
    const pageCount = Math.max(1, Math.ceil(shown.length / SHOP_PAGE_SIZE));
    page = Math.max(0, Math.min(page, pageCount - 1));
    previous.disabled = page === 0;
    next.disabled = page + 1 >= pageCount;
    pageText.textContent = `${page + 1}/${pageCount} 页`;
    for (const [category, button] of tabs) {
      const selected = category === activeCategory;
      button.classList.toggle('is-active', selected);
      button.setAttribute('aria-pressed', String(selected));
    }
    const pageListings = shown.slice(page * SHOP_PAGE_SIZE, (page + 1) * SHOP_PAGE_SIZE);
    cardLayer.replaceChildren();
    for (let index = 0; index < SLOT_ARTWORK.length; index++) {
      const listing = pageListings[index];
      cardLayer.append(makeArtSlot(index, listing, frameScale));
      if (listing) cardLayer.append(...makeProductContent(index, listing, frameScale));
    }
    if (!shown.length) {
      const empty = document.createElement('div');
      empty.className = 'shop-empty-message';
      empty.classList.add('shop-sdf-text');
      empty.dataset.sdfColor = '#633419';
      empty.textContent = '暂无可浏览的配置';
      place(empty, 230, 700, 564, 120);
      setPhysicalFont(empty, 22, 14, frameScale);
      cardLayer.append(empty);
    }
    paintText(frameScale);
  }

  function resize(): void {
    viewportWidth = Math.max(1, window.visualViewport?.width ?? window.innerWidth);
    viewportHeight = Math.max(1, window.visualViewport?.height ?? window.innerHeight);
    frameScale = Math.min(viewportWidth / ART_WIDTH, viewportHeight / ART_HEIGHT);
    frame.style.left = `${(viewportWidth - ART_WIDTH * frameScale) / 2}px`;
    frame.style.top = `${(viewportHeight - ART_HEIGHT * frameScale) / 2}px`;
    frame.style.transform = `scale(${frameScale})`;
    frame.style.setProperty('--shop-scale', String(frameScale));
    setPhysicalFont(title, 34, 15, frameScale);
    setPhysicalFont(summary, 20, 11, frameScale);
    setPhysicalFont(previous, 18, 10, frameScale);
    setPhysicalFont(pageText, 17, 10, frameScale);
    setPhysicalFont(next, 18, 10, frameScale);
    setPhysicalFont(close, 28, 20, frameScale);
    for (const button of tabs.values()) setPhysicalFont(button, 22, 12, frameScale);
    render();
  }

  previous.addEventListener('click', () => { page--; render(); });
  next.addEventListener('click', () => { page++; render(); });
  window.addEventListener('resize', resize);
  window.visualViewport?.addEventListener('resize', resize);
  document.addEventListener('keydown', onKeyDown);
  function onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') actions.onBack();
  }
  root.append(textCanvas);
  document.body.append(root);
  resize();

  return () => {
    window.removeEventListener('resize', resize);
    window.visualViewport?.removeEventListener('resize', resize);
    document.removeEventListener('keydown', onKeyDown);
    root.remove();
  };
}
