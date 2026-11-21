import type { WxLike } from './wxTypes.js';

export interface UiInsets { top: number; bottom: number }

/** 官方布局坐标相对屏幕；转换成小游戏窗口内的逻辑像素。 */
export function getWxUiInsets(wx: Pick<WxLike, 'getWindowInfo' | 'getMenuButtonBoundingClientRect'>): UiInsets {
  const info = wx.getWindowInfo();
  const origin = info.screenTop ?? 0;
  const menu = wx.getMenuButtonBoundingClientRect?.();
  return {
    top: Math.max(0, (info.safeArea?.top ?? origin) - origin, (menu?.bottom ?? origin) - origin) + 8,
    bottom: Math.max(0, info.windowHeight - ((info.safeArea?.bottom ?? origin + info.windowHeight) - origin)) + 8,
  };
}
