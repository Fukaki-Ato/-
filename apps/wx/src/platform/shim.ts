/**
 * Minimal WX canvas shim for Three.js. It provides event registration and a writable style object
 * without fabricating browser globals, and stays testable through injected WX canvas objects.
 */
import type { ContextHandle, GLCanvas, GLContextAttributes } from '@tr/framework/platform/platformAdapter.js';
import type { WxRawCanvas } from './wxTypes.js';

type Listener = (ev?: unknown) => void;

/** 垫片句柄：附带内部 listeners，供 K5 上下文恢复钩子未来触发/测试断言。 */
export interface CanvasShimHandle {
  gl: GLCanvas;
  /** wx 无 webglcontext* 事件源；本表登记的监听器由未来的 onHide/onShow 恢复逻辑手动 dispatch（K5 预留） */
  listeners(): ReadonlyMap<string, Listener[]>;
  dispatch(type: string, ev?: unknown): void;
}

export function installCanvasShim(raw: WxRawCanvas): CanvasShimHandle {
  const listeners = new Map<string, Listener[]>();

  if (!raw.addEventListener) {
    raw.addEventListener = (type: string, fn: Listener) => {
      const arr = listeners.get(type) ?? [];
      arr.push(fn);
      listeners.set(type, arr);
    };
  }
  if (!raw.removeEventListener) {
    raw.removeEventListener = (type: string, fn: Listener) => {
      const arr = listeners.get(type);
      if (arr) listeners.set(type, arr.filter(f => f !== fn));
    };
  }
  // three 会写 canvas.style（setSize updateStyle 分支等）；给可写空对象吞掉写入（D13）
  if (!raw.style) raw.style = {};

  const gl = raw as unknown as GLCanvas; // getContext 签名结构化兼容（string id 覆盖三个重载）
  return {
    gl,
    listeners: () => listeners,
    dispatch(type, ev) {
      for (const fn of [...(listeners.get(type) ?? [])]) fn(ev);
    },
  };
}

/** 语义糖：从垫片取 WebGL 上下文（保留 ContextHandle 不透明性，D3）。 */
export function getContext(
  handle: CanvasShimHandle, id: 'webgl2' | 'webgl' | '2d', attrs?: GLContextAttributes,
): ContextHandle | null {
  return (handle.gl.getContext as (i: string, a?: unknown) => ContextHandle | null)(id, attrs);
}
