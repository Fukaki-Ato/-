import type { PlayerProfile } from './playerProfile.js';

export interface MarketGrant { item: string; amount: number; name: string }
export interface MarketOffer {
  id: string;
  category: 'character' | 'exchange';
  title: string;
  description: string;
  price: Record<string, number>;
  priceText: string;
  grants: MarketGrant[];
  remaining: number | null;
  owned: boolean;
  canPurchase: boolean;
  unavailableReason: string | null;
}
export interface OwnedCharacter {
  id: string;
  name: string;
  tagline: string;
  rarity: string;
  owned: boolean;
  equipped: boolean;
}
export interface InventoryItem { id: string; name: string; amount: number }
export interface MarketTheme { id: string; name: string; selected: boolean }
export interface CommerceSnapshot {
  profile: PlayerProfile;
  catalogVersion: string;
  offers: MarketOffer[];
  characters: OwnedCharacter[];
  items: InventoryItem[];
  themes: MarketTheme[];
}
export interface CommerceService {
  load(): Promise<CommerceSnapshot>;
  newRequestId(): string;
  buy(offerId: string, requestId: string, catalogVersion: string): Promise<CommerceSnapshot>;
  equip(characterId: string): Promise<CommerceSnapshot>;
  selectTheme(themeId: string): Promise<CommerceSnapshot>;
}
