import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MissionStore } from '../apps/server/src/store.mjs';
import { MissionService } from '../apps/server/src/mission-service.mjs';
import { loadMissionContent } from '../apps/server/src/content.mjs';
import { RunnerSim } from '@tr/game/core/sim/runnerSim.js';
import { getMissionPeriods } from '../apps/server/src/periods.mjs';
import { createRuleset, readLegacyRuleset, replaySourceHash, loadReplayRuntime } from '../apps/server/src/rules.mjs';
import { MissionApiCore, MISSION_QUEUE_KEY } from '@tr/game/flow/missionApiCore.js';
import { eventToAction } from '../tools/replay/runner.mjs';

function contentFixture() {
  const content = structuredClone(loadMissionContent());
  const mission = (id, tier, metric, target = 1000000000) => ({ id, tier, metric, target, type: metric === 'score' ? 'bestScore' : 'count', reward: { coin: 1 } });
  content.economy.params.missions = { minRunSeconds: 0,
    daily: { pick: 3, pool: [mission('score', 'easy', 'score'), mission('runs', 'mid', 'runs', 1), mission('distance', 'hard', 'distanceM')] },
    weekly: { pick: 4, pool: [mission('weekly-runs', 'easy', 'runs', 10), mission('weekly-score', 'mid', 'score'),
      mission('weekly-distance', 'hard', 'distanceM'), mission('weekly-coins', 'easy', 'coins')] } };
  return content;
}
function deathReplay(content, actions = []) {
  const sim = new RunnerSim(content, 123, 'char_volt');
  let frames = 0, cursor = 0;
  while (sim.state.alive && frames < 10000) {
    while (actions[cursor]?.frame === frames) sim.applyAction(actions[cursor++].action);
    sim.step(); sim.drainEvents(); frames++;
  }
  assert.equal(sim.state.alive, false);
  return { payload: { frames, actions }, summary: sim.summary() };
}
function setup(t) {
  const directory = mkdtempSync(join(tmpdir(), 'thunder-rules-'));
  const dbPath = join(directory, 'missions.sqlite');
  const content = contentFixture(), clock = { now: Date.UTC(2026, 10, 11, 4) };
  let store = new MissionStore(dbPath);
  t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
  store.createUser('rule-user', clock.now);
  const create = (content, options = {}) => new MissionService({ store, content, now: () => clock.now, ...options });
  return { content, clock, service: create(content), get store() { return store; },
    restart(content, options) { store.close(); store = new MissionStore(dbPath); return create(content, options); } };
}

test('the self-contained server package preserves all existing golden summaries', async () => {
  const content = loadMissionContent();
  const rules = createRuleset({ content, minRunSeconds: 10 });
  const runtime = await loadReplayRuntime(rules.definition, new Set([replaySourceHash(rules.definition.runtimeSource)]));
  const directory = new URL('./golden/', import.meta.url);
  for (const name of readdirSync(directory).filter(name => name.endsWith('.json'))) {
    const { replay, expected } = JSON.parse(readFileSync(new URL(name, directory), 'utf8'));
    const actions = replay.inputs.map(event => ({ frame: event.frame, action: eventToAction(event) }))
      .filter(input => input.action && input.frame < expected.frames);
    const actual = await runtime.replayRun(content, { seed: replay.seed, char_id: replay.charId }, expected.frames, actions, 5000);
    assert.equal(actual.frames, expected.frames, name);
    assert.deepEqual(actual.summary, expected.summary, name);
  }
});

test('a run keeps its issued scoring rules when content changes and the server restarts', async t => {
  const f = setup(t), replay = deathReplay(f.content);
  const { runId } = f.service.startRun('rule-user', { seed: 123, charId: 'char_volt' });
  const changed = structuredClone(f.content); changed.game.params.score.perMeter *= 3;
  const restarted = f.restart(changed);
  f.clock.now += replay.payload.frames * 1000 / 60 + 1000;
  const result = await restarted.finishRun('rule-user', runId, replay.payload);
  const progress = result.daily.missions.find(mission => mission.id === 'score').progress;
  t.diagnostic(JSON.stringify({ issueScore: replay.summary.score, settledScore: progress, status: f.store.getRun(runId, 'rule-user').status }));
  assert.equal(progress, replay.summary.score, 'settlement must use the rules under which the run was issued');
  assert.equal(f.store.getRun(runId, 'rule-user').valid_run, 1);
});

test('a physics update must not mark a previously valid death replay invalid', async t => {
  const f = setup(t), replay = deathReplay(f.content);
  const { runId } = f.service.startRun('rule-user', { seed: 123, charId: 'char_volt' });
  const changed = structuredClone(f.content); changed.game.params.runner.lives = 100;
  const restarted = f.restart(changed);
  f.clock.now += replay.payload.frames * 1000 / 60 + 1000;
  const result = await restarted.finishRun('rule-user', runId, replay.payload);
  const run = f.store.getRun(runId, 'rule-user');
  t.diagnostic(JSON.stringify({ issueAlive: replay.summary.alive, settledValid: run.valid_run, status: run.status }));
  assert.equal(result.daily.missions.find(mission => mission.id === 'runs').progress, 1);
  assert.equal(run.valid_run, 1, 'a deploy must not turn an authorized completed run into an invalid one');
});

