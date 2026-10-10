/**
 * 效果系统的公共类型（docs/03 §4.3 原语参数 → TypeScript 形状）
 * 与 buffEngine 分开：本文件只有类型与默认值构造，无行为。
 */

/** 叠加规则，来自 items.json/skills.json 的 stackRule（docs/03 §4.5） */
export type StackRule = 'refresh' | 'stack' | 'replace';

/** 原语参数包（JSON 直读，字段名严格对齐 docs/03 §4.3） */
export type EffectParams = Record<string, unknown>;

/** 一条生效中的持续性效果（HUD 视图） */
export interface BuffView { primitive: string; label: string; left: number }

/** 引擎对 sim 暴露的派生状态；字段全部每步重算，外部只读 */
export interface FxState {
  magnetT: number;
  magnetRadius: number;
  bootsT: number;
  jumpMul: number;
  flyT: number;
  helmetT: number;
  shieldLayers: number;
  shieldT: number;
  boardT: number;
  invincible: boolean;
  /** 速度乘区（与基础速度叠乘） */
  speedMul: number;
  /** 世界时间流速（<1 = 世界减速，角色操作不受影响） */
  timeSlowMul: number;
  /** >0 时自动躲避前方该纵深内的障碍 */
  avoidLookahead: number;
  /** 金币收益加成（百分比累计） */
  coinPct: number;
  /** 滑铲时长增量（被动） */
  slideAddS: number;
  /** 其他 buff 时长加成（百分比，被动） */
  buffPct: number;
  /** 技能冷却乘区（被动，<1 减冷却） */
  cooldownMul: number;
  /** 道具箱吸取剩余时间 */
  pickupAllT: number;
  /** 下滑护体剩余次数（slideGuard）：滑行中可穿过「小型障碍」的次数，用掉即作废、不叠加 */
  slideGuardCharges: number;
  /** 身高优势（duckPass）：需要下滑躲避的高杆障碍直接穿过 */
  duckPass: boolean;
  /** 其他 buff 时长的固定增量（buffDurationFlat，秒） */
  buffAddS: number;
}

/** 瞬时原语的作用上下文：调用 add 时把「此刻我在哪」传进来，引擎不反向读 sim 状态 */
export interface CastContext { distance: number; lane: number }

/** 瞬时原语需要的外部能力，由 sim 实现（引擎不依赖 sim 类型，避免循环引用） */
export interface EffectWorld {
  /** 向前位移（dash/blink） */
  advance(distanceM: number): void;
  /** 撞碎 [fromD,toD] 区间内压在该车道上的障碍，返回撞碎数（用于近失计数） */
  destroyObstacles(lane: number, fromD: number, toD: number): number;
  /** [fromD,toD] 内该车道第一个不可穿越障碍的起点 z；无则返回 null（blink 无 phase 时的止步点） */
  firstBlocker(lane: number, fromD: number, toD: number): number | null;
  /** 收走 [fromD,toD] 纵深内的全部金币（blink 的 collectCoins：位移途中掠取，不分车道），返回枚数 */
  collectCoinsAlong(fromD: number, toD: number): number;
  /** 清除 [fromD,toD] 纵深内全部车道的障碍（smashAhead），金币与道具箱不受影响，返回清除数 */
  smashObstacles(fromD: number, toD: number): number;
  /** 在指定车道生成金币排（奖励技 spawnCoinsRow） */
  grantCoinRow(lanes: number[], startM: number, lengthM: number, spacingM: number, y: number): void;
  /** 立即加分（scoreAdd） */
  addBonusScore(points: number): void;
  /** 进入飞行段（sim 负责申请空中区间与清障） */
  startFlight(durationS: number, heightM: number | undefined): void;
  /** 飞行中续时（再吃一个飞行道具）：把空中金币带/云团从已铺终点继续延伸到新的终点 */
  extendFlight(durationS: number): void;
}

/** fx 的无 buff 基线（tick 每步复用，避免语义漂移） */
export function freshFx(): FxState {
  return {
    magnetT: 0, magnetRadius: 0, bootsT: 0, jumpMul: 1, flyT: 0, helmetT: 0,
    shieldLayers: 0, shieldT: 0, boardT: 0, invincible: false, speedMul: 1, timeSlowMul: 1,
    avoidLookahead: 0, coinPct: 0, slideAddS: 0, buffPct: 0, cooldownMul: 1, pickupAllT: 0,
    slideGuardCharges: 0, duckPass: false, buffAddS: 0,
  };
}
