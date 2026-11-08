/**
 * 渲染层只读状态、消费 drainEvents；玩法数值来自 config/*.json。
 */
import { RunRng } from '../rng.js'; import { MAX_RANKED_INPUTS, type ReplayInput } from '../leaderboard.js';
import type { GameContent } from '../config/configTypes.js';
import { BuffEngine, type BuffView, type CastContext, type FxState } from '../effects/buffEngine.js';
import { buildLoadout, itemEffects, type EffectSpec, type Loadout } from './character.js';
import { collectCoins, collectPickups, type CollectDeps } from './collect.js';
import { hitsRunner, inDepthWindow, isNearMiss, relZ, safestLane } from './collision.js';
import { clearSkyCoins } from './landing.js';
import { applySurgeStep, level } from './tide.js';
import { CROSSING_DEFAULTS, cullCrossings, stepCrossings } from './crossings.js';
import { Movement } from './movement.js';
import { parseReviveConfig, tryRevive, type ReviveState } from './revive.js';
import { resolveHit, type HitCtx } from './resolveHit.js';
import { TrackGen, type CloudEntity, type CoinEntity, type CrossingEntity, type ObstacleEntity, type PickupEntity } from './trackGen.js';
import { createSimWorld } from './simWorld.js';
import { FirstCoinRecord, scoreForState } from './firstCoinRecord.js';
import { cullByWorldZ, cullObstacles, smashAhead } from './entitySweep.js';
import {
  EMPTY_LOADOUT, FLY_SPEED_CAP, STEP_DT, initialRunnerState,
  type RunnerState, type SimAction, type SimEvent,
} from './simTypes.js';

/** 视前方生成距离（米）：障碍/金币/道具箱提前铺到这里 */
const GEN_AHEAD_M = 320;
/** 实体在角色身后该距离后被回收（米） */
const CULL_BEHIND_M = 14;
/** 受击后的速度惩罚、倒地动画推进系数与上限 */
const STUN_SPEED_MUL = 0.6, TOPPLE_RATE = 2.2, TOPPLE_MAX = 1.4;

export class RunnerSim {
  readonly obstacles: ObstacleEntity[] = [];
  readonly coinsArr: CoinEntity[] = [];
  readonly pickupsArr: PickupEntity[] = [];
  readonly cloudsArr: CloudEntity[] = [];
  readonly crossings: CrossingEntity[] = []; // M4 穿越判定体（crossings 配置出生，cross 事件计分）
  readonly events: SimEvent[] = [];
  private surgeFired = false; readonly tideAware: boolean; // M4 喷发判定化：tideAware=obstacles.json 有 tideAware 块
  readonly state: RunnerState;
  /** 生命数（game.json runner.lives，默认 1：一撞即出局，新手保护仍生效） */
  readonly lives: number;
  /** 本局装配的角色（docs/09 T2.4）；未指定时为空装备=默认手感 */
  readonly loadout: Loadout;
  readonly buffs: BuffEngine;
  /** 金币收集判定面（角色中心前方 coinCollectM 米处触发，取负号用于 z 轴）。
   *  推导：盒深一半 0.4 + 金币最大半径(含磁铁 1.25 倍放大) 0.43 + 步进余量 ≈ 1.1。 数值在 game.json runner.coinCollectM，玩家看着仍偏就微调这一格。 */
  private readonly coinFront: number;
  private readonly gen: TrackGen;
  private readonly mv: Movement;
  private readonly hudBuffs: BuffView[] = [];
  private readonly R: Record<string, number>;
  private readonly SC: Record<string, number>;
  private readonly laneWidth: number;
  private readonly protectionS: number;
  private readonly invulnS: number;
  private readonly fly: { heightM: number; speedMul: number; glideSpeedMul: number; glideS: number };
  private readonly collectDeps: CollectDeps;
  private usedProtection = false;
  /** 复活余量（config revive 段，逻辑在 revive.ts） */
  private revive: ReviveState = { left: 0, invincibleS: 3 };
  /** 命中结算上下文（resolveHit 用；构造一次复用，教程保护消耗标志在闭包里） */
  private readonly hitCtx: HitCtx;
  private coinCarry = 0;
  /** 传给 buff 引擎的可复用上下文（里程/车道）：每步就地改写，避免热路径分配 */
  private readonly buffCtx: CastContext = { distance: 0, lane: 0 };
  private bonusScore = 0;
  private itemPickups = 0;
  /** 任务遥测不改变历史 summary / golden 回放结构。 */
  get missionStats() { return { slides: this.mv.totalSlides, itemPickups: this.itemPickups }; }
  /** Actual pickups (before currency multipliers). */
  collectedCoins = 0;
  readonly firstCoinRecord = new FirstCoinRecord();
  replayFrames = 0;
  readonly replayInputs: ReplayInput[] = [];
  replayOverflow = false;

