import type { MissionPeriod, MissionSnapshot, ReplayAction } from '@tr/game/core/missions/types.js';

type PendingRun = { runId: string; frames: number; actions: ReplayAction[] };
const QUEUE_KEY = 'thunderrun:mission-pending-v1';

export class MissionApi {
  snapshot: MissionSnapshot | null = null;
  feedback = '';
  settling: Promise<void> = Promise.resolve();
  private session: Promise<void> | null = null;
  private sync: Promise<void> = Promise.resolve();
  private queue: PendingRun[] = [];
  constructor() {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]');
      if (Array.isArray(saved)) this.queue = saved.filter(run => run && typeof run.runId === 'string'
        && Number.isSafeInteger(run.frames) && Array.isArray(run.actions)).slice(0, 10);
    } catch { /* 损坏的待同步记录不阻止启动。 */ }
  }
  private async request<T>(path: string, body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`/api/missions${path}`, {
        method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin',
        headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000),
      });
    } catch { throw new Error('任务服务暂时不可用，请稍后重试'); }
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      if (response.status === 401) this.session = null;
      throw Object.assign(new Error(data?.error ?? '任务服务暂时不可用，请稍后重试'), { status: response.status });
    }
    if (!data) throw new Error('任务服务返回无效数据');
    return data as T;
  }
  private connect(): Promise<void> {
    return this.session ??= this.request('/session', {}).then(() => undefined).catch(error => {
      this.session = null; throw error;
    });
  }
  async start(seed: number, charId: string): Promise<string> {
    await this.connect();
    return (await this.request<{ runId: string }>('/runs', { seed: seed >>> 0, charId })).runId;
  }
  private saveQueue(): void {
    try { localStorage.setItem(QUEUE_KEY, JSON.stringify(this.queue)); }
    catch { this.feedback = '浏览器无法保存待同步记录，请勿关闭页面'; }
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
          this.snapshot = await this.request<MissionSnapshot>(`/runs/${encodeURIComponent(run.runId)}/finish`, {
            frames: run.frames, actions: run.actions,
          });
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
    return this.snapshot = await this.request<MissionSnapshot>('');
  }
  async claim(period: MissionPeriod, periodId: string, missionId: string): Promise<MissionSnapshot> {
    await this.connect();
    return this.snapshot = await this.request<MissionSnapshot>('/claim', { period, periodId, missionId });
  }
}
