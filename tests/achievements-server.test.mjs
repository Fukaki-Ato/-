import nodeTest from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const [major, minor] = process.versions.node.split('.').map(Number);
const sqliteSupported = major > 22 || (major === 22 && minor >= 13);
const test = sqliteSupported ? nodeTest : nodeTest.skip;
const { createMissionHttpServer } = sqliteSupported ? await import('../apps/server/src/http.mjs') : {};
const { MissionStore } = sqliteSupported ? await import('../apps/server/src/store.mjs') : {};
const { AchievementService, validateAchievementsConfig } = sqliteSupported ? await import('../apps/server/src/achievement-service.mjs') : {};
const { replayRun } = sqliteSupported ? await import('../apps/server/src/replay.mjs') : {};
import { loadMissionContent } from '../apps/server/src/content.mjs';
import { RunnerSim } from '../packages/game/dist/core/sim/runnerSim.js';

const REAL_CONTENT = loadMissionContent();

/** 测试内容：真实 9 文件为底，任务池取 missions 测试同款（minRunSeconds 0），成就池换成小型确定性集合 */
function testContent() {
  const content = structuredClone(REAL_CONTENT);
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
  const entry = (id, stat, extra = {}) => ({
    id, versions: [{}], name: { 'zh-CN': id }, desc: { 'zh-CN': id },
    stat, target: 1, tier: 'bronze', source: 'run', group: 'run', reward: { coin: 5 }, ...extra,
  });
  content.achievements = { configVersion: '1.0.0', items: [
    entry('ach_test_slide', 'slides', { reward: { coin: 5 } }),
    entry('ach_test_jumps', 'jumps'),
    entry('ach_test_runs', 'runs', { target: 2, reward: { key: 1 } }),
    entry('ach_test_score', 'score', { target: 50, reward: { diamond: 1 } }),
    entry('ach_test_far', 'distanceM', { target: 999999, reward: { coin: 9 } }),
    entry('ach_test_magnet', 'itemOf', { statRef: 'item_magnet', group: 'collect', reward: { shard: 'shard_volt:2' } }),
    entry('ach_test_local', 'charactersUnlocked', { source: 'local', group: 'chars', target: 3, reward: { coin: 800 } }),
  ] };
  return content;
}

/** 与 missions 测试同款：真实确定性死亡局（死亡收尾才是 validRun），跑到死返回帧数 */
function deathRunFrames(content, seed, charId, actions = []) {
  const sim = new RunnerSim(content, seed, charId);
  let cursor = 0, frames = 0;
  for (let frame = 0; frame < 10000; frame++) {
    while (cursor < actions.length && actions[cursor].frame === frame) { sim.applyAction(actions[cursor].action); cursor++; }
    sim.step(); sim.drainEvents(); frames++;
    if (!sim.state.alive) break;
  }
  assert.equal(sim.state.alive, false, '无操作测试局必须死亡收尾');
  return frames;
}

const RUN_MS = frames => frames * 1000 / 60 + 500;

async function setup({ startTime = Date.UTC(2026, 9, 12, 4), limits = {}, minRunSeconds = 0 } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'thunder-achievements-'));
  const state = { cookie: '', directory, dbPath: join(directory, 'missions.sqlite'), now: startTime };
  state.create = async () => {
    const app = createMissionHttpServer({
      dbPath: state.dbPath, content: testContent(), now: () => state.now, limits, minRunSeconds,
    });
    await new Promise((resolve, reject) => {
      app.server.once('error', reject);
      app.server.listen(0, '127.0.0.1', resolve);
    });
    const base = `http://127.0.0.1:${app.server.address().port}`;
    const call = async (method, path, body, options = {}) => {
      const headers = { Origin: options.origin ?? base };
      if (state.cookie) headers.Cookie = state.cookie;
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      const response = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      const text = await response.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = text; }
      const setCookie = response.headers.get('set-cookie');
      if (setCookie) state.cookie = setCookie.split(';', 1)[0];
      return { response, data };
    };
    return { app, base, call };
  };
  state.close = async api => { if (api) await api.app.close(); rmSync(directory, { recursive: true, force: true }); };
  state.session = async api => assert.equal((await api.call('POST', '/api/missions/session')).response.status, 201);
  state.startRun = (api, extra = {}) => api.call('POST', '/api/missions/runs', { seed: 123, charId: 'char_volt', ...extra });
  return state;
}

