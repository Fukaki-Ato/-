import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import * as simulation from '../cloudfunctions/thunder-api/simulation-entry.mjs';
import { RunnerSim } from '../packages/game/dist/core/sim/runnerSim.js';
const require = createRequire(import.meta.url);
const { createCloudBaseStore, COLLECTION } = require('../cloudfunctions/thunder-api/cloudbase-store.cjs');
const { RUNS, RECORDS, META } = require('../cloudfunctions/thunder-api/run-store.cjs');
const { createProfileHandler, initialContent, playerIdFor } = require('../cloudfunctions/thunder-api/profile.cjs');
const { createRunHandler } = require('../cloudfunctions/thunder-api/run-api.cjs');
const { validateConfig } = require('../cloudfunctions/thunder-api/welfare-policy.cjs');
const start = Date.parse('2026-11-06T00:00:00Z'), playerId = playerIdFor('wx-test', 'alice');

// Only test-local memory is used. Exercise the production transaction adapter,
// with snapshot isolation, conflict retries, staged writes and SDK-like metadata.
function fixture(runtime = simulation, initialTime = start) {
  const content = initialContent(runtime.content.characters, runtime.themes);
  const rows = new Map(), versions = new Map(), state = { failWrite: 0, failCommit: false, conflicts: 0, replays: 0 };
  const doc = (table, id, snapshot = rows, staged, reads, seen = versions) => {
    const key = `${table}/${id}`, data = () => structuredClone(staged?.get(key) ?? snapshot.get(key));
    const set = value => { assert.equal(value._id, undefined); if (--state.failWrite === 0) throw new Error('secret write error'); staged.set(key, structuredClone(value)); };
    return { async get() { reads?.set(key, seen.get(key) ?? 0); const value = data(); return { data: value ? { ...value, _id: id } : null }; },
      async set({ data: value }) { set(value); }, async update({ data: value }) { set({ ...data(), ...value }); } };
  };
  const db = { collection: table => ({ doc: id => doc(table, id) }), async runTransaction(callback) {
    for (let attempt = 0; attempt < 20; attempt++) {
      const staged = new Map(), reads = new Map(), snapshot = structuredClone(rows), seen = new Map(versions);
      const result = await callback({ collection: table => ({ doc: id => doc(table, id, snapshot, staged, reads, seen) }) });
      if (state.failCommit) throw new Error('secret commit error');
      if ([...reads].some(([key, version]) => version !== (versions.get(key) ?? 0))) { state.conflicts++; continue; }
      for (const [key, value] of staged) { rows.set(key, value); versions.set(key, (versions.get(key) ?? 0) + 1); }
      return structuredClone(result);
    }
    throw new Error('conflicts exhausted');
  } };
  const store = createCloudBaseStore({ database: () => db });
  let time = initialTime, serial = 0;
  const wrapped = { ...runtime, replayRun(...args) { state.replays++; return runtime.replayRun(...args); } };
  const call = createProfileHandler({ store, content, getAppId: () => 'wx-test',
    getWXContext: () => ({ APPID: 'wx-test', OPENID: 'alice' }), now: () => new Date(time).toISOString(),
    handleAction: createRunHandler({ store, content, loadSimulation: () => wrapped, now: () => time,
      issue: () => ({ runId: `${++serial}`.padStart(43, 'A'), seed: 42 }) }) });
  return { rows, state, call, advance: ms => { time += ms; },
    profile: () => rows.get(`${COLLECTION}/${playerId}`),
    async welfare() { const response = await call({ action: 'welfare.get' }); assert.equal(response.ok, true); return response.welfare; },
    async begin(charId = 'char_volt') { const response = await call({ action: 'run.begin', charId, rulesId: runtime.rulesId }); assert.equal(response.ok, true); return response.ticket; },
    async run(replay = quit, charId) { const ticket = await this.begin(charId); time += replay.frames * 1000 / 60 + 1;
      const event = { action: 'run.finish', runId: ticket.runId, frames: replay.frames, inputs: replay.inputs,
        ...(replay.finishReason ? { finishReason: replay.finishReason } : {}) };
      return { event, response: await call(event) }; } };
}

