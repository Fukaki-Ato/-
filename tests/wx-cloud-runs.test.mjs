import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { buildWxCloud } from '../tools/build-wx-cloud.mjs';
import { RunnerSim } from '../packages/game/dist/core/sim/runnerSim.js';
import { leaderboardRulesId } from '../packages/game/dist/flow/leaderboard.js';
import { rankedClientRulesId } from '../packages/game/dist/flow/clientVersion.js';
import { leaderboardRulesId as configurationRulesId } from '../packages/game/dist/core/leaderboard.js';
import { createRunSession } from '../packages/game/dist/flow/runSession.js';
import { SIMULATION_BUILD_ID } from '../packages/game/dist/core/simulationBuild.js';
import { createHash } from 'node:crypto';
import { connectWxCloud } from '../apps/wx/build/platform/cloudClient.js';

const require = createRequire(import.meta.url), output = await buildWxCloud();
const simulation = require(`${output}/simulation.cjs`);
const { createCloudBaseStore, COLLECTION } = require('../cloudfunctions/thunder-api/cloudbase-store.cjs');
const { RUNS, RECORDS, META } = require('../cloudfunctions/thunder-api/run-store.cjs');
const { createProfileHandler, initialContent, playerIdFor, newProfile } = require('../cloudfunctions/thunder-api/profile.cjs');
const { createRunHandler } = require('../cloudfunctions/thunder-api/run-api.cjs');
const { RUN_TTL_MS, boardIdFor, playerNameFor, creditProfile } = require('../cloudfunctions/thunder-api/run-policy.cjs');
const json = name => JSON.parse(readFileSync(new URL(`../config/${name}.json`, import.meta.url), 'utf8'));
const content = initialContent(json('characters'), json('themes'));
const appId = 'wx-authorized', start = Date.parse('2026-11-06T00:00:00Z');

// Isolated optimistic DB substitute. The code under test is the real CloudBase
// store, including every native transaction read/write and query composition.
function databaseFixture() {
  const rows = new Map(), versions = new Map();
  const state = { failWrite: 0, failCommit: false, conflicts: 0, commits: 0 };
  const document = (table, id, snapshot = rows, staged, reads, snapshotVersions = versions) => {
    const key = `${table}/${id}`;
    const data = () => structuredClone(staged?.get(key) ?? snapshot.get(key) ?? null);
    const write = value => {
      if (--state.failWrite === 0) throw new Error('private SDK write failure');
      staged.set(key, structuredClone(value));
    };
    return {
      async get() { reads?.set(key, snapshotVersions.get(key) ?? 0); const value = data(); return { data: value ? { ...value, _id: id } : null }; },
      async set({ data: value }) { assert.ok(!Object.hasOwn(value, '_id'), 'CloudBase set refuses _id'); write(value); },
      async update({ data: value }) { assert.ok(data()); write({ ...data(), ...value }); },
    };
  };
  const matches = (row, query) => {
    if (query.op === 'and') return query.args.every(q => matches(row, q));
    if (query.op === 'or') return query.args.some(q => matches(row, q));
    return Object.entries(query).every(([key, value]) => value?.op === 'gt' ? row[key] > value.value
      : value?.op === 'lt' ? row[key] < value.value : row[key] === value);
  };
  const query = (table, filter) => {
    const order = []; let limit = Infinity;
    const all = () => [...rows].filter(([key, row]) => key.startsWith(`${table}/`) && matches(row, filter))
      .map(([, row]) => structuredClone(row)).sort((a, b) => {
        for (const [key, direction] of order) if (a[key] !== b[key]) return (a[key] < b[key] ? -1 : 1) * direction;
        return 0;
      });
    return { orderBy(key, direction) { order.push([key, direction === 'desc' ? -1 : 1]); return this; },
      limit(n) { limit = n; return this; }, async get() { return { data: all().slice(0, limit) }; },
      async count() { return { total: all().length }; } };
  };
  const db = {
    command: { gt: value => ({ op: 'gt', value }), lt: value => ({ op: 'lt', value }),
      and: args => ({ op: 'and', args }), or: args => ({ op: 'or', args }) },
    collection(table) { return { doc: id => document(table, id), where: filter => query(table, filter) }; },
    async runTransaction(callback) {
      for (let retry = 0; retry < 20; retry++) {
        const staged = new Map(), reads = new Map(), snapshot = structuredClone(rows), snapshotVersions = new Map(versions);
        const result = await callback({ collection: table => ({
          doc: id => document(table, id, snapshot, staged, reads, snapshotVersions),
        }) });
        if (state.failCommit) throw new Error('private SDK commit failure');
        if ([...reads].some(([key, version]) => version !== (versions.get(key) ?? 0))) { state.conflicts++; continue; }
        for (const [key, value] of staged) { rows.set(key, value); versions.set(key, (versions.get(key) ?? 0) + 1); }
        state.commits++;
        return structuredClone(result);
      }
      throw new Error('conflicts exhausted');
    },
  };
  return { rows, state, db };
}

