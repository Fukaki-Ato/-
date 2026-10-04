/**
 * 主界面背景循环逻辑单测（issue 验收：对抽出的动画时间/循环逻辑补测，覆盖循环边界
 * 及不同帧间隔）。Web 端背景是 15 秒循环视频，首尾镜头不接，用起点帧覆盖层淡入淡出
 * 掩盖接缝；loopFade 是纯函数，这里用假时钟推进，不建 GL、不碰 DOM。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loopFade, mod, LOOP_FADE_S } from '../packages/game/dist/ui/menuBackdrop.js';

const P = 15.07;

test('loopFade：中段全透明，末段淡入、首段淡出', () => {
  assert.equal(loopFade(P / 2, P), 0, '播放中段不盖起点帧');
  assert.ok(loopFade(P - LOOP_FADE_S / 2, P) > 0.4, '末段淡入到一半以上');
  assert.ok(Math.abs(loopFade(P - 1e-6, P) - 1) < 1e-3, '跳转前一刻几乎全盖');
  assert.ok(loopFade(LOOP_FADE_S / 2, P) > 0.4, '首段淡出中');
  assert.ok(Math.abs(loopFade(LOOP_FADE_S, P)) < 1e-9, '淡出结束回到全透明');
});

test('loopFade：循环边界连续不跳变', () => {
  const before = loopFade(P - 1e-4, P);
  const after = loopFade(0, P);
  assert.ok(Math.abs(before - after) < 0.01, `跳转两侧都接近全盖：${before} vs ${after}`);
  for (const t of [0, 3.7, P - 0.4, P, P + 2.2, 41.9]) {
    assert.ok(Math.abs(loopFade(t, P) - loopFade(t + P, P)) < 1e-9, `跨一个周期取值相同 t=${t}`);
  }
});

test('loopFade：按经过时间推进——不同帧间隔累积到同一 t 结果相同', () => {
  const target = 14.9;
  const run = dt => { let t = 0; let k = 0; while (t < target - 1e-12) { t = Math.min(target, t + dt); k = loopFade(t, P); } return k; };
  const a = run(1 / 60);
  const b = run(1 / 144);
  const c = run(0.0137);
  assert.ok(Math.abs(a - b) < 1e-9 && Math.abs(a - c) < 1e-9, `帧率无关：${a} / ${b} / ${c}`);
});

test('loopFade：参数退化不出 NaN（时长 0、fade 大于周期）', () => {
  for (const [p, f] of [[0, 1.2], [1, 4], [P, 0]]) {
    const k = loopFade(0.3, p, f);
    assert.ok(Number.isFinite(k) && k >= 0 && k <= 1, `p=${p} f=${f} 实得 ${k}`);
  }
});

test('mod：负数取模落回 [0,n)', () => {
  assert.equal(mod(-1, 10), 9);
  assert.equal(mod(-10, 10), 0);
  assert.equal(mod(11, 10), 1);
});
