import nodeTest from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const [major, minor] = process.versions.node.split('.').map(Number);
const sqliteSupported = major > 22 || (major === 22 && minor >= 13);
const test = sqliteSupported ? nodeTest : nodeTest.skip;
const { createMissionHttpServer } = sqliteSupported ? await import('../apps/server/src/http.mjs') : {};
import { loadMissionContent } from '../apps/server/src/content.mjs';
import { getMissionPeriods } from '../apps/server/src/periods.mjs';
import { RunnerSim } from '../packages/game/dist/core/sim/runnerSim.js';

function testContent() {
  const content = structuredClone(loadMissionContent());
  content.economy.params.missions = {
    minRunSeconds: 0,
    daily: { pick: 3, pool: [
      { id: 'test_distance', tier: 'easy', type: 'accumulate', metric: 'distanceM', target: 1, reward: { coin: 7 } },
      { id: 'test_slides', tier: 'mid', type: 'count', metric: 'slides', target: 1, reward: { shard: 'shard_volt:3' } },
      { id: 'test_score', tier: 'hard', type: 'bestScore', metric: 'score', target: 1, reward: { key: 2 } },
    ] },
    weekly: { pick: 4, pool: [
      { id: 'test_week_distance', tier: 'mid', type: 'accumulate', metric: 'distanceM', target: 1, reward: { coin: 11 } },
      { id: 'test_week_skill', tier: 'mid', type: 'count', metric: 'skillCasts', target: 1, reward: { shard: 'shard_ama:4' } },
      { id: 'test_week_pickup', tier: 'easy', type: 'count', metric: 'itemPickups', target: 1, reward: { coin: 13 } },
      { id: 'test_week_chars', tier: 'hard', type: 'count', metric: 'charactersPlayed', target: 2, reward: { key: 3 } },
    ] },
  };
  return content;
}

/** 服务端回放的同款确定性死亡局（seed 与 startRun 的 123 一致）：跑到死返回帧数。
 *  有效局必须死亡收尾（mission-service 与排行榜 worker 同口径，审查 S-1），
 *  测试局因此也必须按真实终局提交，存活截断局不再计入任务进度。 */
function deathRunFrames(charId, actions = [], items = []) {
  const sim = new RunnerSim(loadMissionContent(), 123, charId, false, items);
  let cursor = 0, frames = 0;
  for (let frame = 0; frame < 10000; frame++) {
    while (cursor < actions.length && actions[cursor].frame === frame) { sim.applyAction(actions[cursor].action); cursor++; }
    sim.step(); sim.drainEvents(); frames++;
    if (!sim.state.alive) break;
  }
  assert.equal(sim.state.alive, false, '无操作测试局必须死亡收尾（否则提交帧数无效）');
  return frames;
}

/** 死亡局的墙钟推进（回放耗时闸：elapsedMs ≥ frames*STEP_DT*1000 - allowance） */
const RUN_MS = frames => frames * 1000 / 60 + 500;

async function setup({ startTime = Date.UTC(2026, 9, 12, 4), limits = {}, minRunSeconds = 0, publicOrigin, trustedProxy } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'thunder-missions-'));
  const state = { cookie: '', directory, dbPath: join(directory, 'missions.sqlite'), now: startTime, content: testContent(), limits, minRunSeconds, publicOrigin };
  state.create = async () => {
    const app = createMissionHttpServer({
      dbPath: state.dbPath, content: state.content, now: () => state.now,
      limits: state.limits, minRunSeconds: state.minRunSeconds, publicOrigin: state.publicOrigin, trustedProxy,
    });
    await new Promise((resolve, reject) => {
      app.server.once('error', reject);
      app.server.listen(0, '127.0.0.1', resolve);
    });
    const address = app.server.address();
    const base = `http://127.0.0.1:${address.port}`;
    const call = async (method, path, body, options = {}) => {
      const headers = { Origin: options.origin ?? base };
      if (options.realIp) headers['X-Real-IP'] = options.realIp;
      if (state.cookie) headers.Cookie = state.cookie;
      if (body !== undefined || options.rawBody !== undefined) headers['Content-Type'] = options.contentType ?? 'application/json';
      const response = await fetch(base + path, {
        method, headers, body: options.rawBody ?? (body === undefined ? undefined : JSON.stringify(body)),
      });
      const text = await response.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = text; }
      const setCookie = response.headers.get('set-cookie');
      if (setCookie) state.cookie = setCookie.split(';', 1)[0];
      return { response, data, cookie: state.cookie };
    };
    return { app, base, call, get cookie() { return state.cookie; }, set cookie(value) { state.cookie = value; } };
  };
  state.close = async api => { if (api) await api.app.close(); rmSync(directory, { recursive: true, force: true }); };
  state.session = async api => {
    const result = await api.call('POST', '/api/missions/session');
    assert.equal(result.response.status, 201, JSON.stringify(result.data));
    assert.match(result.response.headers.get('set-cookie'), /HttpOnly/i);
    assert.match(result.response.headers.get('set-cookie'), /SameSite=Lax/i);
    return result;
  };
  state.startRun = async (api, charId = 'char_volt', extra = {}) => api.call('POST', '/api/missions/runs', { seed: 123, charId, ...extra });
  state.finish = async (api, runId, payload = { frames: 60, actions: [] }, advanceMs = 1000) => {
    state.now += advanceMs;
    return api.call('POST', `/api/missions/runs/${runId}/finish`, payload);
  };
  return state;
}

