import type {
  ICloudService,
  ILogger,
  LeaderboardEntry,
  LeaderboardQuery,
  LeaderboardResult,
  SaveData,
  SubmitScorePayload,
  SubmitScoreResult,
} from '../../../core/contracts';
import type { WxApi } from './WechatTypes';

declare const setTimeout: (handler: () => void, timeout?: number) => unknown;
declare const clearTimeout: (handle: unknown) => void;

/**
 * `ICloudService` 的微信云开发实现（docs/05 §4）。
 *
 * - `wx.cloud.callFunction` 统一封装：超时/失败转换为安全默认值，不向 UI 抛异常；
 * - `login` 为契约外附加能力（云函数 login），供平台适配器取玩家档案；
 * - 好友榜暂未接入开放数据域 UI，`board: 'friends'` 降级为云端世界榜（报告说明）。
 */

export interface WechatCloudLoginProfile {
  uid: string;
  nickname: string;
  avatarUrl: string;
  bestScore: number;
}

export interface WechatCloudOptions {
  wx?: WxApi | null;
  log?: ILogger;
  /** 云函数调用超时毫秒，默认 8000，最小 1000。 */
  timeoutMs?: number;
}

interface CloudEnvelope {
  ok?: boolean;
  code?: string;
  message?: string;
  [key: string]: unknown;
}

const DEFAULT_TIMEOUT_MS = 8000;
const MAX_TOP = 100;

export class WechatCloudService implements ICloudService {
  private readonly wx: WxApi | null;
  private readonly log?: ILogger;
  private readonly timeoutMs: number;
  private ready = false;

