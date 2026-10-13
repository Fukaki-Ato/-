import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeDom, importWebModule } from './dom-fixture.mjs';
import { RunnerSim } from '@tr/game/core/sim/runnerSim.js';
import { recordMissionRun } from '@tr/game/core/missions/recorder.js';
import { createRunSession } from '@tr/game/flow/runSession.js';
import { leaderboardRulesId } from '@tr/game/flow/leaderboard.js';

const { createMissionPanel } = await importWebModule('../apps/web/src/missionPanel.ts');
const { MissionApi } = await importWebModule('../apps/web/src/missionApi.ts');
const { createMissionIntegration } = await importWebModule('../apps/web/src/missionIntegration.ts');
const tick = () => new Promise(resolve => setImmediate(resolve));
const makeSnapshot = () => ({
  serverTime: Date.UTC(2026, 9, 12), wallet: { coin: 400, shard_volt: 5, key: 1 },
  daily: { periodId: '2026-10-12', resetsAt: Date.UTC(2026, 9, 12, 16), missions: [
    { id: 'mruns', title: '完成5局酷跑', metric: 'runs', progress: 5, target: 5, reward: { coin: 400 }, claimed: false },
    { id: 'mslide', title: '滑铲30次', metric: 'slides', progress: 1, target: 30, reward: { coin: 450 }, claimed: false },
  ] },
  weekly: { periodId: '2026-10-12', resetsAt: Date.UTC(2026, 9, 18, 16), missions: [
    { id: 'wchars', title: '使用3位角色', metric: 'charactersPlayed', progress: 1, target: 3, reward: { key: 2 }, claimed: false },
  ] },
});

test('QA mission integration stays untracked; normal runs keep their mission start/finish path', async t => {
  const { content } = fakeDom(t);
  const originalFetch = globalThis.fetch, originalStorage = globalThis.localStorage;
  t.after(() => { globalThis.fetch = originalFetch; globalThis.localStorage = originalStorage; });
  const calls = [];
  globalThis.localStorage = { getItem: () => null, setItem() {} };
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return Response.json(url.endsWith('/runs') ? { runId: 'mission-run' } : makeSnapshot());
  };
  const qaSim = new RunnerSim(content, 1234, 'char_volt');
  const oldStep = qaSim.step, oldAction = qaSim.applyAction;
  const qa = createMissionIntegration(true);
  const stopQa = qa.trackRun(qaSim, 1234); qaSim.step(); stopQa(); await tick();
  assert.equal(qaSim.step, oldStep); assert.equal(qaSim.applyAction, oldAction);
  assert.equal(calls.length, 0, 'known QA mode must not call the task API or record reward progress');
  const normalSim = new RunnerSim(content, 1234, 'char_volt');
  const normal = createMissionIntegration(false);
  const stopNormal = normal.trackRun(normalSim, 1234); normalSim.applyAction('slide'); normalSim.step(); stopNormal();
  for (let i = 0; i < 5; i++) await tick();
  assert.ok(calls.some(call => call.url.endsWith('/runs')));
  const finish = calls.find(call => call.url.endsWith('/finish')); assert.ok(finish);
  assert.equal(JSON.parse(finish.options.body).frames, 1);
  assert.deepEqual(JSON.parse(finish.options.body).actions, [{ frame: 0, action: 'slide' }]);
});

test('recorder replays exact fixed steps, ignores death animation and counts successful slides', t => {
  const { content } = fakeDom(t);
  const sim = new RunnerSim(content, 1234, 'char_volt');
  const finish = recordMissionRun(sim);
  for (let i = 0; i < 900; i++) {
    if (i % 80 === 0) sim.applyAction('slide');
    if (i % 140 === 0) sim.applyAction('skill');
    sim.step(); sim.drainEvents();
  }
  const payload = finish();
  const replay = new RunnerSim(content, 1234, 'char_volt');
  let index = 0;
  for (let frame = 0; frame < payload.frames; frame++) {
    while (payload.actions[index]?.frame === frame) replay.applyAction(payload.actions[index++].action);
    replay.step(); replay.drainEvents();
  }
  assert.deepEqual(replay.summary(), sim.summary());
  assert.deepEqual(replay.missionStats, sim.missionStats);
  assert.ok(sim.missionStats.slides > 0);
  assert.ok(payload.frames <= 900);
});

test('mission tracking coexists with server-seeded leaderboard recording and cancelled preflight', async t => {
  const { content } = fakeDom(t);
  let sim, callbacks, mission, ranked, release = 0, started = 0;
  const ticket = { runId: 'ranked-run', seed: 1234, rulesId: leaderboardRulesId(content) };
  const deps = {
    content, charId: 'char_volt',
    adapter: { canvas: { mainCanvas: () => ({}), windowSize: () => ({ width: 390, height: 844, dpr: 1 }) } },
    views: { renderBoot: () => ({ setStatus() {} }), mountHud: () => ({ update() {}, dispose() {} }) },
    service: { begin: async () => ticket, submit: async payload => { ranked = payload; return { accepted: true }; },
      cancel: async () => { release++; } },
    trackRun: (runner, seed) => {
      started++; assert.equal(seed, ticket.seed);
      const finish = recordMissionRun(runner); return () => { mission = finish(); };
    },
    createScene: (_host, _adapter, runner, _content, cb) => { sim = runner; callbacks = cb; return { dispose() {} }; },
    onSeed() {}, onDeath() {}, onCast() {}, onPickup() {},
  };
  const session = createRunSession({ ...deps, onEnd: () => session.dispose() });
  await tick();
  sim.applyAction('slide');
  for (let i = 0; i < 600; i++) { sim.step(); sim.drainEvents(); }
  callbacks.onEnd(sim.summary());
  assert.equal(mission.frames, ranked.frames);
  assert.deepEqual(mission.actions, ranked.inputs);
  assert.equal(started, 1); assert.equal(release, 0);
  const cancelled = createRunSession({ ...deps, onEnd() {} });
  cancelled.dispose(); await tick();
  assert.equal(started, 1, 'cancelled preflight must not begin mission tracking');
  assert.equal(release, 1);
});