function fixture(sim = simulation, storeFactory) {
  const memory = databaseFixture(); let time = start, serial = 0, openid = 'alice';
  const store = storeFactory ? storeFactory(memory) : createCloudBaseStore({ database: options => {
    assert.deepEqual(options, { throwOnNotFound: false }); return memory.db;
  } });
  const getId = () => playerIdFor(appId, openid);
  const handler = createProfileHandler({ getWXContext: () => ({ APPID: appId, OPENID: openid }),
    getAppId: () => appId, store, content, now: () => new Date(time).toISOString(),
    handleAction: createRunHandler({ store, content, loadSimulation: () => sim, now: () => time,
      issue: () => ({ runId: `${++serial}`.padStart(43, 'A'), seed: 42 }) }) });
  return { ...memory, store, handler, getId, advance: ms => { time += ms; }, as: user => { openid = user; },
    async begin() { return (await handler({ action: 'run.begin', charId: 'char_volt', rulesId: sim.rulesId })).ticket; } };
}

// Genuine client-side action recording through RunnerSim(recordReplay=true),
// including tutorial protection. No state/obstacles/coins are modified.
function record(seed = 42) {
  const sim = new RunnerSim(simulation.content, seed, 'char_volt', true);
  while (sim.state.alive && sim.replayFrames < simulation.MAX_RANKED_FRAMES) {
    if (sim.replayFrames === 30) sim.applyAction('jump');
    sim.step(); sim.drainEvents();
  }
  assert.equal(sim.state.alive, false);
  return { frames: sim.replayFrames, inputs: sim.replayInputs, summary: sim.summary(),
    firstCoinRecord: sim.firstCoinRecord.snapshot(sim.summary()) };
}
const recording = record();
const finishEvent = ticket => ({ action: 'run.finish', runId: ticket.runId,
  frames: recording.frames, inputs: recording.inputs });
async function ready(f) { const ticket = await f.begin(); f.advance(recording.frames * 1000 / 60 + 1); return ticket; }
const errorCode = result => { assert.equal(result.ok, false); return result.error.code; };

test('built simulation matches same-source rules and a real recorded death, not early/late death', () => {
  assert.equal(simulation.rulesId, leaderboardRulesId(Object.fromEntries(
    ['game', 'characters', 'skills', 'items', 'obstacles', 'themes', 'events', 'economy'].map(name => [name, json(name)]))));
  assert.match(simulation.rulesId, /^first-coin-v3:[a-f0-9]{64}:first-coin-v2-/);
  assert.equal(SIMULATION_BUILD_ID, createHash('sha256').update(readFileSync(
    new URL('../apps/server/dist/replay-runtime.mjs', import.meta.url))).digest('hex'));
  const run = { seed: 42, charId: 'char_volt' };
  const replay = simulation.replayRun(run, recording.frames, recording.inputs);
  assert.equal(replay.accepted, true);
  assert.deepEqual(replay.summary, recording.summary);
  assert.deepEqual(replay.firstCoinRecord, recording.firstCoinRecord);
  assert.ok(recording.summary.coins > 0);
  assert.equal(simulation.replayRun(run, recording.frames - 1, recording.inputs).accepted, false);
  assert.equal(simulation.replayRun(run, recording.frames + 1, recording.inputs).accepted, false);
});

