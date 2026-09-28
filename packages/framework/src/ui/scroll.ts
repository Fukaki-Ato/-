/**
 * ScrollView 惯性滚动物理：摩擦衰减 + 越界回弹（弹簧）+ 拖拽越界阻尼。
 * 纯状态机：step(dt) 推进，无定时器/无平台依赖；时间单位一律「秒」。
 * 手感参数（ScrollFeel）为扁平数值结构，字段命名对齐 config/game.json 未来 params.ui.scroll 段
 * （见 API.md §5 的 JSON 草案），届时经 configValidator 校验后原样注入。
 */
import { clamp } from './types.js'

export interface ScrollFeel {
  /** 惯性速度指数衰减率（1/s），越大停得越快 */
  frictionPerS: number
  /** 惯性停止阈值（px/s） */
  minVelocityPxS: number
  /** fling 初速度上限（px/s） */
  flingMaxPxS: number
  /** 拖拽越界阻尼系数 0..1（越小越「重」） */
  overscrollResist: number
  /** 回弹弹簧刚度 */
  bounceStiffness: number
  /** 回弹阻尼 */
  bounceDamping: number
  /** 回弹收敛位置阈值 px */
  settleEpsPx: number
  /** 回弹收敛速度阈值 px/s */
  settleEpsPxS: number
}

export const defaultScrollFeel: ScrollFeel = {
  frictionPerS: 4.2,
  minVelocityPxS: 12,
  flingMaxPxS: 6000,
  overscrollResist: 0.35,
  bounceStiffness: 170,
  bounceDamping: 26,
  settleEpsPx: 0.5,
  settleEpsPxS: 8,
}

export function resolveScrollFeel(patch?: Partial<ScrollFeel> | null): ScrollFeel {
  return { ...defaultScrollFeel, ...(patch ?? {}) }
}

export interface PosSample { x: number; t: number }

/** 由最近采样估速度（px/s）：取尾部 ≤100ms 窗口首尾差商；采样不足返回 0 */
export function estimateVelocity(samples: PosSample[], windowS = 0.1): number {
  if (samples.length < 2) return 0
  const last = samples[samples.length - 1]!
  let first = last
  for (let i = samples.length - 1; i >= 0; i--) {
    const s = samples[i]!
    if (last.t - s.t > windowS) break
    first = s
  }
  const dt = last.t - first.t
  if (dt <= 0) return 0
  return (last.x - first.x) / dt
}

export interface ScrollPhysicsOptions {
  /** 内容总长 px */
  content: number
  /** 视口长 px */
  viewport: number
  feel?: Partial<ScrollFeel> | null
  offset?: number
}

const MAX_SUBSTEP = 1 / 120

export class ScrollPhysics {
  readonly feel: ScrollFeel
  private content: number
  private viewport: number
  private _offset: number
  private velocity = 0
  private _dragging = false
  private pointerX = 0
  private samples: PosSample[] = []

  constructor(opts: ScrollPhysicsOptions) {
    this.feel = resolveScrollFeel(opts.feel)
    this.content = Math.max(0, opts.content)
    this.viewport = Math.max(0, opts.viewport)
    this._offset = clamp(opts.offset ?? 0, 0, this.maxOffset)
  }

  get offset(): number { return this._offset }
  get maxOffset(): number { return Math.max(0, this.content - this.viewport) }
  get dragging(): boolean { return this._dragging }
  /** 是否仍需 tick（惯性未停，或停在越界位置等待回弹） */
  get animating(): boolean {
    if (this._dragging) return false
    return this.velocity !== 0 || this._offset < 0 || this._offset > this.maxOffset
  }
  get velocityPxS(): number { return this.velocity }

  setBounds(content: number, viewport: number): void {
    this.content = Math.max(0, content)
    this.viewport = Math.max(0, viewport)
    this._offset = clamp(this._offset, 0, this.maxOffset)
  }

  /** 直接定位（清速度），如 List 点击跳转 */
  snapTo(offset: number): void {
    this._offset = clamp(offset, 0, this.maxOffset)
    this.velocity = 0
    this.samples = []
  }

  dragStart(t: number): void {
    this._dragging = true
    this.velocity = 0
    this.pointerX = 0
    this.samples = [{ x: 0, t }]
  }

  /** 指针位移 dx（内容跟手：offset -= dx）；越界部分乘 overscrollResist */
  dragBy(dx: number, t: number): void {
    if (!this._dragging) return
    this.pointerX += dx
    const raw = this._offset - dx
    const hi = this.maxOffset
    const r = this.feel.overscrollResist
    if (raw < 0) this._offset = raw * r
    else if (raw > hi) this._offset = hi + (raw - hi) * r
    else this._offset = raw
    this.samples.push({ x: this.pointerX, t })
    if (this.samples.length > 16) this.samples.shift()
  }

  /** 松手：由采样估 fling 速度（内容速度 = -指针速度），进入惯性；返回采用的初速度 */
  dragEnd(): number {
    if (!this._dragging) return 0
    this._dragging = false
    const v = clamp(-estimateVelocity(this.samples), -this.feel.flingMaxPxS, this.feel.flingMaxPxS)
    this.velocity = Math.abs(v) < this.feel.minVelocityPxS ? 0 : v
    this.samples = []
    return this.velocity
  }

  /** 直接给初速度（如键盘/代码滚动） */
  fling(v: number): void {
    this.velocity = clamp(v, -this.feel.flingMaxPxS, this.feel.flingMaxPxS)
  }

  /**
   * 推进 dt 秒（内部子步 ≤1/120s 保证弹簧稳定）。
   * 返回本步是否产生了位移（false = 已静止，可停 tick）。
   */
  step(dt: number): boolean {
    if (this._dragging || !(dt > 0) || !Number.isFinite(dt)) return false
    const before = this._offset
    let rest = Math.min(dt, 0.25)
    while (rest > 1e-9) {
      const h = Math.min(rest, MAX_SUBSTEP)
      this.integrate(h)
      rest -= h
    }
    return Math.abs(this._offset - before) > 1e-9 || this.velocity !== 0
  }

  private integrate(h: number): void {
    const f = this.feel
    const hi = this.maxOffset
    const out = this._offset < 0 ? this._offset : this._offset > hi ? this._offset - hi : 0
    if (out !== 0) {
      // 越界：阻尼弹簧拉回最近边界；回到界内时若已近静止则贴边收敛，否则带速度进入摩擦段
      const bound = out < 0 ? 0 : hi
      const a = -f.bounceStiffness * (this._offset - bound) - f.bounceDamping * this.velocity
      this.velocity += a * h
      this._offset += this.velocity * h
      // 收敛判定不要求已回到界内：过阻尼弹簧可能从外侧无限逼近边界
      if (Math.abs(this._offset - bound) < f.settleEpsPx && Math.abs(this.velocity) < f.settleEpsPxS) {
        this._offset = bound
        this.velocity = 0
      }
      return
    }
    // 界内：指数摩擦衰减；越界交给下一子步的弹簧
    this.velocity *= Math.exp(-f.frictionPerS * h)
    this._offset += this.velocity * h
    if (Math.abs(this.velocity) < f.minVelocityPxS && this._offset >= 0 && this._offset <= hi) {
      this.velocity = 0
    }
  }
}
