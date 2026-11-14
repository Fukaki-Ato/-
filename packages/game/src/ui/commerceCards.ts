import { Box, type Widget } from '@tr/framework/ui/index.js';
import type { UiHost } from '@tr/framework/ui/host.js';
import type { MarketOffer, OwnedCharacter, MarketTheme, InventoryItem } from '../core/commerce.js';
import { coast, text, WelfareAction } from './welfareCards.js';
import { characterPortrait, characterAbilities, themePalette, type CommerceArtwork } from './commerceArtwork.js';

export { coast, text, WelfareAction } from './welfareCards.js';

export function commerceCard(host: UiHost, children: Widget[], accent = false): Box {
  return new Box({ background: host.solidSkin, backgroundColor: accent ? coast.sea : coast.line, padding: 1 }, [
    new Box({ background: host.solidSkin, backgroundColor: coast.paper, padding: 14, gap: 8 }, children),
  ]);
}

export function offerAvailable(offer: MarketOffer): boolean {
  return offer.canPurchase && !offer.owned && offer.remaining !== 0;
}

export function offerDetails(offer: MarketOffer, artwork: CommerceArtwork = {}): Widget[] {
  const id = offer.grants.find(grant => grant.item.startsWith('char_'))?.item;
  const portrait = id ? characterPortrait(id, artwork) : undefined;
  return [text(offer.category === 'character' ? '角色招募' : '俱乐部兑换', 12, coast.sea),
    new Box({ direction: 'row', gap: portrait ? 10 : 0, align: 'center' }, [
      ...(portrait ? [portrait] : []), new Box({ width: 0, flex: 1 }, [text(offer.title, 19)]),
    ]), text(offer.description, 13, coast.muted),
    ...(id ? characterAbilities(id, artwork) : []),
    text(`报价：${offer.priceText}`, 16),
    ...offer.grants.map(grant => text(`${grant.name} ×${grant.amount}`, 14)),
    text(offer.remaining === null ? '不限购' : `剩余限购 ${offer.remaining}`, 12, coast.muted),
  ];
}

export function offerCard(host: UiHost, offer: MarketOffer, busy: boolean, onBuy: () => void,
  artwork: CommerceArtwork = {}): Box {
  const available = offerAvailable(offer);
  const state = offer.owned ? '已拥有' : offer.remaining === 0 ? '限购已用完'
    : !offer.canPurchase ? offer.unavailableReason ?? '暂不可购买' : '可购买';
  return commerceCard(host, [...offerDetails(offer, artwork), text(state, 13, available ? coast.sea : coast.muted),
    new WelfareAction(host, offer.owned ? '已拥有' : !available ? '不可购买' : '购买', onBuy, available && !busy),
  ], available);
}

export function characterCard(host: UiHost, character: OwnedCharacter, busy: boolean,
  onEquip: () => void, onShop: (() => void) | undefined, artwork: CommerceArtwork = {}, pending = false): Box {
  const state = character.owned ? character.equipped ? '当前出战' : '已拥有' : '未拥有';
  const portrait = characterPortrait(character.id, artwork);
  return commerceCard(host, [
    new Box({ direction: 'row', gap: portrait ? 10 : 0, align: 'center' }, [
      ...(portrait ? [portrait] : []), new Box({ width: 0, flex: 1, gap: 4 }, [
        text(`${character.rarity} · ${state}`, 12, character.equipped ? coast.sea : coast.muted),
        text(character.name, 21),
      ]),
    ]), text(character.tagline, 14, coast.muted), ...characterAbilities(character.id, artwork),
    new WelfareAction(host, pending ? '保存中…' : !character.owned ? '前往商店' : character.equipped ? '已出战' : '出战',
      character.owned ? onEquip : () => onShop?.(),
      !busy && (character.owned ? !character.equipped : !!onShop),
      character.equipped ? coast.gold : coast.coral),
  ], character.owned && character.equipped);
}

export function inventoryCard(host: UiHost, item: InventoryItem): Box {
  return commerceCard(host, [text(item.name, 17), text(`数量 ${item.amount}`, 14, coast.muted)]);
}

export function themeCard(host: UiHost, theme: MarketTheme, busy: boolean, onSelect: () => void,
  artwork: CommerceArtwork = {}): Box {
  return commerceCard(host, [text('跑酷主题', 12, coast.sea), text(theme.name, 19),
    ...themePalette(host, theme.id, artwork),
    text(theme.selected ? '当前主题' : '可选择', 13, coast.muted),
    new WelfareAction(host, theme.selected ? '已选择' : '选择主题', onSelect, !theme.selected && !busy,
      theme.selected ? coast.gold : coast.coral),
  ], theme.selected);
}