function recording(frames, inputs = [{ frame: 30, action: 'jump' }]) {
  const sim = new RunnerSim(simulation.content, 42, 'char_volt', true);
  for (let frame = 0; sim.state.alive && (frames === undefined || frame < frames); frame++) {
    for (const input of inputs) if (input.frame === frame) sim.applyAction(input.action);
    sim.step(); sim.drainEvents();
  }
  return { frames: sim.replayFrames, inputs: sim.replayInputs, summary: sim.summary(),
    finishReason: frames === undefined ? undefined : 'quit' };
}
const quit = recording(600), death = recording(), short = recording(599);
function compact() {
  const economy = structuredClone(simulation.economy), config = economy.params;
  config.missions.daily.pool = [
    { id: 'druns', tier: 'easy', metric: 'runs', type: 'count', target: 1, reward: { coin: 7 } },
    { id: 'dscore', tier: 'mid', metric: 'score', type: 'bestScore', target: 99999, reward: { shard: 'shard_volt:5' } },
    { id: 'dclean', tier: 'hard', metric: 'cleanRuns', type: 'count', target: 1, reward: { key: 1 } },
  ];
  config.missions.weekly.pool = [
    { id: 'wruns', metric: 'runs', target: 100, reward: { coin: 11 } },
    { id: 'wchars', metric: 'charactersPlayed', target: 3, reward: { key: 2, diamond: 1 } },
    { id: 'wslides', metric: 'slides', target: 10, reward: { coin: 2 } },
    { id: 'wpickups', metric: 'itemPickups', target: 10, reward: { coin: 2 } },
  ];
  config.handbook.chapters.forEach((chapter, index) => { chapter.target = index === 3 ? 2 : 1; });
  validateConfig(economy); return { ...simulation, economy };
}
const mission = (welfare, group, id) => welfare[group].missions.find(item => item.id === id);
const claim = (welfare, id) => ({ action: 'mission.claim', period: 'daily', periodId: welfare.daily.periodId, missionId: id });
const error = response => { assert.equal(response.ok, false); return response.error.code; };

test('production config, deterministic tier picks, Beijing resets and first-generated definitions are frozen', async () => {
  validateConfig(simulation.economy);
  assert.deepEqual(simulation.economy.params.handbook.chapters.map(chapter => chapter.target), [1, 1000, 100, 10]);
  assert.deepEqual(simulation.economy.params.missions.weekly.pool.find(item => item.id === 'wchars').reward,
    { key: 2, diamond: 1 });
  const runtime = { ...simulation, economy: structuredClone(simulation.economy) }, f = fixture(runtime);
  const first = await f.welfare();
  assert.equal(first.minRunSeconds, 10); assert.equal(first.daily.missions.length, 3); assert.equal(first.weekly.missions.length, 4);
  for (const [index, tier] of ['easy', 'mid', 'hard'].entries()) {
    const candidates = runtime.economy.params.missions.daily.pool.filter(item => item.tier === tier);
    const choice = createHash('sha256').update(`${playerId}:${first.daily.periodId}:${tier}`).digest().readUInt32BE(0) % candidates.length;
    assert.equal(first.daily.missions[index].id, candidates[choice].id);
  }
  runtime.economy.params.missions.daily.pool.forEach(item => { item.target = 1; item.reward = { coin: 999 }; });
  assert.deepEqual((await f.welfare()).daily, first.daily);
  assert.equal((await f.welfare()).profile.revision, first.profile.revision);
  f.advance(86400000); const next = await f.welfare();
  assert.equal(next.daily.periodId, '2026-11-07'); assert.equal(next.weekly.periodId, '2026-11-02');
  assert.equal(next.daily.missions[0].target, 1); assert.equal(next.profile.revision, first.profile.revision + 1);
});

