/**
 * 商店目录构建（从 shopView 拆出；动态卡构造在 shopCards.ts）。
 * 只读地把 economy.shop.offers + 动态卡（场景/道具强化/角色本体/角色碎片）+ 预览卡收敛成 ShopListing；
 * 购买交互在 shopView（canvas）与 apps/web shopOverlay（DOM）。上架态以 availability 结构化字段为准
 * （purchasable 才有购买按钮），statusText 仅作展示文案；限购/进度/解锁态不在此层（依赖 store，
 * 见 localEconomy.offerPurchaseState、itemUpgradeState、themeCardState 与 unlock.characterCardState）。
 */
import type { GameContent } from '@tr/game/core/config/configTypes.js';
import type { ShopArtwork } from './shopImage.js';
import { canUseEquippedItem } from '../flow/itemAvailability.js';
import { buildDynamicCards } from './shopCards.js';

export type ShopCategory = 'scene' | 'currency' | 'items' | 'shards' | 'skins' | 'character';
export type ShopFilterCategory = 'scene' | 'currency' | 'items' | 'special';
/** 结构化上架态：purchasable=可购买；coming-soon=有购买入口但暂不可买（活动/素材未就绪）；browse=纯配置展示不走购买 */
export type ShopAvailability = 'purchasable' | 'coming-soon' | 'browse';
/** 卡片类型：offer=配置商品；itemUpgrade=道具强化；shard=角色碎片卡；theme=场景卡；character=角色本体卡 */
export type ShopListingKind = 'offer' | 'itemUpgrade' | 'shard' | 'theme' | 'character';
export interface ShopListing {
  id: string;
  kind: ShopListingKind;
  /** itemUpgrade→itemId；shard/character→charId；theme→themeId；offer 无需（id 即 offerId） */
  refId?: string;
  category: ShopCategory;
  categories: ShopCategory[];
  rewardText: string;
  description: string;
  priceText: string;
  priceIcon?: 'coinIcon' | 'gemIcon';
  statusText: string | null;
  availability: ShopAvailability;
  illustration?: ShopArtwork;
}
export const SHOP_PAGE_SIZE = 6;
/** 首分类=场景（默认选中，商店打开即浏览场景）；special=角色（本体+碎片+皮肤） */
export const SHOP_CATEGORIES: Array<{ id: ShopFilterCategory; label: string }> = [
  { id: 'scene', label: '场景' },
  { id: 'currency', label: '货币' },
  { id: 'items', label: '道具' },
  { id: 'special', label: '角色' },
];
export type Entry = Record<string, unknown>;
export function isEntry(value: unknown): value is Entry {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function entries(value: unknown): Entry[] {
  return Array.isArray(value) ? value.filter(isEntry) : [];
}
export function textOf(entry: Entry | undefined, field: string): string {
  if (!entry) return '';
  const localized = entry[field];
  if (isEntry(localized) && typeof localized['zh-CN'] === 'string') return localized['zh-CN'];
  return '';
}
export function entryName(entry: Entry | undefined, fallback: string): string {
  return textOf(entry, 'name') || fallback;
}
const CATEGORY_LABELS: Record<ShopCategory, string> = {
  scene: '场景', currency: '货币', items: '道具', shards: '碎片', skins: '皮肤', character: '角色',
};
export const shopCategoryLabel = (category: ShopCategory): string => CATEGORY_LABELS[category];
export const shopListingBadgeText = (listing: ShopListing): string => {
  const category = shopCategoryLabel(listing.category);
  if (listing.availability === 'coming-soon') return `${category} · ${listing.statusText}`;
  return listing.statusText ?? category;
};
export const filterShopCatalog = (catalog: ShopListing[], category: ShopFilterCategory): ShopListing[] =>
  category === 'scene' ? catalog.filter(listing => listing.categories.includes('scene'))
    : category === 'special' ? catalog.filter(listing => listing.categories.some(id => id === 'shards' || id === 'skins' || id === 'character'))
      : catalog.filter(listing => listing.categories.includes(category));

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

  const configuredOffers: ShopListing[] = offers.flatMap(offer => {
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
    const hasUnavailableReward = rewards.some(reward => reward.status === 'draft' || reward.status === 'retired'
      || (reward.itemId.startsWith('item_') && !canUseEquippedItem(content, reward.itemId)));
    const blocked = hasUnavailableReference || hasUnavailableReward;
    return [{
      id: offer.id,
      kind: 'offer',
      category,
      categories,
      rewardText: rewards.map(reward => `${reward.name} ×${reward.count}`).join(' · '),
      description: rewards.map(reward => reward.description).filter(Boolean).join(' · '),
      ...price,
      statusText: blocked ? '待开放' : null,
      availability: blocked ? 'coming-soon' : 'purchasable',
      illustration: rewards.length === 1 ? rewards[0]!.illustration : undefined,
    }];
  });
  if (!configuredOffers.length) return [];

  const lootTables: ShopListing[] = entries(content.economy.params.lootTables).map(table => {
    const tableId = typeof table.id === 'string' ? table.id : 'loot';
    // 宝箱三档已有专属开启页（chest 场景），商店里只作配置导览
    const name = tableId === 'loot_coin_chest' ? '金币箱' : tableId === 'loot_thunder_box' ? '雷霆箱'
      : tableId === 'loot_chest_bronze' ? '铜宝箱' : tableId === 'loot_chest_silver' ? '银宝箱'
        : tableId === 'loot_chest_gold' ? '金宝箱' : tableId;
    const isChestTier = tableId.startsWith('loot_chest_');
    const price = priceInfo(table.cost);
    return {
      id: `preview_${tableId}`, kind: 'offer', category: 'items' as const, categories: ['items' as const],
      rewardText: `${name}（配置）`,
      description: `配置内容 · ${entries(table.entries).length} 项`,
      ...price, statusText: isChestTier ? '宝箱页开启' : '仅浏览配置', availability: 'browse', illustration: 'chest' as const,
    };
  });

  const dynamic = buildDynamicCards(content);
  const coinOffers = configuredOffers.filter(listing => listing.illustration === 'coinBag');
  // 碎片 offer 已由碎片卡承载（带进度条/合成态），不再以普通商品卡重复出现
  const otherOffers = configuredOffers.filter(listing =>
    listing.illustration !== 'coinBag' && !listing.id.startsWith('offer_shard_'));

  return [
    ...dynamic.sceneCards,
    ...coinOffers,
    ...dynamic.itemUpgradeCards,
    ...dynamic.characterCards,
    ...dynamic.shardCards,
    ...otherOffers,
    ...lootTables,
    {
      id: 'preview_compass', kind: 'offer', category: 'items', categories: ['items'],
      rewardText: '方向标（素材）', description: '合成图图像，配置未提供',
      priceText: '', statusText: '待补充', availability: 'coming-soon', illustration: 'compass',
    },
  ];
}
