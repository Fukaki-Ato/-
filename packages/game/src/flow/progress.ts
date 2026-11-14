import type { SyncStorage } from '@tr/framework/platform/platformAdapter.js';
import type { PlayerAccount } from '../core/playerProfile.js';

export const BEST_KEY = 'thunderrun:best';
const LEGACY_BEST_KEY = 'thunderrun:b\u2026st';
export const CHAR_KEY = 'thunderrun:character';
export const DEFAULT_CHAR = 'char_volt';
export const COINS_KEY = 'thunderrun:coins-total';
export const DIAMOND_KEY = 'thunderrun:diamonds-total';

/** 云账户的钱包只有服务器快照；未配置账户的本地开发维持原有存档语义。 */
export function createFlowProgress(storage: SyncStorage, account?: PlayerAccount) {
  const count = (key: string): number => {
    const n = Number(storage.get(key) ?? '0');
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  const bestScore = (): number => {
    if (account) return account.read().stats?.bestScore ?? 0;
    if (storage.get(BEST_KEY) !== null) return count(BEST_KEY);
    const best = count(LEGACY_BEST_KEY);
    if (storage.get(LEGACY_BEST_KEY) !== null) storage.remove(LEGACY_BEST_KEY);
    if (best > 0) storage.set(BEST_KEY, String(best));
    return best;
  };
  return {
    bestScore,
    initialCharacter: () => account?.read().preferences.characterId ?? storage.get(CHAR_KEY) ?? DEFAULT_CHAR,
    owns: (id: string) => !account || account.read().inventory.characters.includes(id),
    wallet: () => account ? { coins: account.read().wallet.coin, diamonds: account.read().wallet.diamond }
      : { coins: count(COINS_KEY), diamonds: count(DIAMOND_KEY) },
    recordLocal(summary: { score: number; coins?: number }) {
      if (account) return;
      if (summary.score > bestScore()) storage.set(BEST_KEY, String(summary.score));
      if ((summary.coins ?? 0) > 0) storage.set(COINS_KEY, String(count(COINS_KEY) + summary.coins!));
    },
  };
}