const snapshot = async api => {
  const result = await api.call('GET', '/api/missions');
  assert.equal(result.response.status, 200, JSON.stringify(result.data));
  return result.data;
};

test('Beijing periods reset at midnight; weekly period starts on Monday', () => {
  const before = Date.UTC(2026, 9, 11, 15, 59, 59);
  const at = Date.UTC(2026, 9, 11, 16, 0, 0);
  assert.deepEqual(getMissionPeriods(before).daily, { periodId: '2026-10-11', resetsAt: at });
  assert.deepEqual(getMissionPeriods(before).weekly, { periodId: '2026-10-05', resetsAt: at });
  assert.equal(getMissionPeriods(at).daily.periodId, '2026-10-12');
  assert.equal(getMissionPeriods(at).weekly.periodId, '2026-10-12');
});

test('session cookie, stable daily tiers, all weekly missions, and SQLite persistence', async () => {
  const state = await setup();
  let api;
  try {
    api = await state.create();
    const unauth = await api.call('GET', '/api/missions');
    assert.equal(unauth.response.status, 401);
    assert.equal(typeof unauth.data.error, 'string');
    await state.session(api);
    const first = await snapshot(api);
    assert.equal(first.daily.missions.length, 3);
    assert.equal(first.weekly.missions.length, 4);
    assert.equal(first.daily.periodId, '2026-10-12');
    assert.equal(first.weekly.periodId, '2026-10-12');
    assert.equal(first.wallet && typeof first.wallet, 'object');
    assert.match(first.rewardLedgerId, /^[a-f0-9]{64}$/);
    assert.equal(api.app.store.hasUser(first.rewardLedgerId), true);
    assert.notEqual(first.rewardLedgerId, api.cookie.split('=')[1], 'ledger ID must not expose the bearer token');
    const storedIds = first.daily.missions.map(mission => mission.id);
    assert.deepEqual((await snapshot(api)).daily.missions.map(mission => mission.id), storedIds);
    await api.app.close();
    api = await state.create();
    const reopened = await snapshot(api);
    assert.deepEqual(reopened.daily.missions.map(mission => mission.id), storedIds);
    assert.equal(reopened.daily.resetsAt, first.daily.resetsAt);
    assert.equal(reopened.rewardLedgerId, first.rewardLedgerId, 'ledger ID survives restart');
    api.cookie = '';
    await state.session(api);
    assert.notEqual((await snapshot(api)).rewardLedgerId, first.rewardLedgerId, 'new visitors have independent ledgers');
  } finally { await state.close(api); }
});