test('mission panel switches periods, guards claims, displays wallet and disposes late requests', async t => {
  const { body, content, byClass, all } = fakeDom(t);
  const snapshot = makeSnapshot();
  let claimCalls = 0, resolveClaim;
  const api = { feedback: '', load: async () => snapshot, claim: (period, periodId, id) => {
    claimCalls++; assert.deepEqual([period, periodId, id], ['daily', '2026-10-12', 'mruns']);
    return new Promise(resolve => { resolveClaim = resolve; });
  } };
  let back = 0;
  const dispose = createMissionPanel(api, content, () => back++);
  await tick();
  assert.equal(byClass(body, 'mission-card').length, 2);
  const claims = byClass(body, 'mission-claim');
  assert.equal(claims[0].disabled, false);
  assert.equal(claims[1].disabled, true);
  claims[0].click(); claims[0].click();
  assert.equal(claimCalls, 1);
  assert.ok(byClass(body, 'mission-claim').every(button => button.disabled));
  snapshot.daily.missions[0].claimed = true;
  resolveClaim(snapshot); await tick();
  assert.equal(byClass(body, 'mission-claim')[0].textContent, '已领取');
  assert.match(byClass(body, 'mission-wallet')[0].textContent, /金币 400/);
  byClass(body, 'mission-tab')[1].click();
  assert.equal(byClass(body, 'mission-card').length, 1);
  assert.match(byClass(body, 'mission-list')[0].textContent, /使用3位角色/);
  all(body).find(node => node.getAttribute('aria-label') === '返回上一页').click();
  assert.equal(back, 1);
  dispose(); assert.equal(byClass(body, 'mobile-missions').length, 0);

  let resolveLoad;
  const late = createMissionPanel({ load: () => new Promise(resolve => { resolveLoad = resolve; }) }, content, () => {});
  late(); resolveLoad(snapshot); await tick();
  assert.equal(byClass(body, 'mobile-missions').length, 0);
});

test('mission panel offers retry on service errors', async t => {
  const { body, content, byClass } = fakeDom(t);
  let fails = true;
  const api = { load: async () => { if (fails) throw new Error('离线'); return makeSnapshot(); } };
  const dispose = createMissionPanel(api, content, () => {});
  await tick(); assert.match(byClass(body, 'mission-status')[0].textContent, /离线/);
  fails = false; byClass(body, 'mission-refresh')[0].click(); await tick();
  assert.equal(byClass(body, 'mission-card').length, 2);
  dispose();
});

test('claim failure preserves the task and allows retry without optimistic rewards', async t => {
  const { body, content, byClass } = fakeDom(t);
  const snapshot = makeSnapshot();
  const api = { load: async () => snapshot, claim: async () => { throw new Error('周期已更新'); } };
  const dispose = createMissionPanel(api, content, () => {});
  await tick(); byClass(body, 'mission-claim')[0].click(); await tick();
  assert.match(byClass(body, 'mission-status')[0].textContent, /周期已更新/);
  assert.equal(byClass(body, 'mission-claim')[0].disabled, false);
  assert.equal(snapshot.wallet.coin, 400);
  assert.equal(snapshot.daily.missions[0].claimed, false);
  dispose();
});

test('client persists retries and sends no client-authored scores', async t => {
  const originalFetch = globalThis.fetch, originalStorage = globalThis.localStorage;
  t.after(() => { globalThis.fetch = originalFetch; globalThis.localStorage = originalStorage; });
  const store = new Map();
  globalThis.localStorage = { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) };
  let offline = true, finishes = 0;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/finish')) {
      finishes++;
      if (offline) throw new Error('offline');
      assert.deepEqual(JSON.parse(options.body), { frames: 10, actions: [{ frame: 0, action: 'slide' }] });
    }
    return Response.json(url.endsWith('/runs') ? { runId: 'r1' } : makeSnapshot());
  };
  const api = new MissionApi();
  assert.equal(await api.start(-1, 'char_volt'), 'r1');
  await assert.rejects(api.finish({ runId: 'r1', frames: 10, actions: [{ frame: 0, action: 'slide' }] }), /暂时不可用/);
  assert.equal(JSON.parse([...store.values()][0]).length, 1);
  offline = false;
  const restored = new MissionApi();
  await restored.load();
  assert.equal(finishes, 2);
  assert.equal(JSON.parse([...store.values()][0]).length, 0);
  assert.equal(calls.find(call => call.url.endsWith('/runs')).options.credentials, 'same-origin');
  assert.equal(JSON.parse(calls.find(call => call.url.endsWith('/runs')).options.body).seed, 4294967295);
});
