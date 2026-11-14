/**
 * 成就 API 传输层与 web 壳接线测试（此前该层零覆盖，achievements-client.test.mjs 注入假
 * achievementsApi 绕过了它——同构的 MissionApiCore 有 mission-client/wx-mission-api 两份直测）：
 * - AchievementsApiCore：load/claim 走线、onSnapshot 回调、网络失败/无效数据包装、status>=400 带 status 上抛；
 * - 401 自愈：复位共享会话（MissionApiCore.invalidateSession），下次请求重走 /session——与任务 API 对称；
 * - web 壳：AchievementsApi（fetch 同源 cookie）+ missionIntegration 接线，快照钱包经
 *   wallet.syncRewards 入本机钱包（web 端唯一发奖链路，漏传 wallet 即静默延迟入账）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { AchievementsApiCore } from '../packages/game/dist/flow/achievementApiCore.js';
import { MissionApiCore } from '../packages/game/dist/flow/missionApiCore.js';
import { createRewardWalletStore } from '../packages/game/dist/flow/missionRewardWallet.js';
import { walletBalance } from '../packages/game/dist/flow/localEconomy.js';
import { importWebModule } from './dom-fixture.mjs';

const snapshot = over => ({ serverTime: 1, rewardLedgerId: 'u1', achievements: [], wallet: { coin: 12 }, ...over });

/** 记录请求并按队列应答的假传输（throw 项=网络失败） */
const makeTransport = responses => {
  const calls = [];
  return {
    calls,
    async request(path, method, body) {
      calls.push({ path, method, body });
      const next = responses.shift();
      if (!next) throw new Error('测试响应队列已空');
      if (next.throw) throw next.throw;
      return { status: next.status ?? 200, data: next.data ?? null };
    },
  };
};
const makeSession = () => {
  const calls = [];
  return {
    calls,
    ensureConnected: async () => { calls.push('ensure'); },
    invalidateSession() { calls.push('invalidate'); },
  };
};

test('AchievementsApiCore：load/claim 走线、onSnapshot 回调并透传快照', async () => {
  const transport = makeTransport([{ data: snapshot() }, { data: snapshot({ wallet: { coin: 30 } }) }]);
  const session = makeSession();
  const seen = [];
  const api = new AchievementsApiCore(transport, session, snap => seen.push(snap));
  const loaded = await api.load();
  assert.deepEqual(session.calls, ['ensure'], '先过共享会话');
  assert.deepEqual(transport.calls, [{ path: '', method: 'GET', body: undefined }]);
  assert.equal(loaded.wallet.coin, 12);
  assert.equal(seen.length, 1, 'load 同样回调 onSnapshot（壳层入本机钱包的唯一通道）');
  const claimed = await api.claim('ach_x');
  assert.deepEqual(transport.calls[1], { path: '/claim', method: 'POST', body: { achievementId: 'ach_x' } });
  assert.equal(claimed.wallet.coin, 30);
  assert.equal(seen.length, 2);
});

test('AchievementsApiCore：网络失败/无效数据/HTTP 错误的包装语义', async () => {
  { // 网络失败：包装为统一文案，不带 status
    const api = new AchievementsApiCore(makeTransport([{ throw: new Error('ECONNREFUSED') }]), makeSession());
    await assert.rejects(api.load(), error => error.message === '成就服务暂时不可用，请稍后重试' && error.status === undefined);
  }
  { // status>=400：服务端 error 原文 + status 上抛
    const api = new AchievementsApiCore(makeTransport([{ status: 503, data: { error: '维护中' } }]), makeSession());
    await assert.rejects(api.load(), error => error.message === '维护中' && error.status === 503);
  }
  { // 空/非对象数据：无效数据错误
    const api = new AchievementsApiCore(makeTransport([{ data: null }]), makeSession());
    await assert.rejects(api.load(), /无效数据/);
  }
  { // onSnapshot 抛错（本机钱包损坏）原样上抛：调用方据 message 显示真实原因，不得吞成网络口径
    const api = new AchievementsApiCore(makeTransport([{ data: snapshot() }]), makeSession(),
      () => { throw new Error('本机钱包记录损坏，请保留存档并联系支持'); });
    await assert.rejects(api.load(), /钱包记录损坏/);
  }
});

