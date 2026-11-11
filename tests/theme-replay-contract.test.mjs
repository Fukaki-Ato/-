import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { loadContent } from '../tools/replay/runner.mjs';
import { RunnerSim } from '../packages/game/dist/core/sim/runnerSim.js';
import { leaderboardRulesId } from '../packages/game/dist/core/leaderboard.js';
import { createRunSession } from '../packages/game/dist/flow/runSession.js';
import { MissionApiCore } from '../packages/game/dist/flow/missionApiCore.js';
import { createLeaderboardServer, API_PATH } from '../server/index.mjs';
import { ReplayPool } from '../server/replay-pool.mjs';
import { createMissionHttpServer } from '../apps/server/src/http.mjs';
import { MissionStore } from '../apps/server/src/store.mjs';
import { replayRun } from '../apps/server/src/replay.mjs';
import { createWxMissionApi } from '../apps/wx/build/platform/missionApi.js';
import { fakeDom, importWebModule } from './dom-fixture.mjs';

const DEFAULT_THEME = 'theme_seaside_day', LIBRARY = 'theme_library';
const CHAR = 'char_volt', ORIGIN = 'https://theme.example.test';
const tick = () => new Promise(resolve => setImmediate(resolve));

function contentFixture() {
  const content = loadContent();
  Object.assign(content.game.params.runner, { lives: 1, invulnS: 0, baseSpeed: 60, maxSpeed: 60, speedRampPer100M: 0 });
  content.game.params.revive = { maxPerRun: 0, webFreeRevivePerRun: 0 };
  content.game.params.tutorial.protectionS = 0;
  content.game.params.track.restGapM = [0, 0];
  Object.assign(content.game.params.coins, {
    chainBuckets: [{ min: 0, max: 0, weight: 100 }], laneGroupWeights: { '1': 100, '2': 0, '3': 0 }, laneGapM: 1e6,
  });
  content.obstacles.patterns = [{ id: 'theme_contract', minDifficulty: 0, weight: 1, lengthSegments: 2,
    cells: [{ segment: 0, lane: 0, offsetM: -40, obsRef: 'obs_adwall' }], guarantee: { safeLanePattern: [0] } }];
  content.obstacles.difficultyCurve = [{ by: 0, poolWeights: { theme_contract: 1 }, coinDensity: 0, pickupRate: 0 }];
  content.obstacles.dropTable.weights = {};
  delete content.obstacles.zap;
  // Library-only entrance clearance removes the first wall, making omitted theme observably different.
  content.obstacles.antigrav = { fromM: 25, lengthM: 60, everyM: 500, ceilingH: 4.6 };
  content.themes.items.push({ id: 'theme_retired_test', status: 'retired', scenery: 'library' });
  return content;
}

function deathRun(content, seed, themeId) {
  const sim = new RunnerSim(content, seed, CHAR, false, [], themeId);
  while (sim.state.alive && sim.replayFrames < 1000) { sim.step(); sim.drainEvents(); }
  assert.equal(sim.state.alive, false);
  assert.ok(sim.replayFrames < 120, 'fixture fits the upload clock allowance without waiting');
  return { frames: sim.replayFrames, inputs: [], summary: sim.summary(), record: sim.firstCoinRecord.snapshot(sim.summary()) };
}

async function temporaryDirectory(t, close) {
  const directory = await mkdtemp(join(tmpdir(), 'thunder-theme-contract-'));
  t.after(async () => {
    try { await close(); }
    finally { await rm(directory, { recursive: true, force: true }); }
  });
  return directory;
}

