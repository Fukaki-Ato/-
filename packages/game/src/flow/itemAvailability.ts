import type { GameContent } from '../core/config/configTypes.js';
import { itemEffects } from '../core/sim/character.js';

/** Account experience is not implemented yet. Do not charge for or consume its placeholder buff. */
export function canUseEquippedItem(content: GameContent, id: string): boolean {
  const item = content.items.items?.find(entry => entry.id === id);
  const effects = itemEffects(content, id);
  return !!item && item.status !== 'draft' && item.status !== 'retired'
    && effects.length > 0 && effects.every(effect => effect.primitive !== 'xpMul');
}
