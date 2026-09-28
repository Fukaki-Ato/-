/**
 * 赛道程序化生成器（core/sim 层，纯逻辑、确定性）
 * 对应文档：docs/01 §4（赛道与障碍）、docs/09 T1.3。
 * 规则：
 *   1. 以 obstacles.json 的布局模板(pattern)为单位向前拼接，难度随距离升档；
 *   2. 金币链铺在模板声明的安全线上（docs/01：金币即教学）；
 *   3. 所有随机来自注入的 RunRng（同 seed 必同赛道，支撑每日挑战/回放校验）。
 * 坐标约定：entity.worldZ = 生成时固定在「前方多少米」；
 *          渲染/判定时 rel = distance - worldZ（负=还在前方，0=到达角色面，正=已掠过）。
 */
import type { RunRng } from '../rng.js';
import type { GameContent, NamedEntry } from '../config/configTypes.js';
import { BLOCKING_CLASSES, normalizeSwing, type SwingSpec } from './trackDefs.js';

export interface ObstacleEntity {
  obsRef: string;
  cls: 'low' | 'high' | 'full' | 'moving' | 'hazard' | 'vehicle';
  w: number; h: number; d: number;
  lane: number;
  worldZ: number;
  swing?: SwingSpec;
  done?: boolean;      // 已命中（避免同一障碍重复判负）
  passed?: boolean;    // 已掠过角色面（近失判定一次性）
}

export interface CoinEntity { lane: number; worldZ: number; y?: number; taken?: boolean; passed?: boolean; chain?: number; takenAt?: number }

/** 云团：纯视觉实体（位置由生成器管理，渲染层负责穿云特效与消散） */
export interface CloudEntity { worldZ: number; x: number; y: number }

/** 道具箱：落在无障碍的车道上，间隔 ≥ minGapM */
export interface PickupEntity { itemRef: string; lane: number; worldZ: number; taken?: boolean; passed?: boolean }

interface PatternCell { segment: number; lane: number; offsetM: number; obsRef?: string; coins?: number }
interface Pattern { id: string; minDifficulty: number; weight: number; lengthSegments: number; cells: PatternCell[]; guarantee?: { safeLanePattern: number[] } }

export class TrackGen {
  /** 生成推进线：已把赛道铺到了多少米 */
  genZ = 60; // 开局 60m 净空，给新手反应时间
  private readonly segLen: number;
  private readonly restGapM: [number, number]; // 模板之间的净空带（连续障碍不压太紧）
  private readonly laneWidthRef: number;
  private readonly defs = new Map<string, NamedEntry>();
  private readonly patterns: Pattern[];
  private readonly curve: { by: number; poolWeights: Record<string, number> }[];
  private readonly chainBuckets: { min: number; max: number; weight: number }[];
  private readonly coinSpacing: number;
  private readonly laneWeights: Record<number, number>;
  private readonly laneGapM: number; // 单车道金币最长断档（超过则强制补链）
  private readonly lastCoinZ: Record<number, number> = { [-1]: 0, 0: 0, 1: 0 }; // 各车道最近一次投币的 z
  private readonly dropWeights: Record<string, number>;
  private readonly pickupSegmentM: number;      // 每段长度（默认 200m）
  private readonly pickupCountWeights: Record<number, number>; // 每段道具箱数量分布 1/2/3
  private readonly pickupEdgeM: number;         // 段首尾安全边距
  private readonly pickupMinGapM: number;
  private readonly blockFromDiff: number;          // 封路概率规则生效的难度档
  private readonly blockWeights: Record<number, number>; // 封堵 1/2 条道的权重       // 同段两箱最小间隔
  private nextPickupSeg = 200; // 首段从 200m 开始（新手段净空）
  private chainSeq = 0; // 链编号（整链撤回用）
  /** 上一个抽中的模板 id：pickPattern 用于避免连续同模板 */
  private lastPatternId = '';

