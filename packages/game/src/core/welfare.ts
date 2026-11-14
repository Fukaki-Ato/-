import type { MissionGroup, MissionPeriod } from './missions/types.js';
import type { PlayerProfile } from './playerProfile.js';

export interface HandbookChapter {
  id: string;
  title: string;
  description: string;
  metric: string;
  target: number;
  progress: number;
  reward: Record<string, number | string>;
  claimed: boolean;
  unlocked: boolean;
}

export interface WelfareSnapshot {
  profile: PlayerProfile;
  serverTime: number;
  minRunSeconds: number;
  daily: MissionGroup;
  weekly: MissionGroup;
  handbook: HandbookChapter[];
}

export interface WelfareService {
  load(): Promise<WelfareSnapshot>;
  claimMission(period: MissionPeriod, periodId: string, missionId: string): Promise<WelfareSnapshot>;
  claimChapter(chapterId: string): Promise<WelfareSnapshot>;
}
