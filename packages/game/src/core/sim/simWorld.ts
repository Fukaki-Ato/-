/**
 * EffectWorld 的 sim 侧实现（docs/03 §4.3 瞬时原语与飞行对世界的作用面）
 * 单独成文件的原因：这些操作要直接改动赛道实体（撞碎障碍、开空中段、插金币排），
 * 属于「引擎 → 世界」的适配层，与逐帧玩法推进（runnerSim.step）不是同一个概念。
 * deps 由 sim 构造时建一次并复用（热路径零分配）。
 */
import type { EffectWorld } from '../effects/buffEngine.js';
import type { CloudEntity, CoinEntity, ObstacleEntity, PickupEntity, TrackGen } from './trackGen.js';
import { FLY_SPEED_CAP, type RunnerState, type SimEvent } from './simTypes.js';

export interface FlightParams { heightM: number; speedMul: number; glideSpeedMul: number; glideS: number }

export interface SimWorldDeps {
  state: RunnerState;
  obstacles: ObstacleEntity[];
  coins: CoinEntity[];
  pickups: PickupEntity[];
  clouds: CloudEntity[];
  events: SimEvent[];
  gen: TrackGen;
  fly: FlightParams;
  /** game.json coins.spacingM：spawnCoinsRow 未显式给间距时使用 */
  coinSpacing: number;
  /** scoreAdd 原语的加分入口 */
  addBonus(points: number): void;
  /** fly 原语触发瞬间：sim 需要知道「已进入飞行」以正确衔接滑翔降落 */
  onFlightStart(): void;
}

/** 空中内容铺设速度：取飞行巡航上限（实际飞行速度∈[base×2.5, 34]），再叠滑翔尾段 */
const SKY_METERS_PER_SECOND = FLY_SPEED_CAP;
const SKY_GLIDE_TAIL_M = 70;
/** 起飞窄带：同车道前方清障长度与向后余量（米）。缓升到最高障碍顶 2.6m 约需 8m 行程，12m 留裕量 */
const TAKEOFF_CLEAR_M = 12, TAKEOFF_CLEAR_BACK_M = 2;

export function createSimWorld(d: SimWorldDeps): EffectWorld {
  let coinChainSeq = 0; // 奖励技金币排的链号，只需本局唯一
  /** 金币带/云团已铺到的世界 z（续飞时从这里往后补，避免重叠与断档） */
  let skyContentTo = 0;
  return {
    advance: (distanceM: number) => { d.state.distance += Math.max(0, distanceM); },

    destroyObstacles: (lane, fromD, toD) => {
      let n = 0;
      for (const o of d.obstacles) {
        if (o.done || o.lane !== lane) continue;
        if (o.worldZ + o.d / 2 < fromD || o.worldZ - o.d / 2 > toD) continue;
        o.done = true;
        o.passed = true;
        d.state.nearMiss++;
        d.events.push({ type: 'nearMiss' });
        n++;
      }
      return n;
    },

    firstBlocker: (lane, fromD, toD) => {
      let best: number | null = null;
      for (const o of d.obstacles) {
        if (o.done || o.lane !== lane) continue;
        const front = o.worldZ - o.d / 2;
        if (front < fromD || front > toD) continue;
        if (best === null || front < best) best = front;
      }
      return best;
    },

    grantCoinRow: (lanes, startM, lengthM, spacingM, y) => {
      const spacing = spacingM > 0 ? spacingM : d.coinSpacing;
      const count = Math.max(0, Math.floor(lengthM / spacing));
      const id = ++coinChainSeq;
      for (const lane of lanes) {
        for (let i = 0; i < count; i++) {
          d.coins.push({ lane, worldZ: d.state.distance + startM + i * spacing, y, chain: id });
        }
      }
    },

    addBonusScore: (points: number) => { d.addBonus(Math.max(0, points)); },

    startFlight: (durationS, heightM) => {
      const s = d.state;
      s.gliding = false;
      d.onFlightStart();
      const height = heightM ?? d.fly.heightM;
      const from = s.distance + 8;
      const to = s.distance + durationS * SKY_METERS_PER_SECOND + SKY_GLIDE_TAIL_M;
      // 地面内容整体不清场、不中断：飞行从上方掠过，地面障碍照常保留（可俯瞰）；着陆安全另由滑翔清道保证。
      // 唯一例外：起飞窄带——同车道前方 12m 内的障碍清除，避免缓升阶段身体穿进障碍模型。
      d.gen.spawnSky(from, to, height, d.coins, d.clouds);
      d.gen.clearObstacles(d.obstacles, s.distance - TAKEOFF_CLEAR_BACK_M, s.distance + TAKEOFF_CLEAR_M, s.lane);
      skyContentTo = to;
    },

    extendFlight: (durationS) => {
      const to = d.state.distance + durationS * SKY_METERS_PER_SECOND + SKY_GLIDE_TAIL_M;
      if (to <= skyContentTo + 8) return; // 续时没有把终点推远，无需补铺
      d.gen.spawnSky(skyContentTo, to, d.fly.heightM, d.coins, d.clouds);
      skyContentTo = to;
    },
  };
}
