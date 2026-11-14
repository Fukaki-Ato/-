import type { WelfareSnapshot, HandbookChapter } from '@tr/game/core/welfare.js';
import type { MissionGroup, MissionView } from '@tr/game/core/missions/types.js';
import { CloudApiError, parseCloudProfile, record } from './cloudProtocol.js';

const invalid = (): never => { throw new CloudApiError('INVALID_RESPONSE', '福利数据格式异常，请刷新重试'); };
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const metric = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;

function reward(value: unknown): Record<string, number | string> {
  if (!record(value) || !Object.values(value).every(item => typeof item === 'string'
    || (Number.isSafeInteger(item) && (item as number) >= 0))) return invalid();
  return { ...value } as Record<string, number | string>;
}

function mission(value: unknown): MissionView {
  if (!record(value) || !text(value.id) || !text(value.title) || !text(value.metric)
    || !metric(value.target) || value.target === 0 || !metric(value.progress)
    || typeof value.claimed !== 'boolean') return invalid();
  return { id: value.id, title: value.title, metric: value.metric, target: value.target,
    progress: value.progress, reward: reward(value.reward), claimed: value.claimed };
}

function group(value: unknown): MissionGroup {
  if (!record(value) || !text(value.periodId) || !metric(value.resetsAt) || !Array.isArray(value.missions)) return invalid();
  return { periodId: value.periodId, resetsAt: value.resetsAt, missions: value.missions.map(mission) };
}

function chapter(value: unknown): HandbookChapter {
  if (!record(value) || typeof value.description !== 'string' || typeof value.unlocked !== 'boolean') return invalid();
  return { ...mission(value), description: value.description, unlocked: value.unlocked };
}

export function parseWelfareSnapshot(value: unknown): WelfareSnapshot {
  if (!record(value) || !metric(value.serverTime) || !metric(value.minRunSeconds) || !Array.isArray(value.handbook)) return invalid();
  return { profile: parseCloudProfile(value.profile), serverTime: value.serverTime, minRunSeconds: value.minRunSeconds,
    daily: group(value.daily), weekly: group(value.weekly), handbook: value.handbook.map(chapter) };
}
