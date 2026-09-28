/**
 * 输入统一事件模型与手势判定内核类型（PlatformAdapter v2 §2，S10 契约）。
 * v1 onGesture + onKey 合并为 onInput(InputEvent)（D4）；判定实现见 gestureClassifier.ts。
 */

export type SwipeDir = 'up' | 'down' | 'left' | 'right';

/**
 * 统一输入事件（v1 onGesture 的 Gesture 与 onKey 的 code 合并）。
 * 坐标一律为 CSS 逻辑像素、相对主画布左上角（两端画布即视口，等价视口左上角）。
 */
export type InputEvent =
  /** v1 swipe 原样保留；x/y 为按下起点（v2 新增必填字段，旧消费方忽略即可，D4）。 */
  | { type: 'swipe'; dir: SwipeDir; x: number; y: number }
  /** v1 tap 原样保留。 */
  | { type: 'tap'; x: number; y: number }
  /** v1 doubleTap 原样保留。 */
  | { type: 'doubleTap'; x: number; y: number }
  /** v1 onKey(code) 的替代：code 保持 KeyboardEvent.code 语义（ArrowLeft/Space/Escape…）；
   *  phase 为 v2 新增（v1 隐式只在 down 时回调，迁移时过滤 phase==='down'）。
   *  wx 端无物理键盘，只发手势事件；UI 层「虚拟按键」由 ui 包自行合成业务事件，不经 adapter。 */
  | { type: 'key'; code: string; phase: 'down' | 'up' };

/** v1 的 Gesture 类型去向：InputEvent 的手势子集（导出名保留，减少调用方 churn）。 */
export type Gesture = Extract<InputEvent, { type: 'swipe' | 'tap' | 'doubleTap' }>;

/** 平台触点采样：web 由 PointerEvent 折算，wx 由 wx.onTouch* 折算；坐标 CSS 逻辑像素。 */
export interface TouchSample {
  phase: 'down' | 'up';
  x: number;
  y: number;
  /** 与 adapter.now() 同基准的时间戳（D12）。 */
  timeMs: number;
}

/** 判定阈值；默认值取 v1 webPlatform.ts 的现行常量（手势手感不回退）。 */
export interface GestureClassifierOptions {
  swipeMinPx?: number;
  tapMaxMs?: number;
  doubleTapWindowMs?: number;
  doubleTapMaxDistPx?: number;
}

/**
 * 手势归一化共享内核（纯状态机，无平台依赖，node 可直测，D8）：
 * 两端各自只做「平台触点 → TouchSample」折算，判定逻辑在此一处。
 */
export interface GestureClassifier {
  /** 喂入触点采样；产生手势事件则返回，否则 null。 */
  push(sample: TouchSample): InputEvent | null;
  /** 触点序列被打断（touchcancel / 页面隐藏）时清状态。 */
  reset(): void;
}
