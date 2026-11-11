import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { RunnerSim } from '@tr/game/core/sim/runnerSim.js';
import { CONTEXT_REPLAY_VERSION, DT_MS, eventToAction, loadContent, loadReplayFile, parseReplay, runReplay } from '../tools/replay/runner.mjs';
import { makeReplay } from '../tools/replay/recorder.mjs';
import { formatResult } from '../tools/replay/report.mjs';

const content = loadContent();
const base = { version: 2, seed: 777, charId: '', dtMs: DT_MS, maxFrames: 3600, inputs: [] };

test('v1 still ignores context fields and default recorder output remains v1', () => {
  const old = parseReplay({ ...base, version: 1, themeId: 'theme_library', initialItems: ['item_helmet'] });
  assert.equal(old.themeId, undefined); assert.equal(old.initialItems, undefined);
  assert.equal(makeReplay(777, '', { maxFrames: 3600 }).version, 1);
  assert.deepEqual(runReplay(content, old), runReplay(content, { ...base, version: 1 }));
});

test('v2 parsing preserves independent context values and validates their shapes', () => {
  const items = ['item_helmet'];
  const parsed = parseReplay({ ...base, themeId: 'theme_library', initialItems: items });
  assert.equal(parsed.version, CONTEXT_REPLAY_VERSION);
  assert.equal(parsed.themeId, 'theme_library'); assert.deepEqual(parsed.initialItems, items);
  items.push('item_magnet'); assert.deepEqual(parsed.initialItems, ['item_helmet']);
  assert.deepEqual(parseReplay(base).initialItems, []);
  for (const themeId of ['', null, 42]) assert.throws(() => parseReplay({ ...base, themeId }), /themeId/);
  for (const initialItems of [null, 'item_helmet', [42], ['']]) assert.throws(() => parseReplay({ ...base, initialItems }), /initialItems/);
  assert.throws(() => makeReplay(777, '', { initialItems: null }), /initialItems/);
});

test('v2 actually replays the requested theme and initial equipment through RunnerSim', () => {
  const replay = makeReplay(777, '', { maxFrames: 120, themeId: 'theme_library', initialItems: ['item_jetpack'] });
  const sim = new RunnerSim(content, replay.seed, undefined, false, replay.initialItems, replay.themeId);
  let cursor = 0, frames = 0;
  while (frames < replay.maxFrames) {
    while (replay.inputs[cursor]?.frame === frames) {
      const action = eventToAction(replay.inputs[cursor++]); if (action) sim.applyAction(action);
    }
    sim.step(); sim.drainEvents(); frames++;
    if (!sim.state.alive) break;
  }
  const result = runReplay(content, replay);
  assert.deepEqual(result.summary, sim.summary()); assert.equal(result.frames, frames);
  assert.deepEqual(result.context, { themeId: sim.themeId, initialItems: ['item_jetpack'] });
  assert.equal(result.context.themeId, 'theme_library');
  assert.notEqual(result.summary.distance, runReplay(content, { ...replay, initialItems: [] }).summary.distance,
    'dropping starting flight must change actual simulated distance, not just metadata');
});

test('v2 missing context has identical default gameplay while explicitly reporting resolved context', () => {
  const modern = runReplay(content, { ...base, maxFrames: 60 });
  const legacy = runReplay(content, { ...base, version: 1, maxFrames: 60 });
  const { context, ...result } = modern;
  assert.deepEqual(result, legacy); assert.deepEqual(context.initialItems, []);
  assert.ok(context.themeId);
  assert.match(formatResult(base, modern), /实际上下文:/);
  assert.doesNotMatch(formatResult({ ...base, version: 1 }, legacy), /实际上下文:/);
});

test('recorder CLI emits v2 for context without changing the existing input RNG stream', () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const recorded = spawnSync(process.execPath, ['tools/replay/recorder.mjs', '--seed=777', '--frames=120',
    '--theme=theme_library', '--items=item_helmet,item_magnet'], { cwd: root, encoding: 'utf8', timeout: 10000 });
  assert.equal(recorded.status, 0, recorded.stderr);
  const replay = parseReplay(JSON.parse(recorded.stdout));
  assert.equal(replay.version, 2); assert.equal(replay.themeId, 'theme_library');
  assert.deepEqual(replay.initialItems, ['item_helmet', 'item_magnet']);
  assert.deepEqual(replay.inputs, makeReplay(777, '', { maxFrames: 120 }).inputs);
});

test('v2 example is loadable and reports its effective simulation context', () => {
  const file = fileURLToPath(new URL('../tools/replay/examples/example-v2.json', import.meta.url));
  const replay = loadReplayFile(file), result = runReplay(content, replay);
  assert.equal(replay.version, 2); assert.equal(result.context.themeId, 'theme_library');
  assert.deepEqual(result.context.initialItems, ['item_helmet']);
});
