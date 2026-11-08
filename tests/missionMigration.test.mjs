import nodeTest from 'node:test';
import assert from 'node:assert/strict';
import { loadMissionContent } from '../apps/server/src/content.mjs';
import { RunnerSim } from '../packages/game/dist/core/sim/runnerSim.js';
const [major, minor] = process.versions.node.split('.').map(Number);
const sqliteSupported = major > 22 || (major === 22 && minor >= 13);
const test = sqliteSupported ? nodeTest : nodeTest.skip;
const { MissionStore } = sqliteSupported ? await import('../apps/server/src/store.mjs') : {};
const { MissionService } = sqliteSupported ? await import('../apps/server/src/mission-service.mjs') : {};

function setup(t) {
  const content = structuredClone(loadMissionContent());
  const store = new MissionStore(':memory:');
  t.after(() => store.close());
  const clock = { now: Date.UTC(2026, 10, 8, 4) };
  store.createUser('player', clock.now);
  const service = new MissionService({ store, content, now: () => clock.now, minRunSeconds: 0 });
  return { content, store, service, clock };
}
function legacyDaily(store, content, periodId, { claimed = false, progress = 1 } = {}) {
  const pool = content.economy.params.missions.daily.pool;
  const definitions = ['mdist', 'mslide', 'mnohit'].map(id => structuredClone(pool.find(m => m.id === id)));
  store.db.prepare(`UPDATE mission_periods SET definitions_json = ?, progress_json = ?, claimed_json = ?
    WHERE user_id = ? AND period_type = 'daily' AND period_id = ?`).run(JSON.stringify(definitions),
    JSON.stringify({ mdist: 123, mslide: 4, mnohit: progress }), JSON.stringify({ mslide: true, mnohit: claimed }), 'player', periodId);
  return store.getPeriod('player', 'daily', periodId);
}

test('actual config only assigns achievable daily missions and retains all weekly tasks', t => {
  const { store, service } = setup(t);
  for (let i = 0; i < 64; i++) {
    const id = `user-${i}`;
    store.createUser(id, 0);
    const snapshot = service.snapshot(id);
    assert.equal(snapshot.daily.missions.length, 3);
    assert.equal(snapshot.weekly.missions.length, 4);
    assert.equal(snapshot.daily.missions.some(m => m.metric === 'cleanRuns'), false);
    assert.equal(snapshot.daily.missions.find(m => m.id === 'mscore').metric, 'score');
  }
});

test('legacy unclaimed task migrates once, preserving identity/reward and unrelated state', t => {
  const { content, store, service } = setup(t);
  const id = service.snapshot('player').daily.periodId;
  const old = legacyDaily(store, content, id);
  const migrated = service.snapshot('player');
  const replacement = migrated.daily.missions.find(m => m.id === 'mnohit');
  assert.equal(replacement.metric, 'score');
  assert.equal(replacement.title, '达到目标分数');
  assert.equal(replacement.target, content.economy.params.missions.daily.pool.find(m => m.id === 'mscore').target);
  assert.equal(replacement.progress, 0);
  assert.deepEqual(replacement.reward, old.definitions[2].reward);
  const data = store.getPeriod('player', 'daily', id);
  assert.deepEqual(data.definitions.slice(0, 2), old.definitions.slice(0, 2));
  assert.deepEqual(data.progress, { mdist: 123, mslide: 4, mnohit: 0 });
  assert.deepEqual(data.claimed, old.claimed);
  assert.deepEqual(service.snapshot('player'), migrated);
  store.saveProgress('player', 'daily', id, { ...data.progress, mnohit: replacement.target });
  const claim = { period: 'daily', periodId: id, missionId: 'mnohit' };
  assert.equal(service.claim('player', claim).wallet.key, 1);
  assert.equal(service.claim('player', claim).wallet.key, 1);
  const restarted = new MissionService({ store, content });
  assert.equal(restarted.ensurePeriod('player', 'daily', id).progress.mnohit, replacement.target);
});

test('already claimed legacy tasks never reset or pay twice', t => {
  const { content, store, service } = setup(t);
  const id = service.snapshot('player').daily.periodId;
  const before = legacyDaily(store, content, id, { claimed: true, progress: 2 });
  store.addWallet('player', 'key', 1);
  service.snapshot('player');
  assert.deepEqual(store.getPeriod('player', 'daily', id), before);
  assert.equal(service.claim('player', { period: 'daily', periodId: id, missionId: 'mnohit' }).wallet.key, 1);
});

