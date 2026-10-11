/**
 * 收集物拾取判定（docs/01 §5 收集物与道具）
 * 与 collision.ts 同思路：判定逻辑独立成纯函数，入账/施加 buff 通过 deps 回调交回 sim。
 * deps 对象由 sim 在构造时建一次并复用（每帧零分配，docs/02 §8）。
 */
import type { CoinEntity, PickupEntity } from './trackGen.js';
import type { FxState } from '../effects/buffEngine.js';
import { VACUUM_RANGE_M, type RunnerState, type SimEvent } from './simTypes.js';

/** 金币高度匹配窗口：角色重心（y+0.9）与金币圆心（默认 0.65）的允许差 */
const COIN_Y_TOL = 1.3;
/** 金币横向判定：车道中心 ±0.9 米 */
const COIN_X_TOL = 0.9;
/** 道具箱横向判定（箱子比金币大，容差略宽） */
const PICKUP_X_TOL = 1.0;
const PICKUP_Y_TOL = 1.4;
/**
 * 道具箱的悬浮中心高度（米）：渲染层直接用这一个数（entityLayers 贴砖图时同源），
 * 免得「看得见的位置」和「吃得到的位置」各写各的。2026-10-07 从 0.75 抬到 1.15：
 * 砖图正面贴徽标后需要正对玩家才认得出道具，抬到胸口高度既更显眼也不挡路面视线。
 * 容差 1.4m 远大于抬升量，地面跑动照旧必吃（|0.9-1.15|=0.25）。
 */
export const PICKUP_CENTER_Y = 1.15;

export interface CollectDeps {
  state: RunnerState;
  coins: CoinEntity[];
  pickups: PickupEntity[];
  fx: FxState;
  events: SimEvent[];
  laneWidth: number;
  /** 收集判定面（角色前表面，负值；game.json runner.coinCollectM） */
  coinFront: number;
  /** 一枚金币入账（含 coinValueAdd 加成，由 sim 计数） */
  creditCoin(): void;
  /** 施加道具的全部原语效果 */
  grantItem(itemRef: string): void;
}

export function collectCoins(d: CollectDeps): void {
  const { state: s, fx, coins, coinFront, laneWidth } = d;
  for (const c of coins) {
    if (c.taken) continue;
    const z = s.distance - c.worldZ; // 负=前方逼近中
    const yOK = Math.abs(s.y + 0.9 - (c.y ?? 0.65)) < COIN_Y_TOL; // 空中金币带 / 地面金币各自匹配
    // 磁铁：身前 magnetRadius 米内三车道金币直接吸取（渲染层做飞向角色的吸入表现）
    if (fx.magnetT > 0 && yOK && z <= coinFront && z >= -fx.magnetRadius) { takeCoin(d, c); continue; }
    if (z >= coinFront && !c.passed) {
      c.passed = true;
      if (Math.abs(c.lane * laneWidth - s.x) < COIN_X_TOL && yOK) takeCoin(d, c);
    }
  }
}

function takeCoin(d: CollectDeps, c: CoinEntity) {
  c.taken = true;
  c.takenAt = d.state.t;
  d.creditCoin();
  d.events.push({ type: 'coin' });
}

/** 道具箱：与金币同规则（同车道面碰撞）；pickupAll 期间无视车道与高度直接吸取 */
export function collectPickups(d: CollectDeps): void {
  const { state: s, fx, pickups, laneWidth } = d;
  for (const p of pickups) {
    if (p.taken) continue;
    const z = s.distance - p.worldZ; // 负=前方逼近中
    // 真空吸取方向：身前 VACUUM_RANGE_M 米、身后 3m 容差（修正前误吸的是身后 60m）
    const vacuum = fx.pickupAllT > 0 && z > -VACUUM_RANGE_M && z < 3;
    if (!((z >= 0 && !p.passed) || vacuum)) continue;
    p.passed = true;
    const laneOK = vacuum || Math.abs(p.lane * laneWidth - s.x) < PICKUP_X_TOL;
    const heightOK = vacuum || Math.abs(s.y + 0.9 - PICKUP_CENTER_Y) < PICKUP_Y_TOL;
    if (!laneOK || !heightOK) continue;
    p.taken = true;
    d.grantItem(p.itemRef);
    d.events.push({ type: 'pickup', itemRef: p.itemRef });
  }
}
