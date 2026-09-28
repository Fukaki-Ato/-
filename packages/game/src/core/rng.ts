/**
 * 确定性随机数（core 层，禁止 Math.random）
 * 对应文档：docs/02 §6（RNG）、docs/09 T1.1
 * 同一 seed + 同一调用顺序 => 结果完全可复现，支撑每日挑战与反作弊回放。
 */

/** 经典 mulberry32：32 位状态，速度快、分布可用 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 字符串 -> 32 位数字种子（FNV-1a），用于把日期/分享码转成 seed */
export function hashSeed(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** 一局游戏的随机源。所有玩法随机必须从这里取。 */
export class RunRng {
  private readonly next01: () => number;
  constructor(public readonly seed: number) {
    this.next01 = mulberry32(seed);
  }
  /** [0,1) */
  next(): number { return this.next01(); }
  /** [min,max) 浮点 */
  range(min: number, max: number): number { return min + (max - min) * this.next01(); }
  /** [min,max] 整数 */
  int(min: number, max: number): number { return Math.floor(this.range(min, max + 1)); }
  /** 数组随机取一 */
  pick<T>(arr: readonly T[]): T { return arr[this.int(0, arr.length - 1)]; }
  /** 原地洗牌（Fisher-Yates，用注入的随机源） */
  shuffle<T>(arr: T[]): void {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }
  /** 按权重取一；weight 为负数视为 0 */
  weighted<T>(items: readonly T[], getWeight: (item: T) => number): T {
    let total = 0;
    for (const it of items) total += Math.max(0, getWeight(it));
    if (total <= 0) return items[0];
    let roll = this.next() * total;
    for (const it of items) {
      roll -= Math.max(0, getWeight(it));
      if (roll < 0) return it;
    }
    return items[items.length - 1];
  }
}
