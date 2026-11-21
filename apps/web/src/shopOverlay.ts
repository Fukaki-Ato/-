import type { GameContent } from '@tr/game/core/config/configTypes.js';
import type { BuyResult, ShopActions } from '@tr/game/flow/views.js';
import type { FontSet } from '@tr/framework/ui/text/metrics.js';
import { SHOP_SPRITE_CROPS } from '@tr/game/ui/shopImage.js';
import {
  buildShopCatalog, filterShopCatalog, SHOP_CATEGORIES, SHOP_PAGE_SIZE, shopListingBadgeText,
  type ShopFilterCategory, type ShopListing,
} from '@tr/game/ui/shopCatalog.js';
import { mountMobilePage, pageHeader, pageLifecycle, uiButton, uiText } from './mobileUi.js';
import keyIcon from './assets/mobile-ui/icon-key.webp';
import './shopOverlay.css';

/** 进度条（道具强化 / 碎片进度共用）：轨道 + 百分比宽填充 */
function progressBar(value: number, total: number): HTMLElement {
  const track = uiText('div', '', 'shop-progress');
  const fill = uiText('div', '', 'shop-progress-fill');
  fill.style.width = `${total > 0 ? Math.max(0, Math.min(100, value / total * 100)) : 0}%`;
  track.append(fill);
  return track;
}

function coinPrice(priceText: string): HTMLElement {
  const price = uiText('div', priceText || '暂无标价', 'shop-product-price');
  if (priceText) {
    const icon = document.createElement('img');
    icon.src = `${import.meta.env.BASE_URL}assets/ui/icon_gold.png`;
    icon.alt = '';
    price.prepend(icon);
  }
  return price;
}

