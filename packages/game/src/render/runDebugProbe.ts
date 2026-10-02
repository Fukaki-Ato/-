/**
 * ?debug 自动化探针（docs/08 §2 的浏览器侧对拍入口）
 * 挂到 globalThis.__trRun：state 给逐帧数值快照，probe 给只读前瞻（近处障碍/道具箱/各车道金币）。
 * 只在 URL 带 ?debug 时安装，正式运行不产生任何全局变量；局结束时由 runnerScene.dispose 调用
 * uninstallRunProbe() 卸载，避免 __trRun 跨局残留。
 */
import type { RunnerSim } from '@tr/game/core/sim/runnerSim.js';
import type { createBurstPool } from './vfxBurst.js';
import type { createCoinField } from './coinField.js';

/** 前瞻采样窗口（米）：金币按车道统计、障碍/道具箱按最近若干个 */
const COIN_LOOKAHEAD_M = 60, OBS_LOOKAHEAD_M = 40, PICKUP_LOOKAHEAD_M = 200;

type BurstPool = ReturnType<typeof createBurstPool>;

export function installRunProbe(
  sim: RunnerSim,
  camera: () => { x: number; y: number },
  bursts: BurstPool,
  /** 渲染统计（drawcall / 三角面），docs/02 §8 性能预算与 docs/08 §5 门禁取证用 */
  renderInfo: () => { calls: number; triangles: number } = () => ({ calls: -1, triangles: -1 }),
  /** 金币场实际绘制数（「跳跃顶点金币消失」类问题排查用；正式运行不影响逻辑） */
  coinField?: ReturnType<typeof createCoinField>,
) {
  const r2 = (v: number) => +v.toFixed(2);
  const fxOf = () => {
    const f = sim.fx;
    return {
      magnetT: r2(f.magnetT), magnetRadius: r2(f.magnetRadius), bootsT: r2(f.bootsT), flyT: r2(f.flyT),
      helmetT: r2(f.helmetT), shield: f.shieldLayers, boardT: r2(f.boardT), invincible: f.invincible,
      speedMul: r2(f.speedMul), timeSlowMul: r2(f.timeSlowMul), avoid: r2(f.avoidLookahead),
      coinPct: r2(f.coinPct), slideAddS: r2(f.slideAddS), buffPct: r2(f.buffPct), cdMul: r2(f.cooldownMul),
    };
  };
  (globalThis as Record<string, unknown>).__trRun = {
    get state() {
      const s = sim.state;
      return {
        ...sim.summary(), sliding: s.sliding, y: r2(s.y), fx: fxOf(),
        lane: s.lane, x: r2(s.x), supportY: r2(s.supportY),
        coinN: coinField ? coinField.lastCount : -1,
        shocks: s.shocks,
        energy: r2(s.energy), cd: r2(s.skillCd), gliding: s.gliding, cam: camera(), draw: renderInfo(),
        burstFired: bursts.fired,
        obstacles: sim.obstacles.length, coins: sim.coinsArr.length,
        pickups: sim.pickupsArr.length, clouds: sim.cloudsArr.length,
      };
    },
    /** 只读前瞻探针：供自动化 QA 驾驶（近处障碍与道具箱的位置/车道/类型） */
    get probe() {
      const s = sim.state;
      const rel = (z: number) => z - s.distance;
      // 前方 60m 每条车道的未拾取金币数（审计「金币荒漠」用）
      const perLane = { '-1': 0, 0: 0, 1: 0 } as Record<number, number>;
      for (const c of sim.coinsArr) if (!c.taken && c.worldZ > s.distance && c.worldZ < s.distance + COIN_LOOKAHEAD_M) perLane[c.lane]++;
      return {
        obs: sim.obstacles.filter(o => !o.done && rel(o.worldZ) > 0 && rel(o.worldZ) < OBS_LOOKAHEAD_M)
          .slice(0, 8).map(o => ({ lane: o.lane, z: r2(rel(o.worldZ)), cls: o.cls, zap: o.zap === true })),
        pk: sim.pickupsArr.filter(p => !p.taken && rel(p.worldZ) > 0 && rel(p.worldZ) < PICKUP_LOOKAHEAD_M)
          .slice(0, 3).map(p => ({ lane: p.lane, z: r2(rel(p.worldZ)), item: p.itemRef })),
        coinsAhead: perLane,
        // 窗口内金币明细（与 render/coinField 的选取口径 z∈[-115,8] 一致，符号取 worldZ-dist；
        // 排查「跳跃顶点地面金币消失」用：taken 状态 + 远近分布）
        coins: sim.coinsArr
          .map(c => ({ z: r2(rel(c.worldZ)), y: r2(c.y ?? 0.65), taken: c.taken === true }))
          .filter(c => c.z >= -8 && c.z <= 116).slice(0, 40),
      };
    },
  };
}

/** 卸载探针：场景 dispose 时必须调用，否则 __trRun 会跨局存活并指向已销毁的 sim（审计 T9） */
export function uninstallRunProbe(): void {
  delete (globalThis as Record<string, unknown>).__trRun;
}
