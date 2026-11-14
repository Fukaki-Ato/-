import type { PlatformAdapter } from '@tr/framework/platform/platformAdapter.js';

type Frames = Pick<PlatformAdapter, 'requestFrame' | 'cancelFrame'>;
type Callback = (nowMs: number) => void;

/** 单个原生 rAF：先推进/绘制跑局，再绘制 UI，避免两套循环争用屏幕画布。 */
export function createWxFrameLoop(adapter: PlatformAdapter) {
  const pending = new Map<number, { phase: number; callback: Callback }>();
  let next = 0, native: number | null = null;
  let draining = false, hidden = false, disposed = false;
  const schedule = (): void => {
    if (!disposed && !hidden && !draining && native === null && pending.size) {
      native = adapter.requestFrame(tick);
    }
  };
  function tick(nowMs: number): void {
    native = null;
    if (disposed || hidden) return;
    draining = true;
    const frame = [...pending.entries()].sort((a, b) => a[1].phase - b[1].phase);
    try {
      for (const [id, entry] of frame) {
        if (!pending.delete(id)) continue; // 前一回调可能结束场景并取消同帧的后续工作。
        entry.callback(nowMs);
      }
    } finally {
      draining = false;
      schedule();
    }
  }
  const channel = (phase: number): Frames => ({
    requestFrame(callback) {
      if (disposed) return 0;
      const id = ++next;
      pending.set(id, { phase, callback });
      schedule();
      return id;
    },
    cancelFrame(id) {
      pending.delete(id);
      if (!pending.size && native !== null) {
        adapter.cancelFrame(native); native = null;
      }
    },
  });
  const offVisibility = adapter.onVisibility(value => {
    hidden = value;
    if (hidden && native !== null) { adapter.cancelFrame(native); native = null; }
    if (!hidden) schedule();
  });
  return {
    game: channel(0),
    ui: channel(1),
    dispose() {
      disposed = true;
      if (native !== null) adapter.cancelFrame(native);
      native = null; pending.clear(); offVisibility();
    },
  };
}