const achievements = async api => {
  const result = await api.call('GET', '/api/achievements');
  assert.equal(result.response.status, 200, JSON.stringify(result.data));
  return result.data;
};
const entryOf = (snap, id) => snap.achievements.find(item => item.id === id);

test('成就快照端点：鉴权、形状对齐任务快照、local 条目不进服务端', async () => {
  const state = await setup();
  let api;
  try {
    api = await state.create();
    assert.equal((await api.call('GET', '/api/achievements')).response.status, 401, '未建会话 401');
    await state.session(api);
    const snap = await achievements(api);
    assert.match(snap.rewardLedgerId, /^[a-f0-9]{64}$/);
    assert.equal(snap.serverTime, state.now);
    assert.deepEqual(snap.wallet, {});
    assert.equal(entryOf(snap, 'ach_test_local'), undefined, 'local 条目不进服务端快照');
    assert.equal(snap.achievements.length, 6);
    const slide = entryOf(snap, 'ach_test_slide');
    assert.deepEqual(slide, {
      id: 'ach_test_slide', name: { 'zh-CN': 'ach_test_slide' }, desc: { 'zh-CN': 'ach_test_slide' },
      stat: 'slides', target: 1, tier: 'bronze', group: 'run', reward: { coin: 5 }, progress: 0, claimed: false,
    });
    const magnet = entryOf(snap, 'ach_test_magnet');
    assert.equal(magnet.stat, 'itemOf');
    assert.deepEqual(magnet.reward, { shard: 'shard_volt:2' });
  } finally { await state.close(api); }
});

test('死亡结算累计成就进度，领取入账、幂等、409/404 与错误方法 404 口径', async () => {
  const state = await setup();
  let api;
  try {
    api = await state.create();
    await state.session(api);
    const started = await state.startRun(api);
    const actions = [{ frame: 0, action: 'slide' }];
    const frames = deathRunFrames(testContent(), 123, 'char_volt', actions);
    state.now += RUN_MS(frames);
    const finished = await api.call('POST', `/api/missions/runs/${started.data.runId}/finish`, { frames, actions });
    assert.equal(finished.response.status, 200, JSON.stringify(finished.data));
    let snap = await achievements(api);
    assert.equal(entryOf(snap, 'ach_test_slide').progress, 1);
    assert.equal(entryOf(snap, 'ach_test_runs').progress, 1, 'target 2，单局进度 1');
    assert.equal(entryOf(snap, 'ach_test_jumps').progress, 0, '这局没跳');
    assert.ok(entryOf(snap, 'ach_test_score').progress >= 1, '单局分随距离必得');

    const claimed = await api.call('POST', '/api/achievements/claim', { achievementId: 'ach_test_slide' });
    assert.equal(claimed.response.status, 200);
    assert.equal(claimed.data.wallet.coin, 5, '奖励入同一钱包账本');
    assert.equal(entryOf(claimed.data, 'ach_test_slide').claimed, true);
    const repeat = await api.call('POST', '/api/achievements/claim', { achievementId: 'ach_test_slide' });
    assert.equal(repeat.response.status, 200, '已领幂等跳过');
    assert.equal(repeat.data.wallet.coin, 5, '幂等不重复发奖');

    assert.equal((await api.call('POST', '/api/achievements/claim', { achievementId: 'ach_test_far' })).response.status, 409, '未达标 409');
    assert.equal((await api.call('POST', '/api/achievements/claim', { achievementId: 'ach_test_local' })).response.status, 404, 'local 条目服务端不受理');
    assert.equal((await api.call('POST', '/api/achievements/claim', { achievementId: 'ach_nope' })).response.status, 404);
    assert.equal((await api.call('POST', '/api/achievements/claim', { achievementId: 'ach_test_runs', extra: 1 })).response.status, 400, '多余字段 400');
    assert.equal((await api.call('POST', '/api/achievements/claim', { achievementId: 5 })).response.status, 400);
    assert.equal((await api.call('POST', '/api/achievements/claim', { achievementId: 'ach_test_runs' }, { origin: '' })).response.status, 403, '无 Origin 403');
    // 方法不匹配无守卫：与 missions 端点同口径落到通用 404
    assert.equal((await api.call('POST', '/api/achievements')).response.status, 404);
    assert.equal((await api.call('GET', '/api/achievements/claim')).response.status, 404);
    snap = await achievements(api);
    assert.equal(entryOf(snap, 'ach_test_slide').claimed, true);
  } finally { await state.close(api); }
});

