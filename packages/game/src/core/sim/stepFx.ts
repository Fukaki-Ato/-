/**
 * runnerSim 的每帧效果步进（M7b 自 step 逻辑抽出：surge 喷发 / crossings 穿越 / 潮位 / 追击者 / 弹跳垫），
 * 让 runnerSim 回到 ≤300 行红线内。纯逻辑：零分配（事件对象按需 push 例外）、确定性、回放安全。
 */
import { applySurgeStep, level } from './tide.js';
import { CROSSING_DEFAULTS, cullCrossings, stepCrossings, type CrossingEntity } from './crossings.js';
import { zoneAt, type Zone } from './zones.js';
import { lowGravAt, warpAt, RAIN_WARN_M, type LowGravSeg, type RainWin, type WarpSeg } from './warps.js';
import type { ObstacleEntity } from './trackGen.js';
import type { RunnerState } from './simTypes.js';

/** step 效果的持有物（runnerSim 的字段视图；调用方每步传同一对象，零分配） */
export interface FxCtx {
  tideAware: boolean;
  surgeFired: boolean;
  crossings: CrossingEntity[];
  lastHits: number;
  laneWidth: number;
  /** 反重力区表引用（A-2 预告窗用；runnerSim 构造后在 gen 就绪处注入 gen.zones。未配置=空数组 ⇒ flipWarn 恒 0） */
  zones: Zone[];
  /** Stormspire 三表引用（warps.ts）：未注入/未配置=空数组=查询恒 null=恒零变化（硬门） */
  warps: WarpSeg[];
  rains: RainWin[];
  lows: LowGravSeg[];
  /** 金币雨已预告的窗口序号（「当前窗口序号」法，初始 −1：表按 startM 升序 ⇒ 一次性事件纯 (state,ctx) 推导） */
  lastRain: number;
  /** 上一帧 warp 状态（0|1，初始 0）：沿检测推 {type:'warp', phase:±1} 一次性事件（渲染闪屏「时空隧道！」消费） */
  lastWarp: 0 | 1;
  /** 当前低重力倍率（stepFx 每步写 lg ? lg.gMul : 1；runnerSim 透传给 movement 的重力积分） */
  lowGravMulNow: number;
}

/**
 * 每帧效果步进：surge 喷发事件/预警窗 → crossings 穿越判定/回收 → 潮位 → 追击者 → 弹跳垫。
 * 返回新的 surgeFired（调用方写回字段）。
 */
export function stepFx(s: RunnerState, dm: number, events: { type: string; [k: string]: unknown }[],
  obstacles: ObstacleEntity[], ctx: FxCtx): boolean {
  // M4 喷发判定化：进喷发段一次性 surge 事件；1s 红光预警窗（距下段起点 ≤ 估速×1.0s）写 surgeWarn
  let surgeFired = ctx.surgeFired;
  if (ctx.tideAware) surgeFired = applySurgeStep(s, dm, events, surgeFired);
  else s.surgeWarn = 0;
  // M4 穿越判定层：深度窗+高度带一次性判定，命中加分推 cross 事件（渲染层爆点）
  s.score += stepCrossings(ctx.crossings, s.distance, s.y, CROSSING_DEFAULTS, events) * CROSSING_DEFAULTS.scorePer;
  cullCrossings(ctx.crossings, s.distance, 14);
  s.tideLevel = level(s.distance);
  // Stormspire 三事件派生（warps.ts）：区内 ⇒ warp=1 + warpRemain=endM−distance（HUD 倒计时）；
  // 低重力带内 ⇒ lowGravRemain 同式 + lowGravMulNow=gMul（movement 重力积分透传）。表空 ⇒ 恒 0/1（硬门）。
  const wp = warpAt(ctx.warps, s.distance);
  s.warp = wp ? 1 : 0;
  s.warpRemain = wp ? wp.endM - s.distance : 0;
  if (s.warp !== ctx.lastWarp) { ctx.lastWarp = s.warp; events.push({ type: 'warp', phase: wp ? 1 : -1 }); } // 进/出隧道各一次
  const lg = lowGravAt(ctx.lows, s.distance);
  s.lowGravRemain = lg ? lg.endM - s.distance : 0;
  ctx.lowGravMulNow = lg ? lg.gMul : 1;
  // 金币雨一次性事件：「当前窗口序号」法（lastRain 单调推进，同 surgeFired 口径、纯 (state,ctx) 推导回放安全）。
  // 二分找 distance 所在/下一窗口，idx 推进且到达预告位（提前 RAIN_WARN_M=30m）⇒ push 一次 coinRain。
  if (ctx.rains.length > 0) {
    let lo = 0, hi = ctx.rains.length; // 第一个 endM > distance 的窗口（所在/下一窗；表按 startM 升序）
    while (lo < hi) { const mid = (lo + hi) >> 1; if (ctx.rains[mid]!.endM <= s.distance) lo = mid + 1; else hi = mid; }
    const w = ctx.rains[lo];
    if (w && lo > ctx.lastRain && s.distance >= w.startM - RAIN_WARN_M) { ctx.lastRain = lo; events.push({ type: 'coinRain', startM: w.startM }); }
  }
  // A-2/B-9 反重力区查询：zoneAt 一次查询共用——区内 ⇒ zoneRemain=endM−distance（HUD 区内倒计时）、flipWarn 保持 0；
  // 区外 ⇒ zoneRemain=0，二分找下一区起点（zones 按 startM 升序），剩余 ∈(0,60] ⇒ flipWarn=剩余米数（60m≈3 秒预告）。
  // zones 空 ⇒ 两者恒 0（硬门）。flipWarn 取值与 A-2 版逐字节一致（同一次 zoneAt 结果分流）。
  s.flipWarn = 0; s.zoneRemain = 0;
  const zn = ctx.zones.length > 0 ? zoneAt(ctx.zones, s.distance) : null;
  if (zn) s.zoneRemain = zn.endM - s.distance;
  else {
    let lo = 0, hi = ctx.zones.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (ctx.zones[mid]!.startM <= s.distance) lo = mid + 1; else hi = mid; }
    if (lo < ctx.zones.length) { const gap = ctx.zones[lo]!.startM - s.distance; if (gap <= 60) s.flipWarn = gap; }
  }
  // M7a 追击者：受击拉近 8m、奔跑缓慢拉远（钳 8~80）
  s.chaserDist = Math.max(8, Math.min(80, s.chaserDist + (s.hits > ctx.lastHits ? -8 : 0.02)));
  ctx.lastHits = s.hits;
  // M7a 弹跳垫 + M7b 发射台：踩中正向弹射（一次性；发射台在坡末端触发，弹上火车顶/高处）
  for (const o of obstacles) {
    if (o.done) continue;
    const inLane = Math.abs(s.x - o.lane * ctx.laneWidth) < 1.5;
    const hitPad = o.cls === 'bounce' && inLane && Math.abs(s.distance - o.worldZ) < 2 && s.y < 1;
    const hitRamp = o.cls === 'step' && o.launchVY !== undefined && inLane
      && s.distance - o.worldZ > o.d / 2 - 1.5 && s.distance - o.worldZ < o.d / 2 + 1 && s.y < 1.2;
    if (hitPad || hitRamp) {
      o.done = true;
      s.vy = hitRamp ? o.launchVY! : (o.bounceVY ?? 24); s.y = Math.max(s.y, 0.1);
      events.push({ type: 'bounce', vy: s.vy });
    }
  }
  return surgeFired;
}