// A deliberately distinguishable, self-contained ABI-1 publication fixture, not a gameplay change.
const otherRuntime = `export const STEP_DT=1/30;
export async function replayRun(content,run,frames){return {frames,elapsedSeconds:frames*STEP_DT,
summary:{alive:false,charId:run.char_id,distance:50,score:54321,coins:0,hits:1,casts:0,nearMiss:0},
missionStats:{slides:0,itemPickups:0}};}`;

test('a different simulation publication cannot replace the code or timestep of an issued run', async t => {
  const f = setup(t), replay = deathReplay(f.content);
  const { runId } = f.service.startRun('rule-user', { seed: 123, charId: 'char_volt' });
  const oldRulesId = f.store.getRun(runId, 'rule-user').rules_id;
  const restarted = f.restart(f.content, { replaySource: otherRuntime });
  assert.notEqual(restarted.rulesId, oldRulesId);
  f.clock.now += replay.payload.frames * 1000 / 60 + 1000;
  const oldResult = await restarted.finishRun('rule-user', runId, replay.payload);
  assert.equal(oldResult.daily.missions.find(mission => mission.id === 'score').progress, replay.summary.score);
  const next = restarted.startRun('rule-user', { seed: 123, charId: 'char_volt' });
  f.clock.now += 2500;
  const currentResult = await restarted.finishRun('rule-user', next.runId, { frames: 60, actions: [] });
  assert.equal(currentResult.daily.missions.find(mission => mission.id === 'score').progress, 54321,
    'the test must prove both that old code was retained and the new code is actually used for new runs');
});

test('qualification and input limits remain those of issue; duplicate settlement does not recount', async t => {
  const f = setup(t), replay = deathReplay(f.content, [{ frame: 0, action: 'slide' }]);
  const { runId } = f.service.startRun('rule-user', { seed: 123, charId: 'char_volt' });
  const restarted = f.restart(f.content, { minRunSeconds: 600, limits: { maxFrames: 60, maxActions: 0 } });
  f.clock.now += replay.payload.frames * 1000 / 60 + 1000;
  const result = await restarted.finishRun('rule-user', runId, replay.payload);
  assert.equal(result.daily.missions.find(mission => mission.id === 'runs').progress, 1);
  const before = f.store.getPeriod('rule-user', 'daily', result.daily.periodId);
  await restarted.finishRun('rule-user', runId, replay.payload);
  assert.deepEqual(f.store.getPeriod('rule-user', 'daily', result.daily.periodId), before);
  await assert.rejects(restarted.finishRun('rule-user', runId, { frames: 30, actions: [] }), error => error.status === 409);
});

test('content mutations affect future admissions without mutating an already-bound snapshot', async t => {
  const f = setup(t), replay = deathReplay(f.content);
  f.content.game.params.optionalMarker = undefined;
  const first = f.service.startRun('rule-user', { seed: 123, charId: 'char_volt' });
  const original = f.store.getRun(first.runId, 'rule-user').rules_id;
  f.content.game.params.score.perMeter *= 3;
  const second = f.service.startRun('rule-user', { seed: 123, charId: 'char_volt' });
  assert.notEqual(f.store.getRun(second.runId, 'rule-user').rules_id, original);
  f.clock.now += replay.payload.frames * 1000 / 60 + 1000;
  const result = await f.service.finishRun('rule-user', first.runId, replay.payload);
  assert.equal(result.daily.missions.find(mission => mission.id === 'score').progress, replay.summary.score);
});

test('corrupt rules keep the run open and the client queue intact until a valid retry', async t => {
  const f = setup(t), replay = deathReplay(f.content);
  const { runId } = f.service.startRun('rule-user', { seed: 123, charId: 'char_volt' });
  const rulesId = f.store.getRun(runId, 'rule-user').rules_id;
  const original = f.store.db.prepare('SELECT definition_json FROM replay_rulesets WHERE id=?').get(rulesId).definition_json;
  f.store.db.prepare('UPDATE replay_rulesets SET definition_json=? WHERE id=?').run('{}', rulesId);
  const data = new Map();
  const storage = { get: key => data.get(key) ?? null, set: (key, value) => data.set(key, value) };
  const transport = { async request(path, _method, body) {
    try {
      const result = path === '/session' ? {} : path.endsWith('/finish')
        ? await f.service.finishRun('rule-user', runId, body) : f.service.snapshot('rule-user');
      return { status: 200, data: result };
    } catch (error) { return { status: error.status ?? 500, data: { error: error.message } }; }
  } };
  const api = new MissionApiCore(transport, storage);
  f.clock.now += replay.payload.frames * 1000 / 60 + 1000;
  await assert.rejects(api.finish({ runId, ...replay.payload }), error => error.status === 503);
  assert.equal(f.store.getRun(runId, 'rule-user').status, 'open');
  assert.equal(JSON.parse(data.get(MISSION_QUEUE_KEY)).length, 1);
  f.store.db.prepare('UPDATE replay_rulesets SET definition_json=? WHERE id=?').run(original, rulesId);
  const reloaded = new MissionApiCore(transport, storage);
  const result = await reloaded.load();
  assert.equal(result.daily.missions.find(mission => mission.id === 'runs').progress, 1);
  assert.deepEqual(JSON.parse(data.get(MISSION_QUEUE_KEY)), []);
});

