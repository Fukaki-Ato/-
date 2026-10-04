/**
 * 效果原语引擎（docs/03 §4.3 原语表 ↔ primitives.ts 的 PRIMITIVES 注册表，一一对应）
 * 对应任务：docs/09 T2.2。原语注册表与槽位模型拆在 primitives.ts（守 300 行模块上限）。
 * 约定：
 *   1. 玩法只有两个入口 —— `add()`（施加效果）与 `tick(dt, ctx)`（推进时间，ctx 带来当前里程）；
 *   2. `fx` 是所有已施加效果的**派生视图**，每步整体重算，sim/render/HUD 只读不写；
 *   3. 瞬时原语（dash/blink/scoreAdd/spawnCoinsRow/smashAhead）在 add 时通过 `EffectWorld` 回调直接改世界；
 *   4. 到期口径有两种且可并存：`durationS`（秒，受 buffDurationAdd/Flat 拉长）与 `distanceM`（跑到该里程即失效，如「无敌 20 米」）；
 *   5. `periodic` 为周期原语：常驻槽位，每 everyS 秒把一组子效果重新施加一次——周期被动只改 JSON 即可加人；
 *   6. 引擎内禁止随机数（C6 确定性）与每步堆分配（docs/02 §8 性能预算）。
 * 新增原语 = 代码任务（标 [PRIMITIVE]）：primitives.ts 注册表加一项 + 本文件 recompute 加合并规则 +
 *            schema/config.schema.json 的 primitive.enum 补一项 + 单测（三处必须同集合）。
 */
import {
  freshFx,
  type BuffView, type CastContext, type EffectParams, type EffectWorld, type FxState, type StackRule,
} from './effectTypes.js';
import {
  asChildren, layersOf, num, MAX_DURATION, MAX_SLOTS, PRIMITIVES, type Slot,
} from './primitives.js';