test('AchievementsApiCore：401 复位共享会话（invalidateSession），下次请求重连', async () => {
  const session = makeSession();
  const api = new AchievementsApiCore(
    makeTransport([{ status: 401, data: { error: '游客会话无效' } }, { data: snapshot() }]), session);
  await assert.rejects(api.load(), /游客会话无效/);
  assert.deepEqual(session.calls, ['ensure', 'invalidate'], '401 复位共享会话缓存（与任务 API 对称）');
  await api.load();
  assert.deepEqual(session.calls, ['ensure', 'invalidate', 'ensure'], '下次 load 重新建会话，401 循环被打断');
});

test('共享会话端到端：真 MissionApiCore 的缓存会话 401 后重连', async () => {
  const calls = [];
  const transport = {
    async request(path) {
      calls.push(path);
      if (path === '/session') return { status: 201, data: { ok: true } };
      return calls.filter(p => p === '').length === 1
        ? { status: 401, data: { error: '游客会话无效，请重新创建会话' } }
        : { status: 200, data: snapshot() };
    },
  };
  const mission = new MissionApiCore(transport, { get: () => null, set: () => {} });
  const api = new AchievementsApiCore(transport, mission);
  await assert.rejects(api.load(), /游客会话无效/);
  const loaded = await api.load();
  assert.equal(loaded.rewardLedgerId, 'u1');
  assert.equal(calls.filter(p => p === '/session').length, 2, '401 复位后重走 /session');
});

// ---------------- web 壳（importWebModule，fetch 桩） ----------------

test('web 壳接线：AchievementsApi 经 missionIntegration 注入，快照钱包入本机钱包且 401 自愈', async t => {
  const originalFetch = globalThis.fetch, originalStorage = globalThis.localStorage;
  t.after(() => { globalThis.fetch = originalFetch; globalThis.localStorage = originalStorage; });
  const store = new Map();
  globalThis.localStorage = {
    getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k),
  };
  const calls = [];
  let sessions = 0, healed = false;
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith('/api/missions/session')) { sessions++; return Response.json({ ok: true }, { status: 201 }); }
    if (!healed) { healed = true; return Response.json({ error: '游客会话无效，请重新创建会话' }, { status: 401 }); }
    return Response.json(snapshot({ wallet: { coin: 40 } }));
  };
  const wallet = createRewardWalletStore({
    get: k => store.get(k) ?? null, set: (k, v) => store.set(k, v), remove: k => store.delete(k),
  });
  const { AchievementsApi } = await importWebModule('../apps/web/src/achievementsApi.ts');
  const { createMissionIntegration } = await importWebModule('../apps/web/src/missionIntegration.ts');
  const integration = createMissionIntegration(false, wallet);
  assert.equal(typeof integration.achievementsApi.load, 'function', 'missionIntegration 暴露成就 API');
  assert.equal(typeof integration.achievementsApi.claim, 'function');
  await assert.rejects(integration.achievementsApi.load(), /游客会话无效/, '首载 401 原样上抛');
  const loaded = await integration.achievementsApi.load();
  assert.equal(loaded.wallet.coin, 40);
  assert.equal(sessions, 2, '401 复位共享会话后重连（自愈对称）');
  assert.equal(walletBalance(wallet, 'coin'), 40, '快照钱包经 onSnapshot→wallet.syncRewards 入本机钱包（漏传 wallet 此处即红）');
  await integration.achievementsApi.claim('ach_slides_100');
  const claimCall = calls.at(-1);
  assert.equal(claimCall.url, '/api/achievements/claim');
  assert.equal(claimCall.options.credentials, 'same-origin');
  assert.deepEqual(JSON.parse(claimCall.options.body), { achievementId: 'ach_slides_100' });
  assert.equal(walletBalance(wallet, 'coin'), 40, '重复快照幂等不重复入账');
});