test('a valid database hash does not authorize unknown executable code', async t => {
  const f = setup(t), replay = deathReplay(f.content);
  const { runId } = f.service.startRun('rule-user', { seed: 123, charId: 'char_volt' });
  const originalId = f.store.getRun(runId, 'rule-user').rules_id;
  const injected = createRuleset({ content: f.content, minRunSeconds: 0,
    runtimeSource: `globalThis.__untrustedReplayExecuted=true;${otherRuntime}` });
  f.store.addRuleset(injected);
  f.store.db.prepare('UPDATE runs SET rules_id=? WHERE id=?').run(injected.id, runId);
  t.after(() => { delete globalThis.__untrustedReplayExecuted; });
  f.clock.now += replay.payload.frames * 1000 / 60 + 1000;
  await assert.rejects(f.service.finishRun('rule-user', runId, replay.payload), error => error.status === 503);
  assert.equal(globalThis.__untrustedReplayExecuted, undefined, 'database data alone must not grant code execution');
  assert.equal(f.store.getRun(runId, 'rule-user').status, 'open');
  f.store.db.prepare('UPDATE runs SET rules_id=? WHERE id=?').run(originalId, runId);
  assert.equal((await f.service.finishRun('rule-user', runId, replay.payload)).daily.missions.find(mission => mission.id === 'runs').progress, 1);
});

test('a retained publication needs explicit runtime trust without losing its pending run', async t => {
  const f = setup(t);
  const oldService = f.restart(f.content, { replaySource: otherRuntime });
  const { runId } = oldService.startRun('rule-user', { seed: 123, charId: 'char_volt' });
  const newerRuntime = otherRuntime.replace('54321', '12345');
  let current = f.restart(f.content, { replaySource: newerRuntime });
  f.clock.now += 2500;
  await assert.rejects(current.finishRun('rule-user', runId, { frames: 60, actions: [] }), error => error.status === 503);
  assert.equal(f.store.getRun(runId, 'rule-user').status, 'open');
  current = f.restart(f.content, { replaySource: newerRuntime, trustedReplayRuntimeHashes: [replaySourceHash(otherRuntime)] });
  const result = await current.finishRun('rule-user', runId, { frames: 60, actions: [] });
  assert.equal(result.daily.missions.find(mission => mission.id === 'score').progress, 54321);
});

test('legacy NULL tickets adopt the verified pre-binding baseline once, not a later publication', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'thunder-legacy-rules-'));
  const dbPath = join(directory, 'missions.sqlite'); let store = new MissionStore(dbPath);
  t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
  const content = contentFixture(), replay = deathReplay(content), now = Date.UTC(2026, 10, 11, 4);
  const period = getMissionPeriods(now);
  store.createUser('rule-user', now); store.addWallet('rule-user', 'coin', 7);
  store.ensurePeriod('rule-user', 'daily', period.daily.periodId, content.economy.params.missions.daily.pool);
  store.ensurePeriod('rule-user', 'weekly', period.weekly.periodId, content.economy.params.missions.weekly.pool);
  store.saveProgress('rule-user', 'daily', period.daily.periodId, { runs: 1 });
  store.saveClaimed('rule-user', 'daily', period.daily.periodId, { runs: true });
  const legacyRun = id => ({ id, userId: 'rule-user', startedAt: now, dailyId: period.daily.periodId,
    weeklyId: period.weekly.periodId, seed: 123, charId: 'char_volt' });
  store.createRun(legacyRun('legacy-open'));
  const changed = structuredClone(content); changed.game.params.runner.lives = 100;
  const service = new MissionService({ store, content: changed, now: () => now + replay.payload.frames * 1000 / 60 + 1000 });
  const baselineId = readLegacyRuleset().id;
  assert.equal(service.legacyBinding.adopted, 1);
  assert.equal(store.getRun('legacy-open', 'rule-user').rules_id, baselineId);
  const result = await service.finishRun('rule-user', 'legacy-open', replay.payload);
  assert.equal(result.daily.missions.find(mission => mission.id === 'score').progress, replay.summary.score);
  assert.equal(result.daily.missions.find(mission => mission.id === 'runs').claimed, true);
  assert.equal(store.getWallet('rule-user').coin, 7);
  store.createRun(legacyRun('late-unbound'));
  store.close(); store = new MissionStore(dbPath);
  const restarted = new MissionService({ store, content: changed, now: () => now + replay.payload.frames * 1000 / 60 + 1000 });
  assert.equal(restarted.legacyBinding.adopted, 0);
  assert.equal(store.getRun('late-unbound', 'rule-user').rules_id, null);
  await assert.rejects(restarted.finishRun('rule-user', 'late-unbound', replay.payload), error => error.status === 503);
  assert.equal(store.getRun('late-unbound', 'rule-user').status, 'open');
});
