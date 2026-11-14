/** 云端玩家档案的公开投影；身份与经济字段只由服务端写入。 */
export interface PlayerProfile {
  schemaVersion: 1;
  revision: number;
  playerId: string;
  wallet: { coin: number; diamond: number };
  inventory: { characters: string[]; items: Record<string, number> };
  preferences: { characterId: string; themeId: string };
  createdAt: string;
  updatedAt: string;
  stats?: { runs: number; distanceM: number; coins: number; bestScore: number };
}

export interface PlayerAccount {
  read(): PlayerProfile;
  subscribe(listener: () => void): () => void;
}