  /** 开局注入的道具：购买自动装备→开局消费→server 重放按 run.items_json 同构复现 */
  readonly initialItems: string[];
  constructor(private readonly content: GameContent, seed: number, charId?: string, private readonly recordReplay = false, initialItems?: string[]) {
    this.tideAware = !!(content.obstacles as unknown as { tideAware?: unknown }).tideAware;
    const p = content.game.params;
    this.R = (p.runner ?? {}) as Record<string, number>;
    this.SC = (p.score ?? {}) as Record<string, number>;
    this.laneWidth = this.R.laneWidth ?? 2.2;
    this.lives = this.R.lives ?? 1;
    this.invulnS = this.R.invulnS ?? 1.4;
    this.coinFront = -(this.R.coinCollectM ?? 1.1);
    this.protectionS = (p.tutorial as Record<string, number>)?.protectionS ?? 15;
    this.revive = parseReviveConfig((p.revive ?? {}) as Record<string, number>);
    const fl = (p.flight ?? {}) as Record<string, number>;
    this.fly = { heightM: fl.heightM ?? 4.6, speedMul: fl.speedMul ?? 2.5, glideSpeedMul: fl.glideSpeedMul ?? 1.6, glideS: fl.glideS ?? 1.8 };
    this.state = initialRunnerState();
    this.gen = new TrackGen(content, new RunRng(seed));
    this.mv = new Movement({
      laneWidth: this.laneWidth, gravity: this.R.gravity ?? -38, jumpVelocity: this.R.jumpVelocity ?? 15.2,
      slideS: this.R.slideS ?? 0.6, slideCooldownS: this.R.slideCooldownS ?? 0.3, laneChangeS: this.R.laneChangeS ?? 0.18,
    }, { heightM: this.fly.heightM, glideS: this.fly.glideS }, this.obstacles);
    this.buffs = new BuffEngine(createSimWorld({
      state: this.state, obstacles: this.obstacles, coins: this.coinsArr, pickups: this.pickupsArr,
      clouds: this.cloudsArr, events: this.events, gen: this.gen, fly: this.fly,
      coinSpacing: ((p.coins ?? {}) as Record<string, number>).spacingM ?? 1.5,
      addBonus: (n) => { this.bonusScore += n; },
      creditCoins: (n) => this.creditCoinsBulk(n),
      onFlightStart: () => { this.mv.flyWasActive = true; },
    }));
    this.loadout = charId ? buildLoadout(content, charId) : EMPTY_LOADOUT;
    this.collectDeps = {
      state: this.state, coins: this.coinsArr, pickups: this.pickupsArr, fx: this.buffs.fx,
      events: this.events, laneWidth: this.laneWidth, coinFront: this.coinFront,
      creditCoin: () => this.creditCoin(), grantItem: (id) => this.grantItem(id),
    };
    this.hitCtx = {
      s: this.state, fx: this.buffs.fx, buffs: this.buffs, events: this.events,
      lives: this.lives, invulnS: this.invulnS, hitStunS: this.R.hitStunS ?? 0.8,
      tutorial: { protectionS: this.protectionS,
        take: () => { if (this.usedProtection) return false; this.usedProtection = true; return true; } },
    };
    this.applyPassive();
    // 装备道具注入（t=0 直接加 buff，不计入 itemPickups 拾取指标）：与局内拾取同一条 buff 通路
    this.initialItems = (initialItems ?? []).filter(id => itemEffects(content, id).length > 0).slice(0, 3);
    for (const id of this.initialItems) this.applyEffects(itemEffects(content, id), id);
  }

  /** buff 派生视图（渲染/HUD/测试统一从这里读，任何地方不得写） */
  get fx(): FxState { return this.buffs.fx; }

  buffList(): BuffView[] { return this.buffs.list(this.hudBuffs); }

  drainEvents(): SimEvent[] {
    if (!this.events.length) return this.events;
    const out = this.events.slice();
    this.events.length = 0;
    return out;
  }

  applyAction(a: SimAction) {
    const s = this.state;
    if (!s.alive) return;
    if (this.recordReplay) {
      if (this.replayInputs.length < MAX_RANKED_INPUTS) this.replayInputs.push({ frame: this.replayFrames, action: a });
      else this.replayOverflow = true;
    }
    if (a === 'laneL') s.lane = Math.max(-1, s.lane - 1); // 换道（含空中与滑翔，滑翔时可变向）
    else if (a === 'laneR') s.lane = Math.min(1, s.lane + 1);
    else if (a === 'skill') this.castSkill();
    else if (this.fx.flyT > 0 || s.gliding) return;        // 飞行/滑翔期间跳铲无效，落地恢复
    else if (a === 'jump') this.mv.jumpInput(s, this.fx);
    else if (a === 'slide') this.mv.slideInput(s, this.fx);
  }

