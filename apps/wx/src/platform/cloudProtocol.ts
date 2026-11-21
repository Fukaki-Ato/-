import type { PlayerProfile } from '@tr/game/core/playerProfile.js';
import type { LeaderboardData, LeaderboardEntry } from '@tr/game/core/leaderboard.js';

export class CloudApiError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

export const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const count = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const metric = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const invalid = (): never => { throw new CloudApiError('INVALID_RESPONSE', '云端数据格式异常，请稍后重试'); };

export function parseCloudProfile(value: unknown): PlayerProfile {
  if (!record(value) || value.schemaVersion !== 1 || !count(value.revision) || !text(value.playerId)
    || !/^p_[a-f0-9]{64}$/.test(value.playerId)) return invalid();
  const { wallet, inventory, preferences, stats } = value;
  if (!record(wallet) || !count(wallet.coin) || !count(wallet.diamond)
    || !record(inventory) || !Array.isArray(inventory.characters) || !inventory.characters.every(text)
    || !record(inventory.items) || !Object.values(inventory.items).every(count)
    || !record(preferences) || !text(preferences.characterId) || !text(preferences.themeId)
    || !inventory.characters.includes(preferences.characterId)
    || !text(value.createdAt) || !text(value.updatedAt)) return invalid();
  if (stats !== undefined && (!record(stats) || !count(stats.runs) || !count(stats.coins)
    || !metric(stats.distanceM) || !metric(stats.bestScore))) return invalid();
  return {
    schemaVersion: 1, revision: value.revision, playerId: value.playerId,
    wallet: { coin: wallet.coin, diamond: wallet.diamond },
    inventory: { characters: [...inventory.characters], items: { ...inventory.items } as Record<string, number> },
    preferences: { characterId: preferences.characterId, themeId: preferences.themeId },
    createdAt: value.createdAt, updatedAt: value.updatedAt,
    ...(stats ? { stats: { ...stats } as PlayerProfile['stats'] } : {}),
  };
}

function parseEntry(value: unknown): LeaderboardEntry {
  if (!record(value) || !count(value.rank) || value.rank === 0 || !text(value.playerName)
    || !metric(value.distance) || !metric(value.score) || !text(value.charId)) return invalid();
  return { rank: value.rank, playerName: value.playerName, distance: value.distance, score: value.score, charId: value.charId };
}

export function parseCloudLeaderboard(value: unknown): LeaderboardData {
  if (!record(value) || !Array.isArray(value.entries) || value.entries.length > 50 || !text(value.playerName)) return invalid();
  return {
    entries: value.entries.map(parseEntry), personal: value.personal === null ? null : parseEntry(value.personal),
    playerName: value.playerName,
  };
}
