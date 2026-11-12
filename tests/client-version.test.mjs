import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { SIMULATION_BUILD_ID } from '@tr/game/core/simulationBuild.js';
import { leaderboardRulesId as configurationRulesId } from '@tr/game/core/leaderboard.js';
import { missionClientRulesId, rankedClientRulesId } from '@tr/game/flow/clientVersion.js';
import { MissionApiCore } from '@tr/game/flow/missionApiCore.js';
import { createRunSession } from '@tr/game/flow/runSession.js';
import { RunnerSim } from '@tr/game/core/sim/runnerSim.js';
import { loadMissionContent } from '../apps/server/src/content.mjs';
import { createMissionHttpServer } from '../apps/server/src/http.mjs';
import { createLeaderboardServer } from '../server/index.mjs';
import { fakeDom, importWebModule } from './dom-fixture.mjs';

const origin = 'https://version.example.test';
function client(base) {
  const cookies = new Map();
  return async (path, body, method = body === undefined ? 'GET' : 'POST') => {
    const response = await fetch(base + path, { method, headers: { Origin: origin,
      Cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join('; '),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const header of response.headers.getSetCookie()) {
      const [pair] = header.split(';'); const at = pair.indexOf('='); cookies.set(pair.slice(0, at), pair.slice(at + 1));
    }
    return { status: response.status, headers: response.headers, data: method === 'HEAD' ? null : await response.json() };
  };
}

test('client declarations match the built package and distinguish code/config changes', () => {
  const source = readFileSync(new URL('../apps/server/dist/replay-runtime.mjs', import.meta.url), 'utf8');
  assert.equal(SIMULATION_BUILD_ID, createHash('sha256').update(source).digest('hex'));
  const content = loadMissionContent(), id = missionClientRulesId(content);
  assert.equal(id, missionClientRulesId(Object.fromEntries(Object.entries(content).reverse())));
  assert.notEqual(id, missionClientRulesId(content, '0'.repeat(64)));
  const changed = structuredClone(content); changed.game.params.runner.baseSpeed++;
  assert.notEqual(id, missionClientRulesId(changed));
  assert.notEqual(rankedClientRulesId(content), rankedClientRulesId(content, '0'.repeat(64)));
  assert.throws(() => missionClientRulesId(content, 'build-required'), /根目录构建/);
});

test('the shared mission client declares context only at start, never on pending finish retries', async () => {
  const content = loadMissionContent(), calls = [];
  const api = new MissionApiCore({ request: async (path, _method, body) => {
    calls.push({ path, body }); return { status: 200, data: path === '/runs' ? { runId: 'signed-run' } : {} };
  } }, { get: () => null, set() {} });
  await api.start(123, 'char_volt', [], 'theme_library', content);
  await api.finish({ runId: 'signed-run', frames: 1, actions: [] });
  assert.equal(calls.find(call => call.path === '/runs').body.clientRulesId, missionClientRulesId(content));
  assert.deepEqual(calls.at(-1).body, { frames: 1, actions: [] });
});

test('run tracking receives the original base content, not theme-derived or local wallet data', () => {
  const content = loadMissionContent(); let captured;
  const session = createRunSession({ content, charId: 'char_volt', themeId: 'theme_library',
    adapter: { canvas: { mainCanvas: () => ({}), windowSize: () => ({}) } },
    views: { mountHud: () => ({ update() {}, dispose() {} }) },
    trackRun: (_sim, _seed, actual) => { captured = actual; return () => {}; },
    createScene: () => ({ dispose() {} }), onSeed() {}, onEnd() {}, onDeath() {}, onCast() {}, onPickup() {} });
  assert.equal(captured, content); session.dispose();
});

test('mission HTTP rejects stale new starts without tickets but still settles an already-issued old body', async t => {
  const content = loadMissionContent(); let now = Date.UTC(2026, 10, 11, 4);
  const app = createMissionHttpServer({ dbPath: ':memory:', content, publicOrigin: origin, now: () => now });
  await new Promise(done => app.server.listen(0, '127.0.0.1', done)); t.after(() => app.close());
  const call = client(`http://127.0.0.1:${app.server.address().port}`);
  await call('/api/missions/session', {});
  const currentId = missionClientRulesId(content), start = { seed: 123, charId: 'char_volt' };
  const stale = structuredClone(content); stale.game.params.runner.baseSpeed++;
  for (const clientRulesId of [undefined, missionClientRulesId(content, '0'.repeat(64)), missionClientRulesId(stale)]) {
    const result = await call('/api/missions/runs', { ...start, ...(clientRulesId === undefined ? {} : { clientRulesId }) });
    assert.equal(result.status, 409); assert.match(result.data.error, /刷新页面/);
  }
  assert.equal(app.store.db.prepare('SELECT COUNT(*) AS n FROM runs').get().n, 0);
  const approved = await call('/api/missions/runs', { ...start, clientRulesId: currentId });
  assert.equal(approved.status, 201, JSON.stringify(approved.data));
  const sim = new RunnerSim(content, 123, 'char_volt'); let frames = 0;
  while (sim.state.alive && frames < 10000) { sim.step(); sim.drainEvents(); frames++; }
  assert.equal(sim.state.alive, false);
  content.game.params.score.perMeter *= 3;
  assert.equal((await call('/api/missions/runs', { ...start, clientRulesId: currentId })).status, 409);
  now += frames * 1000 / 60 + 1000;
  const finished = await call(`/api/missions/runs/${approved.data.runId}/finish`, { frames, actions: [] });
  assert.equal(finished.status, 200, JSON.stringify(finished.data));
  assert.equal(app.store.getRun(approved.data.runId, finished.data.rewardLedgerId).valid_run, 1);
});

test('ranking HTTP rejects configuration-only or wrong-code identities for the same content', async t => {
  const content = loadMissionContent();
  const app = await createLeaderboardServer({ dbPath: ':memory:', content, origins: [origin],
    replayPool: { run: async () => ({ accepted: false }), close: async () => {} } });
  await app.listen(0, '127.0.0.1'); t.after(() => app.close());
  const call = client(`http://127.0.0.1:${app.server.address().port}`);
  const page = await call('/thunder-run/', undefined, 'HEAD'), pageId = page.headers.get('x-tr-rank-page');
  for (const rulesId of [configurationRulesId(content), rankedClientRulesId(content, '0'.repeat(64))]) {
    const result = await call('/thunder-run/api/runs', { charId: 'char_volt', rulesId, pageId });
    assert.equal(result.status, 409); assert.equal(result.data.error.code, 'rules_mismatch');
  }
  const approved = await call('/thunder-run/api/runs', { charId: 'char_volt', rulesId: rankedClientRulesId(content), pageId });
  assert.equal(approved.status, 201, JSON.stringify(approved.data));
  assert.equal(approved.data.rulesId, rankedClientRulesId(content));
});

test('Web ranking preserves the specific version-refresh rejection instead of a network-only message', async t => {
  fakeDom(t);
  const { createLeaderboardClient } = await importWebModule('../apps/web/src/leaderboardClient.ts');
  const api = createLeaderboardClient('/', async () => Response.json({ error: { code: 'rules_mismatch' } }, { status: 409 }), 'page');
  await assert.rejects(api.begin('char_volt', 'old'), error => error.code === 'rules_mismatch' && error.status === 409 && /刷新页面/.test(error.message));
});
