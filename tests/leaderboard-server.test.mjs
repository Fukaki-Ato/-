import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { DatabaseSync } from 'node:sqlite';
import { createServer } from 'node:http';
import { ReplayPool } from '../server/replay-pool.mjs';
import { createLeaderboardServer, API_PATH } from '../server/index.mjs';
import { LeaderboardStore } from '../server/store.mjs';
import { loadContent } from '../tools/replay/runner.mjs';
import { RunnerSim } from '../packages/game/dist/core/sim/runnerSim.js';
import { MAX_RANKED_FRAMES } from '../packages/game/dist/core/leaderboard.js';

const REAL_CONTENT = loadContent();
const CHAR_ID = 'char_volt';
const ORIGIN = 'https://game.example.test';

function rankedFixture({ coinRun = false } = {}) {
  const content = structuredClone(REAL_CONTENT);
  const runner = content.game.params.runner;
  runner.lives = 1;
  runner.invulnS = 0;
  runner.baseSpeed = coinRun ? 26 : 60;
  runner.maxSpeed = coinRun ? 26 : 60;
  runner.speedRampPer100M = 0;
  content.game.params.tutorial.protectionS = 0;
  content.game.params.coins.chainBuckets = coinRun
    ? [{ min: 5, max: 5, weight: 100 }]
    : [{ min: 0, max: 0, weight: 100 }];
  content.game.params.coins.laneGroupWeights = { '1': 100, '2': 0, '3': 0 };
  content.game.params.coins.laneGapM = 1_000_000;
  content.obstacles.patterns = [{
    id: 'ranked_test_pattern', minDifficulty: 0, weight: 1, lengthSegments: 2,
    cells: [{ segment: coinRun ? 1 : 0, lane: 0, offsetM: coinRun ? 0 : -40, obsRef: 'obs_adwall' }],
    guarantee: { safeLanePattern: [0] },
  }];
  content.obstacles.difficultyCurve = [{
    by: 0, poolWeights: { ranked_test_pattern: 1 }, coinDensity: 0, pickupRate: 0,
  }];
  content.obstacles.dropTable.weights = {};
  delete content.obstacles.zap;
  return content;
}

async function openService(t, { content = rankedFixture(), dbPath, ...options } = {}) {
  const dir = dbPath ? null : await mkdtemp(join(tmpdir(), 'tr-leaderboard-'));
  const path = dbPath ?? join(dir, 'leaderboard.sqlite');
  const service = await createLeaderboardServer({
    content, dbPath: path, origins: [ORIGIN], workerCount: 1, maxQueue: 8, replayTimeoutMs: 18_000, secureCookie: false, ...options,
  });
  await service.listen(0, '127.0.0.1');
  const address = service.server.address();
  t.after(async () => {
    await service.close();
    if (dir) await rm(dir, { recursive: true, force: true });
  });
  return { service, dbPath: path, base: 'http://127.0.0.1:' + address.port };
}

class Client {
  constructor(base, ip) {
    this.base = base;
    this.ip = ip;
    this.cookie = null;
  }

  async request(path, { method = 'GET', body, rawBody, origin = ORIGIN, contentType = 'application/json', headers = {} } = {}) {
    const requestHeaders = { 'x-real-ip': this.ip, ...headers };
    if (origin !== undefined) requestHeaders.origin = origin;
    if (this.cookie) requestHeaders.cookie = 'tr_lb=' + this.cookie;
    let payload;
    if (rawBody !== undefined) {
      requestHeaders['content-type'] = contentType;
      payload = rawBody;
    } else if (body !== undefined) {
      requestHeaders['content-type'] = contentType;
      payload = JSON.stringify(body);
    }
    const response = await fetch(this.base + path, { method, headers: requestHeaders, body: payload });
    const setCookie = response.headers.get('set-cookie');
    const cookieMatch = setCookie?.match(/(?:^|,\s*)tr_lb=([A-Za-z0-9_-]{43})/);
    if (cookieMatch) this.cookie = cookieMatch[1];
    let data = null;
    try { data = await response.json(); } catch { /* status-only assertions */ }
    return { response, data, setCookie };
  }
}

async function begin(client, rulesId, charId = CHAR_ID) {
  return client.request(API_PATH + '/runs', {
    method: 'POST', body: { charId, rulesId },
  });
}