test('server replays runs, rejects early time, settles once, and atomically claims reward', async () => {
  const state = await setup({ limits: { replayTimeAllowanceMs: 250 } });
  let api;
  try {
    api = await state.create();
    await state.session(api);
    const started = await state.startRun(api);
    assert.equal(started.response.status, 201);
    const runId = started.data.runId;

    const tooFast = await api.call('POST', `/api/missions/runs/${runId}/finish`, { frames: 60, actions: [] });
    assert.equal(tooFast.response.status, 425);
    assert.match(tooFast.data.error, /过快/);
    const deathActions = [{ frame: 0, action: 'slide' }];
    const deathFrames = deathRunFrames('char_volt', deathActions);
    const finished = await state.finish(api, runId, { frames: deathFrames, actions: deathActions }, RUN_MS(deathFrames));
    assert.equal(finished.response.status, 200, JSON.stringify(finished.data));
    assert.equal(finished.data.daily.missions.find(mission => mission.id === 'test_distance').progress, 1);
    assert.equal(finished.data.weekly.missions.find(mission => mission.id === 'test_week_distance').progress, 1);
    assert.equal(finished.data.daily.missions.find(mission => mission.id === 'test_slides').progress, 1);
    assert.equal(finished.data.daily.missions.find(mission => mission.id === 'test_score').progress, 1);
    const duplicate = await api.call('POST', `/api/missions/runs/${runId}/finish`, { frames: deathFrames, actions: deathActions });
    assert.equal(duplicate.response.status, 200);
    const changed = await api.call('POST', `/api/missions/runs/${runId}/finish`, { frames: 60, actions: [] });
    assert.equal(changed.response.status, 409);

    const beforeClaim = await snapshot(api);
    const claimBody = { period: 'daily', periodId: beforeClaim.daily.periodId, missionId: 'test_distance' };
    const claims = await Promise.all([
      api.call('POST', '/api/missions/claim', claimBody),
      api.call('POST', '/api/missions/claim', claimBody),
    ]);
    assert.deepEqual(claims.map(item => item.response.status), [200, 200]);
    const afterClaim = await snapshot(api);
    assert.equal(afterClaim.wallet.coin, 7);
    assert.equal(afterClaim.daily.missions.find(mission => mission.id === 'test_distance').claimed, true);
  } finally { await state.close(api); }
});

test('weekly character progress deduplicates a runner, while daily stale runs never enter a new day', async () => {
  const startTime = Date.UTC(2026, 9, 13, 15, 59, 59); // Tuesday 23:59:59 Beijing
  const state = await setup({ startTime });
  let api;
  try {
    api = await state.create();
    await state.session(api);
    const first = await state.startRun(api, 'char_volt');
    assert.equal(first.response.status, 201);
    const runId = first.data.runId;
    state.now += 2000; // Cross Wednesday 00:00 Beijing, but remain in the same weekly period.
    const voltFrames = deathRunFrames('char_volt');
    const finished = await state.finish(api, runId, { frames: voltFrames, actions: [] }, RUN_MS(voltFrames));
    assert.equal(finished.response.status, 200);
    assert.equal(finished.data.daily.periodId, '2026-10-14');
    assert.equal(finished.data.daily.missions.find(mission => mission.id === 'test_distance').progress, 0);
    assert.equal(finished.data.weekly.periodId, '2026-10-12');
    assert.equal(finished.data.weekly.missions.find(mission => mission.id === 'test_week_distance').progress, 1);

    const another = await state.startRun(api, 'char_volt');
    state.now += 1000;
    const repeatedCharacter = await state.finish(api, another.data.runId, { frames: voltFrames, actions: [] }, RUN_MS(voltFrames));
    assert.equal(repeatedCharacter.data.weekly.missions.find(mission => mission.id === 'test_week_chars').progress, 1);
    const third = await state.startRun(api, 'char_ama');
    state.now += 1000;
    const amaFrames = deathRunFrames('char_ama');
    const newCharacter = await state.finish(api, third.data.runId, { frames: amaFrames, actions: [] }, RUN_MS(amaFrames));
    assert.equal(newCharacter.data.weekly.missions.find(mission => mission.id === 'test_week_chars').progress, 2);
  } finally { await state.close(api); }
});

