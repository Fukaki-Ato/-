/**
 * 宝箱场景（与 shopScene 同式拆出，保 mainFlow 行数预算）：铜/银/金三档开箱动作装配，
 * hooks.onUnlocked 统一接成就 tracker（charactersUnlocked 生产接线）。
 */
import type { PlatformAdapter } from '@tr/framework/platform/platformAdapter.js';
import type { GameContent } from '@tr/game/core/config/configTypes.js';
import type { GameViews } from './views.js';
import { chestActions } from './chest.js';

export function createChestScene(deps: {
  adapter: Pick<PlatformAdapter, 'storage'>;
  views: GameViews;
  content: () => GameContent | null;
  goSelect: () => void;
  onCharacterUnlocked: () => void;
}): { onEnter(ctx?: unknown): void; onExit(): void; escape(): void } {
  let back: (() => void) | null = null;
  return {
    onEnter: () => {
      const content = deps.content();
      if (!content || !deps.views.renderChest) { deps.goSelect(); return; }
      back = deps.goSelect;
      deps.views.renderChest(content, chestActions(deps.adapter.storage, content, () => back?.(), {
        hooks: { onUnlocked: () => deps.onCharacterUnlocked() },
      }));
    },
    onExit: () => { back = null; },
    escape: () => back?.(),
  };
}
