/**
 * 手势归一化共享内核（PlatformAdapter v2 §6，S10 契约 / D8）。
 * 从 v1 webPlatform.bindGesture 的判定逻辑原样提取为纯状态机：
 * 阈值默认值与判定顺序不变（swipe 位移优先 → tap/doubleTap 窗口），两端共享。
 */
import type { GestureClassifier, GestureClassifierOptions, InputEvent, SwipeDir, TouchSample } from './input.js';

/** v1 现行默认：swipeMinPx=24, tapMaxMs=350, doubleTapWindowMs=280, doubleTapMaxDistPx=40。 */
export const GESTURE_DEFAULTS: Required<GestureClassifierOptions> = {
  swipeMinPx: 24,
  tapMaxMs: 350,
  doubleTapWindowMs: 280,
  doubleTapMaxDistPx: 40,
};

/** 位移主导轴判向（与 v1 相同：水平位移取左右，否则取上下）。 */
function swipeDir(dx: number, dy: number): SwipeDir {
  return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
}

export function createGestureClassifier(opts?: GestureClassifierOptions): GestureClassifier {
  const cfg = { ...GESTURE_DEFAULTS, ...opts };
  let downX = 0, downY = 0, downT = 0, active = false;
  let lastTapT = 0, lastTapX = 0, lastTapY = 0;

  return {
    push(sample: TouchSample): InputEvent | null {
      if (sample.phase === 'down') {
        // v1 语义：新按下覆盖旧按下（多指/重按时以最后一个触点为起点）
        active = true;
        downX = sample.x; downY = sample.y; downT = sample.timeMs;
        return null;
      }
      if (!active) return null; // v1 语义：无配对的 up（如 pointerdown 漏在窗外）直接忽略
      active = false;
      const dx = sample.x - downX, dy = sample.y - downY;
      const dt = sample.timeMs - downT;
      if (Math.abs(dx) > cfg.swipeMinPx || Math.abs(dy) > cfg.swipeMinPx) {
        return { type: 'swipe', dir: swipeDir(dx, dy), x: downX, y: downY };
      }
      if (dt < cfg.tapMaxMs) {
        // 先判双击（两次 tap 距离/间隔达标），否则上报单击
        const t = sample.timeMs;
        if (
          t - lastTapT < cfg.doubleTapWindowMs &&
          Math.hypot(sample.x - lastTapX, sample.y - lastTapY) < cfg.doubleTapMaxDistPx
        ) {
          lastTapT = 0; // 消耗掉，避免三连击
          return { type: 'doubleTap', x: sample.x, y: sample.y };
        }
        lastTapT = t; lastTapX = sample.x; lastTapY = sample.y;
        return { type: 'tap', x: sample.x, y: sample.y };
      }
      return null;
    },

    reset() {
      active = false;
      lastTapT = 0;
    },
  };
}