test('invalid inputs, forged summaries, CSRF, stale claims, and body caps fail as JSON errors', async () => {
  const state = await setup({ limits: { bodyBytes: 128 } });
  let api;
  try {
    api = await state.create();
    const noOrigin = await api.call('POST', '/api/missions/session', undefined, { origin: '' });
    assert.equal(noOrigin.response.status, 403);
    const crossOrigin = await api.call('POST', '/api/missions/session', undefined, { origin: 'http://attacker.invalid' });
    assert.equal(crossOrigin.response.status, 403);
    await state.session(api);
    const validCookie = await api.call('GET', '/api/missions', undefined);
    assert.equal(validCookie.response.status, 200);
    api.cookie = `unrelated=present; ${api.cookie}; another=value`;
    assert.equal((await api.call('GET', '/api/missions')).response.status, 200, 'auth cookie need not be first');
    api.cookie = 'tr_mission_session=' + '0'.repeat(64);
    assert.equal((await api.call('GET', '/api/missions')).response.status, 401);
    await state.session(api);

    assert.equal((await state.startRun(api, 'char_volt', { seed: -1 })).response.status, 400);
    assert.equal((await state.startRun(api, 'not_a_character')).response.status, 400);
    assert.equal((await state.startRun(api, 'skin_volt_default')).response.status, 400);
    const locked = state.content.characters.items.find(item => item.id === 'char_ama');
    locked.locked = true;
    assert.equal((await state.startRun(api, 'char_ama')).response.status, 400);
    const started = await state.startRun(api);
    const id = started.data.runId;
    const forged = await api.call('POST', `/api/missions/runs/${id}/finish`, { frames: 60, actions: [], summary: { score: 999999 } });
    assert.equal(forged.response.status, 400);
    assert.equal((await api.call('POST', `/api/missions/runs/${id}/finish`, { frames: 0, actions: [] })).response.status, 400);
    assert.equal((await api.call('POST', `/api/missions/runs/${id}/finish`, { frames: 60, actions: [{ frame: 60, action: 'jump' }] })).response.status, 400);
    assert.equal((await api.call('POST', `/api/missions/runs/${id}/finish`, { frames: 60, actions: [{ frame: 0, action: 'teleport' }] })).response.status, 400);
    const extraAction = await api.call('POST', '/api/missions/runs/' + id + '/finish', { frames: 60, actions: [{ frame: 0, action: 'jump', summary: { score: 1 } }] });
    assert.equal(extraAction.response.status, 400);
    const large = await api.call('POST', `/api/missions/runs/${id}/finish`, undefined, { rawBody: 'x'.repeat(256) });
    assert.equal(large.response.status, 413);
    for (const result of [noOrigin, crossOrigin, forged, large]) assert.equal(typeof result.data.error, 'string');
    const stale = await api.call('POST', '/api/missions/claim', { period: 'daily', periodId: '2000-01-01', missionId: 'test_distance' });
    assert.equal(stale.response.status, 409);
  } finally { await state.close(api); }
});

test('too-short runs finish but never add mission progress; economy sets the 10-second threshold', async () => {
  const content = loadMissionContent();
  assert.equal(content.economy.params.missions.minRunSeconds, 10);
  const state = await setup({ minRunSeconds: 10 });
  let api;
  try {
    api = await state.create();
    await state.session(api);
    const started = await state.startRun(api);
    const result = await state.finish(api, started.data.runId, { frames: 30, actions: [] });
    assert.equal(result.response.status, 200);
    assert.equal(result.data.daily.missions.find(mission => mission.id === 'test_distance').progress, 0);
    const repeat = await api.call('POST', `/api/missions/runs/${started.data.runId}/finish`, { frames: 30, actions: [] });
    assert.equal(repeat.response.status, 200);
  } finally { await state.close(api); }
});

test('rate limits expire and configured public origin controls Secure cookies', async () => {
  const limited = await setup({ limits: { ipRequestsPerMinute: 1 } });
  let api;
  try {
    api = await limited.create();
    await limited.session(api);
    const blocked = await api.call('GET', '/api/missions');
    assert.equal(blocked.response.status, 429);
    assert.equal(typeof blocked.data.error, 'string');
    limited.now += 60_001;
    assert.equal((await snapshot(api)).daily.missions.length, 3);
  } finally { await limited.close(api); }

  const proxied = await setup({ publicOrigin: 'https://game.example' });
  let proxyApi;
  try {
    proxyApi = await proxied.create();
    const wrong = await proxyApi.call('POST', '/api/missions/session', undefined, { origin: 'https://other.example' });
    assert.equal(wrong.response.status, 403);
    const session = await proxyApi.call('POST', '/api/missions/session', undefined, { origin: 'https://game.example' });
    assert.equal(session.response.status, 201);
    assert.match(session.response.headers.get('set-cookie'), /Secure/i);
  } finally { await proxied.close(proxyApi); }
});

test('trusted proxy uses only an overwritten single client IP, untrusted headers cannot bypass limits', async () => {
  for (const trusted of [false, true]) {
    const state = await setup({ limits: { ipRequestsPerMinute: 1 }, trustedProxy: trusted ? '127.0.0.1' : undefined });
    let api;
    try {
      api = await state.create();
      assert.equal((await api.call('POST', '/api/missions/session', {}, { realIp: '192.0.2.1' })).response.status, 201);
      assert.equal((await api.call('GET', '/api/missions', undefined, { realIp: '192.0.2.2' })).response.status, trusted ? 200 : 429);
      assert.equal((await api.call('GET', '/api/missions', undefined, { realIp: '192.0.2.2' })).response.status, 429);
    } finally { await state.close(api); }
  }
});

