/**
 * 地面金币链铺设（模板窗口内）——trackGen 专用纯函数，独立成文件守 300 行上限。
 * 规则（docs/01：金币即教学）：主链优先铺在模板安全线，再按 laneGroupWeights 抽本组
 * 车道数（单道 70% > 双道 25% > 三道 5%）；链必须完整落在本模板窗口内（不跨窗），
 * 且与窗口内任何障碍同车道深度不重叠；放不下就整链放弃（宁缺毋残，保证 5~16 完整）。
 */
import type { RunRng } from '../rng.js';
import type { CoinEntity, ObstacleEntity } from './trackGen.js';

export interface CoinLayDeps {
  rng: RunRng;
  obstacles: ObstacleEntity[];
  coins: CoinEntity[];
  /** 本模板窗口的 z 范围 */
  winStart: number;
  winEnd: number;
  safeLane: number;
  laneWeights: Record<number, number>;
  chainBuckets: { min: number; max: number; weight: number }[];
  spacing: number;
  /** 单车道金币最长断档（超过则强制补链） */
  laneGapM: number;
  /** 各车道最近一次投币的 z（读写共享：调用方持有） */
  lastCoinZ: Record<number, number>;
  /** 发链号（sim 内唯一） */
  seq(): number;
}

export function layCoinChains(d: CoinLayDeps): void {
  const laneCount = d.rng.weighted([1, 2, 3], k => d.laneWeights[k] ?? 0);
  const others = [-1, 0, 1].filter(l => l !== d.safeLane);
  d.rng.shuffle(others);
  const lanes = [d.safeLane, ...others.slice(0, laneCount - 1)];
  // 反“金币荒漠”：某车道断档超过 laneGapM 就强制补一条（用户反馈：左右两条跑道看不到金币）
  for (const l of [-1, 0, 1]) {
    if (!lanes.includes(l) && d.winStart - d.lastCoinZ[l] > d.laneGapM) lanes.push(l);
  }
  /** 某车道在 [from,to] 内避开所有障碍深度区间后的连续空段列表 */
  const freeSegments = (lane: number, from: number, to: number): Array<[number, number]> => {
    const cuts: Array<[number, number]> = [];
    for (const o of d.obstacles) {
      if (o.lane !== lane) continue;
      const a = Math.max(from, o.worldZ - o.d / 2 - 0.8);
      const b = Math.min(to, o.worldZ + o.d / 2 + 0.8);
      if (b > from && a < to) cuts.push([a, b]);
    }
    cuts.sort((x, y) => x[0] - y[0]);
    const segs: Array<[number, number]> = [];
    let cur = from;
    for (const [a, b] of cuts) {
      if (a > cur + 0.01) segs.push([cur, a]);
      cur = Math.max(cur, b);
    }
    if (cur < to - 0.01) segs.push([cur, to]);
    return segs;
  };
  for (const lane of lanes) {
    const bucket = d.rng.weighted(d.chainBuckets, b => b.weight);
    const wantLen = d.rng.int(bucket.min, bucket.max);
    const segs = freeSegments(lane, d.winStart + 3, d.winEnd - 14); // 后缘让出 14m：24m 长列车的尾部会向后探约 13m
    // 选能容纳最长链的空段；长度按空段容量截断，仍不足 5 枚则放弃本车道
    let best: [number, number] | null = null;
    for (const s of segs) if (!best || (s[1] - s[0]) > (best[1] - best[0])) best = s;
    if (!best) continue;
    const capacity = Math.floor((best[1] - best[0]) / d.spacing) + 1;
    const len = Math.min(wantLen, capacity, bucket.max);
    if (len < 5) continue;
    const maxStart = best[1] - (len - 1) * d.spacing;
    const chainStart = d.rng.range(best[0], Math.max(best[0], maxStart));
    const id = d.seq();
    for (let i = 0; i < len; i++) d.coins.push({ lane, worldZ: chainStart + i * d.spacing, chain: id });
    d.lastCoinZ[lane] = chainStart + (len - 1) * d.spacing; // 记录本车道最近投币位置
  }
}
