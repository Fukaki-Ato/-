/**
 * 商店页（canvas 版，overlayViews 装配；web DOM 版在 apps/web shopOverlay）。
 * 目录构建在 shopCatalog.ts；本文件只负责布局与购买交互（本机经济，flow 层 buyOffer 结算）。
 * statusText=null 的商品渲染「购买」按钮；待开放/预览卡保持仅浏览（审查 M4-2）。
 */
import { Box, Button, Label, type UiView } from '@tr/framework/ui/index.js';
import type { UiHost } from '@tr/framework/ui/host.js';
import type { GameContent } from '@tr/game/core/config/configTypes.js';
import type { ShopActions } from '../flow/views.js';
import {
  buildShopCatalog, filterShopCatalog, SHOP_CATEGORIES, SHOP_PAGE_SIZE, shopListingBadgeText,
  type ShopFilterCategory, type ShopListing,
} from './shopCatalog.js';
import { ShopImage, type ShopImageAssets } from './shopImage.js';

export interface ShopPage { view: UiView; setAssets(assets: ShopImageAssets): void }

export function buildShopPage(host: UiHost, content: GameContent, actions: ShopActions, assets?: ShopImageAssets): ShopPage {
  const c = host.theme.colors;
  let imageAssets = assets;
  const view = host.makeView();
  const catalog = buildShopCatalog(content);
  const categories = new Map<ShopFilterCategory, Button>();
  let activeCategory: ShopFilterCategory = 'all';
  let page = 0;
  const compact = view.height < 800;
  const artSize = compact ? 42 : 64;
  const cardHeight = compact ? 58 : 80;
  const initialPageCount = Math.max(1, Math.ceil(catalog.length / SHOP_PAGE_SIZE));

  const cards = new Box({ direction: 'column', flex: 1, gap: 8, align: 'stretch' });
  const pageText = new Label({ text: `1/${initialPageCount} 页`, fontSizePx: 12, color: c.muted, align: 'center' });
  const walletText = new Label({ text: '', fontSizePx: 12, color: c.gold, align: 'center' });
  const hint = new Label({ text: '', fontSizePx: 11, color: c.muted, align: 'center' });
  const previous = new Button({
    label: '上一页', fontSizePx: 12, disabled: true, padding: { top: 6, bottom: 6, left: 10, right: 10 },
    onClick: () => { page--; update(); },
  });
  const next = new Button({
    label: '下一页', fontSizePx: 12, disabled: initialPageCount === 1,
    padding: { top: 6, bottom: 6, left: 10, right: 10 },
    onClick: () => { page++; update(); },
  });

  function refreshWallet(): void {
    const w = actions.wallet();
    walletText.setText(`余额：金币 ${w.coins} · 钥匙 ${w.keys} · 钻石 ${w.diamonds}`);
  }

  function makeCard(listing: ShopListing): Box {
    const accent = listing.category === 'currency' ? c.gold
      : listing.category === 'shards' ? c.neon
        : listing.category === 'skins' ? '#B48CFF' : '#43D9A3';
    const buyable = listing.statusText === null && !!listing.priceText;
    const buy = new Button({
      label: buyable ? '购买' : listing.statusText ?? '预览',
      fontSizePx: compact ? 10 : 12, disabled: !buyable,
      padding: { top: 4, bottom: 4, left: 10, right: 10 },
      onClick: () => {
        const r = actions.onBuy(listing.id);
        hint.setText(r.message);
        refreshWallet();
        update();
      },
    });
    const details = [
      new Label({ text: listing.rewardText, fontSizePx: compact ? 12 : 15, color: c.text }),
      new Label({
        text: shopListingBadgeText(listing),
        fontSizePx: compact ? 9 : 11,
        color: listing.statusText ? c.gold : accent,
      }),
      new Box({ direction: 'row', align: 'center', gap: 4 }, [
        ...(imageAssets && listing.priceIcon ? [new ShopImage(imageAssets, listing.priceIcon, compact ? 14 : 16)] : []),
        new Label({ text: `标价：${listing.priceText || '—'}`, fontSizePx: compact ? 10 : 12, color: c.gold }),
        buy,
      ]),
    ];
    const illustration = imageAssets && listing.illustration
      ? new ShopImage(imageAssets, listing.illustration, artSize)
      : new Box({ width: artSize, height: artSize, background: 'card', align: 'center', justify: 'center' }, [
        new Label({ text: '暂无图片', fontSizePx: 10, color: c.muted, align: 'center' }),
      ]);
    return new Box(
      { direction: 'row', align: 'center', gap: 8, padding: compact ? 4 : 6, height: cardHeight, background: 'card' },
      [illustration, new Box({ width: 5, height: 42, background: host.solidSkin, backgroundColor: accent }),
        new Box({ direction: 'column', flex: 1, align: 'stretch', gap: compact ? 1 : 3 }, details)],
    );
  }

  function update(): void {
    const shown = filterShopCatalog(catalog, activeCategory);
    const pageCount = Math.max(1, Math.ceil(shown.length / SHOP_PAGE_SIZE));
    page = Math.max(0, Math.min(page, pageCount - 1));
    pageText.setText(`${page + 1}/${pageCount} 页`);
    previous.setDisabled(page === 0);
    next.setDisabled(page + 1 >= pageCount);
    for (const [id, button] of categories) {
      const label = SHOP_CATEGORIES.find(definition => definition.id === id)!.label;
      button.setLabel(id === activeCategory ? `✔ ${label}` : label);
    }
    for (const old of [...cards.children]) cards.remove(old);
    const pageListings = shown.slice(page * SHOP_PAGE_SIZE, (page + 1) * SHOP_PAGE_SIZE);
    if (!pageListings.length) {
      cards.add(new Label({ text: '暂无可浏览的配置', fontSizePx: 14, color: c.muted, align: 'center' }));
    } else {
      for (const listing of pageListings) cards.add(makeCard(listing));
    }
  }

  const categoryButtons = new Box({ direction: 'row', justify: 'center', align: 'center', gap: 5 });
  for (const definition of SHOP_CATEGORIES) {
    const button = new Button({
      label: definition.id === 'all' ? `✔ ${definition.label}` : definition.label,
      fontSizePx: 12,
      padding: { top: 6, bottom: 6, left: 8, right: 8 },
      onClick: () => { activeCategory = definition.id; page = 0; update(); },
    });
    categories.set(definition.id, button);
    categoryButtons.add(button);
  }

  view.add(new Box(
    { direction: 'column', align: 'center', flex: 1, padding: 12 },
    [new Box(
      { direction: 'column', width: { percent: 100 }, maxWidth: 720, flex: 1, gap: 10,
        padding: { top: 14, bottom: 14, left: 14, right: 14 }, background: 'panel' },
      [
        new Box({ direction: 'row', align: 'center', gap: 12 }, [
          new Button({ label: '返回', fontSizePx: 13, padding: { top: 6, bottom: 6, left: 10, right: 10 }, onClick: actions.onBack }),
          new Label({ text: '商店', fontSizePx: 22, color: c.neon }),
        ]),
        walletText,
        hint,
        categoryButtons,
        cards,
        new Box({ direction: 'row', justify: 'center', align: 'center', gap: 12 }, [previous, pageText, next]),
      ],
    )],
  ));
  refreshWallet();
  update();
  return { view, setAssets: next => { imageAssets = next; update(); } };
}