test('concurrent finish credits once; rewards and claim flags survive restart; other visitors cannot settle ticket', async () => {
  const state = await setup();
  const daily = state.content.economy.params.missions.daily.pool[0];
  daily.metric = 'runs'; daily.type = 'count'; daily.target = 1;
  let api;
  try {
    api = await state.create(); await state.session(api);
    const originalCookie = api.cookie;
    const started = await state.startRun(api);
    const concurrentFrames = deathRunFrames('char_volt', [{ frame: 0, action: 'slide' }]);
    const payload = { frames: concurrentFrames, actions: [{ frame: 0, action: 'slide' }] };
    state.now += RUN_MS(concurrentFrames);
    api.cookie = ''; await state.session(api);
    assert.equal((await api.call('POST', `/api/missions/runs/${started.data.runId}/finish`, payload)).response.status, 404);
    api.cookie = originalCookie;
    const results = await Promise.all([0, 1].map(() => api.call('POST', `/api/missions/runs/${started.data.runId}/finish`, payload)));
    assert.deepEqual(results.map(result => result.response.status), [200, 200]);
    const id = results[0].data.daily.periodId;
    await api.call('POST', '/api/missions/claim', { period: 'daily', periodId: id, missionId: daily.id });
    await api.app.close(); api = await state.create();
    assert.equal((await snapshot(api)).wallet.coin, 7);
    assert.equal((await api.call('POST', '/api/missions/claim', { period: 'daily', periodId: id, missionId: daily.id })).data.wallet.coin, 7);
    const rows = api.app.store.db.prepare('SELECT progress_json FROM mission_periods WHERE period_type = ?').all('daily');
    assert.equal(Math.max(...rows.map(row => JSON.parse(row.progress_json)[daily.id] ?? 0)), 1);
  } finally { await state.close(api); }
});

test('weekly rollover rejects old claims and does not carry an old run into the new week', async () => {
  const state = await setup({ startTime: Date.UTC(2026, 9, 18, 15, 59, 59) });
  let api;
  try {
    api = await state.create(); await state.session(api);
    const old = await snapshot(api);
    const started = await state.startRun(api);
    state.now += 2000;
    const finish = await api.call('POST', `/api/missions/runs/${started.data.runId}/finish`, { frames: 60, actions: [] });
    assert.equal(finish.response.status, 200);
    assert.notEqual(finish.data.weekly.periodId, old.weekly.periodId);
    assert.ok(finish.data.weekly.missions.every(mission => mission.progress === 0));
    assert.equal((await api.call('POST', '/api/missions/claim', {
      period: 'weekly', periodId: old.weekly.periodId, missionId: old.weekly.missions[0].id,
    })).response.status, 409);
  } finally { await state.close(api); }
});

test('replay wall-clock timeout, open-run cap, and data purge guardrails', async () => {
  const state = await setup({ limits: { replayWallClockMs: 0, openRunsPerUser: 2 } });
  let api;
  try {
    api = await state.create();
    await state.session(api);
    const frames = deathRunFrames('char_volt');
    // 墙钟超时（0ms 必然在首个 600 帧检查点触发）：408 且 run 保持 open 可重试
    const started = await state.startRun(api);
    const timedOut = await state.finish(api, started.data.runId, { frames, actions: [] }, RUN_MS(frames));
    assert.equal(timedOut.response.status, 408, JSON.stringify(timedOut.data));
    // open-run 上限：已有 1 个 open，第 2 个放行，第 3 个 429
    assert.equal((await state.startRun(api)).response.status, 201);
    assert.equal((await state.startRun(api)).response.status, 429);
    // 数据清理：runs 全部拨到保留期外 → 清 2 条；该用户从此无 runs → 连带清除沉睡用户
    const store = api.app.store;
    store.db.prepare('UPDATE runs SET started_at = ?').run(state.now - 8 * 86400000);
    store.db.prepare('UPDATE users SET created_at = ?').run(state.now - 31 * 86400000);
    const purged = store.purge(state.now);
    assert.equal(purged.staleOpenRuns, 2, JSON.stringify(purged));
    assert.equal(purged.finishedRuns, 0);
    assert.equal(purged.runlessUsers, 1);
    assert.equal((await api.call('GET', '/api/missions')).response.status, 401, '用户已清理，旧会话失效');
  } finally { await state.close(api); }
});

