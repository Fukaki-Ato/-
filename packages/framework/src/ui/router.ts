/**
 * 输入分发器：把归一化触点事件（down/move/up/cancel）沿命中路径做 捕获→目标→冒泡 分发，
 * 并维护「按压态生命周期」（down 命中 → pressed；移动超过 slop → 取消；up 仍在目标内 → click）。
 * 与平台无关：宿主（S4 overlay）把 wx/web 手势归一化成 UiInput 喂进来即可。
 * 单触点语义：down 之后锁定路径，后续 move/up 一律沿该路径分发（滚动中按钮不误触）。
 */
import { containsPoint, type LayoutBox } from './types.js'
import { hitPath } from './hit.js'

export type InputKind = 'down' | 'move' | 'up' | 'cancel'
export interface UiInput { type: InputKind; x: number; y: number; t: number }

export interface UiEvent {
  type: InputKind | 'click'
  x: number
  y: number
  t: number
  /** 事件目标（activePath 最深节点） */
  target: LayoutBox
  phase: 'capture' | 'target' | 'bubble'
  stopPropagation(): void
}

export interface NodeHandlers {
  onDown?(e: UiEvent): void
  onMove?(e: UiEvent): void
  onUp?(e: UiEvent): void
  onCancel?(e: UiEvent): void
  onClick?(e: UiEvent): void
  /** 按压态变化（驱动 Button 状态机/换肤重绘），不走捕获/冒泡，只发给按压目标 */
  onPressChange?(pressed: boolean, e: UiEvent): void
}

export interface RouterOptions {
  /** 按压取消阈值 px（移动超过即判定为滚动/拖拽），默认 8 */
  slop?: number
}

function eventName(type: InputKind | 'click'): keyof NodeHandlers {
  switch (type) {
    case 'down': return 'onDown'
    case 'move': return 'onMove'
    case 'up': return 'onUp'
    case 'cancel': return 'onCancel'
    case 'click': return 'onClick'
  }
}

export class InputRouter {
  private tree: LayoutBox | undefined
  private handlers = new Map<string, NodeHandlers>()
  private slop: number
  /** down 锁定的分发路径（root→leaf） */
  private activePath: LayoutBox[] = []
  /** 按压目标：activePath 中最深的注册了 handler 的节点 */
  private pressTarget: LayoutBox | undefined
  private pressing = false
  private downX = 0
  private downY = 0

  constructor(opts?: RouterOptions) {
    this.slop = opts?.slop ?? 8
  }

  setTree(root: LayoutBox): void { this.tree = root }

  register(id: string, h: NodeHandlers): void { this.handlers.set(id, h) }

  unregister(id: string): void { this.handlers.delete(id) }

  /** 当前是否处于按压 */
  get isPressing(): boolean { return this.pressing }

  dispatch(input: UiInput): void {
    switch (input.type) {
      case 'down': this.onDown(input); break
      case 'move': this.onMove(input); break
      case 'up': this.onUp(input); break
      case 'cancel': this.onCancelInput(input); break
    }
  }

  private lookup(box: LayoutBox | undefined): NodeHandlers | undefined {
    if (!box || box.id === undefined) return undefined
    return this.handlers.get(box.id)
  }

  private onDown(input: UiInput): void {
    this.clearPress(input)
    if (!this.tree) return
    const path = hitPath(this.tree, input.x, input.y)
    if (!path.length) return
    this.activePath = path
    this.downX = input.x
    this.downY = input.y
    for (let i = path.length - 1; i >= 0; i--) {
      const id = path[i]!.id
      if (id !== undefined && this.handlers.has(id)) { this.pressTarget = path[i]; break }
    }
    if (this.pressTarget) this.setPressing(true, input)
    this.propagate('down', input)
  }

  private onMove(input: UiInput): void {
    if (!this.activePath.length) return
    if (this.pressing) {
      const dx = input.x - this.downX
      const dy = input.y - this.downY
      if (dx * dx + dy * dy > this.slop * this.slop) this.cancelPress(input)
    }
    this.propagate('move', input)
  }

  private onUp(input: UiInput): void {
    if (!this.activePath.length) return
    const target = this.pressTarget
    const wasPressing = this.pressing
    if (wasPressing) this.setPressing(false, input)
    this.propagate('up', input)
    if (wasPressing && target && containsPoint(target.rect, input.x, input.y)) {
      this.propagate('click', input)
    }
    this.clearPress(input)
  }

  private onCancelInput(input: UiInput): void {
    if (!this.activePath.length) return
    if (this.pressing) this.cancelPress(input)
    else this.propagate('cancel', input)
    this.clearPress(input)
  }

  /** slop 触发：结束按压并沿路径发 cancel；activePath 保留，滚动容器继续收 move */
  private cancelPress(input: UiInput): void {
    if (!this.pressing) return
    this.setPressing(false, input)
    this.propagate('cancel', input)
  }

  private setPressing(v: boolean, input: UiInput): void {
    this.pressing = v
    const h = this.lookup(this.pressTarget)
    if (h?.onPressChange && this.pressTarget) {
      h.onPressChange(v, this.standaloneEvent(v ? 'down' : 'cancel', input, this.pressTarget))
    }
  }

  private clearPress(input: UiInput): void {
    if (this.pressing) this.setPressing(false, input)
    this.pressing = false
    this.pressTarget = undefined
    this.activePath = []
  }

  private standaloneEvent(type: InputKind | 'click', input: UiInput, target: LayoutBox): UiEvent {
    return { type, x: input.x, y: input.y, t: input.t, target, phase: 'target', stopPropagation() { /* 单播，无意义 */ } }
  }

  /** 捕获（root→target 父）→ 目标 → 冒泡（target 父→root）；一个 UiEvent 实例贯穿全程 */
  private propagate(type: InputKind | 'click', input: UiInput): void {
    const path = this.activePath
    if (!path.length) return
    const target = path[path.length - 1]!
    let stopped = false
    const e: UiEvent = {
      type, x: input.x, y: input.y, t: input.t, target, phase: 'target',
      stopPropagation() { stopped = true },
    }
    const key = eventName(type)
    const fire = (box: LayoutBox, phase: UiEvent['phase']): void => {
      if (stopped) return
      const h = this.lookup(box)
      if (!h) return
      e.phase = phase
      const fn = h[key] as ((ev: UiEvent) => void) | undefined
      fn?.call(h, e)
    }
    for (let i = 0; i < path.length - 1; i++) fire(path[i]!, 'capture')
    fire(target, 'target')
    for (let i = path.length - 2; i >= 0; i--) fire(path[i]!, 'bubble')
  }
}
