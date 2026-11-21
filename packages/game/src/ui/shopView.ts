/**
 * 商店页（canvas 版，overlayViews 装配；web DOM 版在 apps/web shopOverlay）；目录构建在 shopCatalog/shopCards。
 * 购买交互（本机经济，flow 层结算）：offer=buyOffer、itemUpgrade=+0.5s 阶梯强化（绿按钮）、
 * shard=买包+自动合成+升级、theme/character=解锁卡。购买统一两步防误触；限购/进度/解锁态经 actions 动态读取。
 */
import { Box, Button, Label, ScrollView, mixHex, type UiView } from '@tr/framework/ui/index.js';
import type { Widget } from '@tr/framework/ui/widget.js';
import type { UiHost } from '@tr/framework/ui/host.js';
import type { GameContent } from '@tr/game/core/config/configTypes.js';
import type { BuyResult, ShopActions } from '../flow/views.js';
import {
  buildShopCatalog, filterShopCatalog, SHOP_CATEGORIES, SHOP_PAGE_SIZE, shopListingBadgeText,
  type ShopFilterCategory, type ShopListing,
} from './shopCatalog.js';
import { ShopImage, type ShopArtwork, type ShopImageAssets } from './shopImage.js';

export interface ShopPage { view: UiView; setAssets(assets: ShopImageAssets): void }

