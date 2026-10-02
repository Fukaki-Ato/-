/**
 * 着陆安全（用户反馈定稿：滑翔期完全不清障，只在落地帧清落脚点一小段）
 *  - 滑翔帧：**不清除任何障碍**——远近视界里的障碍全部保留（用户反馈「要掉下来时近处障碍
 *    还是会消失，近的消失远的不消失」即旧版下滑路径+26m 余量整段软清除所致）；
 *  - 落地帧（landed=true）：只清「落脚点前后一小段」（runout 14m），避免落点正前方贴障，
 *    并给 0.5s 反应缓冲；更远的障碍留给玩家正常观察与规避。
 * 安全性：判负由 runnerSim.collide 跳过滑翔段保证（滑翔=有控降落演出：不清障、不判负），
 * 落地帧再清一小段并给 0.5s 缓冲——「完全不清障」与「不摔死」由此兼得。
 * 软清除（done+clearT，渲染下沉消散）而非摘除实体：落地带内障碍渐隐，不是整批「场景刷新」。
 * 独立成文件：清道属「运动学→赛道」概念边界，且 runnerSim 受 300 行模块上限约束（docs/10 §4）。
 */
import type { ObstacleEntity, TrackGen } from './trackGen.js';
import type { RunnerState } from './simTypes.js';

/** 落地帧前方净空（米）：只清落脚点一小段，更远的障碍留给玩家正常反应 */
const LANDING_RUNOUT_M = 14;
/** 清道回溯（米）：覆盖落地瞬间压在身下/刚越过的实体 */
const CLEAR_BACK_M = 8;
/** 落地后反应缓冲（秒） */
const LANDING_GRACE_S = 0.5;

export function applyLandingSafety(
  gen: TrackGen, obstacles: ObstacleEntity[], s: RunnerState, landed: boolean,
): void {
  if (s.gliding) return; // 滑翔期完全不清障：障碍全程保留，判负由 runnerSim.collide 跳过滑翔段保证
  if (landed) {
    gen.softClearObstacles(obstacles, s.distance - CLEAR_BACK_M, s.distance + LANDING_RUNOUT_M, s.t);
    s.invulnT = Math.max(s.invulnT, LANDING_GRACE_S); // 落地后 0.5s 反应缓冲
  }
}