function httpClient(base, origin = base) {
  const cookies = new Map();
  return async (path, body, method = body === undefined ? 'GET' : 'POST') => {
    const response = await fetch(base + path, { method,
      headers: { origin, cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join('; '),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const header of response.headers.getSetCookie()) {
      const [key, value] = header.split(';', 1)[0].split('='); cookies.set(key, value);
    }
    const text = await response.text();
    return { status: response.status, data: text ? JSON.parse(text) : null, headers: response.headers };
  };
}

test('theme mappings participate in the existing v2 leaderboard rules hash', () => {
  const content = loadContent(), original = leaderboardRulesId(content);
  assert.match(original, /^first-coin-v2-/);
  content.themes.items.find(theme => theme.id === LIBRARY).scenery = 'coast';
  assert.notEqual(leaderboardRulesId(content), original);
});

test('RunSession passes selected theme to simulation, ranking begin and renderer; omitted theme resolves default', async () => {
  const content = loadContent(), rulesId = leaderboardRulesId(content);
  for (const themeId of [LIBRARY, undefined]) {
    let beginArgs, runner, renderedTheme;
    const session = createRunSession({ content, charId: CHAR, themeId,
      adapter: { canvas: { mainCanvas: () => ({}), windowSize: () => ({}) } },
      views: { renderBoot: () => ({ setStatus() {} }), mountHud: () => ({ update() {}, dispose() {} }) },
      service: { begin: async (...args) => { beginArgs = args; return { runId: 'theme-ticket', seed: 123, rulesId }; } },
      createScene: (_host, _adapter, sim, _content, _callbacks, options) => {
        runner = sim; renderedTheme = options.themeId; return { dispose() {} };
      },
      onSeed() {}, onEnd() {}, onDeath() {}, onCast() {}, onPickup() {},
    });
    await tick();
    assert.deepEqual(beginArgs, [CHAR, rulesId, themeId]);
    assert.equal(runner.themeId, themeId ?? DEFAULT_THEME);
    assert.equal(renderedTheme, runner.themeId);
    session.dispose();
  }
});

test('Web ranking and shared mission clients carry optional start theme without adding it to finish', async t => {
  fakeDom(t);
  const { createLeaderboardClient } = await importWebModule('../apps/web/src/leaderboardClient.ts');
  const rankingBodies = [];
  const ranking = createLeaderboardClient('/', async (_url, options) => {
    rankingBodies.push(JSON.parse(options.body)); return Response.json({ runId: 'ticket', seed: 1, rulesId: 'rules' });
  }, 'page');
  await ranking.begin(CHAR, 'rules', LIBRARY); await ranking.begin(CHAR, 'rules');
  assert.deepEqual(rankingBodies, [{ charId: CHAR, rulesId: 'rules', pageId: 'page', themeId: LIBRARY },
    { charId: CHAR, rulesId: 'rules', pageId: 'page' }]);
  const calls = [];
  const api = new MissionApiCore({ request: async (path, _method, body) => {
    calls.push({ path, body }); return { status: 200, data: { runId: 'mission-ticket' } };
  } }, { get: () => null, set() {} });
  await api.start(123, CHAR, [], LIBRARY); await api.start(123, CHAR);
  await api.finish({ runId: 'mission-ticket', frames: 1, actions: [] });
  assert.deepEqual(calls.filter(call => call.path === '/runs').map(call => call.body),
    [{ seed: 123, charId: CHAR, themeId: LIBRARY }, { seed: 123, charId: CHAR }]);
  assert.deepEqual(calls.at(-1).body, { frames: 1, actions: [] });
});

test('Web mission integration sends the simulation-resolved theme', async t => {
  const { content } = fakeDom(t);
  const { createMissionIntegration } = await importWebModule('../apps/web/src/missionIntegration.ts');
  const originalFetch = globalThis.fetch, originalStorage = globalThis.localStorage;
  t.after(() => { globalThis.fetch = originalFetch; globalThis.localStorage = originalStorage; });
  const calls = [];
  globalThis.localStorage = { getItem: () => null, setItem() {} };
  globalThis.fetch = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) }); return Response.json({ runId: 'mission-ticket' });
  };
  const sim = new RunnerSim(content, 123, CHAR, false, [], LIBRARY);
  const stop = createMissionIntegration(false).trackRun(sim, 123);
  sim.step(); stop();
  for (let i = 0; i < 5; i++) await tick();
  assert.equal(calls.find(call => call.url.endsWith('/runs')).body.themeId, sim.themeId);
  assert.equal(Object.hasOwn(calls.find(call => call.url.endsWith('/finish')).body, 'themeId'), false);
});