  /** 主动技能：冷却结束、活着、积攒门槛达标；无门槛时开局即可释放。 */
  canCastSkill(): boolean {
    const sk = this.loadout.skill;
    const s = this.state;
    if (!sk || !s.alive || s.skillCd > 0) return false;
    return sk.chargeSlides <= 0 || s.slideCount >= sk.chargeSlides;
  }

  private castSkill() {
    const sk = this.loadout.skill;
    if (!sk || !this.canCastSkill()) return;
    const s = this.state;
    if (sk.chargeSlides > 0) s.slideCount = 0; // 积攒清空（不叠加：释放即归零）
    s.skillCd = sk.cooldownS * this.fx.cooldownMul; // 被动 cooldownMul（冷却缩减）在此生效
    s.casts++;
    this.applyEffects(sk.effects, sk.label);
    this.bonusScore += Math.max(0, this.SC.perSkillCast ?? 0);
    this.events.push({ type: 'cast', skillRef: sk.id });
  }

  /** 被动天赋：run_start 施加一次（docs/03 §4.2 trigger=run_start） */
  private applyPassive() {
    if (this.loadout.passive.length) this.applyEffects(this.loadout.passive, this.loadout.talentLabel);
  }

  /** 把一组原语规格施加到引擎（技能/被动/道具共用一条通路） */
  private applyEffects(effects: EffectSpec[], fallbackLabel: string) {
    const s = this.state;
    this.buffCtx.distance = s.distance;
    this.buffCtx.lane = s.lane;
    for (const eff of effects) this.buffs.add(eff.primitive, eff.params, eff.label || fallbackLabel, this.buffCtx, eff.stackRule);
  }

  private grantItem(itemRef: string) { this.itemPickups++; this.applyEffects(itemEffects(this.content, itemRef), itemRef); }

  /** 金币入账：coinValueAdd 的百分比加成走小数累计，避免每枚金币四舍五入丢分 */
  private creditCoin() {
    this.firstCoinRecord.capture(this.state.distance, scoreForState(this.state, this.SC, this.bonusScore));
    this.collectedCoins++;
    this.coinCarry += 1 * (1 + this.fx.coinPct / 100);
    const whole = Math.floor(this.coinCarry);
    this.state.coins += whole;
    this.coinCarry -= whole;
  }

  /** 批量入账（穿梭时空掠取一路金币）：逐枚走加成累计，反馈事件只推一条，不让爆点同帧刷屏 */
  private creditCoinsBulk(n: number) {
    for (let i = 0; i < n; i++) this.creditCoin();
    if (n > 0) this.events.push({ type: 'coin' });
  }

