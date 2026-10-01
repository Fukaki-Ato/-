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

/**
 * 微信小游戏不暴露 WebGL2RenderingContext 全局，而 three 的判定是
 * `typeof WebGL2RenderingContext !== 'undefined' && gl.constructor.name === 'WebGL2RenderingContext'`
 * —— 前半句恒 false，于是把真实的 WebGL2 上下文当成 WebGL1：PBR 着色器按 GLSL ES 1.00 +
 * `GL_OES_standard_derivatives` 生成（编译失败）、InstancedMesh 去要 ANGLE_instanced_arrays
 * （WebGL2 里是核心功能不列为扩展，拒绘），两者都逐帧刷日志（实测约 1 万条/秒）。
 * 用真实上下文的构造器补上这个全局，three 即正确走 WebGL2 分支。
 * 只在构造器名与 three 的判定完全一致时才补，避免把别的对象当成 WebGL2 上下文骗过 three。
 */
function exposeWebGL2Class(canvas: GLCanvas): void {
  const g = globalThis as { WebGL2RenderingContext?: unknown };
  if (g.WebGL2RenderingContext !== undefined) return;
  const ctx = (canvas as unknown as { getContext(kind: string): { constructor?: { name?: string } } | null })
    .getContext('webgl2');
  if (ctx?.constructor?.name === 'WebGL2RenderingContext') g.WebGL2RenderingContext = ctx.constructor;
}

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
      if (!main) {
        main = installCanvasShim(wx.createCanvas()).gl;
        exposeWebGL2Class(main); // 必须在 three 建 renderer 之前补全局（emptyScene 先取画布后建 renderer）
      }
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
