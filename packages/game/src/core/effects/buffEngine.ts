/**
 * 效果原语引擎（docs/03 §4.3 原语表 ↔ 本文件 PRIMITIVES 注册表，一一对应）
 * 对应任务：docs/09 T2.2。
 * 约定：
 *   1. 玩法只有两个入口 —— `add()`（施加效果）与 `tick(dt)`（推进时间）；
 *   2. `fx` 是所有已施加效果的**派生视图**，每步整体重算，sim/render/HUD 只读不写；
 *   3. 瞬时原语（dash/blink/scoreAdd/spawnCoinsRow）在 add 时通过 `EffectWorld` 回调直接改世界；
 *   4. 引擎内禁止随机数（C6 确定性）与每步堆分配（docs/02 §8 性能预算）。
 * 新增原语 = 代码任务（标 [PRIMITIVE]）：此表加一项 + recompute 加合并规则 + docs/03 §4.3 补一行 + 单测。
 */
import {
  freshFx,
  type BuffView, type CastContext, type EffectParams, type EffectWorld, type FxState, type StackRule,
} from './effectTypes.js';

export * from './effectTypes.js';

interface Slot {
  primitive: string;
  label: string;
  params: EffectParams;
  /** 剩余秒数；Infinity = 永久（无 durationS 的被动，如开局护盾） */
  left: number;
  /** stack 语义下的累计层数（shieldAdd 用） */
  layers: number;
}

/** 原语元数据：instant=施加即结算；timed=进槽位按秒衰减 */
type Kind = 'instant' | 'timed';
interface PrimDef { kind: Kind }

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
  // 局外效果：作用于账号经验倍率，无局内表现（xp 系统在 M5 之后）
  xpMul: { kind: 'timed' },
};

/** 配置里出现未注册原语时给出的可定位提示（供 configValidator 使用） */
export const SUPPORTED_PRIMITIVES = Object.keys(PRIMITIVES);

export function isPrimitiveSupported(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(PRIMITIVES, name);
}

/** 同时生效的 buff 上限：超出按「剩余最短优先」淘汰，保证不与玩家抢判定 */
const MAX_SLOTS = 24;
/** 单次时长上限（schema 3600 + buffDurationAdd 拉长余量） */
const MAX_DURATION = 3600 * 1.5;

const num = (p: EffectParams, key: string, dflt: number): number =>
  typeof p[key] === 'number' && Number.isFinite(p[key]) ? (p[key] as number) : dflt;

export class BuffEngine {
  /** 派生视图：外部持有引用读取，勿替换对象 */
  readonly fx: FxState = freshFx();
  private readonly slots: Slot[] = [];

  constructor(private readonly world: EffectWorld) {}

  /** 已占用槽位快照（HUD 用；顺序=施加顺序，稳定无随机） */
  list(out: BuffView[]): BuffView[] {
    out.length = 0;
    for (const s of this.slots) out.push({ primitive: s.primitive, label: s.label, left: s.left });
    return out;
  }

  /** 某原语剩余时间（无则 0；测试与调试用） */
  left(primitive: string): number {
    let best = 0;
    for (const s of this.slots) if (s.primitive === primitive && s.left > best) best = s.left;
    return best;
  }

  /** 施加一条效果；durationS 会被身上的 buffDurationAdd 拉长（docs/03 §4.3） */
  add(primitive: string, params: EffectParams, label: string, ctx: CastContext, stackRule: StackRule = 'refresh') {
    const def = PRIMITIVES[primitive];
    if (!def) return; // configValidator 已拦截；热路径防御性静默，不抛错
    if (def.kind === 'instant') { this.castInstant(primitive, params, ctx); return; }

    const base = num(params, 'durationS', Number.POSITIVE_INFINITY);
    const raw = Number.isFinite(base) ? base * (1 + this.durationBonus() / 100) : Number.POSITIVE_INFINITY;
    const left = Number.isFinite(raw) ? Math.min(Math.max(0, raw), MAX_DURATION) : raw;
    if (left <= 0) return; // 0 时长边界（docs/08 §3）：不产生任何状态

    // 飞行第一次到手：开空中内容；飞行中续时：把金币带/云团延展到新的终点
    if (primitive === 'fly') {
      if (this.left('fly') <= 0) {
        this.world.startFlight(left, typeof params['heightM'] === 'number' ? (params['heightM'] as number) : undefined);
      } else {
        this.world.extendFlight(left);
      }
    }

    const existing = this.slots.find(s => s.primitive === primitive);
    if (existing && stackRule === 'stack') {
      // 叠层（护盾）：层数累加，时长取较长者
      existing.layers += Math.max(1, Math.round(num(params, 'layers', 1)));
      existing.params = params;
      existing.label = label;
      existing.left = Math.max(existing.left, left);
    } else if (existing && stackRule === 'replace') {
      // 替换（滑板）：旧的重置为新参数
      this.slots.splice(this.slots.indexOf(existing), 1);
      this.push(primitive, params, label, left);
    } else if (existing) {
      // refresh（默认）：刷新时长与参数
      existing.params = params;
      existing.label = label;
      existing.left = left;
    } else {
      this.push(primitive, params, label, left);
    }
    this.recompute();
  }

