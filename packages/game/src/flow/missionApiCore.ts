/**
 * 任务 API 客户端核心（平台中立，审查 M5-3）：待同步队列 / 会话 / 幂等结算逻辑只有一份，
 * Web 与 wx 各自注入传输与存储（web=fetch+localStorage 同源 cookie；wx=wx.request+storage+cookie jar）。
 * 本模块零宿主 API——fetch/localStorage 的缺省封装在 apps/web/src/missionApi.ts。
 */
import type { MissionPeriod, MissionSnapshot, ReplayAction } from '../core/missions/types.js';

type PendingRun = { runId: string; frames: number; actions: ReplayAction[] };

export const MISSION_QUEUE_KEY = 'thunderrun:mission-pending-v1';

/** 传输面：path 形如 '/session'、'/runs/{id}/finish'；实现方负责 cookie/超时/同源语义 */
export interface MissionTransport {
  request(path: string, method: 'GET' | 'POST', body?: unknown): Promise<{ status: number; data: unknown }>;
}

export interface MissionQueueStorage {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

export class MissionApiCore {
  snapshot: MissionSnapshot | null = null;
  feedback = '';
  settling: Promise<void> = Promise.resolve();
  private session: Promise<void> | null = null;
  private sync: Promise<void> = Promise.resolve();
  private queue: PendingRun[] = [];
  constructor(
    private readonly transport: MissionTransport,
    private readonly storage: MissionQueueStorage,
    private readonly onSnapshot?: (snapshot: MissionSnapshot) => void,
  ) {
    try {
      const saved: unknown = JSON.parse(storage.get(MISSION_QUEUE_KEY) ?? '[]');
      if (Array.isArray(saved)) this.queue = saved.filter(run => run && typeof run.runId === 'string'
        && Number.isSafeInteger(run.frames) && Array.isArray(run.actions)).slice(0, 10);
    } catch { /* 损坏的待同步记录不阻止启动。 */ }
  }
  private accept(snapshot: MissionSnapshot): MissionSnapshot {
    this.onSnapshot?.(snapshot);
    return this.snapshot = snapshot;
  }
  private async request<T>(path: string, method: 'GET' | 'POST', body?: unknown): Promise<T> {
    let status = 0;
    let data: unknown = null;
    try {
      ({ status, data } = await this.transport.request(path, method, body));
    } catch {
      throw new Error('任务服务暂时不可用，请稍后重试');
    }
    if (status >= 400) {
      if (status === 401) this.session = null;
      throw Object.assign(new Error((data as { error?: string } | null)?.error ?? '任务服务暂时不可用，请稍后重试'), { status });
    }
    if (!data || typeof data !== 'object') throw new Error('任务服务返回无效数据');
    return data as T;
  }
  private connect(): Promise<void> {
    return this.session ??= this.request('/session', 'POST', {}).then(() => undefined).catch(error => {
      this.session = null; throw error;
    });
  }
  async start(seed: number, charId: string, items: string[] = []): Promise<string> {
    if (this.queue.length >= 10) throw new Error('待同步记录已满，请先在任务页同步；本局不计入任务进度');
    await this.connect();
    const body: Record<string, unknown> = { seed: seed >>> 0, charId };
    if (items.length) body.items = items; // 装备道具随票提交：server 重放按同清单注入（确定性）
    return (await this.request<{ runId: string }>('/runs', 'POST', body)).runId;
  }
  private saveQueue(): void {
    try { this.storage.set(MISSION_QUEUE_KEY, JSON.stringify(this.queue)); }
    catch { this.feedback = '本机无法保存待同步记录，请勿关闭页面'; }
  }
  finish(run: PendingRun): Promise<void> {
    if (this.queue.length >= 10) return Promise.reject(new Error('待同步对局已满，请先在任务页重试同步'));
    this.queue.push(run);
    this.saveQueue();
    return this.flush();
  }
  private flush(): Promise<void> {
    const work = this.sync.catch(() => undefined).then(async () => {
      if (!this.queue.length) return;
      await this.connect();
      while (this.queue.length) {
        const run = this.queue[0]!;
        try {
          this.accept(await this.request<MissionSnapshot>(`/runs/${encodeURIComponent(run.runId)}/finish`, 'POST', {
            frames: run.frames, actions: run.actions,
          }));
        } catch (error) {
          const status = (error as { status?: number }).status ?? 0;
          if ([400, 403, 404, 409, 410, 422].includes(status)) {
            this.queue.shift(); this.saveQueue();
            this.feedback = `一局进度未计入：${(error as Error).message}`;
            continue;
          }
          throw error;
        }
        this.queue.shift(); this.saveQueue();
      }
      if (this.feedback.startsWith('进度尚未同步')) this.feedback = '';
    });
    this.sync = work;
    return work;
  }
  async load(): Promise<MissionSnapshot> {
    await this.settling;
    await this.connect();
    await this.flush();
    return this.accept(await this.request<MissionSnapshot>('', 'GET'));
  }
  async claim(period: MissionPeriod, periodId: string, missionId: string): Promise<MissionSnapshot> {
    await this.connect();
    return this.accept(await this.request<MissionSnapshot>('/claim', 'POST', { period, periodId, missionId }));
  }
}