export * from './effectTypes.js';
export * from './primitives.js';

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
    if (def.kind === 'cyclic') { this.addCycle(params, label); return; }

    const base = num(params, 'durationS', Number.POSITIVE_INFINITY);
    // 时长 = 基础秒 ×（1 + 百分比加成）+ 固定秒加成；无 durationS 的永久效果（开局护盾等）不参与加成
    const raw = Number.isFinite(base) ? base * (1 + this.durationBonus() / 100) + this.durationFlat() : Number.POSITIVE_INFINITY;
    const left = Number.isFinite(raw) ? Math.min(Math.max(0, raw), MAX_DURATION) : raw;
    // distanceM：按里程到期（「无敌 20 米」这类），与秒数并存时以先到者为准
    const distM = num(params, 'distanceM', 0);
    const endAt = distM > 0 ? ctx.distance + distM : undefined;
    if (left <= 0 && endAt === undefined) return; // 0 时长边界（docs/08 §3）：不产生任何状态

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
      existing.layers += layersOf(params);
      existing.params = params;
      existing.label = label;
      existing.left = Math.max(existing.left, left);
      if (endAt !== undefined) existing.endAt = Math.max(existing.endAt ?? 0, endAt);
    } else if (existing && stackRule === 'replace') {
      // 替换（滑板）：旧的重置为新参数
      this.slots.splice(this.slots.indexOf(existing), 1);
      this.push(primitive, params, label, left, endAt);
    } else if (existing) {
      // refresh（默认）：刷新时长与参数
      existing.params = params;
      existing.label = label;
      existing.left = left;
      existing.endAt = endAt;
    } else {
      this.push(primitive, params, label, left, endAt);
    }
    this.recompute();
  }

  private push(primitive: string, params: EffectParams, label: string, left: number, endAt?: number) {
    this.enqueue({ primitive, label, params, left, endAt, layers: layersOf(params) });
  }

  /**
   * 周期原语（periodic）：常驻槽位，每 everyS 秒把 effects 里那组子效果重新施加一次。
   * 首次触发在下一个 tick（即开局就生效一次）；子效果在解析期校验，热路径不再读 JSON。
   * 同 label 的周期槽位复用（refresh 语义），不同 label 各自独立计时。
   */
  private addCycle(params: EffectParams, label: string) {
    const everyS = num(params, 'everyS', 0);
    const children = asChildren(params['effects']);
    if (!(everyS > 0) || children.length === 0) return;
    const existing = this.slots.find(s => s.primitive === 'periodic' && s.label === label);
    if (existing) {
      existing.params = params;
      existing.children = children;
      existing.nextAt = 0;
      return;
    }
    this.enqueue({ primitive: 'periodic', label, params, left: Number.POSITIVE_INFINITY, layers: 1, nextAt: 0, children });
  }

  private enqueue(slot: Slot) {
    if (this.slots.length >= MAX_SLOTS) this.evictLeastRemaining();
    this.slots.push(slot);
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

  /** 消耗一次下滑护体（滑行中穿过小型障碍时调用），返回剩余次数 */
  consumeSlideGuard(): number {
    const s = this.slots.find(x => x.primitive === 'slideGuard');
    if (!s || s.layers <= 0) return 0;
    s.layers -= 1;
    if (s.layers <= 0) this.remove('slideGuard');
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

  /** 推进时间并重算派生视图（每固定步一次）；ctx 提供当前里程，供按米数到期与周期触发用 */
  tick(dt: number, ctx: CastContext) {
    for (let i = this.slots.length - 1; i >= 0; i--) {
      const s = this.slots[i];
      if (s.endAt !== undefined && ctx.distance >= s.endAt) { this.slots.splice(i, 1); continue; }
      if (s.children) { this.runCycle(s, dt, ctx); continue; } // 周期槽位自身不衰减
      if (!Number.isFinite(s.left)) continue;
      s.left -= dt;
      if (s.left <= 0) this.slots.splice(i, 1);
    }
    this.recompute();
  }

  /** 周期触发：到点把子效果重施加一轮，并把下次触发推后 everyS（落后过多不补发，直接对齐下一周期） */
  private runCycle(s: Slot, dt: number, ctx: CastContext) {
    if (s.nextAt === undefined) return;
    s.nextAt -= dt;
    if (s.nextAt > 0) return;
    const everyS = Math.max(0.1, num(s.params, 'everyS', 10));
    s.nextAt += everyS;
    if (s.nextAt <= 0) s.nextAt = everyS;
    for (const c of s.children ?? []) this.add(c.primitive, c.params, s.label, ctx);
  }

  private durationBonus(): number {
    let pct = 0;
    for (const s of this.slots) if (s.primitive === 'buffDurationAdd') pct += num(s.params, 'pct', 0);
    return pct;
  }

  /** 固定秒数加成（buffDurationFlat，如「道具持续 +2 秒」） */
  private durationFlat(): number {
    let add = 0;
    for (const s of this.slots) if (s.primitive === 'buffDurationFlat') add += num(s.params, 'addS', 0);
    return add;
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
        case 'slideGuard': f.slideGuardCharges += s.layers; break;
        case 'duckPass': f.duckPass = true; break;
        case 'buffDurationFlat': f.buffAddS += num(p, 'addS', 0); break;
        default: break; // xpMul / periodic：仅占位计时，不直接参与局内数值
      }
    }
    Object.assign(this.fx, f);
  }

  private castInstant(primitive: string, params: EffectParams, ctx: CastContext) {
    const w = this.world;
    if (primitive === 'scoreAdd') { w.addBonusScore(Math.max(0, num(params, 'flat', 0))); return; }
    if (primitive === 'smashAhead') {
      // 破坏前方 aheadM 米全部车道的障碍（金币与道具箱原样保留）
      const aheadM = Math.max(0, num(params, 'aheadM', 0));
      if (aheadM > 0) w.smashObstacles(ctx.distance, ctx.distance + aheadM);
      return;
    }
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
      // collectCoins：位移途中把经过纵深里的金币全部掠走（穿梭时空），不分车道、不受高度限制
      if (params['collectCoins'] === true) w.collectCoinsAlong(ctx.distance, to);
      w.advance(Math.max(0, to - ctx.distance));
    }
  }
}