function simulateToDeath(content, ticket, inputs = []) {
  const sim = new RunnerSim(content, ticket.seed, CHAR_ID);
  let cursor = 0;
  let frames = 0;
  while (sim.state.alive && frames < MAX_RANKED_FRAMES) {
    while (cursor < inputs.length && inputs[cursor].frame === frames) {
      sim.applyAction(inputs[cursor++].action);
    }
    sim.step();
    frames++;
  }
  return { frames, inputs, collectedCoins: sim.collectedCoins, summary: sim.summary() };
}

async function waitUntilUploadable(startedAt, frames) {
  const minimumMs = Math.max(0, frames * (1000 / 60) - 2000 + 100);
  const remaining = minimumMs - (performance.now() - startedAt);
  if (remaining > 0) await new Promise(resolve => setTimeout(resolve, remaining));
}

test('HTTP clients share a persistent global best; tickets are bound and single-use', async t => {
  const content = rankedFixture();
  const { service, dbPath, base } = await openService(t, { content });
  const alice = new Client(base, '203.0.113.11');
  const bob = new Client(base, '203.0.113.12');

  const aliceInitial = await alice.request(API_PATH + '/leaderboard');
  const bobInitial = await bob.request(API_PATH + '/leaderboard');
  assert.equal(aliceInitial.response.status, 200);
  assert.equal(bobInitial.response.status, 200);
  assert.notEqual(alice.cookie, bob.cookie);
  assert.match(aliceInitial.setCookie, /HttpOnly/i);
  assert.match(aliceInitial.setCookie, /SameSite=Lax/i);
  assert.match(aliceInitial.setCookie, /Path=\/thunder-run\/api/);
  assert.doesNotMatch(aliceInitial.setCookie, /; Secure/i);
  assert.deepEqual(aliceInitial.data.entries, []);
  assert.equal(aliceInitial.data.personal, null);
  assert.equal(aliceInitial.data.playerName.length <= 16, true);
  assert.equal(JSON.stringify(aliceInitial.data).includes(alice.cookie), false);

  const startedAt = performance.now();
  const ticketReply = await begin(alice, service.expectedRulesId);
  assert.equal(ticketReply.response.status, 201);
  assert.deepEqual(Object.keys(ticketReply.data).sort(), ['rulesId', 'runId', 'seed']);
  assert.match(ticketReply.data.runId, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(ticketReply.data.rulesId, service.expectedRulesId);
  assert.equal(Number.isInteger(ticketReply.data.seed), true);

  const replay = simulateToDeath(content, ticketReply.data);
  assert.equal(replay.summary.alive, false);
  assert.equal(replay.collectedCoins, 0);
  const stolenTicket = await bob.request(API_PATH + '/runs/submit', {
    method: 'POST', body: { runId: ticketReply.data.runId, frames: replay.frames, inputs: replay.inputs },
  });
  assert.equal(stolenTicket.response.status, 404, 'another cookie identity cannot submit this run');
  await waitUntilUploadable(startedAt, replay.frames);
  const submission = await alice.request(API_PATH + '/runs/submit', {
    method: 'POST', body: { runId: ticketReply.data.runId, frames: replay.frames, inputs: replay.inputs },
  });
  assert.equal(submission.response.status, 200);
  assert.deepEqual(submission.data, { accepted: true });

  const bobAfter = await bob.request(API_PATH + '/leaderboard');
  assert.equal(bobAfter.data.entries.length, 1);
  assert.equal(bobAfter.data.entries[0].rank, 1);
  assert.equal(bobAfter.data.entries[0].distance, replay.summary.distance);
  assert.equal(bobAfter.data.entries[0].score, replay.summary.score);
  assert.equal(bobAfter.data.entries[0].charId, CHAR_ID);
  assert.equal(bobAfter.data.personal, null);
  assert.equal(bobAfter.data.playerName, bobInitial.data.playerName);
  const aliceAfter = await alice.request(API_PATH + '/leaderboard');
  assert.deepEqual(aliceAfter.data.personal, bobAfter.data.entries[0]);
  assert.equal(aliceAfter.data.playerName, aliceInitial.data.playerName);

  const duplicate = await alice.request(API_PATH + '/runs/submit', {
    method: 'POST', body: { runId: ticketReply.data.runId, frames: replay.frames, inputs: replay.inputs },
  });
  assert.equal(duplicate.response.status, 404);
  assert.equal(duplicate.data.error.code, 'challenge_unavailable');

  await service.close();
  const db = new DatabaseSync(dbPath);
  const hashes = db.prepare('SELECT token_hash FROM players').all().map(row => row.token_hash);
  db.close();
  const aliceHash = createHash('sha256').update(alice.cookie).digest('hex');
  assert.equal(hashes.includes(aliceHash), true);
  assert.equal(hashes.includes(alice.cookie), false);

  const reopened = await createLeaderboardServer({ content, dbPath, origins: [ORIGIN], workerCount: 1, maxQueue: 8, replayTimeoutMs: 18_000, secureCookie: false });
  await reopened.listen(0, '127.0.0.1');
  t.after(() => reopened.close());
  alice.base = 'http://127.0.0.1:' + reopened.server.address().port;
  bob.base = alice.base;
  const alicePersisted = await alice.request(API_PATH + '/leaderboard');
  const bobPersisted = await bob.request(API_PATH + '/leaderboard');
  assert.deepEqual(alicePersisted.data.personal, bobAfter.data.entries[0]);
  assert.equal(bobPersisted.data.entries.length, 1);
});

test('best records sort by distance, then score, then earliest submitted best', () => {
  const store = new LeaderboardStore(':memory:');
  const players = ['a', 'b', 'c', 'd'].map(name => createHash('sha256').update(name).digest('hex'));
  for (const tokenHash of players) store.createPlayer(tokenHash);
  store.recordBest({ tokenHash: players[0], charId: 'char_volt', distance: 100, score: 500, achievedAt: 1000 });
  store.recordBest({ tokenHash: players[1], charId: 'char_volt', distance: 100, score: 500, achievedAt: 900 });
  store.recordBest({ tokenHash: players[2], charId: 'char_volt', distance: 99, score: 9999, achievedAt: 500 });
  store.recordBest({ tokenHash: players[3], charId: 'char_volt', distance: 101, score: 1, achievedAt: 3000 });
  assert.equal(store.recordBest({ tokenHash: players[0], charId: 'char_volt', distance: 99, score: 99999, achievedAt: 4000 }), false);
  assert.equal(store.recordBest({ tokenHash: players[0], charId: 'char_volt', distance: 100, score: 500, achievedAt: 4000 }), false);
  const beforeTieUpdate = store.list(players[0]).entries;
  assert.equal(beforeTieUpdate[1].playerName, store.getPlayer(players[1]), 'earlier equal best ranks first');
  const preservedTime = store.db.prepare('SELECT achieved_at FROM best_runs WHERE token_hash = ?').get(players[0]).achieved_at;
  assert.equal(preservedTime, 1000);
  assert.equal(store.recordBest({ tokenHash: players[0], charId: 'char_volt', distance: 100, score: 501, achievedAt: 5000 }), true);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM best_runs WHERE token_hash = ?').get(players[0]).n, 1);
  const result = store.list(players[0]);
  assert.deepEqual(result.entries.map(entry => [entry.distance, entry.score]), [
    [101, 1], [100, 501], [100, 500], [99, 9999],
  ]);
  assert.equal(result.entries[2].rank, 3);
  assert.equal(result.personal.rank, 2);
  assert.equal(result.entries[0].playerName.length <= 16, true);
  store.close();
});

test('cancelled tickets release capacity, cannot be stolen, and are idempotent', async t => {
  const { service, base } = await openService(t);
  const alice = new Client(base, '203.0.113.51'), bob = new Client(base, '203.0.113.52');
  await alice.request(API_PATH + '/leaderboard'); await bob.request(API_PATH + '/leaderboard');
  for (let i = 0; i < 7; i++) {
    const ticket = await begin(alice, service.expectedRulesId);
    assert.equal(ticket.response.status, 201);
    const body = { runId: ticket.data.runId };
    assert.equal((await bob.request(API_PATH + '/runs/cancel', { method: 'POST', body })).response.status, 404);
    for (let j = 0; j < 2; j++) assert.equal((await alice.request(API_PATH + '/runs/cancel', { method: 'POST', body })).response.status, 200);
    assert.equal((await alice.request(API_PATH + '/runs/submit', { method: 'POST', body: { ...body, frames: 1, inputs: [] } })).response.status, 404);
  }
});

test('POSTs require exact Origin and JSON, rules/inputs/body are bounded, and living replay is rejected', async t => {
  const { service, base } = await openService(t);
  const client = new Client(base, '203.0.113.21');
  await client.request(API_PATH + '/leaderboard');

  const csrf = await client.request(API_PATH + '/runs', {
    method: 'POST', origin: 'https://attacker.example', body: { charId: CHAR_ID, rulesId: service.expectedRulesId },
  });
  assert.equal(csrf.response.status, 403);
  assert.equal(csrf.data.error.code, 'origin_denied');
  const wrongRules = await begin(client, 'coinless-v1-wrong');
  assert.equal(wrongRules.response.status, 409);
  assert.equal(wrongRules.data.error.code, 'rules_mismatch');
  const invalidCharacter = await begin(client, service.expectedRulesId, 'skin_volt_default');
  assert.equal(invalidCharacter.response.status, 400);
  assert.equal(invalidCharacter.data.error.code, 'invalid_character');
  const wrongType = await client.request(API_PATH + '/runs', {
    method: 'POST', rawBody: '{}', contentType: 'text/plain',
  });
  assert.equal(wrongType.response.status, 415);

  const oversize = await client.request(API_PATH + '/runs', {
    method: 'POST', rawBody: ' '.repeat(2 * 1024 * 1024 + 1),
  });
  assert.equal(oversize.response.status, 413);
  assert.equal(oversize.data.error.code, 'body_too_large');

  const ticket = await begin(client, service.expectedRulesId);
  const unordered = await client.request(API_PATH + '/runs/submit', {
    method: 'POST', body: {
      runId: ticket.data.runId, frames: 2,
      inputs: [{ frame: 1, action: 'jump' }, { frame: 0, action: 'slide' }],
    },
  });
  assert.equal(unordered.response.status, 400);
  assert.equal(unordered.data.error.code, 'invalid_replay');
  const used = await client.request(API_PATH + '/runs/submit', {
    method: 'POST', body: { runId: ticket.data.runId, frames: 1, inputs: [] },
  });
  assert.equal(used.response.status, 404);

  const badFrameTicket = await begin(client, service.expectedRulesId);
  const badFrame = await client.request(API_PATH + '/runs/submit', {
    method: 'POST', body: { runId: badFrameTicket.data.runId, frames: 1, inputs: [{ frame: 1, action: 'jump' }] },
  });
  assert.equal(badFrame.response.status, 400);
  assert.equal(badFrame.data.error.code, 'invalid_replay');
  const badActionTicket = await begin(client, service.expectedRulesId);
  const badAction = await client.request(API_PATH + '/runs/submit', {
    method: 'POST', body: { runId: badActionTicket.data.runId, frames: 1, inputs: [{ frame: 0, action: 'cheat' }] },
  });
  assert.equal(badAction.response.status, 400);
  assert.equal(badAction.data.error.code, 'invalid_replay');

  const earlyDeathTicket = await begin(client, service.expectedRulesId);
  const actualRun = simulateToDeath(rankedFixture(), earlyDeathTicket.data);
  const earlyDeath = await client.request(API_PATH + '/runs/submit', {
    method: 'POST', body: {
      runId: earlyDeathTicket.data.runId, frames: actualRun.frames + 1, inputs: actualRun.inputs,
    },
  });
  assert.equal(earlyDeath.response.status, 200);
  assert.deepEqual(earlyDeath.data, { accepted: false });

  const liveTicket = await begin(client, service.expectedRulesId);
  const alive = await client.request(API_PATH + '/runs/submit', {
    method: 'POST', body: { runId: liveTicket.data.runId, frames: 1, inputs: [] },
  });
  assert.equal(alive.response.status, 200);
  assert.deepEqual(alive.data, { accepted: false });
  const health = await client.request(API_PATH + '/health');
  assert.equal(health.response.status, 200);
  assert.deepEqual(health.data, { ok: true });
});

test('a playable character marked locked cannot receive a ranked ticket', async t => {
  const content = rankedFixture();
  const volt = content.characters.items.find(character => character.id === CHAR_ID);
  volt.locked = true;
  const { service, base } = await openService(t, { content });
  const client = new Client(base, '203.0.113.29');
  await client.request(API_PATH + '/leaderboard');
  const result = await begin(client, service.expectedRulesId);
  assert.equal(result.response.status, 400);
  assert.equal(result.data.error.code, 'invalid_character');
});

test('a replay cannot be uploaded faster than its 60 Hz frame duration (with two-second slop)', async t => {
  const content = rankedFixture();
  content.game.params.runner.baseSpeed = 0.4;
  content.game.params.runner.maxSpeed = 0.4;
  const { service, base } = await openService(t, { content });
  const client = new Client(base, '203.0.113.35');
  await client.request(API_PATH + '/leaderboard');
  const ticket = await begin(client, service.expectedRulesId);
  const startedAt = performance.now();
  const replay = simulateToDeath(content, ticket.data);
  assert.equal(replay.summary.alive, false);
  assert.ok(replay.frames > 120);
  assert.ok(performance.now() - startedAt < replay.frames * (1000 / 60) - 2000);
  const response = await client.request(API_PATH + '/runs/submit', {
    method: 'POST', body: { runId: ticket.data.runId, frames: replay.frames, inputs: replay.inputs },
  });
  assert.equal(response.response.status, 200);
  assert.deepEqual(response.data, { accepted: false });
});

test('real game content rejects a replay that is still alive at its claimed last frame', async t => {
  const { service, base } = await openService(t, { content: REAL_CONTENT });
  const client = new Client(base, '203.0.113.31');
  await client.request(API_PATH + '/leaderboard');
  const ticket = await begin(client, service.expectedRulesId);
  const result = await client.request(API_PATH + '/runs/submit', {
    method: 'POST', body: { runId: ticket.data.runId, frames: 1, inputs: [] },
  });
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.data, { accepted: false });
});

