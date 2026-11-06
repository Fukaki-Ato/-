/**
 * 遥测骨架（S16b 前置，M 推荐③）：本机环形缓冲记录每局生命周期，QA 经 debug 探针读取。
 * 刻意不上报网络（S16b 正式通道接管时只换 sink）：先让「每次改动都有数据回音」成立。
 * 数据面：run_end（seed/char/距离/分/命中/复活/道具/终局）+ 死亡点抽样；容量上限防膨胀。
 */
import type { RunnerState } from '../core/sim/simTypes.js';

export interface TelemetryEntry {
  t: number;            // 墙钟（毫秒，宿主 Date.now 注入）
  kind: 'run_end';
  seed: number;
  charId: string;
  distanceM: number;
  score: number;
  coins: number;
  hits: number;
  revives: number;
  items: string[];
  cause: 'death' | 'exit';
}

export interface TelemetryStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

export const TELEMETRY_KEY = 'thunderrun:telemetry';
const CAP = 20;

export class TelemetryRecorder {
  private entries: TelemetryEntry[] = [];
  constructor(private readonly store: TelemetryStore, private readonly now: () => number = Date.now) {
    try {
      const raw: unknown = JSON.parse(store.get(TELEMETRY_KEY) ?? '[]');
      if (Array.isArray(raw)) this.entries = raw.filter(e => e && e.kind === 'run_end').slice(-CAP);
    } catch { /* 损坏的历史遥测不阻止启动 */ }
  }
  /** 局末记录（runSession onEnd 调用；exit=中途退出，death=终局） */
  recordRun(s: RunnerState, meta: { seed: number; charId: string; items: string[]; cause: 'death' | 'exit' }): void {
    this.entries.push({
      t: this.now(), kind: 'run_end', seed: meta.seed, charId: meta.charId,
      distanceM: Math.round(s.distance), score: s.score, coins: s.coins,
      hits: s.hits, revives: s.revivesUsed, items: [...meta.items], cause: meta.cause,
    });
    if (this.entries.length > CAP) this.entries.splice(0, this.entries.length - CAP);
    try { this.store.set(TELEMETRY_KEY, JSON.stringify(this.entries)); } catch { /* 存储满：遥测静默丢帧 */ }
  }
  /** QA 读取（__trTelemetry.snapshot()）；返回副本防外部改写 */
  snapshot(): TelemetryEntry[] { return this.entries.slice(); }
  /** 汇总视图（近 N 局的均值，调平衡用） */
  summary(): { runs: number; avgDistanceM: number; avgScore: number; reviveRate: number; itemUsage: Record<string, number> } {
    const runs = this.entries.length || 1;
    const itemUsage: Record<string, number> = {};
    for (const e of this.entries) for (const id of e.items) itemUsage[id] = (itemUsage[id] ?? 0) + 1;
    return {
      runs: this.entries.length,
      avgDistanceM: Math.round(this.entries.reduce((a, e) => a + e.distanceM, 0) / runs),
      avgScore: Math.round(this.entries.reduce((a, e) => a + e.score, 0) / runs),
      reviveRate: Math.round(this.entries.filter(e => e.revives > 0).length / runs * 100),
      itemUsage,
    };
  }
}

