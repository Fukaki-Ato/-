/**
 * buildAlert 优先级单元测试（B-9 A 线 + 特殊事件 2.0，渲染层纯函数——import 构建产物，路径同 settings-scene/adPosters 口径）。
 * 安全预警先于区内状态与瞬间闪屏；urgency 是语义配色，不是优先级。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAlert } from '../packages/game/dist/render/runTheme.js';
import { createRunAlerts } from '../packages/game/dist/render/runAlerts.js';

const base = { surgeWarn: 0, flipWarn: 0, zoneRemain: 0, chaserDist: 80, warpRemain: 0, lowGravRemain: 0 }; // 全静默基准（chaserDist 80=远离）

test('buildAlert 安全优先级：追击者逼近 > 喷发预警 > 翻转区预告 > 区内状态', () => {
  // 全部同真时逐级压过：追击者盖过一切
  assert.deepEqual(buildAlert({ ...base, surgeWarn: 1, flipWarn: 30, zoneRemain: 40, chaserDist: 15 }),
    { text: '追击者逼近 · 快跑！', urgency: 3 });
  // 一秒喷发预警不能被区内状态盖住
  assert.deepEqual(buildAlert({ ...base, surgeWarn: 1, flipWarn: 30, zoneRemain: 40.4 }),
    { text: '喷发预警', urgency: 1 });
  assert.deepEqual(buildAlert({ ...base, flipWarn: 30.2, zoneRemain: 40.4 }),
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

test('buildAlert 区内状态：隧道 > 反重力 > 低重力，向上取整；不覆盖安全预警', () => {
  assert.deepEqual(buildAlert({ ...base, warpRemain: 45.4, zoneRemain: 10 }),
    { text: '时空隧道 · 剩余 46m', urgency: 4 });
  assert.deepEqual(buildAlert({ ...base, lowGravRemain: 20.2 }),
    { text: '低重力带 · 剩余 21m', urgency: 5 });
  assert.deepEqual(buildAlert({ ...base, zoneRemain: 10, lowGravRemain: 20 }),
    { text: '反重力区 · 剩余 10m', urgency: 2 }, '区内倒计时压过低重力带');
  // 追击者仍最高：全部同真时盖过一切
  assert.deepEqual(buildAlert({ surgeWarn: 1, flipWarn: 30, zoneRemain: 40, warpRemain: 10, lowGravRemain: 10, chaserDist: 15 }),
    { text: '追击者逼近 · 快跑！', urgency: 3 });
  // 新字段全空（含显式 0）仍返回 null
  assert.equal(buildAlert({ ...base, warpRemain: 0, lowGravRemain: 0 }), null, 'warp/低重力都为 0 时全空=null');
  assert.deepEqual(buildAlert({ ...base, warpRemain: 45, surgeWarn: 0.5 }), { text: '喷发预警', urgency: 1 });
  assert.deepEqual(buildAlert({ ...base, lowGravRemain: 20, flipWarn: 5 }), { text: '重力翻转区 · 5m', urgency: 2 });
});

test('flip/warp/coinRain 的瞬间闪不能盖住或染色安全预警', () => {
  const events = [{ type: 'flip', flip: 1, ceilH: 0 }, { type: 'warp', phase: -1 }, { type: 'coinRain', startM: 100 }];
  for (const ev of events) {
    const alerts = createRunAlerts(); alerts.consume(ev);
    for (const safety of [{ chaserDist: 10 }, { surgeWarn: 1 }, { flipWarn: 5 }]) {
      const state = { ...base, ...safety, warpRemain: 30 };
      assert.deepEqual(alerts.current(state), buildAlert(state));
      assert.equal('fx' in alerts.current(state), false, '危险期间不叠庆祝闪屏');
    }
  }
});

test('瞬间反馈按自身时长衰减，结束回落到当前区内状态，金币雨明确是预告', () => {
  const alerts = createRunAlerts();
  alerts.consume({ type: 'warp', phase: 1 });
  assert.deepEqual(alerts.current(base), { text: '时空隧道！', urgency: 4, fx: 1 });
  alerts.update(0.7);
  assert.equal(alerts.current(base).fx, 0.5);
  alerts.update(0.7);
  assert.deepEqual(alerts.current({ ...base, warpRemain: 12 }), { text: '时空隧道 · 剩余 12m', urgency: 4 });
  alerts.consume({ type: 'coinRain', startM: 100 });
  assert.deepEqual(alerts.current(base), { text: '金币雨即将到来', urgency: 5, fx: 0.6 });
  alerts.update(0.6);
  assert.equal(alerts.current(base).fx, 0.3);
  alerts.consume({ type: 'flip', flip: -1, ceilH: 4.6 });
  assert.equal(alerts.current(base).text, '重力翻转！', '新事件替换旧反馈');
  alerts.update(2);
  assert.equal(alerts.current(base), null);
});
