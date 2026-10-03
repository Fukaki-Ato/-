/**
 * 主界面分层背景动效的时间逻辑单测（issue 验收：覆盖循环边界及不同帧间隔）。
 * 时间→位姿是纯函数，这里用假时钟推进，不建 GL。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loopOffset, gullPose, GULLS, mod } from '../packages/game/dist/ui/menuBackdrop.js';

test('loopOffset：取值恒在 [0,period) 且循环边界连续不跳变', () => {
  const speed = 14, period = 400;
  const T = period / speed;                       // 一个完整循环的秒数
  for (const t of [0, 0.37, 3.1, T - 1e-9, T, T + 1e-9, 2 * T, 17.5]) {
    const o = loopOffset(t, speed, period);
    assert.ok(o >= 0 && o < period, `offset 在 [0,period) 内，t=${t} 实得 ${o}`);
  }
  for (const t of [0.5, 3.3, 9.9]) {
    assert.ok(Math.abs(loopOffset(t, speed, period) - loopOffset(t + T, speed, period)) < 1e-6,
      `跨一个循环回到同一点，t=${t}`);
  }
  // 边界两侧按「模 period 的圆距离」判连续：offset 归零等价于走完一整条，视觉不跳
  const a = loopOffset(T - 0.01, speed, period);
  const b = loopOffset(T + 0.01, speed, period);
  const circ = Math.min(Math.abs(a - b), period - Math.abs(a - b));
  assert.ok(circ < speed * 0.02 + 1e-6, `wrap 两侧圆距离只差两帧位移：${a} → ${b}`);
});

test('loopOffset：按经过时间推进——不同帧间隔累积到同一 t 结果相同', () => {
  const speed = 22, period = 300;
  const target = 12.5;
  const run = dt => { let t = 0; let o = 0; while (t < target - 1e-12) { t = Math.min(target, t + dt); o = loopOffset(t, speed, period); } return o; };
  const fixed60 = run(1 / 60);
  const fixed144 = run(1 / 144);
  const jitter = run(0.0137);
  assert.ok(Math.abs(fixed60 - fixed144) < 1e-9 && Math.abs(fixed60 - jitter) < 1e-9,
    `帧率无关：${fixed60} / ${fixed144} / ${jitter}`);
});

test('gullPose：飞行窗口内淡入淡出、窗口外屏外休息、跨周期连续', () => {
  const g = GULLS[0];
  const fly = g.period * 0.62;
  assert.equal(gullPose(g.delay, g).alpha, 0, '刚飞入时透明');
  assert.equal(gullPose(g.delay + fly / 2, g).alpha, 1, '巡航中段不透明');
  assert.ok(gullPose(g.delay + fly * 0.99, g).alpha < 0.2, '飞出前淡出');
  const rest = gullPose(g.delay + fly + 1, g);
  assert.equal(rest.visible, false, '窗口外屏外休息');
  assert.equal(gullPose(g.delay + g.period, g).alpha, 0, '下一周期起点与上一周期终点同为透明，无跳变');
  // 位置左入右出
  assert.ok(gullPose(g.delay + 0.01, g).x < 0, '从屏幕左外飞入');
  assert.ok(gullPose(g.delay + fly - 0.01, g).x > 1, '从屏幕右外飞出');
});

test('gullPose：三只错峰——同一时刻不会齐飞齐隐', () => {
  const visAt = t => GULLS.map(g => gullPose(t, g).visible);
  const samples = Array.from({ length: 200 }, (_, i) => visAt(i * 0.37));
  assert.ok(samples.some(v => v[0] && !v[1]), '存在 A 飞 B 歇的时刻');
  assert.ok(samples.some(v => v[1] && !v[2]), '存在 B 飞 C 歇的时刻');
  assert.ok(!samples.every(v => v.every(Boolean)), '不会三只全程同框');
  assert.ok(samples.some(v => v.some(Boolean)), '任意长窗口内总有鸟在场');
});

test('mod：负数取模落回 [0,n)', () => {
  assert.equal(mod(-1, 10), 9);
  assert.equal(mod(-10, 10), 0);
  assert.equal(mod(11, 10), 1);
});
