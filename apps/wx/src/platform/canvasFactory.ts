/**
 * CanvasFactory 的 wx 实现（S10 §4 映射表 §1 画布行）。
 * 主画布幂等单例（D1）：首个 wx.createCanvas() 即上屏画布（官方语义），之后返回同一实例；
 * 离屏画布每次新建（后续 createCanvas()）。上屏画布 width/height 已是物理像素（K6）。
 */
import type { CanvasFactory, GLCanvas, WindowSize } from '@tr/framework/platform/platformAdapter.js';
import { installCanvasShim } from './shim.js';
import type { WxLike } from './wxTypes.js';

/** K6：真机 pixelRatio 常见 2.75~3.5，必须封顶（与 web 端 min(dpr,2) 同策略） */
const DPR_CAP = 2;

export function createWxCanvasFactory(wx: WxLike): CanvasFactory {
  let main: GLCanvas | null = null;

  const windowSize = (): WindowSize => {
    const info = wx.getWindowInfo();
    return {
      width: info.windowWidth,
      height: info.windowHeight,
      dpr: Math.min(info.pixelRatio || 1, DPR_CAP),
    };
  };

  return {
    mainCanvas() {
      if (!main) main = installCanvasShim(wx.createCanvas()).gl;
      return main;
    },
    createOffscreenCanvas(width, height) {
      const handle = installCanvasShim(wx.createCanvas());
      handle.gl.width = Math.max(1, Math.floor(width));
      handle.gl.height = Math.max(1, Math.floor(height));
      return handle.gl;
    },
    windowSize,
    onResize(cb) {
      // 转屏/系统键盘弹起：res 只带新 w/h，尺寸一律重查 windowSize()（pixelRatio 不变）
      const handler = () => cb(windowSize());
      wx.onWindowResize(handler);
      return () => wx.offWindowResize(handler);
    },
  };
}
