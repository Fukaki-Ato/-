/**
 * 主流程测试（fake views，无 UI/GL）：
 * - 最佳分（对应 M2 审计：键名笔误迁移 + 脏值兜底）；
 * - 页面流转接线：start 两入口（微信登录仅 env==='wx' 可用、失败停留 + 反馈）、入口方式本机记忆、
 *   结算/局内 Esc 回选角页。content 未加载时 run/select 的 onEnter 空转，可直接驱动场景机。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameFlow, BEST_KEY } from '../packages/game/dist/flow/mainFlow.js';
import { ENTRY_KEY } from '../packages/game/dist/flow/session.js';

const LEGACY_KEY = 'thunderrun:b\u2026st'; // 旧版笔误键：b + U+2026 省略号 + st

function makeFlow(initial, { env, extras } = {}) {
  const store = new Map(Object.entries(initial ?? {}));
  const seen = { best: null, summary: null, start: null, result: null, busy: [], feedback: [] };
  const inputs = [];
  const adapter = {
    env,
    extras,
    storage: {
      get: k => (store.has(k) ? store.get(k) : null),
      set: (k, v) => { store.set(k, v); },
      remove: k => { store.delete(k); },
    },
    onInput: cb => { inputs.push(cb); return () => {}; },
  };
  const views = {
    renderBoot: () => ({ setStatus() {} }),
    renderStart: actions => {
      seen.start = actions;
      return {
        setBusy: b => seen.busy.push(b),
        setFeedback: (text, isError) => seen.feedback.push({ text, isError }),
      };
    },
    renderSelect: () => {},
    mountHud: () => ({ update() {}, dispose() {} }),
    renderResult: (summary, best, actions) => { seen.summary = summary; seen.best = best; seen.result = actions; },
    toast: () => {},
  };
  const flow = createGameFlow({ adapter, views, configResolve: n => `./${n}.json` });
  const key = code => inputs.forEach(cb => cb({ type: 'key', code, phase: 'down' }));
  return { flow, store, seen, key };
}

const tick = () => new Promise(r => setImmediate(r));

const summaryOf = score => ({
  t: 1, distance: 10, coins: 0, nearMiss: 0, hits: 0, score, alive: true, casts: 0, charId: 'char_volt',
});

test('BEST_KEY 是不含省略号的修正键', () => {
  assert.equal(BEST_KEY, 'thunderrun:best');
  assert.ok(!BEST_KEY.includes('\u2026'));
});

test('旧键迁移：新键缺失且旧键为有效值 → 校验后写入新键并删旧键', () => {
  const { flow, store, seen } = makeFlow({ [LEGACY_KEY]: '42' });
  flow.machine.go('result', summaryOf(10));
  assert.equal(seen.best, 42);
  assert.equal(store.get(BEST_KEY), '42');
  assert.equal(store.has(LEGACY_KEY), false);
  assert.equal(seen.summary.score, 10);
});

test('旧键迁移：脏值按 0，不写入新键且旧键清除（不把脏值当好成绩）', () => {
  const { flow, store, seen } = makeFlow({ [LEGACY_KEY]: 'oops' });
  flow.machine.go('result', summaryOf(7));
  assert.equal(seen.best, 0);
  assert.equal(store.get(BEST_KEY), '7'); // 由 result 写入路径落盘
  assert.equal(store.has(LEGACY_KEY), false);
});

test('新键脏值（NaN/Infinity/负数）按 0，真实分数可正常刷新纪录', () => {
  for (const dirty of ['abc', 'Infinity', '-5', '']) {
    const { flow, store, seen } = makeFlow({ [BEST_KEY]: dirty });
    flow.machine.go('result', summaryOf(9));
    assert.equal(seen.best, 0, `dirty=${JSON.stringify(dirty)}`);
    assert.equal(store.get(BEST_KEY), '9', `dirty=${JSON.stringify(dirty)}`);
  }
});

test('平纪录不覆盖好值：score <= best 时不重写存储，best 原样透传视图', () => {
  const { flow, store, seen } = makeFlow({ [BEST_KEY]: '100', [LEGACY_KEY]: '5' });
  flow.machine.go('result', summaryOf(100));
  assert.equal(seen.best, 100);
  assert.equal(store.get(BEST_KEY), '100'); // 未被旧键 5 覆盖，也未因平纪录重写
});

// ---------------- 页面流转接线 ----------------

test('start：web 环境微信登录不可用（即便注入了 extras.login 游客兜底），onWechat 空转', async () => {
  let calls = 0;
  const { flow, store, seen } = makeFlow({}, { env: 'web', extras: { login: async () => { calls++; return { openid: 'g', isGuest: true }; } } });
  flow.machine.go('start');
  assert.equal(seen.start.wechatAvailable, false);
  seen.start.onWechat();
  await tick();
  assert.equal(calls, 0);
  assert.equal(flow.machine.current(), 'start');
  assert.equal(store.has(ENTRY_KEY), false);
});

test('start：游客登录 → select 并记住 guest', () => {
  const { flow, store, seen } = makeFlow();
  flow.machine.go('start');
  seen.start.onGuest();
  assert.equal(flow.machine.current(), 'select');
  assert.equal(store.get(ENTRY_KEY), 'guest');
});

test('start：wx 微信登录成功 → select 并记住 wechat；登录中重复点击不重复调用', async () => {
  let calls = 0;
  const { flow, store, seen } = makeFlow({}, { env: 'wx', extras: { login: async () => { calls++; return { openid: 'wx-guest-1', isGuest: true }; } } });
  flow.machine.go('start');
  assert.equal(seen.start.wechatAvailable, true);
  seen.start.onWechat();
  seen.start.onWechat();
  seen.start.onGuest(); // 登录进行中：游客入口也被锁
  assert.deepEqual(seen.busy, [true]);
  await tick();
  assert.equal(calls, 1);
  assert.equal(flow.machine.current(), 'select');
  assert.equal(store.get(ENTRY_KEY), 'wechat');
});

test('start：wx 微信登录失败 → 停留 start、错误反馈、解锁；不记入口', async () => {
  const { flow, store, seen } = makeFlow({}, { env: 'wx', extras: { login: async () => { throw new Error('boom'); } } });
  flow.machine.go('start');
  seen.start.onWechat();
  await tick();
  assert.equal(flow.machine.current(), 'start');
  assert.deepEqual(seen.busy, [true, false]);
  const last = seen.feedback.at(-1);
  assert.equal(last.isError, true);
  assert.ok(last.text.includes('微信登录失败') && last.text.includes('boom'), last.text);
  assert.equal(store.has(ENTRY_KEY), false);
});

test('start：登录返回前已离开开始页 → 结果丢弃，不强行跳转', async () => {
  let resolve;
  const { flow, store, seen } = makeFlow({}, { env: 'wx', extras: { login: () => new Promise(r => { resolve = r; }) } });
  flow.machine.go('start');
  seen.start.onWechat();
  flow.machine.go('result', summaryOf(1));
  resolve({ openid: 'x', isGuest: true });
  await tick();
  assert.equal(flow.machine.current(), 'result');
  assert.equal(store.has(ENTRY_KEY), false);
});

test('导航：局内 Esc 与结算「返回选角」都回 select', () => {
  const { flow, seen, key } = makeFlow();
  flow.machine.go('run'); // content 未加载：run.onEnter 空转
  key('Escape');
  assert.equal(flow.machine.current(), 'select');
  flow.machine.go('result', summaryOf(3));
  seen.result.onSelect();
  assert.equal(flow.machine.current(), 'select');
  key('Escape'); // 非 run 场景 Esc 无效
  assert.equal(flow.machine.current(), 'select');
});
