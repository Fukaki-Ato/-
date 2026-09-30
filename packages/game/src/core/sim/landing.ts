/**
 * 滑翔着陆清道（docs/01 §4 飞行；用户反馈修正：飞行结束不再「直接摔死」）
 *  - 滑翔帧：软清空「剩余下滑路径 + 余量」深度区间的障碍（含全部车道——滑翔中允许变道）；
 *  - 落地帧（landed=true）：再清出落地净空缓冲，避免落点正前方就有障碍。
 * 软清除（done+clearT，渲染下沉消散）而非摘除实体：落地瞬间不再整批「场景刷新」式消失（用户反馈）。
 * 独立成文件：清道属「运动学→赛道」概念边界，且 runnerSim 受 300 行模块上限约束（docs/10 §4）。
 */
import type { ObstacleEntity, TrackGen } from './trackGen.js';
import type { RunnerState } from './simTypes.js';

/** 下滑路径向前清障余量（米）与落地后净空缓冲（米） */
const GLIDE_CLEAR_MARGIN_M = 26, LANDING_RUNOUT_M = 40;
/** 清道回溯（米）：覆盖上一帧刚越过的实体，避免边界残留 */
const CLEAR_BACK_M = 8;

export function clearLandingPath(
  gen: TrackGen, obstacles: ObstacleEntity[], s: RunnerState,
  fallMps: number, speedMps: number, landed: boolean,
): void {
  if (s.gliding) {
    const reach = (s.y / fallMps) * speedMps + GLIDE_CLEAR_MARGIN_M;
    gen.softClearObstacles(obstacles, s.distance - CLEAR_BACK_M, s.distance + reach, s.t);
  } else if (landed) {
    gen.softClearObstacles(obstacles, s.distance - CLEAR_BACK_M, s.distance + LANDING_RUNOUT_M, s.t);
  }
}
