/**
 * 平台手势 → UiInput 适配（过渡层，S3 v2 合入后见文末切换点）。
 * v1 PlatformAdapter.Gesture 只有 swipe/tap/doubleTap（swipe 无坐标、无 move 流）：
 *   - tap/doubleTap → down+up（可命中、可点击，无拖拽）；
 *   - swipe → 无法定位命中（v1 不带坐标），转为「整页滚动 fling」由 applySwipeScroll 消费。
 * 拖拽滚动需要原始触点流：demo（apps/web）直接绑 pointer 事件；生产路径等 S3 v2。
 *
 * S3 合入后的切换点：
 *   1. v2 InputEvent 的 swipe 带起点坐标（x/y）→ swipeToInputs 可产出定位 down（仍无 move 流）；
 *   2. 建议平台层暴露原始触点通道（v2 规格 §6 的 TouchSample {phase,x,y,timeMs} 已含所需字段），
 *      web/wx 各自折算后 overlay.handleInput 即获得完整拖拽/惯性——本文件届时退役或仅留语义手势映射。
 */
import type { UiInput } from '../router.js';
import type { ScrollPhysics } from '../scroll.js';

/** v1 Gesture 的结构化镜像（不从 @tr/platform import，避免与 S3 在飞改动耦合） */
export type GestureLikeV1 =
  | { type: 'swipe'; dir: 'up' | 'down' | 'left' | 'right' }
  | { type: 'tap'; x: number; y: number }
  | { type: 'doubleTap'; x: number; y: number };

/** v2 InputEvent（手势子集）的结构化前向兼容镜像 */
export type GestureLikeV2 =
  | { type: 'swipe'; dir: 'up' | 'down' | 'left' | 'right'; x: number; y: number }
  | { type: 'tap'; x: number; y: number }
  | { type: 'doubleTap'; x: number; y: number };

/**
 * 手势 → 命中分发输入序列（t 单位=秒）。
 * swipe：v1 无坐标返回空；v2（带 x/y）返回起点 down+up（点击语义，滚动交给 applySwipeScroll）。
 */
export function gestureToInputs(g: GestureLikeV1 | GestureLikeV2, t: number): UiInput[] {
  switch (g.type) {
    case 'tap':
    case 'doubleTap':
      return [
        { type: 'down', x: g.x, y: g.y, t },
        { type: 'up', x: g.x, y: g.y, t },
      ];
    case 'swipe':
      if ('x' in g && 'y' in g) {
        return [
          { type: 'down', x: g.x, y: g.y, t },
          { type: 'up', x: g.x, y: g.y, t },
        ];
      }
      return [];
  }
}

/** swipe → 滚动 fling（无拖拽跟手时的退化滚动：一次滑动翻 amountPx，方向=内容跟手方向） */
export function applySwipeScroll(
  g: { type: 'swipe'; dir: 'up' | 'down' | 'left' | 'right' },
  physics: ScrollPhysics,
  axis: 'x' | 'y',
  amountPx = 320,
): void {
  const vertical = g.dir === 'up' || g.dir === 'down';
  if ((axis === 'y') !== vertical) return;
  // 手指上滑 → 内容上移 → offset 增大（dragBy 的符号约定：内容速度 = -指针速度）
  const sign = g.dir === 'up' || g.dir === 'left' ? 1 : -1;
  const v = (sign * amountPx) / 0.25; // 0.25s 内滚完的量作为初速（摩擦会再衰减）
  physics.fling(v);
}
