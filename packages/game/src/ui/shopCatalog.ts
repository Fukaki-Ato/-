/**
 * 商店目录构建（从 shopView 拆出：该文件要容纳购买交互，300 行上限两侧吃紧）。
 * 只读地把 economy.shop.offers + 预览卡收敛成 ShopListing 列表；购买交互在 shopView（canvas）
 * 与 apps/web shopOverlay（DOM）。statusText=null 的 listing 视为可直接购买。
 */
import type { GameContent } from '@tr/game/core/config/configTypes.js';
import type { ShopArtwork } from './shopImage.js';

export type ShopCategory = 'all' | 'currency' | 'items' | 'shards' | 'skins';
export type ShopFilterCategory = 'all' | 'currency' | 'items' | 'special';
export interface ShopListing {
  id: string;
  category: Exclude<ShopCategory, 'all'>;
  categories: Array<Exclude<ShopCategory, 'all'>>;
  rewardText: string;
  description: string;
  priceText: string;
  priceIcon?: 'coinIcon' | 'gemIcon';
  statusText: string | null;
  illustration?: ShopArtwork;
}
export const SHOP_PAGE_SIZE = 6;
export const SHOP_CATEGORIES: Array<{ id: ShopFilterCategory; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'currency', label: '货币' },
  { id: 'items', label: '道具' },
  { id: 'special', label: '角色' },
];
type Entry = Record<string, unknown>;
function isEntry(value: unknown): value is Entry {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function entries(value: unknown): Entry[] {
  return Array.isArray(value) ? value.filter(isEntry) : [];
}
function textOf(entry: Entry | undefined, field: string): string {
  if (!entry) return '';
  const localized = entry[field];
  if (isEntry(localized) && typeof localized['zh-CN'] === 'string') return localized['zh-CN'];
  return '';
}
function entryName(entry: Entry | undefined, fallback: string): string {
  return textOf(entry, 'name') || fallback;
}
const CATEGORY_LABELS: Record<Exclude<ShopCategory, 'all'>, string> = {
  currency: '货币', items: '道具', shards: '碎片', skins: '皮肤',
};
export const shopCategoryLabel = (category: Exclude<ShopCategory, 'all'>): string => CATEGORY_LABELS[category];
export const shopListingBadgeText = (listing: ShopListing): string => {
  const category = shopCategoryLabel(listing.category);
  return listing.statusText === '待开放' || listing.statusText === '待补充'
    ? `${category} · ${listing.statusText}` : listing.statusText ?? category;
};
export const filterShopCatalog = (catalog: ShopListing[], category: ShopFilterCategory): ShopListing[] =>
  category === 'all' ? catalog : catalog.filter(listing => category === 'special'
    ? listing.categories.some(id => id === 'shards' || id === 'skins') : listing.categories.includes(category));

export function buildShopCatalog(content: GameContent): ShopListing[] {
  const items = entries(content.items.items);
  const characters = entries(content.characters.items);
  const skins = characters.filter(item => item.kind === 'skin');
  const shardRefs = entries(content.economy.params.shards);
  const events = entries(content.events.items);
  const shop = content.economy.params.shop;
  const offers = isEntry(shop) ? entries(shop.offers) : [];
  const priceInfo = (raw: unknown) => {
    const price = isEntry(raw) ? raw : {};
    const rows = Object.entries(price).filter(([, amount]) => Number.isFinite(Number(amount))).map(([currency, amount]) => {
      const currencyEntry = items.find(item => item.id === `item_${currency}`);
      return { currency, text: `${entryName(currencyEntry, currency)} ×${Number(amount)}` };
    });
    return {
      priceText: rows.map(row => row.text).join(' · '),
      ...(rows.length === 1 && rows[0]?.currency === 'coin' ? { priceIcon: 'coinIcon' as const }
        : rows.length === 1 && rows[0]?.currency === 'key' ? { priceIcon: 'gemIcon' as const } : {}),
    };
  };

  const resolveReward = (itemId: string) => {
    const currencyId = itemId === 'coin' || itemId === 'key' ? `item_${itemId}` : itemId;
    const currency = items.find(item => item.id === currencyId);
    if (itemId === 'coin' || itemId === 'key') {
      return {
        category: 'currency' as const,
        name: entryName(currency, itemId),
        description: textOf(currency, 'desc'),
        status: currency?.status,
        illustration: itemId === 'coin' ? 'coinBag' as const : undefined,
      };
    }

    if (itemId.startsWith('shard_')) {
      const shard = shardRefs.find(item => item.id === itemId);
      const characterId = typeof shard?.grants === 'string' ? shard.grants : '';
      const character = characters.find(item => item.id === characterId);
      const characterName = entryName(character, characterId || itemId);
      return {
        category: 'shards' as const,
        name: `${characterName}碎片`,
        description: `角色碎片 · ${characterName}`,
        status: character?.status,
        illustration: undefined,
      };
    }

    const skin = skins.find(item => item.id === itemId);
    if (skin) {
      const base = characters.find(item => item.id === skin.baseRef);
      return {
        category: 'skins' as const,
        name: entryName(skin, itemId),
        description: `角色涂装 · ${entryName(base, String(skin.baseRef ?? ''))}`,
        status: skin.status,
        illustration: undefined,
      };
    }

    const item = items.find(candidate => candidate.id === itemId);
    return {
      category: 'items' as const,
      name: entryName(item, itemId),
      description: textOf(item, 'desc') || `配置道具 · ${itemId}`,
      status: item?.status,
      illustration: undefined,
    };
  };

  const configuredOffers = offers.flatMap(offer => {
    const rewardRows = entries(offer.give);
    if (!rewardRows.length || typeof offer.id !== 'string') return [];
    const rewards = rewardRows.map(reward => {
      const itemId = typeof reward.item === 'string' ? reward.item : '';
      const count = Number.isFinite(Number(reward.n)) ? Number(reward.n) : 0;
      return { itemId, count, ...resolveReward(itemId) };
    });
    const categories = [...new Set(rewards.map(reward => reward.category))];
    const category = categories[0]!;
    const price = priceInfo(offer.price);
    const eventRef = typeof offer.requiresEvent === 'string' ? offer.requiresEvent : '';
    const event = eventRef ? events.find(item => item.id === eventRef) : undefined;
    const hasUnavailableReference = Boolean(eventRef && event?.status !== 'live');
    const hasUnavailableReward = rewards.some(reward => reward.status === 'draft' || reward.status === 'retired');
    return [{
      id: offer.id,
      category,
      categories,
      rewardText: rewards.map(reward => `${reward.name} ×${reward.count}`).join(' · '),
      description: rewards.map(reward => reward.description).filter(Boolean).join(' · '),
      ...price,
      statusText: hasUnavailableReference || hasUnavailableReward ? '待开放' : null,
      illustration: rewards.length === 1 ? rewards[0]!.illustration : undefined,
    }];
  });
  if (!configuredOffers.length) return [];

  const itemPreviews: ShopListing[] = [
    ['item_magnet', 'magnet'], ['item_boots', 'boots'], ['item_shield', 'shield'],
  ].flatMap(([id, illustration]) => {
    const item = items.find(candidate => candidate.id === id);
    if (!item) return [];
    return [{
      id: `preview_${id}`, category: 'items', categories: ['items'],
      rewardText: entryName(item, id), description: textOf(item, 'desc'), priceText: '',
      statusText: '道具 · 非商店', illustration: illustration as ShopArtwork,
    }];
  });

  const lootTables = entries(content.economy.params.lootTables).map(table => {
    const tableId = typeof table.id === 'string' ? table.id : 'loot';
    const name = tableId === 'loot_coin_chest' ? '金币箱' : tableId === 'loot_thunder_box' ? '雷霆箱' : tableId;
    const price = priceInfo(table.cost);
    return {
      id: `preview_${tableId}`, category: 'items' as const, categories: ['items' as const],
      rewardText: `${name}（配置）`,
      description: `配置内容 · ${entries(table.entries).length} 项`,
      ...price, statusText: '仅浏览配置', illustration: 'chest' as const,
    };
  });
  const coinOffers = configuredOffers.filter(listing => listing.illustration === 'coinBag');
  const otherOffers = configuredOffers.filter(listing => listing.illustration !== 'coinBag');

  return [
    ...coinOffers,
    ...itemPreviews,
    ...otherOffers,
    ...lootTables,
    {
      id: 'preview_compass', category: 'items', categories: ['items'],
      rewardText: '方向标（素材）', description: '合成图图像，配置未提供',
      priceText: '', statusText: '待补充', illustration: 'compass',
    },
  ];
}
