import test from 'node:test';
import assert from 'node:assert/strict';
import { loadContent } from '../tools/replay/runner.mjs';
import { leaderboardRulesId } from '../packages/game/dist/flow/leaderboard.js';
import { createRunSession } from '../packages/game/dist/flow/runSession.js';
import { createGameFlow } from '../packages/game/dist/flow/mainFlow.js';

const content = loadContent(), tick = () => new Promise(r => setImmediate(r));
const ticket = { runId: 'ticket', seed: 101, rulesId: leaderboardRulesId(content) };
function fixture(options = {}) {
  const seen = { disposed: 0, scenes: 0, submits: [], summary: null };
  const d = {
    content, charId: 'char_volt', adapter: { canvas: { mainCanvas: () => ({}), windowSize: () => ({}) } },
    views: { renderBoot: () => ({ setStatus() {} }), mountHud: () => ({ update() {}, dispose() {} }) },
    service: { begin: async () => ticket, submit: async replay => { seen.submits.push(replay); return { accepted: true }; } },
    createScene: (_host, _adapter, sim, _content, callbacks) => {
      seen.scenes++; seen.sim = sim; seen.callbacks = callbacks;
      return { dispose() { seen.disposed++; } };
    },
    onSeed: seed => { seen.seed = seed; }, onEnd: summary => { seen.summary = summary; },
    onDeath() {}, onCast() {}, onPickup() {}, ...options,
  };
  return { d, seen, session: createRunSession(d) };
}

test('比赛取服务器 seed；完整零金币局上传操作且结算订阅结果', async () => {
  const { session, seen } = fixture();
  await tick();
  assert.equal(seen.seed, ticket.seed);
  seen.sim.applyAction('jump'); seen.sim.step();
  seen.sim.state.alive = false;
  seen.callbacks.onEnd(seen.sim.summary());
  assert.equal(seen.summary.ranking.message, '零金币成绩校验中…');
  const updates = [], off = seen.summary.ranking.subscribe(text => updates.push(text));
  await tick();
  assert.equal(seen.submits[0].runId, ticket.runId);
  assert.equal(seen.submits[0].frames, 1);
  assert.deepEqual(seen.submits[0].inputs, [{ frame: 0, action: 'jump' }]);
  assert.equal(updates.at(-1), '零金币成绩已入全服榜');
  off(); session.dispose();
});

test('吃币局不上传；取消等待不创建场景；服务故障回落普通局', async () => {
  const first = fixture(); await tick();
  first.seen.sim.collectedCoins = 1;
  first.seen.callbacks.onEnd(first.seen.sim.summary());
  await tick(); assert.equal(first.seen.submits.length, 0);
  assert.match(first.seen.summary.ranking.message, /收集了金币/); first.session.dispose();
  let resolve;
  const waiting = fixture({ service: { begin: () => new Promise(r => { resolve = r; }) } });
  waiting.session.dispose(); resolve(ticket); await tick();
  assert.equal(waiting.seen.scenes, 0);
  const unavailable = fixture({ service: { begin: async () => { throw Error('offline'); } } });
  await tick(); assert.equal(unavailable.seen.scenes, 1);
  unavailable.seen.callbacks.onEnd(unavailable.seen.sim.summary());
  assert.match(unavailable.seen.summary.ranking.message, /服务不可用/); unavailable.session.dispose();
});

test('吃币/中途退出/晚到比赛票释放占用；已提交结算不误取消', async () => {
  const released = [];
  const service = { begin: async () => ticket, cancel: async id => released.push(id), submit: async () => ({ accepted: true }) };
  const coin = fixture({ service }); await tick();
  coin.seen.sim.collectedCoins = 1; coin.seen.callbacks.onEnd(coin.seen.sim.summary()); coin.session.dispose();
  assert.equal(released.length, 1);
  const abandoned = fixture({ service }); await tick(); abandoned.session.dispose();
  assert.equal(released.length, 2);
  let resolve;
  const waiting = fixture({ service: { ...service, begin: () => new Promise(r => { resolve = r; }) } });
  waiting.session.dispose(); resolve(ticket); await tick(); assert.equal(released.length, 3);
  const ranked = fixture({ service }); await tick();
  ranked.seen.callbacks.onEnd(ranked.seen.sim.summary()); ranked.session.dispose(); await tick();
  assert.equal(released.length, 3);
});

test('debug/test 不向排行榜取票或提交，配置不匹配不入榜', async () => {
  for (const mode of ['test', 'debug']) {
    let calls = 0;
    const f = fixture({ [mode]: true, service: { begin: async () => { calls++; return ticket; } } });
    assert.equal(f.seen.scenes, 1); assert.equal(calls, 0);
    f.seen.callbacks.onEnd(f.seen.sim.summary());
    assert.match(f.seen.summary.ranking.message, /测试局/); f.session.dispose();
  }
  const f = fixture({ service: { begin: async () => ({ ...ticket, rulesId: 'old' }) } });
  await tick(); assert.equal(f.seen.scenes, 1);
  f.seen.callbacks.onEnd(f.seen.sim.summary());
  assert.match(f.seen.summary.ranking.message, /服务不可用/); f.session.dispose();
});

test('大厅与结算排行榜入口接场景，返回与 Escape 回大厅', async () => {
  const seen = {}, store = new Map(), inputs = [];
  const service = {};
  const views = {
    renderBoot: () => ({ setStatus() {} }),
    renderSelect: (_content, actions) => { seen.select = actions; },
    renderResult: (_summary, _best, actions) => { seen.result = actions; },
    renderLeaderboard: (s, actions) => { assert.equal(s, service); seen.rank = actions; },
  };
  const adapter = { storage: { get: k => store.get(k) ?? null, set: (k, v) => store.set(k, v), remove: k => store.delete(k) },
    fetchJson: async name => content[name], onInput: cb => { inputs.push(cb); return () => {}; } };
  const flow = createGameFlow({ adapter, views, configResolve: name => name, leaderboard: service });
  await flow.boot(); seen.select.onLeaderboard();
  assert.equal(flow.machine.current(), 'leaderboard');
  seen.rank.onBack(); assert.equal(flow.machine.current(), 'select');
  seen.select.onLeaderboard();
  inputs.forEach(cb => cb({ type: 'key', phase: 'down', code: 'Escape' }));
  assert.equal(flow.machine.current(), 'select');
  flow.machine.go('result', { score: 0, coins: 0 }); seen.result.onLeaderboard();
  assert.equal(flow.machine.current(), 'leaderboard');
});
