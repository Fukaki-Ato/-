/**
 * 商店场景（从 mainFlow 拆出：场景装配签名与 eventsScene 同式，保 mainFlow 行数预算）。
 * 进店先跑一次碎片自动合成扫描（攒满 need["1"]=50 即解锁，覆盖宝箱/任务等非商店入账）；
 * 动作组装：shopActions（钱包/本机购买/限购快照/道具强化）+ shardShopActions（碎片卡/升级），
 * onUnlocked 统一接成就 tracker（charactersUnlocked 生产接线）。
 */
import type { PlatformAdapter } from '@tr/framework/platform/platformAdapter.js';
import type { GameContent } from '@tr/game/core/config/configTypes.js';
import type { GameViews } from './views.js';
import { shopActions } from './localEconomy.js';
import { characterShopActions, shardShopActions, syncShardAutoSynth } from './unlock.js';

export function createShopScene(deps: {
  adapter: Pick<PlatformAdapter, 'storage'>;
  views: GameViews;
  content: () => GameContent | null;
  goShopBack: (returnTo: 'select' | 'characterSelect' | 'inventory', characterId?: string) => void;
  onCharacterUnlocked: () => void;
}): { onEnter(ctx?: unknown): void; onExit(): void; escape(): void } {
  let back: (() => void) | null = null;
  const hooks = { onUnlocked: () => deps.onCharacterUnlocked() };
  return {
    onEnter: ctx => {
      const content = deps.content();
      if (!content) { deps.goShopBack('select'); return; }
      const request = typeof ctx === 'object' && ctx !== null ? ctx as { returnTo?: unknown; characterId?: unknown } : {};
      const returnTo = request.returnTo === 'characterSelect' ? 'characterSelect'
        : request.returnTo === 'inventory' ? 'inventory' : 'select';
      const characterId = typeof request.characterId === 'string'
        && (content.characters.items ?? []).some(c => c.id === request.characterId)
        ? request.characterId : undefined;
      back = () => deps.goShopBack(returnTo, characterId);
      syncShardAutoSynth(deps.adapter.storage, content, hooks);
      deps.views.renderShop(content, {
        ...shopActions(deps.adapter.storage, content, () => back?.()),
        ...shardShopActions(deps.adapter.storage, content, hooks),
        ...characterShopActions(deps.adapter.storage, content, hooks),
      });
    },
    onExit: () => { back = null; },
    escape: () => back?.(),
  };
}