export function buildShopPage(host: UiHost, content: GameContent, actions: ShopActions, assets?: ShopImageAssets): ShopPage {
  const c = host.theme.colors;
  let imageAssets = assets;
  const view = host.makeView();
  const catalog = buildShopCatalog(content);
  const categories = new Map<ShopFilterCategory, Button>();
  let activeCategory: ShopFilterCategory = 'scene';
  let page = 0;
  let pendingOffer: string | null = null;
  const compact = view.height < 800;
  const artSize = compact ? 42 : 64;
  const cardHeight = compact ? 58 : 80;
  const initialPageCount = Math.max(1, Math.ceil(catalog.length / SHOP_PAGE_SIZE));

  const cards = new Box({ direction: 'column', flex: 1, gap: 8, align: 'stretch' });
  const pageText = new Label({ text: `1/${initialPageCount} 页`, fontSizePx: 12, color: c.muted, align: 'center' });
  const walletText = new Label({ text: '', fontSizePx: 12, color: c.gold, align: 'center' });
  const hint = new Label({ text: '', fontSizePx: 11, color: c.muted, align: 'center' });
  const previous = new Button({ label: '上一页', fontSizePx: 12, disabled: true, padding: { top: 6, bottom: 6, left: 10, right: 10 }, onClick: () => { page--; pendingOffer = null; update(); } });
  const next = new Button({ label: '下一页', fontSizePx: 12, disabled: initialPageCount === 1, padding: { top: 6, bottom: 6, left: 10, right: 10 }, onClick: () => { page++; pendingOffer = null; update(); } });

  const refreshWallet = (): void => walletText.setText(
    `余额：金币 ${actions.wallet().coins} · 钥匙 ${actions.wallet().keys} · 钻石 ${actions.wallet().diamonds}`);

  function progressBar(value: number, total: number, color: string): Box {
    const pct = total > 0 ? Math.max(0, Math.min(100, value / total * 100)) : 0;
    return new Box(
      { flex: 1, height: 8, background: host.solidSkin, backgroundColor: mixHex(c.card, c.text, 0.3) },
      [new Box({ width: { percent: pct }, height: 8, background: host.solidSkin, backgroundColor: color })],
    );
  }

  /** 按钮动作分派：offer → onBuy；itemUpgrade → onBuyItemUpgrade；shard → onBuyShardPack */
  function doBuy(listing: ShopListing): BuyResult {
    if (listing.kind === 'itemUpgrade' && actions.onBuyItemUpgrade) return actions.onBuyItemUpgrade(listing.refId ?? '');
    if (listing.kind === 'shard' && actions.onBuyShardPack) return actions.onBuyShardPack(listing.refId ?? '');
    if (listing.kind === 'theme' && actions.onBuyTheme) return actions.onBuyTheme(listing.refId ?? '');
    if (listing.kind === 'character' && actions.onUnlockCharacter) return actions.onUnlockCharacter(listing.refId ?? '');
    return actions.onBuy(listing.id);
  }

  function confirmPair(listing: ShopListing): Box {
    return new Box({ direction: 'row', align: 'center', gap: 4 }, [
      new Button({
        label: '✔ 确认购买', fontSizePx: compact ? 10 : 12, backgroundColor: '#43C24D',
        padding: { top: 4, bottom: 4, left: 10, right: 10 },
        onClick: () => {
          const r = doBuy(listing);
          pendingOffer = null;
          // 成功静默完成（进度/余额刷新即反馈）；失败仍要提示原因
          if (!r.ok) hint.setText(r.message);
          refreshWallet();
          update();
        },
      }),
      new Button({
        label: '取消', fontSizePx: compact ? 10 : 12, backgroundColor: '#F0C24D', labelColor: '#5C3A00',
        padding: { top: 4, bottom: 4, left: 10, right: 10 },
        onClick: () => { pendingOffer = null; update(); },
      }),
    ]);
  }

  const smallButton = (label: string, disabled: boolean, onClick: () => void, bgColor?: string): Button => new Button({
    label, fontSizePx: compact ? 10 : 12, disabled, ...(bgColor ? { backgroundColor: bgColor } : {}),
    padding: { top: 4, bottom: 4, left: 10, right: 10 }, onClick,
  });

  /** 价格行；pushRight=true 时右端对齐操作按钮（强化卡右下角放大布局） */
  function priceRow(priceIcon: 'coinIcon' | 'gemIcon' | undefined, priceText: string, action: Box | Button, pushRight = false): Box {
    return new Box({ direction: 'row', align: 'center', gap: 6 }, [
      ...(imageAssets && priceIcon ? [new ShopImage(imageAssets, priceIcon, compact ? 14 : 16)] : []),
      new Label({ text: priceText || '—', fontSizePx: compact ? 10 : 12, color: c.gold }),
      ...(pushRight ? [new Box({ flex: 1 })] : []),
      action,
    ]);
  }

  function cardShell(listing: ShopListing, accent: string, rows: Widget[], height = cardHeight): Box {
    const illustration: Box | ShopImage = imageAssets && listing.illustration
      ? new ShopImage(imageAssets, listing.illustration, artSize)
      : new Box({ width: artSize, height: artSize, background: 'card', align: 'center', justify: 'center' }, [new Label({ text: '暂无图片', fontSizePx: 10, color: c.muted, align: 'center' })]);
    return new Box(
      { direction: 'row', align: 'center', gap: 8, padding: compact ? 4 : 6, height, background: 'card' },
      [illustration, new Box({ width: 5, height: 42, background: host.solidSkin, backgroundColor: accent }),
        new Box({ direction: 'column', flex: 1, align: 'stretch', gap: compact ? 1 : 3 }, rows)],
    );
  }

  /** 配置商品卡：限购余量徽标 + 「购买 → 确认」两步 */
  function offerCard(listing: ShopListing, accent: string): Box {
    const state = actions.purchaseState?.(listing.id) ?? null;
    const soldOut = !!state && state.remaining === 0;
    const buyable = listing.availability === 'purchasable' && !!listing.priceText && !soldOut;
    const action: Box | Button = pendingOffer === listing.id && buyable ? confirmPair(listing)
      : smallButton(
        soldOut ? (state!.oncePurchased ? '已购入' : '今日已购完')
          : buyable ? '购买' : listing.statusText ?? '预览',
        !buyable, () => { pendingOffer = listing.id; update(); },
      );
    const limitText = state?.perDay ? ` · 今日剩余 ${state.remaining}/${state.perDay}` : '';
    return cardShell(listing, accent, [
      new Label({ text: listing.rewardText, fontSizePx: compact ? 12 : 15, color: c.text }),
      new Label({
        text: `${shopListingBadgeText(listing)}${limitText}`,
        fontSizePx: compact ? 9 : 11,
        color: listing.availability === 'purchasable' ? accent : c.gold,
      }),
      priceRow(listing.priceIcon, `标价：${listing.priceText}`, action),
    ]);
  }

  /** 解锁型卡（场景 1000 能量币 / 角色本体 coin/key）：owned 置灰、两步确认；非直购按钮只展示途径 */
  function unlockableCard(listing: ShopListing, accent: string): Box {
    const isTheme = listing.kind === 'theme';
    const state = isTheme ? actions.themeCardState?.(listing.refId ?? '') : actions.characterCardState?.(listing.refId ?? '');
    const owned = !!state?.owned;
    const kind = state && 'unlockKind' in state ? state.unlockKind : 'free';
    const priceCoin = state && 'priceCoin' in state ? state.priceCoin : 0;
    const priceText = state && 'priceText' in state ? state.priceText : '';
    const direct = isTheme ? true : kind === 'coin' || kind === 'key';
    const lockedByConfig = listing.availability !== 'purchasable';
    const buyable = !lockedByConfig && !owned && direct;
    const fallbackLabel = isTheme ? listing.statusText ?? '预览'
      : kind === 'loot' ? '宝箱产出 · 可攒碎片' : kind === 'event' ? '活动解锁 · 可攒碎片' : '初始伙伴';
    const action: Box | Button = pendingOffer === listing.id && buyable ? confirmPair(listing)
      : smallButton(owned ? (isTheme ? '已解锁' : '已拥有') : buyable ? '解锁' : fallbackLabel, !buyable,
        () => { pendingOffer = listing.id; update(); });
    const icon = isTheme || kind === 'coin' ? 'coinIcon' as const : kind === 'key' ? 'gemIcon' as const : undefined;
    const priceLine = isTheme ? (state ? `标价：能量币 ×${priceCoin}` : '')
      : direct && priceText ? `标价：${priceText}` : priceText;
    return cardShell(listing, accent, [
      new Label({
        text: `${listing.rewardText}${isTheme && state && 'active' in state && state.active ? ' · 使用中' : ''}`,
        fontSizePx: compact ? 12 : 15, color: c.text,
      }),
      new Label({
        text: shopListingBadgeText(listing),
        fontSizePx: compact ? 9 : 11,
        color: lockedByConfig || owned ? c.gold : accent,
      }),
      priceRow(icon, priceLine, action),
    ]);
  }

  /** 道具强化卡：+0.5s/次进度条 + 阶梯价（首购 1000，每次 +2000）；可强化=绿按钮，满级置灰 */
  function upgradeCard(listing: ShopListing, accent: string): Box {
    const state = actions.itemUpgradeState?.(listing.refId ?? '') ?? null;
    const count = state?.count ?? 0;
    const max = state?.max ?? 10;
    const maxed = !!state && count >= max;
    const action: Box | Button = maxed ? smallButton('已满级', true, () => {})
      : pendingOffer === listing.id ? confirmPair(listing)
        : new Button({
          label: '强化', fontSizePx: compact ? 11 : 13, backgroundColor: '#43C24D',
          padding: { top: 7, bottom: 7, left: 16, right: 16 },
          onClick: () => { pendingOffer = listing.id; update(); },
        });
    return cardShell(listing, accent, [
      new Label({ text: listing.rewardText, fontSizePx: compact ? 12 : 15, color: c.text }),
      new Box({ direction: 'row', align: 'center', gap: 6 }, [
        progressBar(count, max, accent),
        new Label({ text: `${count}/${max}`, fontSizePx: compact ? 9 : 11, color: c.muted }),
      ]),
      // 强化按钮右下角放大：价格行右端对齐放大按钮
      priceRow('coinIcon', state ? `能量币 ×${state.priceCoin}` : '', action, true),
    ]);
  }

  /** 角色碎片卡：未拥有=碎片进度条+买碎片包；已拥有=等级+升级进度+升级/继续买碎片；满级禁用 */
  function shardCard(listing: ShopListing, accent: string): Box {
    const state = actions.shardCardState?.(listing.refId ?? '') ?? null;
    const shards = state?.shards ?? 0;
    const step = state?.step ?? 50;
    const owned = !!state?.owned;
    const level = state?.level ?? 1;
    const maxLevel = state?.maxLevel ?? 10;
    const maxed = owned && level >= maxLevel;
    const buy: Box | Button = pendingOffer === listing.id ? confirmPair(listing)
      : smallButton('买碎片', false, () => { pendingOffer = listing.id; update(); });
    const upgrade = owned ? smallButton(
      maxed ? '已满级' : `升级 Lv.${level + 1}`,
      maxed || shards < step,
      () => {
        const r = (state && actions.onUpgradeCharacter?.(state.charId)) ?? { ok: false, message: '升级不可用' };
        hint.setText(r.message);
        refreshWallet();
        update();
      },
    ) : null;
    const title = owned ? `${listing.rewardText} · 已拥有 Lv.${level}/${maxLevel}` : listing.rewardText;
    const actionRow = new Box({ direction: 'row', align: 'center', gap: 4 }, [
      ...(imageAssets ? [new ShopImage(imageAssets, 'coinIcon' as ShopArtwork, compact ? 14 : 16)] : []),
      new Label({ text: `标价：${state ? `能量币 ×${state.packPriceCoin}` : '—'}`, fontSizePx: compact ? 10 : 12, color: c.gold }),
      ...(upgrade ? [upgrade] : []),
      buy,
    ]);
    return cardShell(listing, accent, [
      new Label({ text: title, fontSizePx: compact ? 12 : 14, color: c.text }),
      new Box({ direction: 'row', align: 'center', gap: 6 }, [
        progressBar(shards, step, accent),
        new Label({ text: `${shards}/${step}`, fontSizePx: compact ? 9 : 11, color: c.muted }),
      ]),
      actionRow,
    ], compact ? 70 : 88);
  }

  function makeCard(listing: ShopListing): Box {
    const accent = ({
      currency: c.gold, shards: c.neon, scene: '#7FD1FF', character: '#FFB84D', skins: '#B48CFF',
    } as Record<string, string>)[listing.category] ?? '#43D9A3';
    if (listing.kind === 'itemUpgrade') return upgradeCard(listing, accent);
    if (listing.kind === 'shard') return shardCard(listing, accent);
    if (listing.kind === 'theme' || listing.kind === 'character') return unlockableCard(listing, accent);
    return offerCard(listing, accent);
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
      label: definition.label,
      fontSizePx: 12,
      padding: { top: 6, bottom: 6, left: 8, right: 8 },
      onClick: () => { activeCategory = definition.id; page = 0; pendingOffer = null; update(); },
    });
    categories.set(definition.id, button);
    categoryButtons.add(button);
  }

  const pageBar = new Box(
    { direction: 'row', justify: 'center', align: 'center', gap: 12, absolute: true, left: 0, right: 0, bottom: 0 },
    [previous, pageText, next],
  );

  const panel = new Box(
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
      // 卡片区滚动容器（同成就页）：卡片总高可超视口，滚动查看；pageBar 叠加在面板底部
      new ScrollView({ axis: 'y', flex: 1, content: cards }),
    ],
  );
  panel.add(pageBar);
  view.add(new Box({ direction: 'column', align: 'center', flex: 1, padding: 12 }, [panel]));
  refreshWallet();
  update();
  return { view, setAssets: next => { imageAssets = next; update(); } };
}
