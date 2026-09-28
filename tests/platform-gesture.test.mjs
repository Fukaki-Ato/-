/**
 * 手势归一化内核测试（PlatformAdapter v2 §6，S3 契约矩阵）
 * 验证点：swipe 四方向 + 起点坐标、tap、doubleTap 窗口/距离边界、三连击消耗、
 *         reset 清态、默认阈值与 v1 逐字一致、自定义阈值覆盖。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGestureClassifier, GESTURE_DEFAULTS } from '../packages/framework/dist/platform/gestureClassifier.js';

const D = GESTURE_DEFAULTS;

test('GESTURE_DEFAULTS 与 v1 webPlatform 常量逐字一致（手感不回退）', () => {
  assert.deepEqual(D, { swipeMinPx: 24, tapMaxMs: 350, doubleTapWindowMs: 280, doubleTapMaxDistPx: 40 });
});

/** down→up 一步喂入，返回 up 产生的事件 */
function tapThrough(cl, x, y, t0, t1, ux = x, uy = y) {
  cl.push({ phase: 'down', x, y, timeMs: t0 });
  return cl.push({ phase: 'up', x: ux, y: uy, timeMs: t1 });
}

test('swipe 四方向：主导轴判向，起点坐标 = 按下点（v2 新增 x/y）', () => {
  for (const [dx, dy, dir] of [[-60, 0, 'left'], [60, 0, 'right'], [0, -60, 'up'], [0, 60, 'down']]) {
    const cl = createGestureClassifier();
    const e = tapThrough(cl, 100, 200, 0, 50, 100 + dx, 200 + dy);
    assert.equal(e.type, 'swipe');
    assert.equal(e.dir, dir);
    assert.deepEqual({ x: e.x, y: e.y }, { x: 100, y: 200 });
  }
});

test('swipe 判定：任一轴过阈值即滑动，水平位移更大时取左右（v1 语义）', () => {
  const cl = createGestureClassifier();
  const e = tapThrough(cl, 0, 0, 0, 40, 30, 26); // dx=30>24 且 >|dy|
  assert.equal(e.type, 'swipe');
  assert.equal(e.dir, 'right');
});

test('恰好等于 swipeMinPx 不算滑动（严格大于），落到 tap 分支', () => {
  const cl = createGestureClassifier();
  const e = tapThrough(cl, 1000, 0, 1000, 1040, 1024, 0); // |dx|=24 = swipeMinPx，非 >；用现实时间戳避开 lastTapT=0 初值
  assert.equal(e.type, 'tap');
});

test('tap：短按时长 + 小位移，坐标取抬起点', () => {
  const cl = createGestureClassifier();
  const e = tapThrough(cl, 50, 60, 1000, 1100);
  assert.equal(e.type, 'tap');
  assert.deepEqual({ x: e.x, y: e.y }, { x: 50, y: 60 });
});

test('长按（>= tapMaxMs）且不达滑动距离 → 无事件', () => {
  const cl = createGestureClassifier();
  assert.equal(tapThrough(cl, 10, 10, 0, D.tapMaxMs), null);
});

test('无配对 down 的 up 直接忽略（v1 active 守卫）', () => {
  const cl = createGestureClassifier();
  assert.equal(cl.push({ phase: 'up', x: 0, y: 0, timeMs: 0 }), null);
});

test('doubleTap：窗口内 + 距离内，第二击升级为 doubleTap', () => {
  const cl = createGestureClassifier();
  const a = tapThrough(cl, 80, 90, 1000, 1050);
  const b = tapThrough(cl, 82, 91, 1100, 1150); // 距上一击 100ms<280、距离≈2.2<40
  assert.equal(a.type, 'tap');
  assert.equal(b.type, 'doubleTap');
  assert.deepEqual({ x: b.x, y: b.y }, { x: 82, y: 91 });
});

test('双击窗口边界：间隔 >= doubleTapWindowMs 退化为两次 tap', () => {
  const cl = createGestureClassifier();
  tapThrough(cl, 80, 90, 1000, 1050);
  const b = tapThrough(cl, 80, 90, 1000 + D.doubleTapWindowMs + 50, 1000 + D.doubleTapWindowMs + 100);
  assert.equal(b.type, 'tap');
});

test('双击距离边界：位移 >= doubleTapMaxDistPx 退化为两次 tap', () => {
  const cl = createGestureClassifier();
  tapThrough(cl, 0, 0, 1000, 1050);
  const b = tapThrough(cl, D.doubleTapMaxDistPx + 5, 0, 1100, 1150);
  assert.equal(b.type, 'tap');
});

test('三连击消耗：第三击不产生 doubleTap（lastTapT 归零）', () => {
  const cl = createGestureClassifier();
  assert.equal(tapThrough(cl, 10, 10, 1000, 1050).type, 'tap');
  assert.equal(tapThrough(cl, 10, 10, 1100, 1150).type, 'doubleTap'); // 消耗掉
  assert.equal(tapThrough(cl, 10, 10, 1200, 1250).type, 'tap'); // 第三击重新起 tap
});

test('reset：清空待配对的 down（touchcancel / 页面隐藏打断）', () => {
  const cl = createGestureClassifier();
  cl.push({ phase: 'down', x: 10, y: 10, timeMs: 0 });
  cl.reset();
  assert.equal(cl.push({ phase: 'up', x: 200, y: 10, timeMs: 50 }), null); // down 已被清，不判 swipe
});

test('自定义阈值覆盖默认（只改滑动最小距离）', () => {
  const cl = createGestureClassifier({ swipeMinPx: 100 });
  assert.equal(tapThrough(cl, 0, 0, 0, 40, 50, 0).type, 'tap'); // 50 < 100 不再是 swipe
  assert.equal(tapThrough(cl, 0, 0, 0, 40, 150, 0).type, 'swipe');
});