test('jumps/runs 跨局累加（Movement.totalJumps → 重放 metrics → 成就），进度与领取重启后仍在', async () => {
  const state = await setup();
  let api;
  try {
    api = await state.create();
    await state.session(api);
    const runAndFinish = async (seed, actions) => {
      const started = await state.startRun(api, { seed });
      const frames = deathRunFrames(testContent(), seed, 'char_volt', actions);
      state.now += RUN_MS(frames);
      const finished = await api.call('POST', `/api/missions/runs/${started.data.runId}/finish`, { frames, actions });
      assert.equal(finished.response.status, 200, JSON.stringify(finished.data));
    };
    await runAndFinish(123, [{ frame: 0, action: 'slide' }]);
    await runAndFinish(124, [{ frame: 0, action: 'jump' }]);
    let snap = await achievements(api);
    assert.equal(entryOf(snap, 'ach_test_jumps').progress, 1, '起跳局计入 jumps（服务端重放同源）');
    assert.equal(entryOf(snap, 'ach_test_runs').progress, 2, '完成局数累加');
    const claimed = await api.call('POST', '/api/achievements/claim', { achievementId: 'ach_test_runs' });
    assert.equal(claimed.data.wallet.key, 1);
    await api.app.close();
    api = await state.create();
    snap = await achievements(api);
    assert.equal(entryOf(snap, 'ach_test_jumps').progress, 1, '进度持久化');
    assert.equal(entryOf(snap, 'ach_test_runs').claimed, true, '领取状态持久化');
    assert.equal(snap.wallet.key, 1);
  } finally { await state.close(api); }
});

test('短局（未达 minRunSeconds）不产生成就进度', async () => {
  const state = await setup({ minRunSeconds: 10 });
  let api;
  try {
    api = await state.create();
    await state.session(api);
    const started = await state.startRun(api);
    state.now += 1000;
    const finished = await api.call('POST', `/api/missions/runs/${started.data.runId}/finish`, { frames: 30, actions: [] });
    assert.equal(finished.response.status, 200);
    assert.equal(entryOf(await achievements(api), 'ach_test_runs').progress, 0, 'invalid 局不入账');
  } finally { await state.close(api); }
});

test('重放 missionStats：分道具拾取/jumps 在循环内打点且与客户端同源', async () => {
  const content = REAL_CONTENT;
  // 确定性内容下前几个种子内必有一局带道具拾取；找不到说明生成内容变了，先复核再改
  let chosen = null;
  for (let seed = 1; seed <= 12 && !chosen; seed++) {
    const sim = new RunnerSim(content, seed, 'char_volt');
    const byId = {};
    let frames = 0;
    for (let frame = 0; frame < 10000; frame++) {
      if (frame === 0) sim.applyAction('jump');
      sim.step();
      for (const event of sim.drainEvents()) if (event.type === 'pickup') byId[event.itemRef] = (byId[event.itemRef] ?? 0) + 1;
      frames++;
      if (!sim.state.alive) break;
    }
    assert.equal(sim.state.alive, false);
    if (Object.keys(byId).length > 0) chosen = { seed, frames, byId, jumps: sim.missionStats.jumps };
  }
  assert.ok(chosen, '前 12 个种子应出现道具拾取');
  const replay = await replayRun(content, { seed: chosen.seed, char_id: 'char_volt' }, chosen.frames, [{ frame: 0, action: 'jump' }]);
  assert.deepEqual(replay.missionStats.itemPickupsById, chosen.byId, '分道具计数与客户端事件同源');
  assert.equal(Object.values(replay.missionStats.itemPickupsById).reduce((a, b) => a + b, 0), replay.missionStats.itemPickups,
    'pickup 事件与 grantItem 1:1，分项和等于总数');
  assert.equal(replay.missionStats.jumps, chosen.jumps);
  assert.ok(replay.missionStats.jumps >= 1, '起跳动作经 Movement.totalJumps 进入重放指标');
});

