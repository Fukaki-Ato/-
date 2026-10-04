/**
 * 障碍命中结算（从 runnerSim 拆出，守 300 行模块上限）：
 * 普通碰撞 —— 教程保护 → 护盾 → 滑板 → 硬直/致死（头盔挡刀），顺序与 M2 一致；
 * 闪电圈（zap）—— 先电掉护具（护盾/滑板/头盔），无护具时第一次受创硬直、第二次直接致死。
 * 这里只做结算；「会不会打到/算不算擦身」的几何判定在 collision.ts。
 */
import type { BuffEngine, FxState } from '../effects/buffEngine.js';
import type { RunnerState, SimEvent } from './simTypes.js';
import type { ObstacleEntity } from './trackGen.js';

export interface HitCtx {
  s: RunnerState;
  fx: FxState;
  buffs: BuffEngine;
  events: SimEvent[];
  lives: number;
  invulnS: number;
  hitStunS: number;
  /** 新手保护：protectionS=保护时长；take()=消耗本局唯一一次（标志由 sim 持有） */
  tutorial: { protectionS: number; take(): boolean };
}

export function resolveHit(o: ObstacleEntity, d: HitCtx): void {
  const { s, fx, buffs, events } = d;
  // 每个障碍最多造成一次判定：先消耗再判保护。
  // 否则长列车（d=24m 重叠约 2s > 无敌 1.4s）会在无敌结束后二次判负 —— 一条命制下必死无疑。
  o.done = true;
  if (s.invulnT > 0 || fx.invincible) return;
  // 身高优势（曼波被动）：需要下滑躲避的高杆直接穿过，不消耗任何保护与护体
  if (fx.duckPass && o.cls === 'high') return;
  // 下滑护体（曼波主动技能）：滑行中撞上小型障碍（cls=low）时消耗一次护体穿过去；次数用尽或不在滑行中则正常判负
  if (s.sliding && fx.slideGuardCharges > 0 && o.cls === 'low') {
    events.push({ type: 'slideGuard', charges: buffs.consumeSlideGuard() });
    s.invulnT = d.invulnS;
    return;
  }
  if (s.t < d.tutorial.protectionS && d.tutorial.take()) {
    s.invulnT = d.invulnS;
    events.push({ type: 'protected' });
    return;
  }
  if (o.zap === true) { zapShock(o, d); return; }
  // 护盾层优先（docs/01 §5：抵挡 1 次碰撞），其次滑板护甲
  if (fx.shieldLayers > 0) {
    events.push({ type: 'shieldBreak', layers: buffs.consumeShield() });
    s.invulnT = d.invulnS;
    return;
  }
  if (fx.boardT > 0) {
    buffs.remove('boardArmor');
    events.push({ type: 'boardBreak' });
    s.invulnT = d.invulnS;
    return;
  }
  s.hits++;
  s.stunT = d.hitStunS;
  s.invulnT = d.invulnS;
  events.push({ type: 'hit' });
  if (s.hits >= d.lives) {
    // 头盔：窗口内替角色挡下致命一击（该次受击撤销），随后头盔消失
    if (fx.helmetT > 0) {
      buffs.remove('lifeAdd');
      s.hits--;
      s.stunT = 0;
      s.invulnT = d.invulnS + 0.2;
      events.push({ type: 'helmetSave' });
      return;
    }
    s.alive = false;
    events.push({ type: 'death' });
  }
}

/** 闪电圈触电：护具被「电掉」；无护具——第一次受创硬直，第二次直接致死（头盔若在身已在本次被电掉） */
function zapShock(o: ObstacleEntity, d: HitCtx): void {
  const { s, fx, buffs, events } = d;
  const at = { lane: o.lane, worldZ: o.worldZ }; // 打击位置：渲染层雷电特效用
  const jolt = (gear: 'shield' | 'board' | 'helmet' | null) => {
    s.stunT = d.hitStunS;
    s.invulnT = d.invulnS;
    events.push({ type: 'zap', gear, ...at });
  };
  if (fx.shieldLayers > 0) {
    events.push({ type: 'shieldBreak', layers: buffs.consumeShield() });
    jolt('shield');
    return;
  }
  if (fx.boardT > 0) {
    buffs.remove('boardArmor');
    events.push({ type: 'boardBreak' });
    jolt('board');
    return;
  }
  if (fx.helmetT > 0) {
    buffs.remove('lifeAdd');
    jolt('helmet');
    return;
  }
  if (s.shocks >= 1) {
    s.hits++;
    s.alive = false;
    events.push({ type: 'death', ...at });
    return;
  }
  s.shocks++;
  jolt(null);
}