test('WX mission transport carries the simulation-resolved theme in the shared start contract', async () => {
  const calls = [], values = new Map();
  const api = createWxMissionApi({ request: options => {
    calls.push(options);
    options.success({ statusCode: 201, data: { runId: 'wx-theme-ticket' }, header: {} });
  } }, { get: key => values.get(key) ?? null, set: (key, value) => values.set(key, value) }, ORIGIN);
  const sim = new RunnerSim(loadContent(), 123, CHAR, false, [], LIBRARY);
  await api.start(123, sim.loadout.charId, sim.initialItems, sim.themeId);
  assert.deepEqual(calls.at(-1).data, { seed: 123, charId: CHAR, themeId: LIBRARY });
});

test('leaderboard HTTP validates available themes and binds the ticket to the local replay worker theme', async t => {
  let service;
  const directory = await temporaryDirectory(t, () => service?.close()), content = contentFixture(), payloads = [];
  const pool = new ReplayPool({ content, size: 1 });
  service = await createLeaderboardServer({ content, dbPath: join(directory, 'leaderboard.sqlite'), origins: [ORIGIN],
    replayPool: { run: payload => { payloads.push(payload); return pool.run(payload); }, close: () => pool.close() } });
  await service.listen(0);
  const call = httpClient(`http://127.0.0.1:${service.server.address().port}`, ORIGIN);
  const entry = await call('/thunder-run/', undefined, 'HEAD'), pageId = entry.headers.get('x-tr-rank-page');
  assert.equal(entry.status, 200);
  const begin = extra => call(API_PATH + '/runs', { charId: CHAR, rulesId: service.expectedRulesId, pageId, ...extra });
  for (const themeId of [null, 3, {}, [], '', 'missing_theme', 'theme_retired_test']) {
    const result = await begin({ themeId });
    assert.equal(result.status, 400); assert.equal(result.data.error.code, 'invalid_theme');
  }
  const defaultRun = deathRun(content, 123), themedRun = deathRun(content, 123, LIBRARY);
  assert.notEqual(defaultRun.frames, themedRun.frames);
  for (const themeId of [LIBRARY, DEFAULT_THEME, undefined]) {
    const ticket = await begin(themeId === undefined ? {} : { themeId });
    assert.equal(ticket.status, 201);
    const replay = deathRun(content, ticket.data.seed, themeId);
    const submit = await call(API_PATH + '/runs/submit', { runId: ticket.data.runId, pageId, frames: replay.frames, inputs: [] });
    assert.equal(submit.status, 200); assert.deepEqual(submit.data, { accepted: true });
    assert.equal(payloads.at(-1).themeId, themeId ?? DEFAULT_THEME);
  }
  const ticket = await begin({ themeId: LIBRARY });
  const forged = { runId: ticket.data.runId, pageId, frames: themedRun.frames, inputs: [], themeId: DEFAULT_THEME };
  assert.equal((await call(API_PATH + '/runs/submit', forged)).status, 400);
  assert.equal(payloads.length, 3, 'submit cannot replace the bound theme or reach the worker');
  delete forged.themeId;
  assert.equal((await call(API_PATH + '/runs/submit', forged)).status, 404, 'invalid submission consumes the bound ticket');
  const listed = await call(API_PATH + '/leaderboard');
  assert.equal(listed.data.personal.distance, themedRun.record.distance);
});