test('装备道具随票提交：重放同清单注入则 validRun 成立；无效/重复道具 400（道具闭环 M）', async () => {
  const state = await setup();
  let api;
  try {
    api = await state.create();
    await state.session(api);
    const items = ['item_helmet'];
    const frames = deathRunFrames('char_volt', [], items);
    assert.ok(frames > 0 && frames !== deathRunFrames('char_volt', [], []), '头盔改变了无操作轨迹（注入生效的前提：lifeAdd 20s 覆盖首死）');
    const started = await state.startRun(api, 'char_volt', { items });
    assert.equal(started.response.status, 201);
    const finished = await state.finish(api, started.data.runId, { frames, actions: [] }, RUN_MS(frames));
    assert.equal(finished.response.status, 200, JSON.stringify(finished.data));
    assert.equal(finished.data.daily.missions.find(mission => mission.id === 'test_distance').progress, 1,
      '道具局重放同清单复现 → validRun 成立');
    const bad = await state.startRun(api, 'char_volt', { items: ['item_ghost'] });
    assert.equal(bad.response.status, 400);
    const dup = await state.startRun(api, 'char_volt', { items: ['item_magnet', 'item_magnet'] });
    assert.equal(dup.response.status, 400);
    const over = await state.startRun(api, 'char_volt', { items: ['item_magnet', 'item_boots', 'item_shield', 'item_xp_card'] });
    assert.equal(over.response.status, 400);
  } finally { await state.close(api); }
});

test('purge retains earned wallets and progress when their last run expires', async () => {
  const { MissionStore } = await import('../apps/server/src/store.mjs');
  const store = new MissionStore(':memory:');
  const day = 86400000;
  try {
    for (const id of ['wallet', 'progress', 'claimed', 'characters', 'empty']) {
      store.createUser(id, 0);
      store.ensurePeriod(id, 'daily', 'day32', []);
      store.createRun({ id, userId: id, startedAt: 32 * day, dailyId: 'day32', weeklyId: 'week', seed: 123, charId: '' });
      store.markRunFinished(id, 32 * day, 'hash', true);
    }
    store.addWallet('wallet', 'coin', 1234);
    store.saveProgress('progress', 'daily', 'day32', { distance: 120 });
    store.saveClaimed('claimed', 'daily', 'day32', { distance: true });
    store.addWeeklyCharacter('characters', 'week', 'char_volt');
    assert.deepEqual(store.purge(40 * day), { finishedRuns: 5, staleOpenRuns: 0, runlessUsers: 1 });
    for (const id of ['wallet', 'progress', 'claimed', 'characters']) assert.equal(store.hasUser(id), true, id);
    assert.equal(store.hasUser('empty'), false);
    assert.deepEqual(store.getWallet('wallet'), { coin: 1234 });
    assert.deepEqual(store.getPeriod('progress', 'daily', 'day32').progress, { distance: 120 });
    assert.deepEqual(store.getPeriod('claimed', 'daily', 'day32').claimed, { distance: true });
  } finally { store.close(); }
});

test('expired tickets release open-run slots before purge and respect a configured TTL', async () => {
  const ttl = 60_000;
  const state = await setup({ limits: { runTicketTtlMs: ttl, openRunsPerUser: 2, purgeIntervalMs: 0 } });
  let api;
  try {
    api = await state.create();
    await state.session(api);
    const first = await state.startRun(api);
    assert.equal(first.response.status, 201);
    assert.equal((await state.startRun(api)).response.status, 201);
    assert.equal((await state.startRun(api)).response.status, 429);
    state.now += ttl;
    assert.equal((await state.startRun(api)).response.status, 429, 'tickets remain valid at exactly TTL');
    state.now += 1;
    const expired = await state.finish(api, first.data.runId, { frames: 1, actions: [] }, 0);
    assert.equal(expired.response.status, 410);
    assert.equal((await state.startRun(api)).response.status, 201, 'expired rows must not block a new run');
    const purged = api.app.store.purge(state.now, { runTicketTtlMs: ttl });
    assert.equal(purged.staleOpenRuns, 2);
    assert.equal(purged.runlessUsers, 0);
    assert.equal((await state.startRun(api)).response.status, 201);
    assert.equal((await state.startRun(api)).response.status, 429, 'fresh tickets still count');
  } finally { await state.close(api); }
});
