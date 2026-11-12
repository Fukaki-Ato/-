/**
 * runnerSim 的每帧效果步进（M7b 自 step 逻辑抽出：surge 喷发 / crossings 穿越 / 潮位 / 追击者 / 弹跳垫），
 * 让 runnerSim 回到 ≤300 行红线内。纯逻辑：零分配（事件对象按需 push 例外）、确定性、回放安全。
 */
import { applySurgeStep, level } from './tide.js';
import { CROSSING_DEFAULTS, cullCrossings, stepCrossings, type CrossingEntity } from './crossings.js';
import { zoneAt, type Zone } from './zones.js';
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
  // A-2 反重力预告窗：zoneAt 查区内（区内=0，用法同 runnerSim 的 flip 推导）；区外二分找下一区起点
  // （zones 按 startM 升序），剩余 ∈(0,60] ⇒ flipWarn=剩余米数（60m≈3 秒预告）。zones 空 ⇒ 恒 0（硬门）。
  s.flipWarn = 0;
  if (ctx.zones.length > 0 && !zoneAt(ctx.zones, s.distance)) {
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