test('migration compare-and-swap cannot overwrite a concurrent claim or progress update', t => {
  const { content, store, service } = setup(t);
  const id = service.snapshot('player').daily.periodId;
  const before = legacyDaily(store, content, id);
  store.saveClaimed('player', 'daily', id, { ...before.claimed, mnohit: true });
  assert.equal(store.replacePeriod('player', 'daily', id, before, [], {}), false);
  const claimed = store.getPeriod('player', 'daily', id);
  store.saveProgress('player', 'daily', id, { ...claimed.progress, mdist: 456 });
  assert.equal(store.replacePeriod('player', 'daily', id, claimed, [], {}), false);
  assert.equal(store.getPeriod('player', 'daily', id).progress.mdist, 456);
  assert.equal(store.getPeriod('player', 'daily', id).claimed.mnohit, true);
});

test('in-flight legacy run migrates before scoring, and live truncation still earns nothing', async t => {
  const { content, store, service, clock } = setup(t);
  const { runId } = service.startRun('player', { seed: 123, charId: 'char_volt' });
  const id = service.snapshot('player').daily.periodId;
  legacyDaily(store, content, id);
  const sim = new RunnerSim(content, 123, 'char_volt');
  let frames = 0;
  while (sim.state.alive && frames < 10000) { sim.step(); sim.drainEvents(); frames++; }
  assert.equal(sim.state.alive, false);
  clock.now += frames * 1000 / 60 + 1000;
  await service.finishRun('player', runId, { frames, actions: [] });
  assert.equal(store.getPeriod('player', 'daily', id).progress.mnohit, sim.summary().score);
  const before = store.getPeriod('player', 'daily', id);
  const next = service.startRun('player', { seed: 123, charId: 'char_volt' });
  clock.now += 2000;
  await service.finishRun('player', next.runId, { frames: 60, actions: [] });
  assert.deepEqual(store.getPeriod('player', 'daily', id), before);
});

test('configuration fails early if a daily tier has no achievable alternative', t => {
  const { content, store } = setup(t);
  content.economy.params.missions.daily.pool = content.economy.params.missions.daily.pool.filter(m => m.id !== 'mscore');
  assert.throws(() => new MissionService({ store, content }), /no hard mission/);
});

test('migration retries with fresh state when another writer updates the period', t => {
  const { content, store, service } = setup(t);
  const id = service.snapshot('player').daily.periodId;
  legacyDaily(store, content, id);
  const replace = store.replacePeriod.bind(store);
  let calls = 0;
  store.replacePeriod = (...args) => {
    if (++calls === 1) {
      const data = store.getPeriod('player', 'daily', id);
      store.saveProgress('player', 'daily', id, { ...data.progress, mdist: 789 });
    }
    return replace(...args);
  };
  service.snapshot('player');
  assert.equal(calls, 2);
  const data = store.getPeriod('player', 'daily', id);
  assert.equal(data.progress.mdist, 789);
  assert.equal(data.progress.mnohit, 0);
  assert.equal(data.definitions[2].metric, 'score');
});

test('completed but unclaimed legacy tasks retain their earned reward and original progress', t => {
  const { content, store, service } = setup(t);
  const id = service.snapshot('player').daily.periodId;
  const before = legacyDaily(store, content, id, { progress: 2 });
  service.snapshot('player');
  assert.deepEqual(store.getPeriod('player', 'daily', id), before);
  const claim = { period: 'daily', periodId: id, missionId: 'mnohit' };
  assert.equal(service.claim('player', claim).wallet.key, 1);
  assert.equal(service.claim('player', claim).wallet.key, 1);
  const after = store.getPeriod('player', 'daily', id);
  assert.deepEqual(after.definitions, before.definitions);
  assert.deepEqual(after.progress, before.progress);
  assert.equal(after.claimed.mnohit, true);
});

test('persistent migration conflicts fail safely after bounded retries', t => {
  const { content, store, service } = setup(t);
  const id = service.snapshot('player').daily.periodId;
  const before = legacyDaily(store, content, id);
  let attempts = 0;
  store.replacePeriod = () => { attempts++; return false; };
  assert.throws(() => service.snapshot('player'), error => error.status === 409);
  assert.equal(attempts, 3);
  assert.deepEqual(store.getPeriod('player', 'daily', id), before);
  assert.deepEqual(store.getWallet('player'), {});
});
