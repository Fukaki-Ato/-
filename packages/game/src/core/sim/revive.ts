/**
 * 自动复活（config revive 段，M 白捡玩法）：死亡时清空受击/触电计数 + 无敌窗 + 复活走廊软清障
 * （对齐落地缓冲口径 ±12/14m，不给走廊外的额外保护）。
 * 确定性：同 seed/inputs 下 server 重放按相同规则复现，不进协议、不涉货币。
 */
import type { RunnerState, SimEvent } from './simTypes.js';
import type { ObstacleEntity, TrackGen } from './trackGen.js';

export interface ReviveState {
  /** 本局剩余复活次数（min(maxPerRun, webFreeRevivePerRun)——语义即「每局免费复活数」，平台无关） */
  left: number;
  invincibleS: number;
}

export function parseReviveConfig(raw: Record<string, unknown>): ReviveState {
  const maxRevives = Math.max(0, Math.floor((raw['maxPerRun'] as number) ?? 0));
  const free = Math.max(0, Math.floor((raw['webFreeRevivePerRun'] as number) ?? 0));
  return { left: Math.min(maxRevives, free), invincibleS: (raw['invincibleS'] as number) ?? 3 };
}

/** 尝试复活：成功则就地改写 state 并返回新余量对象（不可变更新便于 sim 持有）；失败原样返回 */
export function tryRevive(
  cfg: ReviveState, s: RunnerState, gen: TrackGen, obstacles: ObstacleEntity[], events: SimEvent[],
): ReviveState {
  if (cfg.left <= 0) return cfg;
  const next = { ...cfg, left: cfg.left - 1 };
  s.alive = true;
  s.hits = 0;
  s.shocks = 0;
  s.stunT = 0;
  s.invulnT = cfg.invincibleS;
  s.topple = 0;
  gen.softClearObstacles(obstacles, s.distance - 12, s.distance + 14, s.t);
  s.revivesUsed++;
  events.push({ type: 'revive', left: next.left });
  return next;
}
