import type {
  ICloudService,
  ILogger,
  IStorage,
  LeaderboardEntry,
  LeaderboardQuery,
  LeaderboardResult,
  SaveData,
  SubmitScorePayload,
  SubmitScoreResult,
} from '../contracts';
import { safeJsonParse } from '../framework/Utils';

export const CLOUD_SAVE_KEY = 'ltkp.cloud.save';
export const CLOUD_BEST_KEY = 'ltkp.cloud.best';

const MAX_LEADERBOARD = 10;
const BOT_NICKNAMES = [
  '疾风少年',
  '夜色跑者',
  '追风阿凯',
  '小跑酱',
  '闪电喵',
  '稳稳当当',
  '晨光旅人',
  '云端漫步',
  '金币猎人',
];
const BOT_SCORES = [4800, 4200, 3900, 3500, 3100, 2800, 2400, 2000, 1500];

export interface LocalCloudIdentity {
  uid: string;
  nickname: string;
  avatarUrl: string;
}

export interface LocalCloudServiceOptions {
  storage: IStorage;
  log?: ILogger;
  now?: () => number;
  /** 当前玩家信息提供者（登录后生效），用于排行榜中「我」的条目。 */
  getIdentity?: () => LocalCloudIdentity;
}

interface BestRecord {
  score: number;
  nickname: string;
  avatarUrl: string;
  at: number;
}

export class LocalCloudService implements ICloudService {
  private readonly storage: IStorage;
  private readonly log?: ILogger;
  private readonly nowFn: () => number;
  private readonly getIdentity: () => LocalCloudIdentity;

  constructor(opts: LocalCloudServiceOptions) {
    this.storage = opts.storage;
    this.log = opts.log;
    this.nowFn = opts.now ?? (() => Date.now());
    this.getIdentity = opts.getIdentity ?? (() => ({
      uid: 'guest_local',
      nickname: '酷跑玩家',
      avatarUrl: '',
    }));
  }

  async init(_envId: string): Promise<void> {
    // 本地云模拟无需初始化
  }

  async uploadSave(save: SaveData): Promise<{ ok: boolean; serverUpdatedAt?: number }> {
    this.storage.set(CLOUD_SAVE_KEY, JSON.stringify(save));
    return { ok: true, serverUpdatedAt: this.nowFn() };
  }

  async downloadSave(): Promise<SaveData | null> {
    const data = safeJsonParse<SaveData>(this.storage.get(CLOUD_SAVE_KEY));
    if (!data || typeof data !== 'object' || typeof data.version !== 'number') return null;
    return data;
  }

  async submitScore(payload: SubmitScorePayload): Promise<SubmitScoreResult> {
    const score = Math.max(0, Math.floor(payload.score));
    const prev = this.readBest();
    const best: BestRecord = prev && prev.score >= score
      ? prev
      : { score, nickname: payload.nickname, avatarUrl: payload.avatarUrl, at: this.nowFn() };
    this.storage.set(CLOUD_BEST_KEY, JSON.stringify(best));
    this.log?.info(`本地排行榜提交 ${score} 分（最佳 ${best.score}）`);
    return { ok: true, bestScore: best.score, rank: 1 };
  }

  async getLeaderboard(query: LeaderboardQuery): Promise<LeaderboardResult> {
    const identity = this.getIdentity();
    const best = this.readBest();
    const entries: LeaderboardEntry[] = [
      {
        rank: 0,
        uid: identity.uid,
        nickname: identity.nickname,
        avatarUrl: identity.avatarUrl,
        score: best?.score ?? 0,
        isMe: true,
      },
      ...BOT_NICKNAMES.map((nickname, index) => ({
        rank: 0,
        uid: `local_bot_${index + 1}`,
        nickname,
        avatarUrl: '',
        score: BOT_SCORES[index],
      })),
    ];
    entries.sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score;
      if (a.isMe) return -1;
      if (b.isMe) return 1;
      return a.uid.localeCompare(b.uid);
    });
    entries.forEach((entry, index) => {
      entry.rank = index + 1;
    });
    const top = Math.max(1, Math.min(Math.floor(query.top) || MAX_LEADERBOARD, MAX_LEADERBOARD));
    const me = entries.find((entry) => entry.isMe);
    return { list: entries.slice(0, top), me, offline: true };
  }

  private readBest(): BestRecord | null {
    const record = safeJsonParse<BestRecord>(this.storage.get(CLOUD_BEST_KEY));
    if (!record || typeof record !== 'object') return null;
    if (typeof record.score !== 'number' || !Number.isFinite(record.score)) return null;
    return record;
  }
}