test('actual collected coins reject a replay even when no client score summary is supplied', async t => {
  const content = rankedFixture({ coinRun: true });
  const { service, base } = await openService(t, { content });
  const client = new Client(base, '203.0.113.41');
  await client.request(API_PATH + '/leaderboard');
  const startedAt = performance.now();
  const ticket = await begin(client, service.expectedRulesId);
  const replay = simulateToDeath(content, ticket.data);
  assert.equal(replay.summary.alive, false);
  assert.ok(replay.collectedCoins > 0, 'fixture must collect at least one actual coin');
  await waitUntilUploadable(startedAt, replay.frames);
  const result = await client.request(API_PATH + '/runs/submit', {
    method: 'POST', body: { runId: ticket.data.runId, frames: replay.frames, inputs: replay.inputs },
  });
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.data, { accepted: false });
  const board = await client.request(API_PATH + '/leaderboard');
  assert.deepEqual(board.data.entries, []);
});

test('replay worker queue is bounded and CPU replay leaves the HTTP event loop responsive', async t => {
  const content = rankedFixture();
  content.game.params.runner.baseSpeed = 1;
  content.game.params.runner.maxSpeed = 1;
  content.obstacles.patterns = [{
    id: 'empty_test_pattern', minDifficulty: 0, weight: 1, lengthSegments: 8, cells: [],
    guarantee: { safeLanePattern: [0] },
  }];
  content.obstacles.difficultyCurve = [{
    by: 0, poolWeights: { empty_test_pattern: 1 }, coinDensity: 0, pickupRate: 0,
  }];
  const pool = new ReplayPool({ size: 1, maxQueue: 0, timeoutMs: 18_000, content });
  const healthServer = createServer((_req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end('{"ok":true}');
  });
  await new Promise(resolve => healthServer.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await pool.close();
    await new Promise(resolve => healthServer.close(resolve));
  });
  const deadline = Date.now() + 5000;
  while (!pool.slots[0]?.ready && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(pool.slots[0]?.ready, true, 'worker starts');

  const payload = { seed: 42, charId: CHAR_ID, frames: MAX_RANKED_FRAMES, inputs: [] };
  const active = pool.run(payload);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.ok(pool.slots[0]?.busy, 'long replay is running off-thread');
  await assert.rejects(pool.run(payload), error => error.code === 'replay_busy');
  const startedAt = performance.now();
  const health = await fetch('http://127.0.0.1:' + healthServer.address().port);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).ok, true);
  assert.ok(performance.now() - startedAt < 500, 'health response is not queued behind replay CPU');
  assert.deepEqual(await active, { accepted: false });
});
