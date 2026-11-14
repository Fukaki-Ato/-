/**
 * 成就 API 客户端核心（平台中立）：请求/错误语义与 missionApiCore 同构，但会话不自建——
 * 与任务 API 共用同一游客 cookie 会话（构造器注入 session.ensureConnected，即
 * MissionApiCore.ensureConnected 的幂等缓存）。401 时复位共享会话（session.invalidateSession?，
 * 与 missionApiCore.request 的 401 分支同款自愈）、网络失败一律上抛，页面回退本地预览。
 * onSnapshot 回调供壳层把快照钱包导入本机（web 侧=wallet.syncRewards，按 rewardLedgerId 幂等）。
 */
import type { AchievementReward, I18n } from '../core/config/configTypes.js';
import type { MissionTransport } from './missionApiCore.js';

/** 服务端成就快照（achievement-service.mjs snapshot()）；rewardLedgerId/wallet 与任务快照同一账本 */
export interface AchSnapshot {
  serverTime: number;
  rewardLedgerId: string;
  achievements: AchProgressView[];
  wallet: Record<string, number>;
}

/** 单条成就的服务端进度（run 类） */
export interface AchProgressView {
  id: string;
  name: I18n;
  desc: I18n;
  stat: string;
  target: number;
  tier: string;
  group: string;
  reward: AchievementReward;
  progress: number;
  claimed: boolean;
}

/** 场景依赖的最小 API 面（web=AchievementsApiCore 子类；测试可注入假实现） */
export interface AchievementApiLike {
  load(): Promise<AchSnapshot>;
  claim(achievementId: string): Promise<AchSnapshot>;
}

/** 会话面：与 MissionApiCore.ensureConnected 同形（共享游客会话，不自建） */
export interface AchievementSession {
  ensureConnected(): Promise<void>;
  /** 会话失效复位（可选）：401 自愈与任务 API 对齐，缺省实现无从复位则跳过 */
  invalidateSession?(): void;
}

export class AchievementsApiCore implements AchievementApiLike {
  constructor(
    private readonly transport: MissionTransport,
    private readonly session: AchievementSession,
    private readonly onSnapshot?: (snapshot: AchSnapshot) => void,
  ) {}

  async load(): Promise<AchSnapshot> {
    await this.session.ensureConnected();
    return this.request('', 'GET');
  }

  async claim(achievementId: string): Promise<AchSnapshot> {
    await this.session.ensureConnected();
    return this.request('/claim', 'POST', { achievementId });
  }

  private async request(path: string, method: 'GET' | 'POST', body?: unknown): Promise<AchSnapshot> {
    let status = 0;
    let data: unknown = null;
    try {
      ({ status, data } = await this.transport.request(path, method, body));
    } catch {
      throw new Error('成就服务暂时不可用，请稍后重试');
    }
    if (status >= 400) {
      if (status === 401) this.session.invalidateSession?.(); // 共享会话服务端失效：复位缓存，下次请求重连（任务 API 同款）
      throw Object.assign(new Error((data as { error?: string } | null)?.error ?? '成就服务暂时不可用，请稍后重试'), { status });
    }
    if (!data || typeof data !== 'object') throw new Error('成就服务返回无效数据');
    const snapshot = data as AchSnapshot;
    this.onSnapshot?.(snapshot);
    return snapshot;
  }
}