test('cloud begin strictly accepts the real flow rules helper, including themes and simulation build identity', async () => {
  const f = fixture(), current = structuredClone(simulation.content);
  current.themes.items[0].scenery = 'library';
  for (const rulesId of [configurationRulesId(simulation.content),
    rankedClientRulesId(simulation.content, '0'.repeat(64)), leaderboardRulesId(current)]) {
    assert.equal(errorCode(await f.handler({ action: 'run.begin', charId: 'char_volt', rulesId })), 'RULES_MISMATCH');
  }
  assert.equal(f.rows.size, 0);
  assert.equal((await f.handler({ action: 'run.begin', charId: 'char_volt',
    rulesId: leaderboardRulesId(simulation.content) })).ok, true);
});

test('begin rejects invalid/retired themes before creating tickets; omission binds the normal default', async () => {
  const themes = structuredClone(simulation.content.themes);
  themes.items.push({ ...themes.items[0], id: 'theme_retired', status: 'retired' });
  const f = fixture({ ...simulation, content: { ...simulation.content, themes } });
  for (const themeId of ['', null, 42, {}, 'missing', 'theme_retired']) {
    assert.equal(errorCode(await f.handler({ action: 'run.begin', charId: 'char_volt',
      rulesId: simulation.rulesId, themeId })), 'INVALID_THEME');
  }
  assert.equal(f.rows.size, 0);
  const ticket = await f.begin();
  assert.equal(ticket.themeId, 'theme_seaside_day');
  assert.equal(f.rows.get(`${RUNS}/${ticket.runId}`).themeId, ticket.themeId);
});

test('real runSession → WX client → cloud begin/finish preserves non-default and special-theme replays', async () => {
  const tick = () => new Promise(resolve => setImmediate(resolve));
  const flowContent = Object.fromEntries(['game', 'characters', 'skills', 'items', 'obstacles',
    'themes', 'events', 'economy'].map(name => [name, json(name)]));
  for (const themeId of [undefined, 'theme_dusk_harbor', 'theme_stormspire', 'theme_forgeheart', 'theme_library']) {
    const f = fixture(), requests = [], seen = {};
    const client = await connectWxCloud({ cloud: { init() {}, async callFunction({ data }) {
      requests.push(data); return { result: await f.handler(data) };
    } } }, { envId: 'flow-contract-test', functionName: 'thunder-api' });
    const session = createRunSession({ content: flowContent, charId: 'char_volt', themeId,
      service: client.leaderboard, cloudProgress: true,
      adapter: { canvas: { mainCanvas: () => ({}), windowSize: () => ({}) } },
      views: { renderBoot: () => ({ setStatus() {} }), mountHud: () => ({ update() {}, dispose() {} }) },
      createScene: (_host, _adapter, sim, _content, callbacks) => {
        seen.sim = sim; seen.callbacks = callbacks; return { dispose() {} };
      }, onSeed(seed) { seen.seed = seed; }, onEnd(summary) { seen.summary = summary; },
      onDeath() {}, onCast() {}, onPickup() {} });
    await tick();
    const begin = requests.find(request => request.action === 'run.begin');
    assert.equal(begin.rulesId, leaderboardRulesId(flowContent));
    assert.deepEqual(begin, { action: 'run.begin', charId: 'char_volt', rulesId: leaderboardRulesId(flowContent),
      ...(themeId === undefined ? {} : { themeId }) });
    const run = [...f.rows].find(([key]) => key.startsWith(`${RUNS}/`))?.[1];
    assert.ok(run, 'flow must obtain a cloud ticket, not silently start an unranked fallback');
    assert.equal(seen.seed, run.seed); assert.equal(run.themeId, themeId ?? 'theme_seaside_day');
    const sim = seen.sim;
    assert.equal(sim.themeId, run.themeId);
    while (sim.state.alive && sim.replayFrames < simulation.MAX_RANKED_FRAMES) {
      if (sim.replayFrames === 30) sim.applyAction('jump');
      sim.step(); sim.drainEvents();
    }
    assert.equal(sim.state.alive, false);
    const replay = simulation.replayRun(run, sim.replayFrames, sim.replayInputs);
    assert.equal(replay.accepted, true); assert.deepEqual(replay.summary, sim.summary());
    assert.deepEqual(replay.firstCoinRecord, sim.firstCoinRecord.snapshot(sim.summary()));
    if (themeId === 'theme_stormspire' || themeId === 'theme_forgeheart') {
      assert.notDeepEqual(simulation.replayRun({ ...run, themeId: 'theme_seaside_day' },
        sim.replayFrames, sim.replayInputs).summary, sim.summary(), 'dropping the ticket theme changes this actual replay');
    }
    // A later preference change cannot select the replay theme for this ticket.
    f.rows.get(`${COLLECTION}/${f.getId()}`).preferences.themeId = 'theme_rain_konbini';
    f.advance(sim.replayFrames * 1000 / 60 + 1);
    seen.callbacks.onEnd(sim.summary()); await tick();
    assert.equal(client.read().stats?.runs, 1);
    assert.equal(client.read().wallet.coin, sim.summary().coins);
    assert.deepEqual(f.rows.get(`${RUNS}/${run.runId}`).summary, sim.summary());
    assert.deepEqual(requests.find(request => request.action === 'run.finish'), {
      action: 'run.finish', runId: run.runId, frames: sim.replayFrames, inputs: sim.replayInputs });
    assert.match(seen.summary.ranking.message, /已入全服榜/);
    session.dispose();
  }
});