  /** 前进一个固定步长 */
  step() {
    const s = this.state;
    s.prevDistance = s.distance;
    if (!s.alive) { s.topple = Math.min(s.topple + STEP_DT * TOPPLE_RATE, TOPPLE_MAX); return; }
    this.replayFrames++;

    s.t += STEP_DT;
    this.buffCtx.distance = s.distance;
    this.buffCtx.lane = s.lane;
    this.buffs.tick(STEP_DT, this.buffCtx); // 周期被动、按米数到期的效果都要知道当前里程
    const fx = this.fx;
    s.stunT = Math.max(0, s.stunT - STEP_DT);
    s.invulnT = Math.max(0, s.invulnT - STEP_DT);
    s.skillCd = Math.max(0, s.skillCd - STEP_DT);
    this.mv.slideCd = Math.max(0, this.mv.slideCd - STEP_DT);

    // 速度：基础值随距离提升（飞行/滑翔/受击各有乘区），再叠 buff 乘区（timeSlow=世界变慢操作不变）
    const base = this.R.baseSpeed ?? 12;
    const max = this.R.maxSpeed ?? 26;
    const ramp = this.R.speedRampPer100M ?? 0.18;
    const modeMul = fx.flyT > 0 ? this.fly.speedMul : s.gliding ? this.fly.glideSpeedMul : s.stunT > 0 ? STUN_SPEED_MUL : 1;
    const raw = Math.min(max, base + ramp * s.distance / 100) * modeMul * fx.speedMul * fx.timeSlowMul;
    // 飞行/滑翔段允许超过地面 max（2.5 倍巡航），但单步位移仍有绝对上限（FLY_SPEED_CAP）
    const cap = fx.flyT > 0 || s.gliding ? FLY_SPEED_CAP : max;
    const dm = Math.min(raw, cap) * STEP_DT;
    s.distance += dm;
    if (this.tideAware) this.surgeFired = applySurgeStep(s, dm, this.events, this.surgeFired); else s.surgeWarn = 0;
    // M4 穿越判定层：深度窗+高度带一次性判定（playerY=s.y），命中加分并推 cross 事件（渲染层爆点）
    s.score += stepCrossings(this.crossings, s.distance, s.y, CROSSING_DEFAULTS, this.events) * CROSSING_DEFAULTS.scorePer;
    cullCrossings(this.crossings, s.distance, CULL_BEHIND_M); s.tideLevel = level(s.distance); // M4 潮位单源：全主题算（~4 op），潮汐主题消费其余忽略

    // 纵向漂移障碍（moveZ<0=向玩家冲来的冲撞体）：推进 worldZ，并把沿途同车道障碍撞开
    for (const o of this.obstacles) {
      if (!o.moveZ || o.done) continue;
      o.worldZ += o.moveZ * STEP_DT;
      if (o.moveZ < 0) smashAhead(this.obstacles, o, s.t);
    }

    if (fx.avoidLookahead > 0) s.lane = safestLane(this.obstacles, s, fx.avoidLookahead);
    this.mv.advanceLateral(s, STEP_DT);
    this.mv.advanceVertical(s, fx, STEP_DT);
    if (this.mv.landedThisStep) clearSkyCoins(this.coinsArr); // 着陆回收空中金币带（用户反馈：回地面后天上的金币应消失）

    this.gen.ensure(s.distance, GEN_AHEAD_M, this.obstacles, this.coinsArr, this.pickupsArr, this.crossings);
    this.collide();
    if (s.alive) {
      collectCoins(this.collectDeps);
      collectPickups(this.collectDeps);
    }
    this.cull();
    if (!s.alive) return; // 死亡帧不结算拾取与计分（cull 仍执行，保持实体回收）

    s.score = scoreForState(s, this.SC, this.bonusScore);
  }

  private collide() {
    const s = this.state;
    if (this.fx.flyT > 0 || s.gliding) return; // 飞行/滑翔段都跳过判负：空中在障碍上方；滑翔是有控降落演出（不清障），净空由落地帧清道保证
    for (const o of this.obstacles) {
      if (o.done) continue;
      const z = relZ(o, s.distance);
      // 电弧地面不用 DEPTH_SLACK 前瞻：4m 弧 + 2×0.4 前瞻 = 4.8m 判定期，
      // 「跳过弧心但擦到边缘判死」的体感根因之一（与判定线过高叠加，见 collision.HAZARD_HIT_Y）。
      if (o.cls === 'hazard' && o.zap !== true) {
        if (Math.abs(z) > o.d / 2) continue;
      } else if (!inDepthWindow(o, z)) continue;
      if (!o.passed) { // 首次进深度窗判一次擦身（先于命中判定；命中时 lateralGap<=0 自然不计）
        o.passed = true;
        if (isNearMiss(o, s, this.laneWidth)) { s.nearMiss++; this.events.push({ type: 'nearMiss' }); }
      }
      // 高杆门按角色净空判（loadout.clearance）：char_mambo 站立可钻过，其余角色仍必须滑铲
      if (hitsRunner(o, s, this.laneWidth, this.loadout.clearance)) {
        resolveHit(o, this.hitCtx);
        if (!s.alive) this.revive = tryRevive(this.revive, s, this.gen, this.obstacles, this.events);
        if (!s.alive) return;
      }
    }
  }

  /** 清理已掠过 CULL_BEHIND_M 的实体（swap-pop，O(1) 摊销） */
  private cull() {
    const s = this.state;
    cullObstacles(this.obstacles, s.distance, CULL_BEHIND_M);
    cullByWorldZ(this.coinsArr, s.distance, CULL_BEHIND_M);
    cullByWorldZ(this.pickupsArr, s.distance, CULL_BEHIND_M);
    cullByWorldZ(this.cloudsArr, s.distance, CULL_BEHIND_M);
  }

  /** 结算摘要（快照测试与结果页共用） */
  summary() {
    const s = this.state;
    return {
      t: +s.t.toFixed(2), distance: +s.distance.toFixed(2), coins: s.coins, nearMiss: s.nearMiss,
      hits: s.hits, score: s.score, alive: s.alive, casts: s.casts, charId: this.loadout.charId, revives: s.revivesUsed,
    };
  }
}