  private push(primitive: string, params: EffectParams, label: string, left: number) {
    if (this.slots.length >= MAX_SLOTS) this.evictLeastRemaining();
    this.slots.push({ primitive, label, params, left, layers: Math.max(1, Math.round(num(params, 'layers', 1))) });
  }

  /** 消耗一层护盾（受击判定调用），返回消耗后剩余层数 */
  consumeShield(): number {
    const s = this.slots.find(x => x.primitive === 'shieldAdd');
    if (!s || s.layers <= 0) return 0;
    s.layers -= 1;
    if (s.layers <= 0) this.remove('shieldAdd');
    else this.recompute();
    return s.layers;
  }

  /** 移除某原语（头盔挡刀后消失、滑板碎板） */
  remove(primitive: string) {
    const i = this.slots.findIndex(s => s.primitive === primitive);
    if (i >= 0) this.slots.splice(i, 1);
    this.recompute();
  }

  clear() {
    this.slots.length = 0;
    Object.assign(this.fx, freshFx());
  }

  /** 推进时间并重算派生视图（每固定步一次） */
  tick(dt: number) {
    for (let i = this.slots.length - 1; i >= 0; i--) {
      const s = this.slots[i];
      if (!Number.isFinite(s.left)) continue;
      s.left -= dt;
      if (s.left <= 0) this.slots.splice(i, 1);
    }
    this.recompute();
  }

  private durationBonus(): number {
    let pct = 0;
    for (const s of this.slots) if (s.primitive === 'buffDurationAdd') pct += num(s.params, 'pct', 0);
    return pct;
  }

  /** 满位时淘汰剩余时间最短者（规则确定可复现） */
  private evictLeastRemaining() {
    let at = -1, min = Number.POSITIVE_INFINITY;
    for (let i = 0; i < this.slots.length; i++) {
      if (this.slots[i].left < min) { min = this.slots[i].left; at = i; }
    }
    if (at >= 0) this.slots.splice(at, 1);
  }

  /** 从槽位集合整体重算 fx：先取基线再逐条合并（叠加规则集中一处，便于 docs/08 §3 矩阵测试） */
  private recompute() {
    const f = freshFx(); // 注：每步一次小对象，热路径可接受（24 槽上限），换 POOL 会牺牲可读性
    for (const s of this.slots) {
      const p = s.params;
      switch (s.primitive) {
        case 'magnet':
          f.magnetT = Math.max(f.magnetT, s.left);
          f.magnetRadius = Math.max(f.magnetRadius, num(p, 'radiusM', 3));
          break;
        case 'jumpBoost':
          f.bootsT = Math.max(f.bootsT, s.left);
          f.jumpMul = Math.max(f.jumpMul, num(p, 'mul', 1.25));
          break;
        case 'fly': f.flyT = Math.max(f.flyT, s.left); break;
        case 'lifeAdd': f.helmetT = Math.max(f.helmetT, s.left); break;
        case 'shieldAdd':
          f.shieldLayers += s.layers;
          f.shieldT = Math.max(f.shieldT, s.left);
          break;
        case 'boardArmor': f.boardT = Math.max(f.boardT, s.left); break;
        case 'invincible': f.invincible = true; break;
        case 'speedMul': f.speedMul *= num(p, 'mul', 1); break;
        case 'timeSlow': f.timeSlowMul *= num(p, 'worldMul', 1); break;
        case 'laneAutoAvoid': f.avoidLookahead = Math.max(f.avoidLookahead, num(p, 'lookaheadM', 12)); break;
        case 'coinValueAdd': f.coinPct += num(p, 'pct', 0); break;
        case 'slideExtend': f.slideAddS += num(p, 'addS', 0); break;
        case 'buffDurationAdd': f.buffPct += num(p, 'pct', 0); break;
        case 'cooldownMul': f.cooldownMul *= num(p, 'mul', 1); break;
        case 'pickupAll': f.pickupAllT = Math.max(f.pickupAllT, s.left); break;
        default: break; // xpMul 等局外原语：仅占位计时，不参与局内数值
      }
    }
    Object.assign(this.fx, f);
  }

  private castInstant(primitive: string, params: EffectParams, ctx: CastContext) {
    const w = this.world;
    if (primitive === 'scoreAdd') { w.addBonusScore(Math.max(0, num(params, 'flat', 0))); return; }
    if (primitive === 'spawnCoinsRow') {
      const lanes = Array.isArray(params['lanes'])
        ? (params['lanes'] as unknown[]).map(Number).filter(n => n >= -1 && n <= 1) : [];
      w.grantCoinRow(lanes.length ? lanes : [0],
        num(params, 'startM', 6), num(params, 'lengthM', 12), num(params, 'spacingM', 1.5), num(params, 'y', 0.65));
      return;
    }
    const distance = Math.max(0, num(params, 'distanceM', 0));
    if (distance <= 0) return;
    if (primitive === 'dash') {
      w.destroyObstacles(ctx.lane, ctx.distance, ctx.distance + distance);
      w.advance(distance);
      return;
    }
    if (primitive === 'blink') {
      const phasing = params['phase'] === true || num(params, 'phase', 0) === 1;
      const to = phasing ? ctx.distance + distance
        : (w.firstBlocker(ctx.lane, ctx.distance, ctx.distance + distance) ?? ctx.distance + distance);
      w.advance(Math.max(0, to - ctx.distance));
    }
  }
}
