/**
 * wx 触点 → 统一 InputEvent（S10 §4 §6）：wx.onTouchStart/End/Cancel → 折算 TouchSample
 * → 与 web 端共享的 GestureClassifier（packages/platform）。
 * 键盘分支 wx 侧**不发**（无物理键盘；UI 虚拟按键由 ui 包自行合成业务事件，不经 adapter）。
 * 时间戳取 now()（与 adapter.now() 同基准，D12；规避 K12 的 timeStamp 基准疑点）。
 * 坐标为逻辑像素不乘 dpr（K13），与 web 的 clientX/Y 同基准。
 */
import { createGestureClassifier } from '@tr/framework/platform/gestureClassifier.js';
import type { InputEvent, TouchSample, Unsubscribe } from '@tr/framework/platform/platformAdapter.js';
import type { WxLike, WxTouchEvent } from './wxTypes.js';

/** 触点序列被打断（cancel）之外的兜底：页面隐藏时也应 reset，见 adapter.onVisibility 接线。 */
export interface WxInput {
  onInput(cb: (e: InputEvent) => void): Unsubscribe;
  reset(): void;
}

export function createWxInput(wx: WxLike, now: () => number): WxInput {
  const classifier = createGestureClassifier();
  const subs = new Set<(e: InputEvent) => void>();
  const emit = (e: InputEvent | null) => {
    if (e) for (const cb of [...subs]) cb(e); // 按订阅顺序同步派发（S10 §6）
  };
  // 单指语义（与 v1 一致）：只取主触点 changedTouches[0]
  const sample = (phase: TouchSample['phase']) => (ev: WxTouchEvent): void => {
    const t = ev.changedTouches?.[0];
    if (!t) return;
    emit(classifier.push({ phase, x: t.clientX, y: t.clientY, timeMs: now() }));
  };
  const onStart = sample('down');
  const onEnd = sample('up');
  const onCancel = () => classifier.reset();

  let bound = false;
  const ensureBound = () => {
    if (bound) return;
    bound = true;
    wx.onTouchStart(onStart);
    wx.onTouchEnd(onEnd);
    wx.onTouchCancel(onCancel);
  };

  return {
    onInput(cb) {
      ensureBound(); // 首次订阅才挂 wx 全局监听（D5：与画布生命周期解耦）
      subs.add(cb);
      return () => { subs.delete(cb); }; // 幂等
    },
    reset() { classifier.reset(); },
  };
}