test('real death and clean quit replay once: income/progress commit together; quit is not ranked', async () => {
  const f = fixture(compact()), before = await f.welfare();
  const finished = await f.run(); assert.equal(finished.response.ok, true); assert.equal(finished.response.accepted, false);
  assert.equal(finished.response.profile.wallet.coin, quit.summary.coins);
  assert.equal(finished.response.profile.revision, before.profile.revision + 1);
  const progress = await f.welfare(); assert.equal(mission(progress, 'daily', 'dclean').progress, 1);
  assert.equal(progress.handbook[0].progress, 1); assert.equal(f.state.replays, 1);
  assert.deepEqual(await f.call(finished.event), finished.response); assert.equal(f.state.replays, 1);
  assert.equal(error(await f.call({ ...finished.event, finishReason: undefined })), 'INVALID_REQUEST');
  const { finishReason, ...asDeath } = finished.event;
  assert.equal(error(await f.call(asDeath)), 'RUN_CONFLICT');
  assert.equal([...f.rows.keys()].some(key => key.startsWith(`${RECORDS}/`) || key.startsWith(`${META}/`)), false);
  const dead = await f.run(death); assert.equal(dead.response.accepted, true);
  assert.equal(mission(await f.welfare(), 'weekly', 'wruns').progress, 2);
  assert.equal(f.state.replays, 2); assert.equal(f.profile().revision, before.profile.revision + 2);
  assert.equal(simulation.replayRun({ seed: 42, charId: 'char_volt' }, death.frames + 1, death.inputs, 'quit').accepted, false);
});

test('short quit earns real income but cannot bypass effective-run welfare using profile.stats', async () => {
  const f = fixture(compact()), result = await f.run(short), welfare = await f.welfare();
  assert.equal(result.response.ok, true); assert.equal(result.response.profile.stats.runs, 1);
  assert.equal(result.response.profile.wallet.coin, short.summary.coins);
  assert.equal(welfare.handbook[0].progress, 0); assert.equal(mission(welfare, 'weekly', 'wruns').progress, 0);
  assert.equal(error(await f.call({ action: 'handbook.claim', chapterId: 'hb_first_run' })), 'REWARD_NOT_READY');
});

test('score is best, other metrics add and characters are distinct; mission telemetry comes from replay', async () => {
  const f = fixture(compact()), moves = recording(600, [{ frame: 30, action: 'jump' }, { frame: 60, action: 'slide' }]);
  await f.run(moves); await f.run(moves);
  let welfare = await f.welfare();
  assert.equal(mission(welfare, 'daily', 'dscore').progress, moves.summary.score);
  assert.equal(mission(welfare, 'weekly', 'wruns').progress, 2);
  assert.equal(mission(welfare, 'weekly', 'wslides').progress, 2);
  assert.equal(mission(welfare, 'weekly', 'wchars').progress, 1);
  await f.run(quit, 'char_ama');
  welfare = await f.welfare(); assert.equal(mission(welfare, 'weekly', 'wchars').progress, 2);
});

test('midnight and Monday crossing only update matching start periods; handbook never resets', async () => {
  for (const [date, expectedWeekRuns] of [['2026-11-06', 1], ['2026-11-08', 0]]) {
    const f = fixture(compact(), Date.parse(`${date}T15:59:55Z`)), ticket = await f.begin();
    const stored = f.rows.get(`${RUNS}/${ticket.runId}`), oldDaily = stored.dailyId;
    assert.equal(stored.weeklyId, '2026-11-02'); f.advance(10001);
    assert.equal((await f.call({ action: 'run.finish', runId: ticket.runId,
      frames: quit.frames, inputs: quit.inputs, finishReason: 'quit' })).ok, true);
    const welfare = await f.welfare(); assert.notEqual(welfare.daily.periodId, oldDaily);
    assert.equal(mission(welfare, 'daily', 'druns').progress, 0);
    assert.equal(mission(welfare, 'weekly', 'wruns').progress, expectedWeekRuns);
    assert.equal(welfare.handbook[0].progress, 1); assert.equal(welfare.profile.revision, 1);
    assert.equal(error(await f.call({ action: 'mission.claim', period: 'daily', periodId: oldDaily, missionId: 'druns' })), 'PERIOD_EXPIRED');
  }
});

