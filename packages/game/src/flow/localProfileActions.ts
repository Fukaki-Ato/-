/** Persist a rename only after its name, free-use count and price can commit together. */
import { PLAYER_NAME_KEY, PLAYER_RENAMES_KEY, tryRename, type PlayerProfile, type ProfileParams, type RenameResult } from '../core/profile/playerProfile.js';
import { DIAMOND_KEY, walletBalance, withEconomyTransaction, type EconomyStore } from './localEconomy.js';

export function renameLocalProfile(
  storage: EconomyStore, profile: PlayerProfile, params: ProfileParams, candidate: string,
): RenameResult {
  return withEconomyTransaction(storage, draft => {
    const result = tryRename(profile, params, candidate, walletBalance(draft, 'diamond'));
    if (!result.ok) return result;
    draft.set(PLAYER_NAME_KEY, result.profile.name);
    draft.set(PLAYER_RENAMES_KEY, String(result.profile.renames));
    draft.set(DIAMOND_KEY, String(result.diamondsLeft));
    return result;
  });
}
