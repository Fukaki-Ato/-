/**
 * 着陆安全（用户反馈定稿：从天上落地时不再自动清除任何障碍、也不要无敌）
 *  - 滑翔帧：不清除任何障碍——远近视界里的障碍全程保留（旧版「下滑路径+26m」整段软清除，
 *    就是用户反馈「要掉下来时近处障碍成片消失、远处不动」的根因）；
 *  - 落地帧（landed=true）：**不清障、也不给无敌**——用户明确要求「飞行落下的时候不要无敌」，
 *    落地瞬间即恢复常规判定，撞到就是撞到；落点选择由玩家在滑翔段自己看与控。
 *  - 下方有火车/斜坡时落上去：由 movement 滑翔段支撑面判定负责（正常落火车顶，不穿模）。
 * 判负由 runnerSim.collide 跳过滑翔段保证（滑翔=有控降落演出：不清障、不判负）。
 * 另管着陆回收：空中金币带在落地帧整套撤走（用户反馈：回到地面后天上的金币应消失）。
 * 独立成文件：着陆安全属「运动学→赛道」概念边界，且 runnerSim 受 300 行模块上限约束（docs/10 §4）。
 */
import type { CoinEntity } from './trackGen.js';
import type { RunnerState } from './simTypes.js';

/** 空中金币带的最低高度（米）：高于此值的金币视为飞行段内容，着陆时回收 */
const SKY_COIN_MIN_Y = 2;

/** 落地帧不做任何保护动作（不清障/不无敌/不缓速）：保留为钩子供后续策略扩展 */
export function applyLandingSafety(_s: RunnerState, _landed: boolean): void { /* 无操作 */ }

/**
 * 着陆回收空中金币带（用户反馈：用飞行背包回到地面后，天上的金币应消失）。
 * 判定：coin.y 高于 SKY_COIN_MIN_Y 的即飞行段铺的空带（地面链 y=0.65，见 trackSky）。
 * swap-pop 摘除、不播吸入动画：落地即整套撤走，不再有悬在空中的地面关卡币。
 */
export function clearSkyCoins(coins: CoinEntity[]): void {
  for (let i = coins.length - 1; i >= 0; i--) {
    const y = coins[i]!.y;
    if (y != null && y > SKY_COIN_MIN_Y) {
      coins[i] = coins[coins.length - 1]!;
      coins.pop();
    }
  }
}
