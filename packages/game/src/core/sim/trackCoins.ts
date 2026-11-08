/**
 * 地面金币链铺设（模板窗口内）——trackGen 专用纯函数，独立成文件守 300 行上限。
 * 规则（docs/01：金币即教学）：主链优先铺在模板安全线，再按 laneGroupWeights 抽本组
 * 车道数由配置抽取；同组多道金币齐头齐尾。链不跨窗、不与障碍重叠，
 * 总长度受普通跳跃的金币净空窗口限制，避免三道金币成为必吃墙。
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
  maxSpanM?: number;
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
  const bucket = d.rng.weighted(d.chainBuckets, b => b.weight);
  const wantLen = d.rng.int(bucket.min, bucket.max);
  const minLen = Math.min(...d.chainBuckets.map(b => b.min));
  let segs: Array<[number, number]> = [[d.winStart + 3, d.winEnd - 14]];
  const accepted: number[] = [];
  for (const lane of lanes) {
    const free = freeSegments(lane, d.winStart + 3, d.winEnd - 14);
    const common: Array<[number, number]> = [];
    for (const [a, b] of segs) for (const [c, e] of free) {
      const from = Math.max(a, c), to = Math.min(b, e);
      if (to - from >= (minLen - 1) * d.spacing) common.push([from, to]);
    }
    if (common.length) { segs = common; accepted.push(lane); }
  }
  if (!accepted.length) return;
  const best = segs.reduce((a, b) => b[1] - b[0] > a[1] - a[0] ? b : a);
  const span = Math.min(best[1] - best[0], d.maxSpanM ?? Infinity);
  const len = Math.min(wantLen, Math.floor(span / d.spacing) + 1);
  if (len < minLen) return;
  const start = d.rng.range(best[0], best[1] - (len - 1) * d.spacing);
  const id = d.seq();
  for (const lane of accepted) {
    for (let i = 0; i < len; i++) d.coins.push({ lane, worldZ: start + i * d.spacing, chain: id });
    d.lastCoinZ[lane] = start + (len - 1) * d.spacing;
  }
}

/**
 * 模板教学金币线（docs/01「金币即教学」的 config 直给面）：pattern cells 带 coins 的格子逐枚铺设。
 * surface:'trainTop' → 骑在 rideTop 载具顶面（y=载具 h）；普通线 y 缺省=地面。
 * 链长守 chainBuckets 区间 + maxSpanM 跳跃净空；同车道与障碍深度重叠的枚跳过（防御）。
 */
export function layTeachingLines(d: {
  cells: { coins?: number; obsRef?: string; lane: number; segment: number; offsetM: number; surface?: string }[];
  genZ: number; segLen: number; coinSpacing: number;
  chainBuckets: { min: number; max: number }[];
  obstacles: { lane: number; done?: boolean; worldZ: number; d: number; rideTop?: boolean; h: number }[];
  coins: CoinEntity[];
  maxSpanM: number;
  seq: () => number;
}): void {
  const minLen = Math.min(...d.chainBuckets.map(b => b.min));
  const maxLen = Math.max(...d.chainBuckets.map(b => b.max));
  for (const cell of d.cells) {
    if (!cell.coins || cell.obsRef) continue;
    const z0 = d.genZ + cell.segment * d.segLen + cell.offsetM;
    const chain = d.seq(); // 一条教学线一个链号（与 layCoinChains 同口径）
    const spanLen = Math.floor(d.maxSpanM / d.coinSpacing) + 1;
    for (let i = 0; i < Math.min(Math.max(cell.coins, minLen), maxLen, spanLen); i++) {
      const z = z0 + i * d.coinSpacing;
      // trainTop 线先找载具：车顶金币本来就落在火车深度窗内，不能被同车道避障跳掉（验收 P1-1）
      const carrier = cell.surface === 'trainTop'
        ? d.obstacles.find(o => o.rideTop === true && o.lane === cell.lane && Math.abs(z - o.worldZ) <= o.d / 2 + 0.6)
        : undefined;
      if (!carrier && d.obstacles.some(o => o.lane === cell.lane && !o.done && Math.abs(z - o.worldZ) < o.d / 2 + 0.5)) continue;
      // 悬停高度与地面金币同口径（地面币 y=0.65 = 高出地面 0.65）：车顶币 = 载具顶面 + 0.65，不然半埋进车顶
      d.coins.push({ lane: cell.lane, worldZ: z, chain, ...(carrier ? { y: carrier.h + 0.65 } : {}) });
    }
  }
}

/**
 * 新障碍兜底反向清币（审查 P0-1 修复 + 跨窗回压清理）：
 *   ① 本窗口新铺的地面链若与新障碍同车道深度重叠 → 按 chain 整链撤回（防御模板参数改小）；
 *   ② 列车/墙体 d 大，seg1 可回压上一窗尾部的地面金币链 → 按重叠精确移除（不动整链）。
 * 天空金币带（spawnSky）与奖励金币排（simWorld coinChainSeq）在①的扫描区间外；
 * 空中/车顶币（y>0）不受地面障碍影响，②豁免。
 */
export function purgeOverlappedCoins(d: {
  coins: CoinEntity[];
  coinStart: number;
  newObs: { lane: number; done?: boolean; worldZ: number; d: number }[];
}): void {
  const killChains = new Set<number>();
  for (let ci = d.coinStart; ci < d.coins.length; ci++) {
    const c = d.coins[ci];
    if (c.chain == null) continue;
    for (const o of d.newObs) {
      if (o.lane === c.lane && Math.abs(c.worldZ - o.worldZ) < o.d / 2 + 0.8) { killChains.add(c.chain); break; }
    }
  }
  if (killChains.size) {
    for (let i = d.coins.length - 1; i >= d.coinStart; i--) if (d.coins[i].chain != null && killChains.has(d.coins[i].chain!)) d.coins.splice(i, 1);
  }
  for (let ci = d.coins.length - 1; ci >= 0; ci--) {
    const c = d.coins[ci];
    if ((c.y ?? 0) > 0) continue;
    for (const o of d.newObs) {
      if (o.lane === c.lane && Math.abs(c.worldZ - o.worldZ) < o.d / 2 + 0.3) { d.coins.splice(ci, 1); break; }
    }
  }
}
