/**
 * wx 任务 API 客户端测试（M5-3）：MissionApiCore 的 wx 装配——
 * cookie jar 捕获/回传、会话键持久化、start/finish 走线、队列 storage 落盘。
 * 用注入的 mock wx.request 在 node 下直测，无需真机。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWxMissionApi } from '../apps/wx/build/platform/missionApi.js';

function makeMockWx(responder) {
  const calls = [];
  return {
    calls,
    request(opts) {
      calls.push(opts);
      Promise.resolve().then(() => responder(opts, opts.success, opts.fail));
    },
  };
}
const storage = () => {
  const map = new Map();
  return { get: key => map.get(key) ?? null, set: (key, value) => map.set(key, value), _map: map };
};
const snapshot = () => ({ serverTime: 1, wallet: {}, daily: { periodId: 'p', resetsAt: 1, missions: [] }, weekly: { periodId: 'p', resetsAt: 1, missions: [] } });

test('wx mission api：会话 cookie 捕获进 jar 并在后续请求回传', async () => {
  const store = storage();
  let phase = 0;
  const wx = makeMockWx((opts, success) => {
    phase++;
    if (phase === 1) {
      success({ statusCode: 201, data: { ok: true }, header: { 'Set-Cookie': 'tr_mission_session=abc123; Path=/; HttpOnly; SameSite=Lax' } });
    } else {
      success({ statusCode: 201, data: { runId: 'run-1' }, header: {} });
    }
  });
  const api = createWxMissionApi(wx, store);
  const runId = await api.start(123, 'char_volt');
  assert.equal(runId, 'run-1');
  assert.equal(wx.calls.length, 2);
  assert.equal(wx.calls[0].url, '/api/missions/session', '先建会话');
  assert.equal(wx.calls[1].url, '/api/missions/runs');
  assert.equal(wx.calls[1].method, 'POST');
  assert.equal(wx.calls[1].header['Content-Type'], 'application/json');
  assert.match(wx.calls[1].header.Cookie ?? '', /tr_mission_session=abc123/, '会话 cookie 回传');
  assert.match(String(store._map.get('thunderrun:mission-cookie')), /tr_mission_session/, 'jar 持久化到 storage');
  assert.deepEqual(wx.calls[1].data, { seed: 123, charId: 'char_volt' }, '请求体对象原样交给基础库（序列化是平台职责）');
});

test('wx mission api：finish 进队列并 flush；队列从 storage 恢复', async () => {
  const store = storage();
  const responses = [];
  const wx = makeMockWx((opts, success) => {
    const res = responses.shift() ?? { statusCode: 200, data: snapshot(), header: {} };
    success(res);
  });
  const api = createWxMissionApi(wx, store);
  responses.push({ statusCode: 201, data: { ok: true }, header: { 'Set-Cookie': 'tr_mission_session=s1; Path=/' } });
  responses.push({ statusCode: 201, data: { runId: 'r-1' }, header: {} });
  responses.push({ statusCode: 200, data: snapshot(), header: {} });
  await api.start(7, 'char_volt');
  await api.finish({ runId: 'r-1', frames: 900, actions: [{ frame: 0, action: 'jump' }] });
  assert.equal(wx.calls.at(-1).url, '/api/missions/runs/r-1/finish');
  assert.deepEqual(wx.calls.at(-1).data, { frames: 900, actions: [{ frame: 0, action: 'jump' }] });
  // 新实例从 storage 恢复（空队列）；再次 finish 走完整会话链
  const api2 = createWxMissionApi(wx, store);
  responses.push({ statusCode: 200, data: snapshot(), header: {} });
  await api2.load();
  assert.ok(api2.snapshot, 'load 后快照就绪');
  // 5xx 保留队列并抛错（下轮重试），404/409 类丢弃并记 feedback
  responses.length = 0;
  responses.push({ statusCode: 500, data: { error: 'boom' }, header: {} });
  await assert.rejects(api.finish({ runId: 'r-2', frames: 10, actions: [] }));
  assert.equal(JSON.parse(store._map.get('thunderrun:mission-pending-v1')).length, 1, '服务端故障保留待同步');
  responses.length = 0;
  responses.push({ statusCode: 200, data: snapshot(), header: {} });
  responses.push({ statusCode: 404, data: { error: '找不到这场跑酷记录' }, header: {} });
  await api.finish({ runId: 'r-3', frames: 10, actions: [] });
  assert.ok(api.feedback.includes('一局进度未计入'), '确定性 4xx 丢弃并给反馈');
});
