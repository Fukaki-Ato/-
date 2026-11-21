import type { CommerceSnapshot, MarketOffer, OwnedCharacter, InventoryItem, MarketTheme } from '@tr/game/core/commerce.js';
import { CloudApiError, parseCloudProfile, record } from './cloudProtocol.js';

const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const count = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const invalid = (): never => { throw new CloudApiError('INVALID_RESPONSE', '商店数据格式异常，请刷新重试'); };

function offer(value: unknown): MarketOffer {
  if (!record(value) || !text(value.id) || !text(value.title) || typeof value.description !== 'string'
    || !['character', 'exchange'].includes(String(value.category)) || !record(value.price)
    || !Object.values(value.price).every(count) || typeof value.priceText !== 'string'
    || !Array.isArray(value.grants) || !(value.remaining === null || count(value.remaining))
    || typeof value.owned !== 'boolean' || typeof value.canPurchase !== 'boolean'
    || !(value.unavailableReason === null || typeof value.unavailableReason === 'string')) return invalid();
  const grants = value.grants.map(item => {
    if (!record(item) || !text(item.item) || !text(item.name) || !count(item.amount) || item.amount === 0) return invalid();
    return { item: item.item, name: item.name, amount: item.amount };
  });
  return { id: value.id, category: value.category as MarketOffer['category'], title: value.title,
    description: value.description, price: { ...value.price } as Record<string, number>, priceText: value.priceText,
    grants, remaining: value.remaining, owned: value.owned, canPurchase: value.canPurchase, unavailableReason: value.unavailableReason };
}
function character(value: unknown): OwnedCharacter {
  if (!record(value) || !text(value.id) || !text(value.name) || typeof value.tagline !== 'string'
    || !text(value.rarity) || typeof value.owned !== 'boolean' || typeof value.equipped !== 'boolean') return invalid();
  return { id: value.id, name: value.name, tagline: value.tagline, rarity: value.rarity, owned: value.owned, equipped: value.equipped };
}
function item(value: unknown): InventoryItem {
  if (!record(value) || !text(value.id) || !text(value.name) || !count(value.amount)) return invalid();
  return { id: value.id, name: value.name, amount: value.amount };
}
function theme(value: unknown): MarketTheme {
  if (!record(value) || !text(value.id) || !text(value.name) || typeof value.selected !== 'boolean') return invalid();
  return { id: value.id, name: value.name, selected: value.selected };
}
export function parseCommerceSnapshot(value: unknown): CommerceSnapshot {
  if (!record(value) || !text(value.catalogVersion) || !Array.isArray(value.offers)
    || !Array.isArray(value.characters) || !Array.isArray(value.items) || !Array.isArray(value.themes)) return invalid();
  return { profile: parseCloudProfile(value.profile), catalogVersion: value.catalogVersion,
    offers: value.offers.map(offer), characters: value.characters.map(character), items: value.items.map(item), themes: value.themes.map(theme) };
}
