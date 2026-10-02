/**
 * 碰撞几何与判定谓词（docs/01 §4.2 障碍类型应对方式）
 * 纯函数：只吃「障碍实体 + 角色状态」，不写任何状态，便于逐条做 docs/08 §2 的 fixture 测试。
 * 命中/近失的**结算**在 runnerSim.onHit()，这里只回答「会不会打到 / 算不算擦身」。
 */
import type { ObstacleEntity } from './trackGen.js';
import { BAR_BOTTOM, type RunnerState } from './simTypes.js';

/** 角色碰撞盒宽（docs/01 §3：0.8×1.7×0.8），与障碍宽度相加后取半 */
export const HIT_BOX_W = 0.8;
/** 深度容差：步进 1/60 秒下允许的穿透余量 */
const DEPTH_SLACK = 0.4;
/** 近失窗口：横向间隙小于该值算「擦身而过」（docs/01 §9 惊险分） */
const NEAR_MISS_M = 0.55;

/** 障碍相对角色的 z（掠过面为 0；负=还在前方逼近中） */
export function relZ(o: ObstacleEntity, distance: number): number {
  return distance - o.worldZ;
}

/** 障碍中心 x（pendulum 类随时间横摆，摆幅取一半见 obstacles.json swing.ampM）。
 *  防呆：swing 字段非法（NaN/非正周期）或角色时间异常时按车道中心处理，绝不返回 NaN。 */
export function obstacleX(o: ObstacleEntity, t: number, laneWidth: number): number {
  const center = o.lane * laneWidth;
  const sw = o.swing;
  let x = center;
  if (sw) {
    const amp = Number.isFinite(sw.ampM) ? sw.ampM : 0;
    const period = Number.isFinite(sw.periodS) && sw.periodS > 0 ? sw.periodS : 0;
    if (period > 0) {
      x = center + Math.sin(t * Math.PI * 2 / period) * amp * 0.5;
    }
  }
  // 横摆不得扫出路面（路宽=3·laneWidth+1.2，见 render/trackVisuals）：
  // 中心限幅到 ±(路半宽-(o.w+HIT_BOX_W)/2)，极端相位仍压得到最外侧车道的碰撞盒（不至于躲到地图外）。
  const maxAbs = (3 * laneWidth + 1.2) / 2 - (o.w + HIT_BOX_W) / 2;
  if (Number.isFinite(maxAbs) && maxAbs > 0) x = Math.max(-maxAbs, Math.min(maxAbs, x));
  return Number.isFinite(x) ? x : 0;
}

/** 角色与障碍是否处于同一深度层 */
export function inDepthWindow(o: ObstacleEntity, z: number): boolean {
  return z >= -o.d / 2 - DEPTH_SLACK && z <= o.d / 2 + DEPTH_SLACK;
}

/** 横向间隙：>0 表示没压上，越小越险。几何量非有限（脏数据）时返回 +∞，按「未接触」处理。 */
export function lateralGap(o: ObstacleEntity, s: RunnerState, laneWidth: number): number {
  const gap = Math.abs(obstacleX(o, s.t, laneWidth) - s.x) - (o.w + HIT_BOX_W) / 2;
  return Number.isFinite(gap) ? gap : Number.POSITIVE_INFINITY;
}

/** 是否算一次惊险擦身（掠过但几乎贴上） */
export function isNearMiss(o: ObstacleEntity, s: RunnerState, laneWidth: number): boolean {
  const gap = lateralGap(o, s, laneWidth);
  return gap > 0 && gap < NEAR_MISS_M;
}

/** 可站立载具（rideTop）的车顶落顶判定余量（米）：低于车顶该值以上视为撞前脸而非落顶 */
export const RIDE_TOP_EPS = 0.08;

/** 纵向判定：低障要跳够、高杆要钻或跃顶、电弧地面要跳起、满格与载具只能换道 */
export function hitsRunner(o: ObstacleEntity, s: RunnerState, laneWidth: number): boolean {
  if (lateralGap(o, s, laneWidth) > 0) return false;
  const playerH = s.sliding ? 0.7 : 1.7;
  if (o.cls === 'low') return s.y < o.h * 0.75;
  if (o.cls === 'step') return false; // 板子：纯支撑面，永不判负（用于无弹跳鞋登火车）
  if (o.cls === 'high') return s.y < o.h && s.y + playerH > BAR_BOTTOM;
  if (o.cls === 'hazard') return s.y < 0.35;
  if (o.cls === 'moving') return o.jumpable ? s.y < o.h * 0.75 : true; // 摆锤 jumpable=true：跳够高度即可越过
  if (o.cls === 'vehicle') return !(o.rideTop === true && s.y >= o.h - RIDE_TOP_EPS); // 列车顶可落可站
  return true; // full：满格墙只能换道
}

/** 判定「前方有威胁」的最小距离（米）：贴脸的障碍已经来不及换道，不计入 */
const AVOID_MIN_Z = 0.5;

/**
 * 雷霆冲刺 laneAutoAvoid 的车道选择（docs/03 §4.3）。
 * 纯确定性扫描：数每条车道 lookaheadM 内的障碍数，选最少的一条；
 * 车道遍历顺序固定为 -1/0/1，平局结果可复现（C6）。
 * @returns 应前往的车道编号（可能等于当前车道，表示无需换道）
 */
export function safestLane(
  obstacles: ObstacleEntity[], s: RunnerState, lookaheadM: number,
): number {
  const blocked = (lane: number) => {
    let n = 0;
    for (const o of obstacles) {
      if (o.done || o.lane !== lane) continue;
      const z = o.worldZ - s.distance;
      if (z > AVOID_MIN_Z && z < lookaheadM) n++;
    }
    return n;
  };
  let best = s.lane, bestN = blocked(s.lane);
  for (const l of [-1, 0, 1]) {
    if (l === s.lane) continue;
    const n = blocked(l);
    if (n < bestN) { bestN = n; best = l; }
  }
  return best;
}
