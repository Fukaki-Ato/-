/**
 * 角色运动学（docs/01 §2 操作与 §3 物理参数）
 * 只管「跳、铲、换道、飞行/滑翔降落」的推进，不碰障碍、收集物与计分。
 * 与 runnerSim 的分工：sim 负责输入路由与逐帧结算，这里负责状态向量的积分。
 */
import type { FxState } from '../effects/buffEngine.js';
import { PENDING_STEPS, type RunnerState } from './simTypes.js';
import { RIDE_TOP_EPS, inDepthWindow, lateralGap } from './collision.js';
import { applyLandingSafety } from './landing.js';
import type { ObstacleEntity } from './trackGen.js';

/** game.json runner 段中被运动学使用的键 */
export interface MovementParams {
  laneWidth: number; gravity: number; jumpVelocity: number;
  slideS: number; slideCooldownS: number; laneChangeS: number;
}

/** game.json flight 段中被运动学使用的键 */
export interface FlightShape { heightM: number; glideS: number }

/** 空中铲的快速落地初速（m/s） */
const DIVE_VY = -20;
/** 飞行升高的趋近系数（每秒）：越大越"弹射"，越小越"缓升" */
const RISE_LERP = 3.2;
/** 判定「仍在空中」的高度阈值（米） */
const AIRBORNE_Y = 0.2;
/** 板子（step）可踏上升级的容差（米）：板高 0.6 内、地面起跑即视为可踏面，跑过自动上板 */
const STEP_UP_TOL = 0.8;

export class Movement {
  /** 起身后的滑铲冷却（禁止连续下滑） */
  slideCd = 0;
  /** 输入缓冲：落地后仍接受该步数内的跳/铲指令 */
  pendingJump = 0;
  pendingSlide = 0;
  /** 上一步是否处于飞行中：燃料耗尽的这一步据此决定是否转入滑翔降落 */
  flyWasActive = false;
  /** 当前可站立支撑面高度（0=地面；>0=列车顶等 rideTop 表面），每帧重算 */
  private floorY = 0;

  constructor(
    private readonly P: MovementParams,
    private readonly fly: FlightShape,
    private readonly obstacles: ObstacleEntity[],
  ) {}

  /** ↑/空格：滑行中按跳=起身直接跳；空中按跳=进缓冲等落地 */
  jumpInput(s: RunnerState, fx: FxState) {
    if (s.sliding) { this.cancelSlide(s); this.jump(s, fx); }
    else if (s.y <= 0 || Math.abs(s.y - this.floorY) < 0.05) this.jump(s, fx); // 车顶上也可直接起跳
    else this.pendingJump = PENDING_STEPS;
  }

  /** ↓：空中铲=快速落地接铲；地面铲=直接进入滑行 */
  slideInput(s: RunnerState, fx: FxState) {
    if (s.y > 0) { s.vy = Math.min(s.vy, DIVE_VY); this.pendingSlide = PENDING_STEPS; }
    else this.slide(s, fx);
  }

  private jump(s: RunnerState, fx: FxState) {
    s.vy = this.P.jumpVelocity * (fx.bootsT > 0 ? fx.jumpMul : 1); // 弹跳鞋：跳跃初速乘区
    if (s.y <= 0) s.y = 0.001; // 从支撑面起跳：车顶（y>0）不重置高度
  }

  private slide(s: RunnerState, fx: FxState) {
    if (s.sliding || this.slideCd > 0) return; // 冷却中不可再次下滑
    s.slideT = this.P.slideS + fx.slideAddS;   // 被动「贴地飞行」加长
    s.sliding = true;
  }

  /** 结束滑行并进入冷却（飞行进入地面、起身跳时都会调用） */
  cancelSlide(s: RunnerState) {
    s.sliding = false;
    s.slideT = 0;
    this.slideCd = this.P.slideCooldownS;
  }

  /** 横向：以 laneChangeS 的速度逼近目标车道（碰撞用连续 x，换道途中可被撞） */
  advanceLateral(s: RunnerState, dt: number) {
    const laneSpeed = this.P.laneWidth / this.P.laneChangeS;
    const dx = s.lane * this.P.laneWidth - s.x;
    s.x += Math.sign(dx) * Math.min(Math.abs(dx), laneSpeed * dt);
  }

  /** 飞行/滑翔期间缓冲同样递减（不执行）：避免进飞行前留下的跳/铲缓冲落地后自动触发 */
  private decayPending() {
    if (this.pendingJump > 0) this.pendingJump--;
    if (this.pendingSlide > 0) this.pendingSlide--;
  }

  /** 垂直：三档 —— 飞行悬停 / 滑翔降落 / 地面跳跃滑铲 */
  advanceVertical(s: RunnerState, fx: FxState, dt: number) {
    if (fx.flyT > 0) {
      this.flyWasActive = true;
      this.decayPending();
      s.vy = 0;
      s.y += (this.fly.heightM - s.y) * Math.min(1, dt * RISE_LERP); // 平滑升至飞行高度（不高，可俯瞰地面）
      if (s.sliding) this.cancelSlide(s);
      return;
    }
    if (this.flyWasActive) {
      this.flyWasActive = false;
      if (s.y > AIRBORNE_Y) s.gliding = true; // 燃料耗尽 → 进入滑翔降落
    }
    if (s.gliding) {
      this.decayPending();
      s.y -= (this.fly.heightM / this.fly.glideS) * dt;              // 匀速滑翔下滑
      const landed = s.y <= 0;
      if (landed) { s.y = 0; s.gliding = false; }
      // 着陆安全：滑翔期与落地帧都不清障（障碍全程保留）；落地只给 0.5s 免伤缓冲
      applyLandingSafety(s, landed);
      return;
    }
    if (this.pendingJump > 0) { this.pendingJump--; if (s.y <= this.floorY + 0.05) { this.jump(s, fx); this.pendingJump = 0; } }
    if (this.pendingSlide > 0) { this.pendingSlide--; if (s.y <= 0) { this.slide(s, fx); this.pendingSlide = 0; } }
    this.floorY = this.supportHeight(s); // 先判支撑后积分：用位移前的 y 判定，避免穿入车体
    // floorY>s.y（地面起跑踏上板子）也要进积分：否则贴不上支撑面，会从板子上穿过去
    if (s.y > 0 || s.vy > 0 || this.floorY > s.y) {
      s.vy += this.P.gravity * dt;
      s.y += s.vy * dt;
      if (s.y <= this.floorY) { s.y = this.floorY; s.vy = 0; } // 落到/贴上地面、板子或列车顶
    }
    if (s.sliding) { s.slideT -= dt; if (s.slideT <= 0) this.cancelSlide(s); }
  }

  /** 可站立支撑面：rideTop 列车（需已到顶面附近）或 step 板子（地面起跑即可踏上）取最高者 */
  private supportHeight(s: RunnerState): number {
    let h = 0;
    for (const o of this.obstacles) {
      if (o.done) continue;
      const tol = o.rideTop === true ? RIDE_TOP_EPS : o.cls === 'step' ? STEP_UP_TOL : 0;
      if (tol <= 0) continue;
      if (!inDepthWindow(o, s.distance - o.worldZ)) continue;
      if (lateralGap(o, s, this.P.laneWidth) > 0) continue;
      if (s.y >= o.h - tol) h = Math.max(h, o.h);
    }
    return h;
  }
}
