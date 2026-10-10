/**
 * 效果原语注册表与槽位模型（从 buffEngine.ts 拆出，守 300 行模块上限）
 * 分工：本文件只放「原语是什么」（注册表、槽位形状、参数解析与校验），
 *       「效果怎么生效」（add/tick/recompute/瞬时结算）全部留在 buffEngine.ts。
 * 新增原语 = 代码任务（标 [PRIMITIVE]）：PRIMITIVES 加一项 + recompute 加合并规则 +
 *            schema/config.schema.json 的 primitive.enum 补一项 + 单测（三处必须同集合）。
 */
import type { EffectParams } from './effectTypes.js';

/** 一条生效中的槽位（引擎内部状态，外部只能通过 fx / list() 读派生结果） */
export interface Slot {
  primitive: string;
  label: string;
  params: EffectParams;
  /** 剩余秒数；Infinity = 永久（无 durationS 的被动，如开局护盾） */
  left: number;
  /** stack 语义下的累计层数（shieldAdd 挡刀层数、slideGuard 护体次数） */
  layers: number;
  /** 按米数到期：跑到该里程即失效（params.distanceM，如「无敌 20 米」） */
  endAt?: number;
  /** 周期原语（periodic）：距下次触发的秒数；0 = 下一步即触发 */
  nextAt?: number;
  /** 周期原语：每次触发重新施加的一组子效果（add 时解析并校验，避免每步解析 JSON） */
  children?: Child[];
}

/** periodic 的一条子效果（已解析） */
export interface Child { primitive: string; params: EffectParams }

/** 原语元数据：instant=施加即结算；timed=进槽位按秒衰减；cyclic=进槽位按周期重复施加子效果 */
export type Kind = 'instant' | 'timed' | 'cyclic';
export interface PrimDef { kind: Kind }

/** 与 docs/03 §4.3 表格、schema 的 primitive.enum 严格同集合 */
export const PRIMITIVES: Record<string, PrimDef> = {
  invincible: { kind: 'timed' },
  speedMul: { kind: 'timed' },
  magnet: { kind: 'timed' },
  fly: { kind: 'timed' },
  lifeAdd: { kind: 'timed' },
  jumpBoost: { kind: 'timed' },
  dash: { kind: 'instant' },
  blink: { kind: 'instant' },
  timeSlow: { kind: 'timed' },
  shieldAdd: { kind: 'timed' },
  buffDurationAdd: { kind: 'timed' },
  coinValueAdd: { kind: 'timed' },
  scoreAdd: { kind: 'instant' },
  spawnCoinsRow: { kind: 'instant' },
  laneAutoAvoid: { kind: 'timed' },
  pickupAll: { kind: 'timed' },
  slideExtend: { kind: 'timed' },
  cooldownMul: { kind: 'timed' },
  boardArmor: { kind: 'timed' },
  // 角色技能/被动专用（2026-10-04 人物改版新增）
  buffDurationFlat: { kind: 'timed' },    // 其他 buff 时长的固定增量（addS 秒）
  slideGuard: { kind: 'timed' },          // 下滑护体：滑行中可穿过「小型障碍」的次数（charges）
  duckPass: { kind: 'timed' },            // 身高优势：需下滑躲避的高杆直接穿过
  smashAhead: { kind: 'instant' },        // 破坏前方 aheadM 米全部车道障碍（金币与道具保留）
  periodic: { kind: 'cyclic' },           // 每 everyS 秒自动施加一组子效果（周期被动）
  // 局外效果：作用于账号经验倍率，无局内表现（xp 系统在 M5 之后）
  xpMul: { kind: 'timed' },
};

/** 配置里出现未注册原语时给出的可定位提示（供 configValidator 使用） */
export const SUPPORTED_PRIMITIVES = Object.keys(PRIMITIVES);

export function isPrimitiveSupported(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(PRIMITIVES, name);
}

/** 同时生效的 buff 上限：超出按「剩余最短优先」淘汰，保证不与玩家抢判定 */
export const MAX_SLOTS = 24;
/** 单次时长上限（schema 3600 + buffDurationAdd/Flat 拉长余量） */
export const MAX_DURATION = 3600 * 1.5;

/** 数值参数读取：非数字/非有限一律回落默认值（配置写错不许崩） */
export const num = (p: EffectParams, key: string, dflt: number): number =>
  typeof p[key] === 'number' && Number.isFinite(p[key]) ? (p[key] as number) : dflt;

/** 槽位层数：护盾读 layers、下滑护体读 charges，都没有则 1 层 */
export const layersOf = (p: EffectParams): number =>
  Math.max(1, Math.round(num(p, 'layers', num(p, 'charges', 1))));

/**
 * 解析 periodic 的子效果表：只接受已注册且非周期的原语（禁止周期套周期造成自激），
 * durationS/distanceM 等参数原样传给子效果。
 */
export function asChildren(v: unknown): Child[] {
  if (!Array.isArray(v)) return [];
  const out: Child[] = [];
  for (const item of v) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) continue;
    const { primitive, ...rest } = item as Record<string, unknown>;
    if (typeof primitive !== 'string') continue;
    const def = PRIMITIVES[primitive];
    if (!def || def.kind === 'cyclic') continue;
    out.push({ primitive, params: rest });
  }
  return out;
}
