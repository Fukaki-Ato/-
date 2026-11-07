import type { SimAction } from '../sim/simTypes.js';

export type MissionPeriod = 'daily' | 'weekly';

export interface MissionView {
  id: string;
  title: string;
  metric: string;
  target: number;
  progress: number;
  reward: Record<string, number | string>;
  claimed: boolean;
}

export interface MissionGroup {
  periodId: string;
  resetsAt: number;
  missions: MissionView[];
}

export interface MissionSnapshot {
  /** Stable identity of the cumulative claimed-reward ledger (not a session token). */
  rewardLedgerId: string;
  serverTime: number;
  daily: MissionGroup;
  weekly: MissionGroup;
  wallet: Record<string, number>;
}

export interface ReplayAction {
  frame: number;
  action: SimAction;
}
