import type { GameContent } from './config/configTypes.js';
import type { SimAction } from './sim/simTypes.js';
import { hashSeed } from './rng.js';

export const MAX_RANKED_FRAMES = 108000;
export const MAX_RANKED_INPUTS = 20000;
export interface ReplayInput { frame: number; action: SimAction }
export interface RankedTicket { runId: string; seed: number; rulesId: string }
export interface RankedReplay { runId: string; frames: number; inputs: ReplayInput[] }
export interface LeaderboardEntry {
  rank: number; playerName: string; distance: number; score: number; charId: string;
}
export interface LeaderboardData {
  entries: LeaderboardEntry[]; personal: LeaderboardEntry | null; playerName: string;
}
export interface LeaderboardService {
  list(): Promise<LeaderboardData>;
  begin(charId: string, rulesId: string, themeId?: string): Promise<RankedTicket>;
  submit(replay: RankedReplay): Promise<{ accepted: boolean }>;
  cancel?(runId: string): Promise<void>;
}
export interface RankingFeedback {
  message: string;
  subscribe(listener: (message: string) => void): () => void;
}

/** Configuration-only metric digest; the flow/wire helper also binds the compiled simulation. */
export function leaderboardRulesId(content: GameContent): string {
  const canonical = (value: unknown): string => {
    if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map(k => `${JSON.stringify(k)}:${canonical(object[k])}`).join(',')}}`;
  };
  const { game, characters, skills, items, obstacles, themes } = content;
  return `first-coin-v2-${hashSeed(canonical({ game, characters, skills, items, obstacles, themes })).toString(16)}`;
}
