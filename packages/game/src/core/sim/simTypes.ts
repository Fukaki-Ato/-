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

/** 角色站立碰撞净空高（米）：无 characters.json clearance 字段时的默认值（老角色/程序化模型）。
 *  per-character 覆盖见 character.ts 的 Loadout.clearance——矮个角色（char_mambo）净空低于
 *  BAR_BOTTOM 时可不滑铲直接钻过高杆门，其余角色仍必须滑铲。 */
export const STAND_H = 1.7;

/** 滑铲碰撞净空高（米）：所有角色统一——滑铲是姿态不是身高，不按角色缩放 */
export const SLIDE_H = 0.7;

/** 输入缓冲 ≈120ms（game.json input.bufferMs 的步数化） */
export const PENDING_STEPS = 7;

/** pickupAll 的吸取纵深（米）：超过视野无意义，取近视野值 */
export const VACUUM_RANGE_M = 60;

export type SimAction = 'jump' | 'slide' | 'laneL' | 'laneR' | 'skill';
export type SimEvent =
  | { type: 'coin' } | { type: 'hit' } | { type: 'protected' } | { type: 'nearMiss' }
  /** death 只表示不可复活的终局；可带闪电圈致死位置，供渲染层绘制雷电 */
  | { type: 'death'; lane?: number; worldZ?: number }
  | { type: 'pickup'; itemRef: string } | { type: 'helmetSave' }
  | { type: 'cast'; skillRef: string } | { type: 'shieldBreak'; layers: number } | { type: 'boardBreak' }
  /** slideGuard：下滑护体消耗一次（曼波滑行穿过小型障碍），带剩余次数 */
  | { type: 'slideGuard'; charges: number }
  /** zap 带打击位置（lane/worldZ）：渲染层据此把雷电特效画到闪电圈所在车道与深度 */
  | { type: 'zap'; gear: 'shield' | 'board' | 'helmet' | null; lane: number; worldZ: number }
  /** revive：自动复活触发（config revive 段），带本局剩余次数；渲染层可做原地起立特效 */
  | { type: 'revive'; left: number }
  /** surge（M4 喷发判定化）：进入喷发段一次性事件（lane/worldZ=喷柱落点；渲染层接 eruption 喷柱+闪橙） */
  | { type: 'surge'; lane: number; worldZ: number };

export interface RunnerState {
  t: number; distance: number; prevDistance: number;
  lane: number; x: number; y: number; vy: number;
  sliding: boolean; slideT: number;
  stunT: number; invulnT: number; hits: number; alive: boolean; topple: number;
  shocks: number; // 已被闪电圈电到的次数（无护具时第二次直接致死）
  /** 本局已消耗的复活次数（config revive 段；渲染 HUD/结算页展示用） */
  revivesUsed: number;
  coins: number; nearMiss: number; score: number;
  gliding: boolean; // 飞行器燃料耗尽后的降落段
  /** 技能冷却剩余、本局累计主动下滑次数（下滑积攒型技能的门槛计数）、本局释放次数 */
  skillCd: number; slideCount: number; casts: number;
  /** 潮位 0..1（M4 潮位单源：sim 每步由 core/sim/tide.level(distance) 更新；非潮汐主题不消费该值） */
  tideLevel: number;
  /** 喷发预警剩余秒（M4 喷发判定化：进入 1s 红光预警窗时 >0；HUD 提示与红光渐起消费，0=无预警） */
  surgeWarn: number;
  /** 当前可站立支撑面高度（米，0=地面；>0=列车顶/坡道面）。每帧由 movement 算好后写回：
   *  渲染层据此区分「站在支撑面上跑」与「真正离地」，sim→render 单向数据流 */
  supportY: number;
}

/** 空装备：未指定角色时的默认手感（保持 M1 行为不变） */
export const EMPTY_LOADOUT: Loadout = {
  charId: '', name: '跑者', tagline: '', tint: '#7FD1FF', rarity: 'R',
  skill: null, passive: [], talentLabel: '', talentDesc: '',
  skinId: '', bodyTint: '#F2F4F8', emissive: '#7FD1FF', modelScale: 1,
  clearance: STAND_H,
};

/** 新建一局的状态初值 */
export function initialRunnerState(): RunnerState {
  return {
    t: 0, distance: 0, prevDistance: 0, lane: 0, x: 0, y: 0, vy: 0,
    sliding: false, slideT: 0, stunT: 0, invulnT: 0, hits: 0, alive: true, topple: 0,
    shocks: 0, revivesUsed: 0,
    coins: 0, nearMiss: 0, score: 0, gliding: false,
    skillCd: 0, slideCount: 0, casts: 0,
    tideLevel: 0,
    surgeWarn: 0,
    supportY: 0,
  };
}
