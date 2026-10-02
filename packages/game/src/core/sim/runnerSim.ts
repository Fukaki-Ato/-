/**
 * 跑酷玩法模拟（core/sim 层，纯逻辑、固定步长、确定性）——docs/01 §2-§9、docs/02 §5、docs/08 §2。
 * 分工：运动学 movement.ts / 几何判定 collision.ts / 拾取 collect.ts /
 *       buff 计时合并 effects/buffEngine.ts / 引擎→世界作用面 simWorld.ts。
 *       本文件只做输入路由、逐帧推进与结算。
 * 原则：只暴露 step()/applyAction()（渲染层读状态不写）；事件由调用方 drainEvents() 取走，
 *       所以 step 外产生的施放事件不会丢；全部数值来自 config/*.json（调手感不改代码）。
 */
import { RunRng } from '../rng.js';
import type { GameContent } from '../config/configTypes.js';
import { BuffEngine, type BuffView, type FxState } from '../effects/buffEngine.js';
import { buildLoadout, itemEffects, type EffectSpec, type Loadout } from './character.js';
import { collectCoins, collectPickups, type CollectDeps } from './collect.js';
import { hitsRunner, inDepthWindow, isNearMiss, relZ, safestLane } from './collision.js';
import { Movement } from './movement.js';
import { TrackGen, type CloudEntity, type CoinEntity, type ObstacleEntity, type PickupEntity } from './trackGen.js';
import { createSimWorld } from './simWorld.js';
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
  readonly events: SimEvent[] = [];
  readonly state: RunnerState;
  /** 生命数（game.json runner.lives，默认 1：一撞即出局，新手保护仍生效） */
  readonly lives: number;
  /** 本局装配的角色（docs/09 T2.4）；未指定时为空装备=默认手感 */
  readonly loadout: Loadout;
  /** buff 调度器；外部一律通过 sim.fx / sim.buffList() 读 */
  readonly buffs: BuffEngine;
  /** 金币收集判定面（角色中心前方 coinCollectM 米处触发，取负号用于 z 轴）。
   *  推导：盒深一半 0.4 + 金币最大半径(含磁铁 1.25 倍放大) 0.43 + 步进余量 ≈ 1.1。
   *  数值在 game.json runner.coinCollectM，玩家看着仍偏就微调这一格。 */
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
  /** 金币收益的小数累计（coinValueAdd 的 +5% / ×2 靠它凑整，不逐枚四舍五入） */
  private coinCarry = 0;
  /** scoreAdd 原语与技能释放奖励的额外分 */
  private bonusScore = 0;

  constructor(private readonly content: GameContent, seed: number, charId?: string) {
    const p = content.game.params;
    this.R = (p.runner ?? {}) as Record<string, number>;
    this.SC = (p.score ?? {}) as Record<string, number>;
    this.laneWidth = this.R.laneWidth ?? 2.2;
    this.lives = this.R.lives ?? 1;
    this.invulnS = this.R.invulnS ?? 1.4;
    this.coinFront = -(this.R.coinCollectM ?? 1.1);
    this.protectionS = (p.tutorial as Record<string, number>)?.protectionS ?? 15;
    const fl = (p.flight ?? {}) as Record<string, number>;
    this.fly = { heightM: fl.heightM ?? 4.6, speedMul: fl.speedMul ?? 2.5, glideSpeedMul: fl.glideSpeedMul ?? 1.6, glideS: fl.glideS ?? 1.8 };
    this.state = initialRunnerState();
    this.gen = new TrackGen(content, new RunRng(seed));
    this.mv = new Movement(
      {
        laneWidth: this.laneWidth, gravity: this.R.gravity ?? -38, jumpVelocity: this.R.jumpVelocity ?? 15.2,
        slideS: this.R.slideS ?? 0.6, slideCooldownS: this.R.slideCooldownS ?? 0.3, laneChangeS: this.R.laneChangeS ?? 0.18,
      },
      { heightM: this.fly.heightM, glideS: this.fly.glideS },
      this.gen, this.obstacles,
    );
    this.buffs = new BuffEngine(createSimWorld({
      state: this.state, obstacles: this.obstacles, coins: this.coinsArr, pickups: this.pickupsArr,
      clouds: this.cloudsArr, events: this.events, gen: this.gen, fly: this.fly,
      coinSpacing: ((p.coins ?? {}) as Record<string, number>).spacingM ?? 1.5,
      addBonus: (n) => { this.bonusScore += n; },
      onFlightStart: () => { this.mv.flyWasActive = true; },
    }));
    this.loadout = charId ? buildLoadout(content, charId) : EMPTY_LOADOUT;
    this.collectDeps = {
      state: this.state, coins: this.coinsArr, pickups: this.pickupsArr, fx: this.buffs.fx,
      events: this.events, laneWidth: this.laneWidth, coinFront: this.coinFront,
      creditCoin: () => this.creditCoin(), grantItem: (id) => this.grantItem(id),
    };
    this.applyPassive();
  }

  /** buff 派生视图（渲染/HUD/测试统一从这里读，任何地方不得写） */
  get fx(): FxState { return this.buffs.fx; }

  /** HUD 用的 buff 列表（名称来自配置，含剩余秒数） */
  buffList(): BuffView[] { return this.buffs.list(this.hudBuffs); }

  /** 取走并清空事件（渲染/音效每帧调用） */
  drainEvents(): SimEvent[] {
    if (!this.events.length) return this.events;
    const out = this.events.slice();
    this.events.length = 0;
    return out;
  }

  applyAction(a: SimAction) {
    const s = this.state;
    if (!s.alive) return;
    if (a === 'laneL') s.lane = Math.max(-1, s.lane - 1); // 换道（含空中与滑翔，滑翔时可变向）
    else if (a === 'laneR') s.lane = Math.min(1, s.lane + 1);
    else if (a === 'skill') this.castSkill();
    else if (this.fx.flyT > 0 || s.gliding) return;        // 飞行/滑翔期间跳铲无效，落地恢复
    else if (a === 'jump') this.mv.jumpInput(s, this.fx);
    else if (a === 'slide') this.mv.slideInput(s, this.fx);
  }

  /** 主动技能可释放：能量满 + 冷却结束 + 活着（docs/01 §6.2） */
  canCastSkill(): boolean {
    const sk = this.loadout.skill;
    const s = this.state;
    return !!sk && s.alive && s.skillCd <= 0 && s.energy >= sk.energyMax;
  }

  private castSkill() {
    const sk = this.loadout.skill;
    if (!sk || !this.canCastSkill()) return;
    const s = this.state;
    s.energy = 0;
    s.skillCd = sk.cooldownS * this.fx.cooldownMul; // 被动 cooldownMul（博尔特警长 -20%）在此生效
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
    const ctx = { distance: s.distance, lane: s.lane };
    for (const eff of effects) this.buffs.add(eff.primitive, eff.params, eff.label || fallbackLabel, ctx, eff.stackRule);
  }

  private grantItem(itemRef: string) {
    this.applyEffects(itemEffects(this.content, itemRef), itemRef);
  }

  /** 金币入账：coinValueAdd 的百分比加成走小数累计，避免每枚金币四舍五入丢分 */
  private creditCoin() {
    this.coinCarry += 1 * (1 + this.fx.coinPct / 100);
    const whole = Math.floor(this.coinCarry);
    this.state.coins += whole;
    this.coinCarry -= whole;
  }

  /** 前进一个固定步长 */
  step() {
    const s = this.state;
    s.prevDistance = s.distance;
    if (!s.alive) { s.topple = Math.min(s.topple + STEP_DT * TOPPLE_RATE, TOPPLE_MAX); return; }

    s.t += STEP_DT;
    this.buffs.tick(STEP_DT);
    const fx = this.fx;
    s.stunT = Math.max(0, s.stunT - STEP_DT);
    s.invulnT = Math.max(0, s.invulnT - STEP_DT);
    s.skillCd = Math.max(0, s.skillCd - STEP_DT);
    this.mv.slideCd = Math.max(0, this.mv.slideCd - STEP_DT);

    // 速度：基础值随距离提升；飞行 ×speedMul、滑翔 ×glideSpeedMul、受击 ×0.6；
    // 再叠 buff 乘区（speedMul 提速；timeSlow 让世界变慢而操作不变慢 = 更多反应时间）
    const base = this.R.baseSpeed ?? 12;
    const max = this.R.maxSpeed ?? 26;
    const ramp = this.R.speedRampPer100M ?? 0.18;
    const modeMul = fx.flyT > 0 ? this.fly.speedMul : s.gliding ? this.fly.glideSpeedMul : s.stunT > 0 ? STUN_SPEED_MUL : 1;
    const raw = Math.min(max, base + ramp * s.distance / 100) * modeMul * fx.speedMul * fx.timeSlowMul;
    // 飞行/滑翔段允许超过地面 max（2.5 倍巡航），但单步位移仍有绝对上限（FLY_SPEED_CAP）
    const cap = fx.flyT > 0 || s.gliding ? FLY_SPEED_CAP : max;
    const dm = Math.min(raw, cap) * STEP_DT;
    s.distance += dm;

    const sk = this.loadout.skill;
    if (sk) s.energy = Math.min(sk.energyMax, s.energy + sk.energyPerMeter * dm);

    if (fx.avoidLookahead > 0) s.lane = safestLane(this.obstacles, s, fx.avoidLookahead);
    this.mv.advanceLateral(s, STEP_DT);
    this.mv.advanceVertical(s, fx, STEP_DT);

    this.gen.ensure(s.distance, GEN_AHEAD_M, this.obstacles, this.coinsArr, this.pickupsArr);
    this.collide();
    if (s.alive) {
      collectCoins(this.collectDeps);
      collectPickups(this.collectDeps);
    }
    this.cull();
    if (!s.alive) return; // 死亡帧不结算拾取与计分（cull 仍执行，保持实体回收）

    s.score = Math.floor(s.distance) * (this.SC.perMeter ?? 10)
      + s.coins * (this.SC.perCoin ?? 5)
      + s.nearMiss * (this.SC.perNearMiss ?? 25)
      + this.bonusScore;
  }

  private collide() {
    const s = this.state;
    if (this.fx.flyT > 0 || s.gliding) return; // 飞行/滑翔段都跳过判负：空中在障碍上方；滑翔是有控降落演出（不清障），净空由落地帧清道保证
    for (const o of this.obstacles) {
      if (o.done) continue;
      const z = relZ(o, s.distance);
      if (!inDepthWindow(o, z)) continue;
      if (!o.passed) {
        // 首次进入深度窗口的那一帧判一次擦身（先于命中判定；命中时 lateralGap<=0 自然不计）
        o.passed = true;
        if (isNearMiss(o, s, this.laneWidth)) { s.nearMiss++; this.events.push({ type: 'nearMiss' }); }
      }
      if (hitsRunner(o, s, this.laneWidth)) { this.onHit(o); if (!s.alive) return; }
    }
  }

  private onHit(o: ObstacleEntity) {
    const s = this.state;
    // 每个障碍最多造成一次判定：先消耗再判保护。
    // 否则长列车（d=24m 重叠约 2s > 无敌 1.4s）会在无敌结束后二次判负 —— 一条命制下必死无疑。
    o.done = true;
    if (s.invulnT > 0 || this.fx.invincible) return;
    if (!this.usedProtection && s.t < this.protectionS) {
      this.usedProtection = true;
      s.invulnT = this.invulnS;
      this.events.push({ type: 'protected' });
      return;
    }
    // 护盾层优先（docs/01 §5：抵挡 1 次碰撞），其次滑板护甲
    if (this.fx.shieldLayers > 0) {
      this.events.push({ type: 'shieldBreak', layers: this.buffs.consumeShield() });
      s.invulnT = this.invulnS;
      return;
    }
    if (this.fx.boardT > 0) {
      this.buffs.remove('boardArmor');
      this.events.push({ type: 'boardBreak' });
      s.invulnT = this.invulnS;
      return;
    }
    s.hits++;
    s.stunT = this.R.hitStunS ?? 0.8;
    s.invulnT = this.invulnS;
    this.events.push({ type: 'hit' });
    if (s.hits >= this.lives) {
      // 头盔：窗口内替角色挡下致命一击（该次受击撤销），随后头盔消失
      if (this.fx.helmetT > 0) {
        this.buffs.remove('lifeAdd');
        s.hits--;
        s.stunT = 0;
        s.invulnT = this.invulnS + 0.2;
        this.events.push({ type: 'helmetSave' });
        return;
      }
      s.alive = false;
      this.events.push({ type: 'death' });
    }
  }

  /** 清理已掠过 CULL_BEHIND_M 的实体（swap-pop，O(1) 摊销） */
  private cull() {
    const s = this.state;
    for (let i = this.obstacles.length - 1; i >= 0; i--) {
      if (relZ(this.obstacles[i], s.distance) > CULL_BEHIND_M) { this.obstacles[i] = this.obstacles[this.obstacles.length - 1]; this.obstacles.pop(); }
    }
    for (let i = this.coinsArr.length - 1; i >= 0; i--) {
      if (s.distance - this.coinsArr[i].worldZ > CULL_BEHIND_M) { this.coinsArr[i] = this.coinsArr[this.coinsArr.length - 1]; this.coinsArr.pop(); }
    }
    for (let i = this.pickupsArr.length - 1; i >= 0; i--) {
      if (s.distance - this.pickupsArr[i].worldZ > CULL_BEHIND_M) { this.pickupsArr[i] = this.pickupsArr[this.pickupsArr.length - 1]; this.pickupsArr.pop(); }
    }
    for (let i = this.cloudsArr.length - 1; i >= 0; i--) {
      if (s.distance - this.cloudsArr[i].worldZ > CULL_BEHIND_M) { this.cloudsArr[i] = this.cloudsArr[this.cloudsArr.length - 1]; this.cloudsArr.pop(); }
    }
  }

  /** 结算摘要（快照测试与结果页共用） */
  summary() {
    const s = this.state;
    return {
      t: +s.t.toFixed(2), distance: +s.distance.toFixed(2), coins: s.coins, nearMiss: s.nearMiss,
      hits: s.hits, score: s.score, alive: s.alive, casts: s.casts, charId: this.loadout.charId,
    };
  }
}