test('finish cannot override a ticket theme, including an otherwise valid different theme', async () => {
  const f = fixture();
  const response = await f.handler({ action: 'run.begin', charId: 'char_volt',
    rulesId: simulation.rulesId, themeId: 'theme_library' });
  assert.equal(response.ok, true);
  const run = f.rows.get(`${RUNS}/${response.ticket.runId}`);
  f.advance(recording.frames * 1000 / 60 + 1);
  assert.equal(errorCode(await f.handler({ ...finishEvent(response.ticket), themeId: 'theme_seaside_day' })), 'INVALID_REQUEST');
  assert.equal(run.themeId, 'theme_library'); assert.equal(run.status, 'open');
  assert.equal((await f.handler({ action: 'profile.get' })).profile.wallet.coin, 0);
});

test('begin validates rules, live character and owned inventory; persists a server-bound ticket', async () => {
  const characters = structuredClone(simulation.content.characters);
  characters.items.find(character => character.id === 'char_ama').unlock = { type: 'coin', cost: 9000 };
  const f = fixture({ ...simulation, content: { ...simulation.content, characters } });
  for (const [charId, rulesId, code] of [['char_volt', 'old', 'RULES_MISMATCH'],
    ['missing', simulation.rulesId, 'INVALID_CHARACTER']]) {
    assert.equal(errorCode(await f.handler({ action: 'run.begin', charId, rulesId })), code);
  }
  assert.equal(f.rows.size, 0);
  await f.handler({ action: 'profile.get' });
  // Isolate the owned-inventory boundary with a paid character fixture: today's roster is free.
  f.rows.get(`${COLLECTION}/${f.getId()}`).inventory.characters = ['char_volt'];
  assert.equal(errorCode(await f.handler({ action: 'run.begin', charId: 'char_ama', rulesId: simulation.rulesId })), 'CHARACTER_NOT_OWNED');
  const ticket = await f.begin(), saved = f.rows.get(`${RUNS}/${ticket.runId}`);
  assert.deepEqual(Object.keys(ticket).sort(), ['rulesId', 'runId', 'seed', 'themeId']);
  assert.equal(ticket.themeId, 'theme_seaside_day'); assert.equal(saved.themeId, ticket.themeId);
  assert.equal(saved.playerId, f.getId()); assert.equal(saved.status, 'open');
  assert.equal(saved.expiresAt - saved.issuedAt, RUN_TTL_MS);
});

