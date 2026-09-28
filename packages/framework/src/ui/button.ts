/**
 * Button 状态机：normal / pressed / disabled 三态纯 reducer。
 * 事件来源：InputRouter 的 onPressChange（down=按压开始，cancel=按压取消）与业务 enable/disable。
 * 激活（触发 onClick 语义）判定：处于 pressed 且收到 up —— 由调用方结合 buttonActivates 使用。
 */

export type ButtonState = 'normal' | 'pressed' | 'disabled'
export type ButtonEvent = 'down' | 'up' | 'leave' | 'enter' | 'cancel' | 'enable' | 'disable'

/** 纯状态转移表 */
export function buttonNext(state: ButtonState, ev: ButtonEvent): ButtonState {
  if (state === 'disabled') return ev === 'enable' ? 'normal' : 'disabled'
  switch (ev) {
    case 'down': return 'pressed'
    case 'up': return 'normal'
    case 'leave': return 'normal'
    case 'cancel': return 'normal'
    case 'disable': return 'disabled'
    case 'enter': return state === 'pressed' ? 'pressed' : 'normal'
    case 'enable': return state
  }
}

/** 本次 (state, ev) 组合是否构成一次激活（点击成功） */
export function buttonActivates(state: ButtonState, ev: ButtonEvent): boolean {
  return state === 'pressed' && ev === 'up'
}

export interface ButtonMachine {
  readonly state: ButtonState
  /** 发送事件，返回转移结果：state=新状态，changed=是否变化，activated=是否激活 */
  send(ev: ButtonEvent): { state: ButtonState; changed: boolean; activated: boolean }
}

export function createButton(opts?: { disabled?: boolean }): ButtonMachine {
  let state: ButtonState = opts?.disabled ? 'disabled' : 'normal'
  return {
    get state() { return state },
    send(ev) {
      const prev = state
      const next = buttonNext(prev, ev)
      state = next
      return { state: next, changed: next !== prev, activated: buttonActivates(prev, ev) }
    },
  }
}
