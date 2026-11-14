import test from 'node:test';
import assert from 'node:assert/strict';
import { connectWxCloud } from '../apps/wx/build/platform/cloudClient.js';
import { parseCloudProfile } from '../apps/wx/build/platform/cloudProtocol.js';
import { parseWelfareSnapshot } from '../apps/wx/build/platform/welfareProtocol.js';

const config = { envId: 'isolated-contract-env', functionName: 'thunder-api' };
const profile = () => ({
  schemaVersion: 1, revision: 0, playerId: `p_${'a'.repeat(64)}`,
  wallet: { coin: 0, diamond: 0 }, inventory: { characters: ['char_volt'], items: {} },
  preferences: { characterId: 'char_volt', themeId: 'theme_seaside_day' },
  createdAt: '2026-11-06T10:00:00.000Z', updatedAt: '2026-11-06T10:00:00.000Z',
});
function fixture(respond = () => ({ ok: true, profile: profile() })) {
  const calls = [], inits = [];
  return { calls, inits, wx: { cloud: {
    init(value) { inits.push(value); },
    async callFunction(options) { calls.push(options); return { result: await respond(options.data) }; },
  } } };
}

test('未配置env不初始化SDK；配置错误/缺SDK明确失败', async () => {
  const f = fixture();
  assert.equal(await connectWxCloud(f.wx, { ...config, envId: '' }), null);
  assert.deepEqual(f.inits, []); assert.deepEqual(f.calls, []);
  await assert.rejects(connectWxCloud(f.wx, {}), { code: 'INVALID_CONFIG' });
  await assert.rejects(connectWxCloud({}, config), { code: 'CLOUD_UNAVAILABLE' });
});

test('连接仅发送profile.get，不提交客户端身份/钱包；采用云端档案', async () => {
  const f = fixture(), client = await connectWxCloud(f.wx, config);
  assert.deepEqual(f.inits, [{ env: config.envId, traceUser: false }]);
  assert.deepEqual(f.calls, [{ name: config.functionName, data: { action: 'profile.get' } }]);
  assert.deepEqual(client.read(), profile());
});

test('对局凭据/提交/取消与排行榜协议一致，提交返回才改变钱包并通知', async () => {
  const next = { ...profile(), revision: 1, wallet: { coin: 17, diamond: 0 }, updatedAt: '2026-11-06T10:01:00.000Z' };
  const leaderboard = { entries: [{ rank: 1, playerName: '跑者', distance: 50, score: 500, charId: 'char_volt' }], personal: null, playerName: '跑者' };
  const f = fixture(data => {
    if (data.action === 'run.begin') return { ok: true, ticket: { runId: 'run-1', seed: 123, rulesId: data.rulesId } };
    if (data.action === 'run.finish') return { ok: true, profile: next, accepted: true };
    if (data.action === 'run.cancel') return { ok: true };
    if (data.action === 'leaderboard.list') return { ok: true, leaderboard };
    return { ok: true, profile: profile() };
  });
  const client = await connectWxCloud(f.wx, config);
  let notifications = 0;
  const off = client.subscribe(() => notifications++);
  assert.deepEqual(await client.leaderboard.begin('char_volt', 'rules-1'), { runId: 'run-1', seed: 123, rulesId: 'rules-1' });
  assert.equal(client.read().wallet.coin, 0);
  const replay = { runId: 'run-1', frames: 1200, inputs: [{ frame: 0, action: 'jump' }] };
  assert.deepEqual(await client.leaderboard.submit(replay), { accepted: true });
  assert.equal(client.read().wallet.coin, 17); assert.equal(notifications, 1);
  assert.deepEqual(f.calls.at(-1).data, { ...replay, action: 'run.finish' });
  assert.deepEqual(await client.leaderboard.list(), leaderboard);
  await client.leaderboard.cancel('run-1');
  assert.deepEqual(f.calls.at(-1).data, { runId: 'run-1', action: 'run.cancel' });
  off(); await client.refresh();
  assert.equal(notifications, 1);
  assert.equal(client.read().wallet.coin, 17, 'older profile response must not replace confirmed settlement');
});

test('服务失败不会伪造档案或成功发奖，网络内部错误不进入玩家消息', async () => {
  const denied = fixture(() => ({ ok: false, error: { code: 'APP_NOT_ALLOWED', message: '应用未获授权' } }));
  await assert.rejects(connectWxCloud(denied.wx, config), { code: 'APP_NOT_ALLOWED' });
  const network = fixture(() => { throw new Error('private transport detail'); });
  await assert.rejects(connectWxCloud(network.wx, config), error => error.code === 'NETWORK_UNAVAILABLE'
    && !error.message.includes('private'));
  const f = fixture(data => data.action === 'run.finish'
    ? { ok: false, error: { code: 'RUN_REJECTED', message: '记录未通过校验' } }
    : { ok: true, profile: profile() });
  const client = await connectWxCloud(f.wx, config);
  await assert.rejects(client.leaderboard.submit({ runId: '1', frames: 100, inputs: [] }), { code: 'RUN_REJECTED' });
  assert.equal(client.read().wallet.coin, 0);
});