test('one authoritative award; identical retry succeeds without resetting wallet or aggregate stats', async () => {
  const f = fixture(), ticket = await ready(f), event = finishEvent(ticket);
  const response = await f.handler(event);
  assert.deepEqual(Object.keys(response).sort(), ['accepted', 'ok', 'profile']);
  assert.equal(response.accepted, true); assert.equal(response.profile.wallet.coin, recording.summary.coins);
  assert.equal(response.profile.revision, 1);
  assert.deepEqual(response.profile.stats, { runs: 1, distanceM: recording.summary.distance,
    coins: recording.summary.coins, bestScore: recording.summary.score });
  assert.equal(response.profile.bestScore, undefined);
  assert.deepEqual(await f.handler(event), response);
  f.advance(RUN_TTL_MS);
  assert.deepEqual(await f.handler({ ...event,
    inputs: event.inputs.map(({ frame, action }) => ({ action, frame })) }), response);
  assert.deepEqual((await f.handler({ action: 'profile.get' })).profile, response.profile);
  assert.equal(errorCode(await f.handler({ ...event, inputs: [] })), 'RUN_CONFLICT');
  assert.equal(f.rows.get(`${RUNS}/${ticket.runId}`).status, 'finished');
});

test('simultaneous submissions and distinct runs preserve exactly-once income across transaction conflicts', async () => {
  const f = fixture(), a = await f.begin(), b = await f.begin();
  f.advance(recording.frames * 1000 / 60 + 1);
  const results = await Promise.all([a, a, b].map(ticket => f.handler(finishEvent(ticket))));
  assert.ok(results.every(result => result.ok && result.accepted));
  const profile = (await f.handler({ action: 'profile.get' })).profile;
  assert.equal(profile.wallet.coin, recording.summary.coins * 2); assert.equal(profile.stats.runs, 2);
  assert.equal(profile.revision, 2);
  assert.ok(f.state.conflicts > 0);
  assert.equal(f.rows.get(`${META}/${boardIdFor(appId, simulation.rulesId)}`).sequence, 1);
});

test('identity, cancellation, expiration, rules and wall-clock speed prevent writes', async () => {
  const f = fixture(), ticket = await f.begin(), event = finishEvent(ticket);
  assert.equal(errorCode(await f.handler(event)), 'RUN_TOO_FAST');
  f.as('bob'); assert.equal(errorCode(await f.handler(event)), 'RUN_UNAVAILABLE');
  assert.equal(errorCode(await f.handler({ action: 'run.cancel', runId: ticket.runId })), 'RUN_UNAVAILABLE');
  f.as('alice'); assert.deepEqual(await f.handler({ action: 'run.cancel', runId: ticket.runId }), { ok: true });
  assert.equal(errorCode(await f.handler(event)), 'RUN_UNAVAILABLE');
  const expired = await f.begin(); f.advance(RUN_TTL_MS);
  assert.equal(errorCode(await f.handler(finishEvent(expired))), 'RUN_EXPIRED');
  const old = await ready(f); f.rows.get(`${RUNS}/${old.runId}`).rulesId = 'old';
  assert.equal(errorCode(await f.handler(finishEvent(old))), 'RULES_MISMATCH');
  assert.equal((await f.handler({ action: 'profile.get' })).profile.wallet.coin, 0);
});

test('rejects client totals/summary, malformed inputs and replay bounds without income', async () => {
  const f = fixture(), event = finishEvent(await ready(f));
  for (const patch of [{ summary: recording.summary }, { coins: 999 }, { frames: 108001 }, { frames: 0 },
    { inputs: Array(20001).fill({ frame: 0, action: 'jump' }) }, { inputs: [{ frame: 0, action: 'grant' }] },
    { inputs: [{ frame: event.frames, action: 'jump' }] },
    { inputs: [{ frame: 2, action: 'jump' }, { frame: 1, action: 'slide' }] }]) {
    assert.equal((await f.handler({ ...event, ...patch })).ok, false);
  }
  assert.equal(errorCode(await f.handler({ ...event, frames: event.frames - 1 })), 'REPLAY_REJECTED');
  assert.equal((await f.handler({ action: 'profile.get' })).profile.wallet.coin, 0);
});