test('服务级语义：score 单局最佳、itemOf 分道具、脏指标丢弃、真实配置可直接构造', () => {
  const store = new MissionStore(':memory:');
  try {
    store.createUser('u1', 0);
    const service = new AchievementService({ store, content: testContent(), now: () => 1000 });
    service.applyRunMetrics('u1', { score: 50, slides: 2, distanceM: 12.34 });
    service.applyRunMetrics('u1', { score: 20 });
    let snap = service.snapshot('u1');
    assert.equal(entryOf(snap, 'ach_test_score').progress, 50, 'score 取单局最佳而非累加（20 不回落）');
    assert.equal(entryOf(snap, 'ach_test_slide').progress, 1, '显示进度按 target 截断');
    assert.equal(store.achievementStats('u1').slides, 2, '累加类存原值只增不减');
    assert.equal(entryOf(snap, 'ach_test_magnet').progress, 0);
    service.applyRunMetrics('u1', { score: Number.NaN, slides: -5, itemPickupsById: { item_magnet: -1, item_shield: 3 } });
    service.applyRunMetrics('u1', { itemPickupsById: { item_magnet: 2 } });
    snap = service.snapshot('u1');
    assert.equal(store.achievementStats('u1').score, 50, 'NaN 被丢弃');
    assert.equal(store.achievementStats('u1').slides, 2, '负数不减账');
    assert.equal(store.achievementStats('u1').item_shield, undefined, '未配置 statRef 的道具不建写入器');
    assert.equal(store.achievementStats('u1')['itemOf:item_magnet'], 2, 'itemOf 按 statRef 分账落 itemOf:<itemId> 键');
    assert.equal(entryOf(snap, 'ach_test_magnet').progress, 1, '显示进度按 target 截断');

    const shardClaim = service.claim('u1', { achievementId: 'ach_test_magnet' });
    assert.equal(shardClaim.wallet.shard_volt, 2, 'shard 奖励拆 id:n 入账');
    assert.equal(service.claim('u1', { achievementId: 'ach_test_score' }).wallet.diamond, 1);
    assert.deepEqual(service.snapshot('u1').wallet, { shard_volt: 2, diamond: 1 });

    // 真实 27 条配置必须过服务端校验（本地条目剔除后进入快照）
    const real = new AchievementService({ store, content: REAL_CONTENT });
    assert.equal(real.snapshot('u1').achievements.length, REAL_CONTENT.achievements.items.filter(e => e.source === 'run').length);
    assert.equal(new AchievementService({ store, content: {} }).snapshot('u1').achievements.length, 0, '无成就配置=空服务不炸');
  } finally { store.close(); }
});

test('draft/retired 下线口径：不进快照、不建写入器、claim 404；status 非法值启动即抛', () => {
  const store = new MissionStore(':memory:');
  try {
    store.createUser('u1', 0);
    const content = testContent();
    content.achievements.items.find(e => e.id === 'ach_test_slide').status = 'retired';
    content.achievements.items.find(e => e.id === 'ach_test_jumps').status = 'draft';
    assert.doesNotThrow(() => validateAchievementsConfig(content), '合法 status 值通过校验（缺 status 也合法，按 live）');
    const service = new AchievementService({ store, content, now: () => 1000 });
    service.applyRunMetrics('u1', { slides: 5, jumps: 3 });
    const snap = service.snapshot('u1');
    assert.equal(entryOf(snap, 'ach_test_slide'), undefined, 'retired 不进快照');
    assert.equal(entryOf(snap, 'ach_test_jumps'), undefined, 'draft 不进快照');
    assert.equal(store.achievementStats('u1').slides, undefined, '下线条目独占的 stat 不建写入器（不累计）');
    assert.equal(store.achievementStats('u1').jumps, undefined);
    service.applyRunMetrics('u1', { runs: 1 });
    assert.equal(store.achievementStats('u1').runs, 1, 'live 条目的 stat 照常累计');
    let status = 200;
    try { service.claim('u1', { achievementId: 'ach_test_slide' }); } catch (error) { status = error.status ?? 0; }
    assert.equal(status, 404, '下线条目 claim 按 404 拒绝');
    const bad = testContent();
    bad.achievements.items.find(e => e.id === 'ach_test_runs').status = 'archived';
    assert.throws(() => validateAchievementsConfig(bad), /status 应为/);
  } finally { store.close(); }
});

