/**
 * runnerSim 的每帧效果步进（M7b 自 step 逻辑抽出：surge 喷发 / crossings 穿越 / 潮位 / 追击者 / 弹跳垫），
 * 让 runnerSim 回到 ≤300 行红线内。纯逻辑：零分配（事件对象按需 push 例外）、确定性、回放安全。
 */
import { applySurgeStep, level } from './tide.js';
import { CROSSING_DEFAULTS, cullCrossings, stepCrossings, type CrossingEntity } from './crossings.js';
import type { ObstacleEntity } from './trackGen.js';
import type { RunnerState } from './simTypes.js';

/** step 效果的持有物（runnerSim 的字段视图；调用方每步传同一对象，零分配） */
export interface FxCtx {
  tideAware: boolean;
  surgeFired: boolean;
  crossings: CrossingEntity[];
  lastHits: number;
  laneWidth: number;
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
  // M7a 追击者：受击拉近 8m、奔跑缓慢拉远（钳 8~80）
  s.chaserDist = Math.max(8, Math.min(80, s.chaserDist + (s.hits > ctx.lastHits ? -8 : 0.02)));
  ctx.lastHits = s.hits;
  // M7a 弹跳垫：踩中弹起（vy=bounceVY，一次性）
  for (const o of obstacles) {
    if (o.cls !== 'bounce' || o.done) continue;
    if (Math.abs(s.distance - o.worldZ) < 2 && Math.abs(s.x - o.lane * ctx.laneWidth) < 1.5 && s.y < 1) {
      o.done = true;
      s.vy = o.bounceVY ?? 24; s.y = 0.1;
      events.push({ type: 'bounce', vy: s.vy });
    }
  }
  return surgeFired;
}