  constructor(content: GameContent, private rng: RunRng) {
    const ob = content.obstacles;
    this.segLen = (content.game.params.track as Record<string, number>)?.segmentLengthM ?? 24;
    const rg = (content.game.params.track as Record<string, unknown>)?.restGapM as [number, number] | undefined;
    this.restGapM = rg ?? [6, 14];
    this.laneWidthRef = ((content.game.params.runner ?? {}) as Record<string, number>).laneWidth ?? 2.2;
    for (const d of ob.defs) this.defs.set(d.id, d);
    this.patterns = ob.patterns as unknown as Pattern[];
    this.curve = ob.difficultyCurve;
    const coins = (content.game.params.coins ?? {}) as Record<string, unknown>;
    const buckets = (coins.chainBuckets ?? [{ min: 5, max: 10, weight: 75 }]) as typeof this.chainBuckets;
    // 防御：配置给出空数组时回落到默认桶，避免向空池 weighted 取到 undefined 后读 min 崩溃
    this.chainBuckets = buckets.length ? buckets : [{ min: 5, max: 10, weight: 75 }];
    this.coinSpacing = (coins.spacingM as number) ?? 1.5;
    const lw = (coins.laneGroupWeights ?? { 1: 70, 2: 25, 3: 5 }) as Record<string, number>;
    this.laneWeights = { 1: lw['1'] ?? 70, 2: lw['2'] ?? 25, 3: lw['3'] ?? 5 };
    this.laneGapM = (coins.laneGapM as number) ?? 120;
    const dt = content.obstacles.dropTable as { weights: Record<string, number>; segmentM?: number; countWeights?: Record<string, number>; edgeMarginM?: number; minBoxGapM?: number } | undefined;
    this.dropWeights = dt?.weights ?? {};
    this.pickupSegmentM = dt?.segmentM ?? 200;
    this.pickupCountWeights = { 1: dt?.countWeights?.['1'] ?? 50, 2: dt?.countWeights?.['2'] ?? 30, 3: dt?.countWeights?.['3'] ?? 20 };
    this.pickupEdgeM = dt?.edgeMarginM ?? 8;
    this.pickupMinGapM = dt?.minBoxGapM ?? 30;
    const lb = (content.obstacles as unknown as { laneBlock?: { fromDifficulty?: number; weights?: Record<string, number> } }).laneBlock;
    this.blockFromDiff = lb?.fromDifficulty ?? 3;
    this.blockWeights = { 1: lb?.weights?.['1'] ?? 80, 2: lb?.weights?.['2'] ?? 20 };
  }

  difficulty(z: number): number { return Math.floor(z / 300); }

  /**
   * 铺设空中内容（飞行器触发/续时）：在 [fromZ,toZ] 生成三条车道的加密金币带（悬浮在飞行
   * 高度）与随机分布的云团。地面内容（障碍/地面金币/道具箱）不受影响、照常生成——飞行只是
   * 从上方掠过，玩家要求「天上也能看到地面障碍」；着陆安全由滑翔段的动态清道保证。
   */
  spawnSky(fromZ: number, toZ: number, skyY: number, coins: CoinEntity[], clouds: CloudEntity[]) {
    const spacing = this.coinSpacing * 0.65; // 空中金币带：间距再收紧、链间空档缩短（"金币会变多"）
    for (const lane of [-1, 0, 1]) {
      let z = fromZ + 8 + this.rng.range(0, 10);
      while (z < toZ - 8) {
        const bucket = this.rng.weighted(this.chainBuckets, b => b.weight);
        const len = this.rng.int(bucket.min, bucket.max);
        const id = ++this.chainSeq;
        for (let i = 0; i < len; i++) {
          const cz = z + i * spacing;
          if (cz < toZ - 4) coins.push({ lane, worldZ: cz, y: skyY, chain: id });
        }
        z += len * spacing + this.rng.range(10, 18); // 链间留空档，密度可控
      }
    }
    for (let z = fromZ + 12; z < toZ - 6; z += this.rng.range(30, 46)) {
      clouds.push({ worldZ: z, x: this.rng.pick([-1, 0, 1]) * this.laneWidthRef + this.rng.range(-0.6, 0.6), y: this.rng.range(skyY - 0.5, skyY + 0.9) });
    }
  }