test('transaction rechecks cancellation/expiry that happens during replay', async () => {
  for (const cause of ['cancel', 'expire']) {
    let f, ticket;
    const sim = { ...simulation, async replayRun(...args) {
      if (cause === 'cancel') await f.handler({ action: 'run.cancel', runId: ticket.runId });
      else f.advance(RUN_TTL_MS);
      return simulation.replayRun(...args);
    } };
    f = fixture(sim); ticket = await ready(f);
    assert.equal((await f.handler(finishEvent(ticket))).ok, false);
    assert.equal((await f.handler({ action: 'profile.get' })).profile.wallet.coin, 0);
  }
});

test('failed mid-write or commit rolls back wallet, run consumption, counter and leaderboard together', async () => {
  for (const failure of ['write', 'commit']) {
    const f = fixture(), ticket = await ready(f), before = structuredClone(f.rows);
    if (failure === 'write') f.state.failWrite = 4; else f.state.failCommit = true;
    const result = await f.handler(finishEvent(ticket));
    assert.equal(result.ok, false); assert.ok(!JSON.stringify(result).includes('private SDK'));
    assert.deepEqual(f.rows, before);
    f.state.failWrite = 0; f.state.failCommit = false;
    assert.equal((await f.handler(finishEvent(ticket))).accepted, true);
  }
});

test('leaderboard ties use stable server arrival order; top 50 and independent personal rank', async () => {
  const f = fixture();
  for (const user of ['alice', 'bob']) { f.as(user); const ticket = await ready(f); await f.handler(finishEvent(ticket)); }
  let board = (await f.handler({ action: 'leaderboard.list' })).leaderboard;
  assert.equal(board.entries[0].playerName, playerNameFor(playerIdFor(appId, 'alice')));
  assert.equal(board.personal.rank, 2);
  assert.deepEqual((await f.handler({ action: 'leaderboard.list' })).leaderboard, board);
  const boardId = boardIdFor(appId, simulation.rulesId);
  f.rows.set(`${RECORDS}/score-tiebreak`, { boardId, distance: recording.firstCoinRecord.distance,
    score: recording.firstCoinRecord.score + 1, order: 999, playerName: 'higher-score', charId: 'char_volt' });
  board = (await f.handler({ action: 'leaderboard.list' })).leaderboard;
  assert.equal(board.entries[0].playerName, 'higher-score'); assert.equal(board.personal.rank, 3);
  for (let i = 0; i < 55; i++) f.rows.set(`${RECORDS}/${i}`, { boardId, distance: 10000 + i,
    score: i, order: i + 3, playerName: `跑者-${i}`, charId: 'char_volt' });
  f.rows.set(`${RECORDS}/other-app`, { boardId: 'other', distance: 999999, score: 0, order: 1 });
  board = (await f.handler({ action: 'leaderboard.list' })).leaderboard;
  assert.equal(board.entries.length, 50); assert.equal(board.personal.rank, 58);
  assert.ok(!board.entries.some(entry => entry.playerName === board.playerName));
  f.as('new-player'); assert.equal((await f.handler({ action: 'leaderboard.list' })).leaderboard.personal, null);
  assert.equal(f.rows.has(`${COLLECTION}/${f.getId()}`), false);
});

test('income has no mission ten-second eligibility threshold', async () => {
  const short = { ...simulation, replayRun: () => ({ accepted: true,
    summary: { coins: 2, distance: 3, score: 30 }, firstCoinRecord: { distance: 1, score: 10, stoppedByCoin: true } }) };
  const f = fixture(short), ticket = await f.begin(); f.advance(1000);
  const response = await f.handler({ action: 'run.finish', runId: ticket.runId, frames: 60, inputs: [] });
  assert.equal(response.profile.wallet.coin, 2); assert.equal(response.profile.stats.runs, 1);
});