test('档案/凭据响应边界拒绝坏余额、未拥有出战和不匹配规则', async () => {
  for (const edit of [
    p => { p.wallet.coin = -1; }, p => { p.wallet.coin = '20'; },
    p => { p.inventory.items.key = 1.2; }, p => { p.preferences.characterId = 'char_niu'; },
    p => { p.schemaVersion = 2; }, p => { p.stats = { runs: 1 }; },
  ]) {
    const p = profile(); edit(p); assert.throws(() => parseCloudProfile(p), { code: 'INVALID_RESPONSE' });
  }
  const f = fixture(data => data.action === 'run.begin'
    ? { ok: true, ticket: { runId: '1', seed: 1, rulesId: 'different' } }
    : { ok: true, profile: profile() });
  const client = await connectWxCloud(f.wx, config);
  await assert.rejects(client.leaderboard.begin('char_volt', 'expected'), { code: 'INVALID_RESPONSE' });
});

test('同毫秒的结算响应逆序到达仍保留最高revision，不以实例时钟排序', async () => {
  const resolve = [];
  const f = fixture(data => data.action === 'run.finish'
    ? new Promise(done => resolve.push(done)) : { ok: true, profile: profile() });
  const client = await connectWxCloud(f.wx, config);
  const first = client.leaderboard.submit({ runId: 'old', frames: 100, inputs: [] });
  const second = client.leaderboard.submit({ runId: 'new', frames: 100, inputs: [] });
  const next = revision => ({ ...profile(), revision, wallet: { coin: revision * 17, diamond: 0 } });
  resolve[1]({ ok: true, accepted: true, profile: next(2) }); await second;
  resolve[0]({ ok: true, accepted: true, profile: next(1) }); await first;
  assert.equal(client.read().revision, 2); assert.equal(client.read().wallet.coin, 34);
  const third = client.leaderboard.submit({ runId: 'latest', frames: 100, inputs: [] });
  resolve[2]({ ok: true, accepted: true, profile: { ...next(3), updatedAt: '2026-11-06T09:59:59.999Z' } });
  await third;
  assert.equal(client.read().revision, 3); assert.equal(client.read().wallet.coin, 51);
});

function welfare(revision = 1) {
  const mission = { id: 'daily', title: '完成跑酷', metric: 'runs', target: 1, progress: 1, reward: { coin: 200 }, claimed: false };
  return {
    profile: { ...profile(), revision }, serverTime: 1793958400000, minRunSeconds: 10,
    daily: { periodId: '2026-11-06', resetsAt: 1793980800000, missions: [mission] },
    weekly: { periodId: '2026-11-02', resetsAt: 1794153600000, missions: [] },
    handbook: [{ ...mission, id: 'first', description: '初次出发', unlocked: true }],
  };
}

test('任务和手册客户端发送领取标识，不发送奖励金额；同一云钱包随服务端快照更新', async () => {
  const state = welfare();
  const f = fixture(data => {
    if (data.action === 'profile.get') return { ok: true, profile: profile() };
    if (data.action === 'mission.claim') {
      state.profile.revision++; state.profile.wallet.coin += 200; state.daily.missions[0].claimed = true;
    }
    if (data.action === 'handbook.claim') {
      state.profile.revision++; state.profile.wallet.diamond = 10; state.handbook[0].claimed = true;
    }
    return { ok: true, welfare: structuredClone(state) };
  });
  const client = await connectWxCloud(f.wx, config);
  assert.equal((await client.welfare.load()).daily.missions[0].claimed, false);
  const mission = await client.welfare.claimMission('daily', '2026-11-06', 'daily');
  assert.equal(mission.daily.missions[0].claimed, true); assert.equal(client.read().wallet.coin, 200);
  assert.deepEqual(f.calls.at(-1).data, { action: 'mission.claim', period: 'daily', periodId: '2026-11-06', missionId: 'daily' });
  await client.welfare.claimChapter('first');
  assert.equal(client.read().wallet.diamond, 10);
  assert.deepEqual(f.calls.at(-1).data, { action: 'handbook.claim', chapterId: 'first' });
});

test('福利错误与格式错误不修改钱包；quit合法结算可未入榜而仍更新进度快照', async () => {
  const f = fixture(data => {
    if (data.action === 'profile.get') return { ok: true, profile: profile() };
    if (data.action === 'mission.claim') return { ok: false, error: { code: 'PERIOD_EXPIRED', message: '任务已刷新' } };
    if (data.action === 'run.finish') return { ok: true, accepted: false,
      profile: { ...profile(), revision: 1, wallet: { coin: 5, diamond: 0 } } };
    return { ok: true, welfare: {} };
  });
  const client = await connectWxCloud(f.wx, config);
  await assert.rejects(client.welfare.load(), { code: 'INVALID_RESPONSE' });
  await assert.rejects(client.welfare.claimMission('daily', 'old', 'daily'), { code: 'PERIOD_EXPIRED' });
  assert.equal(client.read().wallet.coin, 0);
  assert.deepEqual(await client.leaderboard.submit({ runId: 'quit', frames: 600, inputs: [], finishReason: 'quit' }), { accepted: false });
  assert.equal(client.read().wallet.coin, 5);
  assert.equal(f.calls.at(-1).data.finishReason, 'quit');
  const malformed = welfare(); malformed.handbook[0].unlocked = 'yes';
  assert.throws(() => parseWelfareSnapshot(malformed), { code: 'INVALID_RESPONSE' });
});