test('concurrent mission claims award once, including coin/key/shard inventory; retries do not bump revision', async () => {
  const runtime = compact(); runtime.economy.params.missions.daily.pool[1].target = 1;
  const f = fixture(runtime); await f.run(); const welfare = await f.welfare(), revision = welfare.profile.revision;
  const results = await Promise.all(Array.from({ length: 8 }, () => f.call(claim(welfare, 'druns'))));
  assert.ok(results.every(result => result.ok)); assert.ok(f.state.conflicts > 0);
  assert.equal(f.profile().wallet.coin, quit.summary.coins + 7); assert.equal(f.profile().revision, revision + 1);
  await f.call(claim(welfare, 'dclean')); await f.call(claim(welfare, 'dscore'));
  assert.deepEqual(f.profile().inventory.items, { key: 1, shard_volt: 5 });
  assert.equal(f.profile().revision, revision + 3);
  await f.call(claim(welfare, 'druns')); assert.equal(f.profile().revision, revision + 3);
  assert.equal(f.profile()._id, undefined);
});

test('handbook enforces sequential claims and preserves lifetime progress/claims across week reset', async () => {
  const f = fixture(compact()); await f.run(); await f.run(); const before = await f.welfare();
  assert.equal(before.handbook[1].progress, 1); assert.equal(before.handbook[1].unlocked, false);
  assert.equal(error(await f.call({ action: 'handbook.claim', chapterId: 'hb_coast' })), 'CHAPTER_LOCKED');
  for (const chapter of before.handbook) {
    const results = await Promise.all([1, 2].map(() => f.call({ action: 'handbook.claim', chapterId: chapter.id })));
    assert.ok(results.every(result => result.ok));
  }
  assert.equal(f.profile().wallet.coin, quit.summary.coins * 2 + 700);
  assert.equal(f.profile().wallet.diamond, 10); assert.equal(f.profile().inventory.items.key, 1);
  const revision = f.profile().revision; f.advance(7 * 86400000);
  const next = await f.welfare(); assert.ok(next.handbook.every(chapter => chapter.claimed && chapter.unlocked));
  assert.equal(next.profile.revision, revision + 1);
  await f.call({ action: 'handbook.claim', chapterId: 'hb_runner' }); assert.equal(f.profile().revision, revision + 1);
});

test('client amounts/progress/identity are rejected; claims before completion leave no writes', async () => {
  const f = fixture(compact()); const welfare = await f.welfare(), before = structuredClone(f.rows);
  assert.equal(error(await f.call(claim(welfare, 'druns'))), 'REWARD_NOT_READY');
  for (const request of [{ ...claim(welfare, 'druns'), coin: 100 },
    { action: 'handbook.claim', chapterId: 'hb_first_run', progress: 99 },
    { action: 'welfare.get', openid: 'bob' }, { ...claim(welfare, 'druns'), period: 'yearly' }]) {
    assert.equal(error(await f.call(request)), 'INVALID_REQUEST');
  }
  assert.deepEqual(f.rows, before);
  assert.equal((await f.call({ action: 'welfare.get', userInfo: { openId: 'bob' } })).welfare.profile.playerId, playerId);
});