test('WX客户端→云入口→重放→持久钱包读回，平台userInfo不被当业务字段或身份', async () => {
  const f = fixture(), inits = [];
  const wx = { cloud: {
    init(options) { inits.push(options); },
    async callFunction({ name, data }) {
      assert.equal(name, 'thunder-api');
      return { result: await f.handler({ ...data, userInfo: { appId: 'forged', openId: 'bob' } }) };
    },
  } };
  const config = { envId: 'isolated-test', functionName: 'thunder-api' };
  const client = await connectWxCloud(wx, config);
  assert.equal(client.read().playerId, f.getId());
  const ticket = await client.leaderboard.begin('char_volt', simulation.rulesId);
  const replay = { runId: ticket.runId, frames: recording.frames, inputs: recording.inputs };
  f.advance(recording.frames * 1000 / 60 + 1);
  await client.leaderboard.submit(replay);
  assert.equal(client.read().wallet.coin, recording.summary.coins);
  await client.leaderboard.submit(replay);
  const reconnected = await connectWxCloud(wx, config);
  assert.equal(reconnected.read().wallet.coin, recording.summary.coins);
  assert.equal(reconnected.read().stats.runs, 1);
  assert.equal(f.rows.get(`${COLLECTION}/${f.getId()}`).wallet.coin, recording.summary.coins);
  assert.equal((await reconnected.leaderboard.list()).personal.rank, 1);
  assert.equal(inits.length, 2);
});

const sdkPath = new URL('../cloudfunctions/thunder-api/node_modules/wx-server-sdk', import.meta.url);
test('actual SDK transaction wrappers accept the multi-document finish adapter (local transport substitute)',
  { skip: !existsSync(sdkPath) && 'Install the independent cloud function SDK dependencies first' }, async () => {
  const sdk = require('../cloudfunctions/thunder-api/node_modules/wx-server-sdk');
  const cloud = sdk.createNewInstance({ env: 'local-contract-only' });
  const db = cloud.database({ throwOnNotFound: false });
  const f = fixture(simulation, memory => {
    db._db.runTransaction = callback => memory.db.runTransaction(tx => callback({ collection: table => ({ doc(id) {
      const doc = tx.collection(table).doc(id);
      return { get: () => doc.get(), set: data => doc.set({ data }).then(() => ({ updated: 1 })),
        update: data => doc.update({ data }).then(() => ({ updated: 1 })) };
    } }) }));
    // Outside-transaction get is isolated as well; no native cloud IO occurs.
    const store = createCloudBaseStore({ database: () => db });
    store.getRun = async id => structuredClone(memory.rows.get(`${RUNS}/${id}`));
    return store;
  });
  const response = await f.handler(finishEvent(await ready(f)));
  assert.equal(response.accepted, true); assert.equal(response.profile.wallet.coin, recording.summary.coins);
});

test('actual underlying SDK DocumentReference rejects _id; credited profile passes its serializer',
  { skip: !existsSync(sdkPath) && 'Install the independent cloud function SDK dependencies first' }, async () => {
  const sdk = require('../cloudfunctions/thunder-api/node_modules/wx-server-sdk');
  const { EJSON } = require('../cloudfunctions/thunder-api/node_modules/bson');
  const cloud = sdk.createNewInstance({ env: 'local-contract-only' });
  const db = cloud.database({ throwOnNotFound: false });
  const document = db.collection(COLLECTION).doc('local-player');
  let writes = 0;
  // Keep both real DocumentReference layers and their validation/serialization;
  // replace only the final transport, so this never sends a cloud request.
  document._document.request.send = async (action, params) => {
    assert.equal(action, 'database.modifyDocument'); writes++;
    const value = EJSON.parse(params.data);
    assert.equal(value.wallet.coin, recording.summary.coins);
    assert.equal(value.revision, 1); assert.equal(value._id, undefined);
    return { data: { updated: 1, upsert_id: 'local-player' }, requestId: 'local' };
  };
  const stored = { ...newProfile('local-player', content, new Date(start).toISOString()), _id: 'local-player' };
  await assert.rejects(document.set({ data: stored }), /_id/);
  assert.equal(writes, 0);
  const next = creditProfile(stored, { summary: recording.summary }, start);
  assert.equal(stored._id, 'local-player', 'reading metadata does not mutate the DB snapshot');
  await document.set({ data: next }); assert.equal(writes, 1);
});