test('mission HTTP validates themes, persists resolved selection and rejects finish-time replacement', async t => {
  let app;
  const directory = await temporaryDirectory(t, () => app?.close()), content = contentFixture();
  let now = Date.UTC(2026, 10, 11);
  app = createMissionHttpServer({ content, dbPath: join(directory, 'missions.sqlite'), now: () => now, minRunSeconds: 0 });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const call = httpClient(`http://127.0.0.1:${app.server.address().port}`);
  assert.equal((await call('/api/missions/session', {})).status, 201);
  const begin = extra => call('/api/missions/runs', { seed: 123, charId: CHAR, ...extra });
  for (const themeId of [null, 3, {}, [], '', 'missing_theme', 'theme_retired_test']) {
    assert.equal((await begin({ themeId })).status, 400);
  }
  assert.equal(app.store.db.prepare('SELECT COUNT(*) AS n FROM runs').get().n, 0);
  for (const themeId of [LIBRARY, DEFAULT_THEME, undefined]) {
    const ticket = await begin(themeId === undefined ? {} : { themeId });
    assert.equal(ticket.status, 201);
    const row = app.store.db.prepare('SELECT * FROM runs WHERE id = ?').get(ticket.data.runId);
    assert.equal(row.theme_id, themeId ?? DEFAULT_THEME);
    const replay = deathRun(content, 123, themeId);
    const finishPath = `/api/missions/runs/${ticket.data.runId}/finish`;
    now += 10000;
    assert.equal((await call(finishPath, { frames: replay.frames, actions: [], themeId: DEFAULT_THEME })).status, 400);
    assert.equal(app.store.db.prepare('SELECT status FROM runs WHERE id = ?').get(row.id).status, 'open');
    const finish = await call(finishPath, { frames: replay.frames, actions: [] });
    assert.equal(finish.status, 200, JSON.stringify(finish.data));
    const saved = app.store.db.prepare('SELECT * FROM runs WHERE id = ?').get(row.id);
    assert.equal(saved.theme_id, row.theme_id); assert.equal(saved.valid_run, 1);
  }
});

test('legacy mission SQLite schema migrates nullable theme_id, replays default, and preserves selected themes on reopen', async t => {
  let store;
  const directory = await temporaryDirectory(t, () => store?.close()), dbPath = join(directory, 'legacy.sqlite'), content = contentFixture();
  const db = new DatabaseSync(dbPath);
  db.exec(`CREATE TABLE users (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL);
    CREATE TABLE runs (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
      started_at INTEGER NOT NULL, daily_id TEXT NOT NULL, weekly_id TEXT NOT NULL,
      seed INTEGER NOT NULL, char_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open',
      finished_at INTEGER, payload_hash TEXT, valid_run INTEGER NOT NULL DEFAULT 0);
    INSERT INTO users VALUES ('legacy-user', 0);
    INSERT INTO runs(id, user_id, started_at, daily_id, weekly_id, seed, char_id)
      VALUES ('legacy-run', 'legacy-user', 0, '2026-11-11', '2026-11-09', 123, 'char_volt');`);
  db.close();
  store = new MissionStore(dbPath);
  const legacy = store.getRun('legacy-run', 'legacy-user');
  assert.equal(legacy.theme_id, null); assert.equal(legacy.items_json, null);
  const reference = deathRun(content, 123);
  assert.deepEqual((await replayRun(content, legacy, reference.frames, [])).summary, reference.summary);
  store.createRun({ id: 'themed-run', userId: 'legacy-user', startedAt: 0,
    dailyId: '2026-11-11', weeklyId: '2026-11-09', seed: 123, charId: CHAR, themeId: LIBRARY });
  store.close(); store = new MissionStore(dbPath);
  const themed = store.getRun('themed-run', 'legacy-user'), themedReference = deathRun(content, 123, LIBRARY);
  assert.equal(themed.theme_id, LIBRARY);
  assert.deepEqual((await replayRun(content, themed, themedReference.frames, [])).summary, themedReference.summary);
  assert.notDeepEqual(themedReference.summary, reference.summary);
});