test('claim and finish failures roll back progress, reward, revision and run consumption', async () => {
  for (const phase of ['claim', 'finish']) for (const failure of ['write', 'commit']) {
    const f = fixture(compact()); let event;
    if (phase === 'claim') { await f.run(); event = claim(await f.welfare(), 'druns'); }
    else { const ticket = await f.begin(); f.advance(10001); event = { action: 'run.finish', runId: ticket.runId, frames: 600, inputs: quit.inputs, finishReason: 'quit' }; }
    const before = structuredClone(f.rows);
    if (failure === 'write') f.state.failWrite = phase === 'finish' ? 2 : 1; else f.state.failCommit = true;
    const failed = await f.call(event); assert.equal(failed.ok, false); assert.ok(!JSON.stringify(failed).includes('secret'));
    assert.deepEqual(f.rows, before);
    f.state.failWrite = 0; f.state.failCommit = false; assert.equal((await f.call(event)).ok, true);
  }
});

test('initial welfare on existing profile increments revision, subsequent reads do not', async () => {
  const f = fixture(); const original = await f.call({ action: 'profile.get' });
  assert.equal(original.profile.revision, 0);
  const initialized = await f.welfare(); assert.equal(initialized.profile.revision, 1);
  assert.equal((await f.welfare()).profile.revision, 1);
  assert.equal(f.profile()._id, undefined);
});

test('welfare reads reconcile the old free roster without resetting saved claims, wallet or preferences', async () => {
  const f = fixture(), first = await f.welfare();
  const old = f.profile();
  old.inventory.characters = ['char_volt', 'char_historical_paid'];
  old.inventory.items = { key: 3, ticket: 2 };
  old.wallet = { coin: 123, diamond: 9 };
  old.preferences = { characterId: 'char_volt', themeId: 'theme_rain_konbini' };
  old.welfare.handbook.claimed.hb_first_run = true;
  const before = structuredClone(old), migrated = await f.welfare();
  assert.equal(migrated.profile.inventory.characters.length, 11);
  assert.equal(migrated.profile.revision, first.profile.revision + 1);
  assert.deepEqual(f.profile().welfare, before.welfare);
  assert.deepEqual(f.profile().wallet, before.wallet);
  assert.deepEqual(f.profile().inventory.items, before.inventory.items);
  assert.deepEqual(f.profile().preferences, before.preferences);
  assert.deepEqual(await f.welfare(), migrated);
});

test('three freely available characters earn the preserved weekly key and diamond reward once', async () => {
  const f = fixture(compact());
  for (const charId of ['char_volt', 'char_ama', 'char_kaze']) {
    assert.equal((await f.run(quit, charId)).response.ok, true);
  }
  const before = await f.welfare();
  assert.equal(mission(before, 'weekly', 'wchars').progress, 3);
  const event = { action: 'mission.claim', period: 'weekly', periodId: before.weekly.periodId, missionId: 'wchars' };
  assert.equal((await f.call(event)).ok, true);
  assert.equal(f.profile().wallet.diamond, 1); assert.equal(f.profile().inventory.items.key, 2);
  const persisted = structuredClone(f.profile());
  assert.equal((await f.call(event)).ok, true); assert.deepEqual(f.profile(), persisted);
});

test('a claim racing another finish preserves both credits and increments once per profile transaction', async () => {
  const f = fixture(compact()); await f.run(); const welfare = await f.welfare(), revision = f.profile().revision;
  const ticket = await f.begin(); f.advance(10001);
  const event = { action: 'run.finish', runId: ticket.runId, frames: 600, inputs: quit.inputs, finishReason: 'quit' };
  const responses = await Promise.all([f.call(claim(welfare, 'druns')), f.call(event), f.call(event)]);
  assert.ok(responses.every(response => response.ok));
  assert.equal(f.profile().wallet.coin, quit.summary.coins * 2 + 7);
  assert.equal(f.profile().revision, revision + 2);
  assert.equal(mission(await f.welfare(), 'weekly', 'wruns').progress, 2);
});
