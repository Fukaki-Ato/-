/**
 * 商店动态卡目录构造（从 shopCatalog 拆出，300 行预算）：场景/道具强化/角色本体/角色碎片四类卡。
 * 卡片静态文案在此收敛；解锁态/进度/动态价格由视图经 ShopActions 对应 state 动作读取，本层不碰存储。
 */
import type { GameContent } from '@tr/game/core/config/configTypes.js';
import type { ShopArtwork } from './shopImage.js';
import { entries, entryName, textOf, type ShopListing } from './shopCatalog.js';
import { canUseEquippedItem } from '../flow/itemAvailability.js';

type Entry = Record<string, unknown>;

export interface DynamicShopCards {
  /** 场景卡（场景分类默认展示；live 可解锁、draft 待开放） */
  sceneCards: ShopListing[];
  itemUpgradeCards: ShopListing[];
  /** 角色本体卡（角色分类：全角色上架） */
  characterCards: ShopListing[];
  /** 角色碎片卡（角色分类：全角色攒碎片/升级） */
  shardCards: ShopListing[];
}

export function buildDynamicCards(content: GameContent): DynamicShopCards {
  const items = entries(content.items.items);
  const characters = entries(content.characters.items);
  const shardRefs = entries(content.economy.params.shards);
  const offers = entries((content.economy.params.shop as { offers?: unknown } | undefined)?.offers);
  const themes = entries(content.themes.items);

  // 场景卡：全部场景上架（live 可解锁 / draft 待开放）；解锁价由视图从 themes.json price 动态读
  const sceneCards: ShopListing[] = themes.flatMap(theme => {
    const id = typeof theme['id'] === 'string' ? theme['id'] : '';
    if (!id) return [];
    const live = theme.status === 'live';
    return [{
      id: `scene_${id}`, kind: 'theme', refId: id,
      category: 'scene', categories: ['scene'],
      rewardText: entryName(theme, id),
      description: '场景主题 · 解锁后可在设置页自由切换',
      priceText: '', statusText: live ? null : '待开放',
      availability: live ? 'purchasable' : 'coming-soon',
    }];
  });

  // 道具强化卡（全部带时长的游戏内道具动态上架）：+0.5s/次阶梯价，价格/进度由 actions.itemUpgradeState 读取；
  // 插画复用图集语义相近的精灵（金币加成→钱袋、头盔→护盾），无对应图的道具走占位样式（画风统一）
  const ITEM_UPGRADE_ART: Record<string, ShopArtwork> = { item_multiplier: 'coinBag', item_helmet: 'shield' };
  const itemUpgradeCards: ShopListing[] = items
    .filter(item => (item['effects'] as Entry[] | undefined)?.some(e => Number.isFinite(Number(e?.['durationS']))))
    // 未开放道具（如 xpMul 经验卡）不进强化货架——buyItemUpgrade 同口径拒绝
    .filter(item => canUseEquippedItem(content, String(item['id'])))
    .map(item => {
      const itemId = String(item['id']);
      return {
        id: `upgrade_${itemId}`, kind: 'itemUpgrade', refId: itemId,
        category: 'items', categories: ['items'],
        rewardText: `${entryName(item, itemId)} · 强化`,
        description: '每次强化 +0.5 秒时长，最多 10 次',
        priceText: '', statusText: null, availability: 'purchasable',
        illustration: itemId === 'item_magnet' ? 'magnet'
          : itemId === 'item_boots' ? 'boots'
          : itemId === 'item_shield' ? 'shield'
          : ITEM_UPGRADE_ART[itemId],
      };
    });

  // 角色本体卡（全角色上架）：解锁途径/价格由 actions.characterCardState 动态读取
  const characterCards: ShopListing[] = characters.filter(item => item.kind !== 'skin').map(char => {
    const charId = String(char.id);
    return {
      id: `character_${charId}`, kind: 'character', refId: charId,
      category: 'character', categories: ['character'],
      rewardText: entryName(char, charId),
      description: `${String(char['rarity'] ?? '')} · ${textOf(char, 'tagline')}`,
      priceText: '', statusText: null, availability: 'purchasable',
    };
  });

  // 角色碎片卡（全角色含活动/宝箱角色）：进度/合成/升级态由 actions.shardCardState 读取
  const shardCards: ShopListing[] = characters
    .filter(item => item.kind !== 'skin' && shardRefs.some(shard => shard.grants === item.id))
    .map(char => {
      const charId = String(char.id);
      const packSize = Number(offers
        .flatMap(offer => entries(offer.give))
        .find(give => give.item === `shard_${charId.slice(5)}`)?.n) || 5;
      return {
        id: `shardcard_${charId}`, kind: 'shard', refId: charId,
        category: 'shards', categories: ['shards'],
        rewardText: `${entryName(char, charId)}碎片`,
        description: `${String(char['rarity'] ?? '')} · 每包 ${packSize} 枚 · 攒满自动合成`,
        priceText: '', statusText: null, availability: 'purchasable',
      };
    });

  return { sceneCards, itemUpgradeCards, characterCards, shardCards };
}