test('purge 保留有终身成就进度的沉睡用户；addStat 累加 / bestStat 取大 / addClaim 幂等', () => {
  const store = new MissionStore(':memory:');
  const day = 86400000;
  try {
    store.createUser('achiever', 0);
    store.addStat('achiever', 'slides', 3);
    store.addStat('achiever', 'slides', 2);
    store.bestStat('achiever', 'score', 100);
    store.bestStat('achiever', 'score', 40);
    store.addClaim('achiever', 'ach_test_slide', 0);
    store.createUser('empty', 0);
    assert.deepEqual(store.purge(40 * day), { finishedRuns: 0, staleOpenRuns: 0, runlessUsers: 1 });
    assert.equal(store.hasUser('achiever'), true, '有成就进度即有资产，不随沉睡清除');
    assert.equal(store.hasUser('empty'), false);
    assert.deepEqual(store.achievementStats('achiever'), { slides: 5, score: 100 });
    assert.deepEqual([...store.achievementClaims('achiever')], ['ach_test_slide']);
    store.addClaim('achiever', 'ach_test_slide', 5);
    assert.equal(store.achievementClaims('achiever').size, 1, 'addClaim 幂等');
    store.createUser('gone', 0);
    store.addClaim('gone', 'ach_test_slide', 0);
    assert.deepEqual(store.purge(40 * day), { finishedRuns: 0, staleOpenRuns: 0, runlessUsers: 1 });
    assert.equal(store.hasUser('gone'), false, '只领过奖必有 stats 行（claim 前置达标），此构造仅验证 FK CASCADE');
  } finally { store.close(); }
});

test('validateAchievementsConfig 启动即抛：前缀/重复/白名单分区/statRef/奖励', () => {
  const base = () => structuredClone(testContent()).achievements.items;
  const throws = (items, pattern) => assert.throws(() => validateAchievementsConfig(
    { ...structuredClone(REAL_CONTENT), achievements: { items } }), pattern);
  const first = base();
  first[0].id = 'wrong_prefix';
  throws(first, /ach_ 前缀/);
  const dup = base();
  dup.push({ ...dup[0] });
  throws(dup, /id 重复/);
  const runLocal = base();
  runLocal.find(e => e.id === 'ach_test_slide').stat = 'charactersUnlocked';
  throws(runLocal, /白名单/);
  const localRun = base();
  localRun.find(e => e.id === 'ach_test_local').stat = 'score';
  throws(localRun, /白名单/);
  const noRef = base();
  delete noRef.find(e => e.id === 'ach_test_magnet').statRef;
  throws(noRef, /statRef/);
  const ghostRef = base();
  ghostRef.find(e => e.id === 'ach_test_magnet').statRef = 'item_ghost';
  throws(ghostRef, /道具/);
  const strayRef = base();
  strayRef.find(e => e.id === 'ach_test_slide').statRef = 'item_magnet';
  throws(strayRef, /statRef/);
  const zeroTarget = base();
  zeroTarget.find(e => e.id === 'ach_test_slide').target = 0;
  throws(zeroTarget, /target/);
  throws(base().map(e => e.id === 'ach_test_slide' ? { ...e, reward: {} } : e), /reward/);
  throws(base().map(e => e.id === 'ach_test_slide' ? { ...e, reward: { coin: 0 } } : e), /正整数/);
  throws(base().map(e => e.id === 'ach_test_slide' ? { ...e, reward: { coin: 1.5 } } : e), /正整数/);
  throws(base().map(e => e.id === 'ach_test_slide' ? { ...e, reward: { gem: 1 } } : e), /正整数/);
  throws(base().map(e => e.id === 'ach_test_magnet' ? { ...e, reward: { shard: 'shard_volt:0' } } : e), /碎片/);
  assert.doesNotThrow(() => validateAchievementsConfig(REAL_CONTENT), '真实配置全绿');
});
