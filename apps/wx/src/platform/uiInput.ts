import type { UiInput } from '@tr/framework/ui/router.js';
import type { WxLike, WxTouchEvent } from './wxTypes.js';

/** 将原始触点用于按钮按压与双向列表拖动；业务手势仍由 platform/input 提供。 */
export function bindWxUiInput(wx: WxLike, push: (input: UiInput) => void, now: () => number): () => void {
  let active: number | null = null;
  let x = 0, y = 0;
  const send = (type: UiInput['type']): void => push({ type, x, y, t: now() / 1000 });
  const down = (event: WxTouchEvent): void => {
    if (active !== null) return;
    const touch = event.changedTouches[0];
    if (!touch) return;
    active = touch.identifier; x = touch.clientX; y = touch.clientY; send('down');
  };
  const sample = (type: 'move' | 'up') => (event: WxTouchEvent): void => {
    if (active === null) return;
    const touch = event.changedTouches.find(t => t.identifier === active);
    if (!touch) return;
    x = touch.clientX; y = touch.clientY;
    if (type === 'up') active = null;
    send(type);
  };
  const move = sample('move'), up = sample('up');
  const cancel = (): void => {
    if (active !== null) { active = null; send('cancel'); }
  };
  wx.onTouchStart(down); wx.onTouchMove(move); wx.onTouchEnd(up); wx.onTouchCancel(cancel);
  wx.onHide(cancel);
  return () => {
    cancel();
    wx.offTouchStart(down); wx.offTouchMove(move); wx.offTouchEnd(up); wx.offTouchCancel(cancel);
    wx.offHide(cancel);
  };
}
