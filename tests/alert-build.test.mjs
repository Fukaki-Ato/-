/**
 * buildAlert 优先级单元测试（B-9 A 线 + 特殊事件 2.0，渲染层纯函数——import 构建产物，路径同 settings-scene/adPosters 口径）。
 * 优先级高→低：追击者逼近(urgency 3 红) > 时空隧道剩余(4 紫) > 反重力区内倒计时(2) > 低重力带剩余(5 薄荷) >
 * 翻转区预告(2) > 喷发预警(1)；全空=null（隐藏横幅）；fx 不由 buildAlert 产出（瞬间全屏闪由 runnerScene 组装 alert 时附加）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAlert } from '../packages/game/dist/render/runTheme.js';

const base = { surgeWarn: 0, flipWarn: 0, zoneRemain: 0, chaserDist: 80, warpRemain: 0, lowGravRemain: 0 }; // 全静默基准（chaserDist 80=远离）

test('buildAlert 优先级：追击者逼近 > 区内倒计时 > 翻转区预告 > 喷发预警', () => {
  // 全部同真时逐级压过：追击者盖过一切
  assert.deepEqual(buildAlert({ surgeWarn: 1, flipWarn: 30, zoneRemain: 40, chaserDist: 15 }),
    { text: '追击者逼近 · 快跑！', urgency: 3 });
  // 区内倒计时盖过预告与喷发（区内是常态条，Math.ceil 向上取整）
  assert.deepEqual(buildAlert({ ...base, surgeWarn: 1, flipWarn: 30, zoneRemain: 40.4 }),
    { text: '反重力区 · 剩余 41m', urgency: 2 });
  // 翻转区预告盖过喷发（翻转更需要提前预告，口径同旧版）
  assert.deepEqual(buildAlert({ ...base, surgeWarn: 1, flipWarn: 30.2 }),
    { text: '重力翻转区 · 31m', urgency: 2 });
  assert.deepEqual(buildAlert({ ...base, surgeWarn: 0.8 }), { text: '喷发预警', urgency: 1 });
});

test('buildAlert 边界：无告警=null；flipWarn>60 出窗不预告、=60 在窗内；chaserDist=20 恰触发', () => {
  assert.equal(buildAlert(base), null, '全空返回 null（HUD 隐藏横幅）');
  assert.equal(buildAlert({ ...base, flipWarn: 60.1 }), null, 'flipWarn>60 超出预告窗');
  assert.deepEqual(buildAlert({ ...base, flipWarn: 60 }), { text: '重力翻转区 · 60m', urgency: 2 });
  assert.deepEqual(buildAlert({ ...base, chaserDist: 20 }), { text: '追击者逼近 · 快跑！', urgency: 3 }, '≤20 边界含等号');
  assert.equal(buildAlert({ ...base, chaserDist: 20.1 }), null, '>20 不告警');
});

test('buildAlert 不产出 fx：翻转瞬间闪屏强度由 runnerScene 组装 alert 时附加', () => {
  for (const r of [
    buildAlert({ ...base, chaserDist: 10 }),
    buildAlert({ ...base, zoneRemain: 10 }),
    buildAlert({ ...base, flipWarn: 10 }),
    buildAlert({ ...base, surgeWarn: 1 }),
  ]) {
    assert.ok(r, '各优先级均应命中');
    assert.equal('fx' in r, false, 'fx 字段不得由 buildAlert 产生');
  }
});

test('buildAlert 特殊事件 2.0：warpRemain(4 紫) 优先于区内倒计时/翻转预告；低重力带(5 薄荷) 压过预告与喷发；追击者仍最高；全空=null', () => {
  // 时空隧道剩余压过区内倒计时/翻转预告/喷发（区内同时只活一条主事件，隧道优先级更高）
  assert.deepEqual(buildAlert({ ...base, warpRemain: 45.4, zoneRemain: 10, flipWarn: 30, surgeWarn: 1 }),
    { text: '时空隧道 · 剩余 46m', urgency: 4 });
  // 低重力带压过翻转预告与喷发，但让位给区内倒计时（zoneRemain 排在前面）
  assert.deepEqual(buildAlert({ ...base, lowGravRemain: 20.2, flipWarn: 30, surgeWarn: 1 }),
    { text: '低重力带 · 剩余 21m', urgency: 5 });
  assert.deepEqual(buildAlert({ ...base, zoneRemain: 10, lowGravRemain: 20 }),
    { text: '反重力区 · 剩余 10m', urgency: 2 }, '区内倒计时压过低重力带');
  // 追击者仍最高：全部同真时盖过一切
  assert.deepEqual(buildAlert({ surgeWarn: 1, flipWarn: 30, zoneRemain: 40, warpRemain: 10, lowGravRemain: 10, chaserDist: 15 }),
    { text: '追击者逼近 · 快跑！', urgency: 3 });
  // 新字段全空（含显式 0）仍返回 null
  assert.equal(buildAlert({ ...base, warpRemain: 0, lowGravRemain: 0 }), null, 'warp/低重力都为 0 时全空=null');
});