  constructor(opts: WechatCloudOptions = {}) {
    this.wx = opts.wx ?? null;
    this.log = opts.log;
    this.timeoutMs = Math.max(1000, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  }

  /** 云环境是否已成功初始化（登录降级依据）。 */
  get initialized(): boolean {
    return this.ready;
  }

  async init(envId: string): Promise<void> {
    const id = (envId ?? '').trim();
    if (!id) {
      this.log?.warn('未配置 cloudEnvId，微信云能力未初始化（登录将降级游客）');
      this.ready = false;
      return;
    }
    const cloud = this.wx?.cloud;
    if (!cloud || typeof cloud.init !== 'function') {
      this.log?.warn('wx.cloud 不可用，微信云能力未初始化（登录将降级游客）');
      this.ready = false;
      return;
    }
    try {
      cloud.init({ env: id, traceUser: true });
      this.ready = true;
      this.log?.info(`微信云初始化完成（env=${id}）`);
    } catch (err) {
      this.log?.warn('微信云初始化失败，登录将降级游客', err);
      this.ready = false;
    }
  }

  /** 调用云函数；失败/超时 reject，由各公共方法转安全默认值。 */
  async callFunction<T = CloudEnvelope>(name: string, data?: Record<string, unknown>): Promise<T> {
    const cloud = this.wx?.cloud;
    if (!this.ready || !cloud || typeof cloud.callFunction !== 'function') {
      throw new Error('云环境未初始化');
    }
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error(`云函数 ${name} 调用超时`));
      }, this.timeoutMs);
      const finish = (): boolean => {
        if (settled) return false;
        settled = true;
        clearTimeout(timer);
        return true;
      };
      try {
        cloud.callFunction({
          name,
          data,
          success: (res) => {
            if (!finish()) return;
            const result = res?.result;
            if (result === undefined || result === null) {
              reject(new Error(`云函数 ${name} 返回为空`));
              return;
            }
            resolve(result as T);
          },
          fail: (err) => {
            if (!finish()) return;
            reject(new Error(err?.errMsg || `云函数 ${name} 调用失败`));
          },
        });
      } catch (err) {
        if (!finish()) return;
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  /** 登录：调用云函数 login，失败返回 null（由适配器降级游客）。 */
  async login(): Promise<WechatCloudLoginProfile | null> {
    try {
      const res = await this.callFunction<CloudEnvelope>('login');
      if (res?.ok !== true || typeof res.uid !== 'string' || !res.uid) {
        this.log?.warn('云函数 login 返回异常', res);
        return null;
      }
      return {
        uid: res.uid,
        nickname: typeof res.nickname === 'string' ? res.nickname : '',
        avatarUrl: typeof res.avatarUrl === 'string' ? res.avatarUrl : '',
        bestScore: toSafeInt(res.bestScore, 0),
      };
    } catch (err) {
      this.log?.warn('云函数 login 调用失败，将降级游客', err);
      return null;
    }
  }

  async uploadSave(save: SaveData): Promise<{ ok: boolean; serverUpdatedAt?: number }> {
    try {
      const res = await this.callFunction<CloudEnvelope>('syncSave', {
        action: 'upload',
        save,
        version: toSafeInt(save?.version, 0),
        updatedAt: toSafeInt(save?.updatedAt, 0),
      });
      const serverUpdatedAt = toSafeInt(res.serverUpdatedAt, NaN);
      if (res?.ok !== true) {
        return { ok: false, serverUpdatedAt: Number.isFinite(serverUpdatedAt) ? serverUpdatedAt : undefined };
      }
      return { ok: true, serverUpdatedAt: Number.isFinite(serverUpdatedAt) ? serverUpdatedAt : undefined };
    } catch (err) {
      this.log?.warn('云存档上传失败（不影响本地存档）', err);
      return { ok: false };
    }
  }

  async downloadSave(): Promise<SaveData | null> {
    try {
      const res = await this.callFunction<CloudEnvelope>('syncSave', { action: 'download' });
      const data = res?.save;
      if (res?.ok !== true || !data || typeof data !== 'object') return null;
      const save = data as SaveData;
      return typeof save.version === 'number' ? save : null;
    } catch (err) {
      this.log?.warn('云存档下载失败', err);
      return null;
    }
  }

  async submitScore(payload: SubmitScorePayload): Promise<SubmitScoreResult> {
    try {
      const res = await this.callFunction<CloudEnvelope>('submitScore', {
        score: toSafeInt(payload.score, 0),
        distance: toSafeInt(payload.distance, 0),
        mode: typeof payload.mode === 'string' ? payload.mode : '',
        nickname: typeof payload.nickname === 'string' ? payload.nickname : '',
        avatarUrl: typeof payload.avatarUrl === 'string' ? payload.avatarUrl : '',
      });
      if (res?.ok !== true) {
        this.log?.warn('排行榜提交被云端拒绝', res.code, res.message);
        return { ok: false };
      }
      const rank = toSafeInt(res.rank, 0);
      return {
        ok: true,
        bestScore: toSafeInt(res.bestScore, toSafeInt(payload.score, 0)),
        rank: rank > 0 ? rank : undefined,
      };
    } catch (err) {
      this.log?.warn('排行榜提交失败（不影响本局结算）', err);
      return { ok: false };
    }
  }

  async getLeaderboard(query: LeaderboardQuery): Promise<LeaderboardResult> {
    const top = clampTop(query?.top);
    const friends = query?.board === 'friends';
    if (friends) {
      this.log?.info('好友榜开放数据域尚未接入主域 UI，本次降级为云端世界榜');
    }
    // 云函数仅提供 world（global）榜；friends 亦走该接口保证页签可用（见报告）。
    try {
      const res = await this.callFunction<CloudEnvelope>('getLeaderboard', { board: 'global', top });
      if (res?.ok !== true || !Array.isArray(res.list)) {
        this.log?.warn('排行榜返回异常', res?.code, res?.message);
        return { list: [], offline: true };
      }
      const list = res.list
        .filter(isRecord)
        .slice(0, top)
        .map((entry, index) => normalizeEntry(entry, index, false));
      const me = isRecord(res.me) ? normalizeEntry(res.me, list.length, true) : undefined;
      return { list, me };
    } catch (err) {
      this.log?.warn('排行榜拉取失败', err);
      return { list: [], offline: true };
    }
  }
}

function clampTop(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : 50;
  return Math.min(MAX_TOP, Math.max(1, n));
}

function toSafeInt(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.floor(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeEntry(entry: Record<string, unknown>, index: number, forceMe: boolean): LeaderboardEntry {
  const rank = toSafeInt(entry.rank, index + 1);
  const result: LeaderboardEntry = {
    rank: rank > 0 ? rank : index + 1,
    uid: typeof entry.uid === 'string' ? entry.uid : '',
    nickname: typeof entry.nickname === 'string' ? entry.nickname : '',
    avatarUrl: typeof entry.avatarUrl === 'string' ? entry.avatarUrl : '',
    score: toSafeInt(entry.score, 0),
  };
  if (forceMe || entry.isMe === true) result.isMe = true;
  return result;
}