  /** 保证赛道铺到 distance + aheadM；新障碍/金币/道具箱追加进传入数组（sim 持有所有权） */
  ensure(distance: number, aheadM: number, obstacles: ObstacleEntity[], coins: CoinEntity[], pickups: PickupEntity[] = []) {
    const target = distance + aheadM;
    while (this.genZ < target) {
      const pat = this.pickPattern(this.difficulty(this.genZ));
      const patStart = obstacles.length; // 记录本轮新障碍起点（金币反向清理用）
      for (const cell of pat.cells) {
        const z = this.genZ + cell.segment * this.segLen + cell.offsetM;
        if (cell.obsRef) {
          const def = this.defs.get(cell.obsRef);
          if (!def) continue; // validateRefs 已保证不会出现，防御一下
          const size = (def.size as number[]) ?? [2, 1.2, 1.2];
          obstacles.push({
            obsRef: cell.obsRef,
            cls: def.class as ObstacleEntity['cls'],
            w: size[0], h: size[1], d: size[2],
            lane: cell.lane, worldZ: z,
            swing: normalizeSwing(def.swing),
          });
        }
      }
      // 金币链：主链优先铺在模板安全线（docs/01：金币即教学），
      // 再按 laneGroupWeights 抽本组车道数（单道 70% > 双道 25% > 三道 5%）。
      // 关键约束：链完整落在本模板窗口内（不跨窗口 => 未来障碍永远压不到已投链），
      // 且与窗口内任何障碍同车道深度不重叠；放不下就整链放弃（宁缺毋残，保证 5~16 完整）。
      const safeLane = pat.guarantee?.safeLanePattern?.[0] ?? 0;
      const newObs = obstacles.slice(patStart); // 本轮新障碍（兜底反向清理用）
      const laneCount = this.rng.weighted([1, 2, 3], k => this.laneWeights[k] ?? 0);
      const others = [-1, 0, 1].filter(l => l !== safeLane);
      this.rng.shuffle(others);
      const lanes = [safeLane, ...others.slice(0, laneCount - 1)];
      // 反“金币荒漠”：某车道断档超过 coins.laneGapM（默认 120m）就强制补一条，
      // 保证玩家任意车道都不会长时间见不到金币（用户反馈：左右两条跑道看不到金币）。
      for (const l of [-1, 0, 1]) {
        if (!lanes.includes(l) && this.genZ - this.lastCoinZ[l] > this.laneGapM) lanes.push(l);
      }
      const winStart = this.genZ;
      const winEnd = this.genZ + pat.lengthSegments * this.segLen;
      /** 某车道在 [from,to] 内避开所有障碍深度区间后的连续空段列表 */
      const freeSegments = (lane: number, from: number, to: number): Array<[number, number]> => {
        const cuts: Array<[number, number]> = [];
        for (const o of obstacles) {
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
        const bucket = this.rng.weighted(this.chainBuckets, b => b.weight);
        const wantLen = this.rng.int(bucket.min, bucket.max);
        const segs = freeSegments(lane, winStart + 3, winEnd - 14); // 后缘让出 14m：24m 长列车的尾部会向后探约 13m
        // 选能容纳最长链的空段；长度按空段容量截断，仍不足 5 枚则放弃本车道
        let best: [number, number] | null = null;
        for (const s of segs) if (!best || (s[1] - s[0]) > (best[1] - best[0])) best = s;
        if (!best) continue;
        const capacity = Math.floor((best[1] - best[0]) / this.coinSpacing) + 1;
        const len = Math.min(wantLen, capacity, bucket.max);
        if (len < 5) continue;
        const maxStart = best[1] - (len - 1) * this.coinSpacing;
        const chainStart = this.rng.range(best[0], Math.max(best[0], maxStart));
        const id = ++this.chainSeq;
        for (let i = 0; i < len; i++) coins.push({ lane, worldZ: chainStart + i * this.coinSpacing, chain: id });
        this.lastCoinZ[lane] = chainStart + (len - 1) * this.coinSpacing; // 记录本车道最近投币位置
      }
      // 兜底反向清理（理论上不触发：链不跨窗；防御未来模板长度参数改小）
      if (newObs.length) {
        const killChains = new Set<number>();
        for (const c of coins) {
          if (c.chain == null) continue;
          for (const o of newObs) {
            if (o.lane === c.lane && Math.abs(c.worldZ - o.worldZ) < o.d / 2 + 0.8) { killChains.add(c.chain); break; }
          }
        }
        if (killChains.size) {
          for (let i = coins.length - 1; i >= 0; i--) if (coins[i].chain != null && killChains.has(coins[i].chain!)) coins.splice(i, 1);
        }
        // 道具箱同理：新障碍压到已投道具箱时先尝试换到空车道，无处可换才删除（保持段内数量分布）
        for (let i = pickups.length - 1; i >= 0; i--) {
          const p = pickups[i];
          if (!newObs.some(o => o.lane === p.lane && Math.abs(p.worldZ - o.worldZ) < o.d / 2 + 1.2)) continue;
          const alt = [-1, 0, 1].find(l => l !== p.lane && !obstacles.some(o => o.lane === l && Math.abs(p.worldZ - o.worldZ) < o.d / 2 + 1.2));
          if (alt !== undefined) p.lane = alt;
          else pickups.splice(i, 1);
        }
      }
      // 道具箱：每 segmentM（200m）一段，段内数量按 countWeights 抽 1/2/3（50/30/20）；
      // 位置在段内均分槽位随机落子（保证最小间隔），只放在无障碍车道；
      // 整段须完全位于已生成障碍区内（segEnd ≤ genZ），杜绝被后生成障碍压到。
      // 道具段须完全落在已生成障碍区内，且段尾再留 14m（24m 长列车中心可向后延伸 12m，
      // 防止后生成列车的尾部把已投道具箱反向撤回，导致段内箱数低于预期分布）
      while (this.nextPickupSeg + this.pickupSegmentM + 14 <= this.genZ) {
        const segStart = this.nextPickupSeg;
        const n = this.rng.weighted([1, 2, 3], k => this.pickupCountWeights[k] ?? 0);
        const span = this.pickupSegmentM - 2 * this.pickupEdgeM;
        const slot = Math.max(0, (span - (n - 1) * this.pickupMinGapM) / n);
        const refs = Object.keys(this.dropWeights);
        for (let k = 0; k < n && refs.length; k++) {
          const z = segStart + this.pickupEdgeM + k * (this.pickupMinGapM + slot) + this.rng.range(0, slot);
          const freeLanes = [-1, 0, 1].filter(l => !obstacles.some(o => o.lane === l && Math.abs(z - o.worldZ) < o.d / 2 + 1.2));
          if (!freeLanes.length) continue;
          pickups.push({ itemRef: this.rng.weighted(refs, r => this.dropWeights[r] ?? 0), lane: this.rng.pick(freeLanes), worldZ: z });
        }
        this.nextPickupSeg += this.pickupSegmentM;
      }
      this.genZ += pat.lengthSegments * this.segLen + this.rng.range(this.restGapM[0], this.restGapM[1]); // 模板后接喘息带
    }
  }

  /** 当前难度档可用模板池按权重抽一；高难度段（by ≥ laneBlock.fromDifficulty）
   *  再按「同时封堵车道数」（仅 full/vehicle/moving）二次过滤：默认 1 道 80% / 2 道 20%，
   *  3 道封堵永不出现；池内有 ≥2 个可选时排除上一个抽中的模板，避免连续同模板导致体感单一化。
   *  public：供测试与 M5 可解性求解器复用 */
  pickPattern(d: number): Pattern {
    let band = this.curve[0];
    for (const c of this.curve) if (c.by <= d) band = c;
    let pool = this.patterns.filter(p => p.minDifficulty <= d && (band.poolWeights[p.id] ?? 0) > 0);
    if (!pool.length) pool = this.patterns.filter(p => p.minDifficulty <= d); // 防御：难度带池为空时退回难度可用集
    if (!pool.length) pool = this.patterns; // 防御：配置极端时退回全量，绝不向空池抽签
    // 避免连续同模板：先排除上一个（排除后为空则不排除，保证不死锁）
    let candidates = pool;
    if (candidates.length > 1 && this.lastPatternId) {
      const fresh = candidates.filter(p => p.id !== this.lastPatternId);
      if (fresh.length) candidates = fresh;
    }
    if (d >= this.blockFromDiff && (this.blockWeights[1] ?? 0) + (this.blockWeights[2] ?? 0) > 0) {
      const want = this.rng.weighted([1, 2], k => this.blockWeights[k] ?? 0);
      const fit = candidates.filter(p => this.maxBlockedLanes(p) === want);
      if (fit.length) candidates = fit; // 该封堵数无可用模板时保留原池（不会死锁）
    }
    if (!candidates.length) throw new Error('TrackGen.pickPattern: 模板池为空（configValidator 应已拦截）');
    const picked = this.rng.weighted(candidates, p => band.poolWeights[p.id] ?? 0);
    this.lastPatternId = picked.id;
    return picked;
  }

  /** 模板的"封堵度"：单段内被「不可通过」障碍（full/vehicle/moving）占用的车道数最大值。
   *  低障/高杆/电弧可跳可铲通过，不计入封路——否则 by≥3 的单道池会被单一模板垄断。 */
  maxBlockedLanes(p: Pattern): number {
    const perSeg = new Map<number, Set<number>>();
    for (const cell of p.cells) {
      if (!cell.obsRef) continue;
      const cls = String(this.defs.get(cell.obsRef)?.class ?? '');
      if (!BLOCKING_CLASSES.has(cls)) continue;
      if (!perSeg.has(cell.segment)) perSeg.set(cell.segment, new Set());
      perSeg.get(cell.segment)!.add(cell.lane);
    }
    let max = 0;
    for (const s of perSeg.values()) max = Math.max(max, s.size);
    return max;
  }

  /** 清空与 [fromZ,toZ] 深度区间相交的地面障碍（滑翔着陆走廊/落地缓冲/起飞窄带；swap-pop 不保序）。
   *  lane 省略时清全部车道；传入车道号时只清该车道（起飞窄带只清玩家当前跑道）。
   *  返回移除数量。移除而非标记 done：渲染层也据此停止绘制，避免落地/起飞穿过残留模型。 */
  clearObstacles(obstacles: ObstacleEntity[], fromZ: number, toZ: number, lane?: number): number {
    let n = 0;
    for (let i = obstacles.length - 1; i >= 0; i--) {
      const o = obstacles[i];
      if (lane !== undefined && o.lane !== lane) continue;
      if (o.worldZ + o.d / 2 < fromZ || o.worldZ - o.d / 2 > toZ) continue;
      obstacles[i] = obstacles[obstacles.length - 1];
      obstacles.pop();
      n++;
    }
    return n;
  }
}