export function createShopOverlay(content: GameContent, actions: ShopActions, _fonts: FontSet): () => void {
  const { root, frame } = mountMobilePage('商店浏览', 'tr-shop-overlay');
  const header = pageHeader('海风补给站', 'SUPPLY SHOP / 商店', actions.onBack);
  header.querySelector('button')!.classList.add('shop-close-button');
  header.querySelector('button')!.setAttribute('aria-label', '返回上一页');
  const note = uiText('p', '旅途的小帮手，都在这里。', 'shop-intro');
  const notice = uiText('div', '金币/钥匙商品可直接购买；强化在大厅的「休闲酷跑」中生效。皮肤暂为展示。', 'shop-browse-notice');
  const walletBar = uiText('p', '', 'shop-wallet');
  const status = uiText('p', '', 'shop-feedback');
  status.setAttribute('role', 'status');
  const tabBar = uiText('nav', '', 'shop-tabs');
  tabBar.setAttribute('aria-label', '商品分类');
  const tabs = new Map<ShopFilterCategory, HTMLButtonElement>();
  let activeCategory: ShopFilterCategory = 'scene';
  let page = 0;
  // 购买两步确认：pendingOffer 记录待确认卡，翻页/切分类/取消时复位（与 canvas shopView 同语义）
  let pendingOffer: string | null = null;
  const catalog = buildShopCatalog(content);

  /** 按钮动作分派：offer → onBuy；itemUpgrade → onBuyItemUpgrade；shard → onBuyShardPack */
  function doBuy(listing: ShopListing): BuyResult {
    if (listing.kind === 'itemUpgrade' && actions.onBuyItemUpgrade) return actions.onBuyItemUpgrade(listing.refId ?? '');
    if (listing.kind === 'shard' && actions.onBuyShardPack) return actions.onBuyShardPack(listing.refId ?? '');
    if (listing.kind === 'theme' && actions.onBuyTheme) return actions.onBuyTheme(listing.refId ?? '');
    if (listing.kind === 'character' && actions.onUnlockCharacter) return actions.onUnlockCharacter(listing.refId ?? '');
    return actions.onBuy(listing.id);
  }

  function confirmPair(listing: ShopListing): HTMLElement {
    const row = uiText('div', '', 'shop-product-confirm');
    const confirm = uiButton('✔ 确认购买', 'shop-product-action is-green', () => {
      const result = doBuy(listing);
      pendingOffer = null;
      status.textContent = `${listing.rewardText}：${result.message}`;
      render();
    });
    confirm.setAttribute('aria-label', `确认购买${listing.rewardText}`);
    const cancel = uiButton('取消', 'shop-product-action is-yellow', () => { pendingOffer = null; render(); });
    row.append(confirm, cancel);
    return row;
  }

  /** 配置商品卡：限购余量徽标 + 「购买 → 确认」两步（审查 M4-2：非上架保持仅浏览） */
  function offerCard(listing: ShopListing, details: HTMLElement): void {
    const state = actions.purchaseState?.(listing.id) ?? null;
    const soldOut = !!state && state.remaining === 0;
    const buyable = listing.availability === 'purchasable' && !!listing.priceText && !soldOut;
    const limitText = state?.perDay ? ` · 今日剩余 ${state.remaining}/${state.perDay}` : '';
    details.append(
      uiText('span', `${shopListingBadgeText(listing)}${limitText}`, 'shop-product-status'),
      uiText('h2', listing.rewardText), uiText('p', listing.description, 'shop-product-desc'),
    );
    const price = uiText('div', listing.priceText || '暂无标价', 'shop-product-price');
    if (listing.priceIcon && listing.priceText) {
      const icon = document.createElement('img');
      icon.src = listing.priceIcon === 'coinIcon' ? `${import.meta.env.BASE_URL}assets/ui/icon_gold.png` : keyIcon;
      icon.alt = '';
      price.prepend(icon);
    }
    let actionRow: HTMLElement;
    if (pendingOffer === listing.id && buyable) {
      actionRow = confirmPair(listing);
    } else {
      const action = buyable
        ? uiButton('购买', 'shop-product-action', () => { pendingOffer = listing.id; render(); })
        : uiButton(soldOut ? (state!.oncePurchased ? '已购入' : '今日已购完') : listing.statusText ?? '仅供浏览', 'shop-product-action');
      if (!buyable) {
        action.disabled = true;
        action.title = '仅展示配置，不执行购买或兑换';
      }
      actionRow = action;
    }
    details.append(price, actionRow);
  }

  /** 道具强化卡：+0.5s/次进度条 + 阶梯价（首购 1000，每次 +2000），满 10 次禁用 */
  function upgradeCard(listing: ShopListing, details: HTMLElement): void {
    const state = actions.itemUpgradeState?.(listing.refId ?? '') ?? null;
    const count = state?.count ?? 0;
    const max = state?.max ?? 10;
    const maxed = !!state && count >= max;
    details.append(
      uiText('span', `道具强化 · ${count}/${max}`, 'shop-product-status'),
      uiText('h2', listing.rewardText), uiText('p', listing.description, 'shop-product-desc'),
      progressBar(count, max),
    );
    let actionRow: HTMLElement;
    if (maxed) {
      const maxedButton = uiButton('已满级', 'shop-product-action');
      maxedButton.disabled = true;
      actionRow = maxedButton;
    } else if (pendingOffer === listing.id) {
      actionRow = confirmPair(listing);
    } else {
      actionRow = uiButton('强化', 'shop-product-action is-green', () => { pendingOffer = listing.id; render(); });
    }
    // 强化按钮右下角放大：操作行右对齐（确认/取消对随行）
    const actionArea = uiText('div', '', 'shop-card-actions');
    actionArea.append(coinPrice(state ? `能量币 ×${state.priceCoin}` : ''), actionRow);
    details.append(actionArea);
  }

  /** 角色碎片卡：未拥有=碎片进度+买碎片包；已拥有=等级+升级（攒满自动合成，升级直接结算并回显） */
  function shardCard(listing: ShopListing, details: HTMLElement): void {
    const state = actions.shardCardState?.(listing.refId ?? '') ?? null;
    const shards = state?.shards ?? 0;
    const step = state?.step ?? 50;
    const owned = !!state?.owned;
    const level = state?.level ?? 1;
    const maxLevel = state?.maxLevel ?? 10;
    const maxed = owned && level >= maxLevel;
    details.append(
      uiText('span', owned ? `已拥有 · Lv.${level}/${maxLevel}` : `碎片进度 · ${shards}/${step}`, 'shop-product-status'),
      uiText('h2', listing.rewardText), uiText('p', listing.description, 'shop-product-desc'),
      progressBar(shards, step),
    );
    const actionRow = uiText('div', '', 'shop-product-confirm');
    if (owned) {
      const upgrade = uiButton(maxed ? '已满级' : `升级 Lv.${level + 1}`, 'shop-product-action', () => {
        const result = (state && actions.onUpgradeCharacter?.(state.charId)) ?? { ok: false, message: '升级不可用' };
        status.textContent = `${listing.rewardText}：${result.message}`;
        render();
      });
      if (maxed || shards < step) upgrade.disabled = true;
      actionRow.append(upgrade);
    }
    const buy = pendingOffer === listing.id ? confirmPair(listing)
      : uiButton('买碎片', 'shop-product-action', () => { pendingOffer = listing.id; render(); });
    actionRow.append(buy);
    details.append(coinPrice(state ? `能量币 ×${state.packPriceCoin}` : ''), actionRow);
  }

  /** 解锁型卡（场景 1000 能量币 / 角色本体 coin/key）：owned 置灰、两步确认；非直购（loot/event/free/待开放）按钮只展示途径 */
  function unlockableCard(listing: ShopListing, details: HTMLElement): void {
    const isTheme = listing.kind === 'theme';
    const state = isTheme ? actions.themeCardState?.(listing.refId ?? '') : actions.characterCardState?.(listing.refId ?? '');
    const owned = !!state?.owned;
    const kind = state && 'unlockKind' in state ? state.unlockKind : 'free';
    const priceCoin = state && 'priceCoin' in state ? state.priceCoin : 0;
    const priceText = state && 'priceText' in state ? state.priceText : '';
    const direct = isTheme ? true : kind === 'coin' || kind === 'key';
    const lockedByConfig = listing.availability !== 'purchasable';
    const buyable = !lockedByConfig && !owned && direct;
    const active = isTheme && state && 'active' in state && state.active;
    details.append(
      uiText('span', `${active ? '使用中' : owned ? '已解锁' : shopListingBadgeText(listing)}`, 'shop-product-status'),
      uiText('h2', listing.rewardText), uiText('p', listing.description, 'shop-product-desc'),
    );
    let actionRow: HTMLElement;
    if (owned) {
      const ownedButton = uiButton(isTheme ? '已解锁' : '已拥有', 'shop-product-action');
      ownedButton.disabled = true;
      actionRow = ownedButton;
    } else if (pendingOffer === listing.id && buyable) {
      actionRow = confirmPair(listing);
    } else {
      const fallback = isTheme ? listing.statusText ?? '仅供浏览'
        : kind === 'loot' ? '宝箱产出 · 可攒碎片' : kind === 'event' ? '活动解锁 · 可攒碎片' : '初始伙伴';
      const action = buyable
        ? uiButton('解锁', 'shop-product-action', () => { pendingOffer = listing.id; render(); })
        : uiButton(fallback, 'shop-product-action');
      if (!buyable) {
        action.disabled = true;
        action.title = '仅展示配置，不执行购买或兑换';
      }
      actionRow = action;
    }
    const icon = isTheme || kind === 'coin' ? `${import.meta.env.BASE_URL}assets/ui/icon_gold.png` : kind === 'key' ? keyIcon : null;
    const price = uiText('div', isTheme && state ? `能量币 ×${priceCoin}` : priceText, 'shop-product-price');
    if (icon) {
      const img = document.createElement('img');
      img.src = icon;
      img.alt = '';
      price.prepend(img);
    }
    details.append(price, actionRow);
  }

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
      art.append(uiText('span', listing.category === 'currency' ? '◇' : listing.category === 'scene' ? '▲' : '✦'));
    }
    const details = uiText('div', '', 'shop-product-details');
    if (listing.kind === 'itemUpgrade') upgradeCard(listing, details);
    else if (listing.kind === 'shard') shardCard(listing, details);
    else if (listing.kind === 'theme' || listing.kind === 'character') unlockableCard(listing, details);
    else offerCard(listing, details);
    card.append(art, details);
    return card;
  }

  for (const category of SHOP_CATEGORIES) {
    const button = uiButton(category.label, 'shop-tab', () => { activeCategory = category.id; page = 0; pendingOffer = null; render(); });
    tabs.set(category.id, button);
    tabBar.append(button);
  }
  const cards = uiText('div', '', 'shop-card-layer');
  cards.setAttribute('aria-label', '商品列表');
  const pageNav = uiText('nav', '', 'shop-page-nav');
  pageNav.setAttribute('aria-label', '商品分页');
  const previous = uiButton('‹ 上一页', 'shop-page-button', () => { page--; pendingOffer = null; render(); });
  const next = uiButton('下一页 ›', 'shop-page-button', () => { page++; pendingOffer = null; render(); });
  const pageText = uiText('span', '', 'shop-page-label');
  pageText.setAttribute('aria-live', 'polite');
  pageNav.append(previous, pageText, next);
  frame.append(header, note, notice, walletBar, status, tabBar, cards, pageNav);

  function render(): void {
    const shown = filterShopCatalog(catalog, activeCategory);
    const pageCount = Math.max(1, Math.ceil(shown.length / SHOP_PAGE_SIZE));
    page = Math.max(0, Math.min(page, pageCount - 1));
    previous.disabled = page === 0;
    next.disabled = page + 1 >= pageCount;
    pageText.textContent = `${page + 1} / ${pageCount}`;
    const wallet = actions.wallet();
    walletBar.textContent = `余额：金币 ${wallet.coins} · 钥匙 ${wallet.keys} · 钻石 ${wallet.diamonds}`;
    for (const [category, button] of tabs) {
      const selected = category === activeCategory;
      button.classList.toggle('is-active', selected);
      button.setAttribute('aria-pressed', String(selected));
    }
    cards.replaceChildren(...shown.slice(page * SHOP_PAGE_SIZE, (page + 1) * SHOP_PAGE_SIZE).map(listing => makeCard(listing)));
    if (!shown.length) cards.append(uiText('p', '暂无可浏览的配置', 'shop-empty-message ui-panel'));
  }
  render();
  return pageLifecycle(root, actions.onBack);
}
