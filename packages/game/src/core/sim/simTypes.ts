/**
 * sim 层的公共类型与物理常量（docs/01 §3、docs/02 §5）
 * 只放「无行为」的定义，供 runnerSim 与各子模块共用，避免相互 import 成环。
 */
import type { Loadout } from './character.js';

/** 固定步长：1/60 秒。渲染帧率与其解耦（docs/02 §5） */
export const STEP_DT = 1 / 60;

/** 飞行/滑翔期间的速度上限（防高速档 2.5 倍后步进过大） */
export const FLY_SPEED_CAP = 34;

/** 高杆横杆的下沿高度：低于此高度可钻（滑铲），高于杆顶可跳越（弹跳鞋） */
export const BAR_BOTTOM = 1.2;

/** 输入缓冲 ≈120ms（game.json input.bufferMs 的步数化） */
export const PENDING_STEPS = 7;

/** pickupAll 的吸取纵深（米）：超过视野无意义，取近视野值 */
export const VACUUM_RANGE_M = 60;

export type SimAction = 'jump' | 'slide' | 'laneL' | 'laneR' | 'skill';
export type SimEvent =
  | { type: 'coin' } | { type: 'hit' } | { type: 'protected' } | { type: 'nearMiss' }
  /** death 可带打击位置（闪电圈致死时）：渲染层据此把雷电画在致死点 */
  | { type: 'death'; lane?: number; worldZ?: number }
  | { type: 'pickup'; itemRef: string } | { type: 'helmetSave' }
  | { type: 'cast'; skillRef: string } | { type: 'shieldBreak'; layers: number } | { type: 'boardBreak' }
  /** zap 带打击位置（lane/worldZ）：渲染层据此把雷电特效画到闪电圈所在车道与深度 */
  | { type: 'zap'; gear: 'shield' | 'board' | 'helmet' | null; lane: number; worldZ: number };

export interface RunnerState {
  t: number; distance: number; prevDistance: number;
  lane: number; x: number; y: number; vy: number;
  sliding: boolean; slideT: number;
  stunT: number; invulnT: number; hits: number; alive: boolean; topple: number;
  shocks: number; // 已被闪电圈电到的次数（无护具时第二次直接致死）
  coins: number; nearMiss: number; score: number;
  gliding: boolean; // 飞行器燃料耗尽后的降落段
  /** 主动技能能量（0..skill.energyMax）、冷却剩余、本局释放次数 */
  energy: number; skillCd: number; casts: number;
  /** 当前可站立支撑面高度（米，0=地面；>0=列车顶/坡道面）。每帧由 movement 算好后写回：
   *  渲染层据此区分「站在支撑面上跑」与「真正离地」，sim→render 单向数据流 */
  supportY: number;
}

/** 空装备：未指定角色时的默认手感（保持 M1 行为不变） */
export const EMPTY_LOADOUT: Loadout = {
  charId: '', name: '跑者', tagline: '', tint: '#7FD1FF', rarity: 'R',
  skill: null, passive: [], talentLabel: '', talentDesc: '',
  skinId: '', bodyTint: '#F2F4F8', emissive: '#7FD1FF', modelScale: 1,
};

/** 新建一局的状态初值 */
export function initialRunnerState(): RunnerState {
  return {
    t: 0, distance: 0, prevDistance: 0, lane: 0, x: 0, y: 0, vy: 0,
    sliding: false, slideT: 0, stunT: 0, invulnT: 0, hits: 0, alive: true, topple: 0,
    shocks: 0,
    coins: 0, nearMiss: 0, score: 0, gliding: false,
    energy: 0, skillCd: 0, casts: 0,
    supportY: 0,
  };
}
