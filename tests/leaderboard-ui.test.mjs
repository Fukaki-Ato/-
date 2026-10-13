import test from 'node:test';
import assert from 'node:assert/strict';
import { importWebModule, fakeDom } from './dom-fixture.mjs';
const { createMobileLeaderboard } = await importWebModule('../apps/web/src/mobileLeaderboard.ts');
const { createLeaderboardClient } = await importWebModule('../apps/web/src/leaderboardClient.ts');
const { createMobileResult } = await importWebModule('../apps/web/src/mobilePanels.ts');
const tick = () => new Promise(r => setImmediate(r));

test('排行榜展示全服/个人纪录，失败可刷新；晚到响应不更新已卸载页面', async t => {
  const { body, byClass } = fakeDom(t);
  let calls = 0, resolve;
  const data = { entries: [{ rank: 1, playerName: '<b>游客</b>', distance: 42.25, score: 420, charId: 'char_volt' }], personal: null, playerName: '游客小电' };
  const service = { list: () => {
    calls++;
    if (calls === 1) return Promise.reject(Error('offline'));
    if (calls === 3) return new Promise(r => { resolve = r; });
    return Promise.resolve(data);
  } };
  const dispose = createMobileLeaderboard(service, { onBack() {} });
  await tick(); assert.match(body.textContent, /加载失败/);
  byClass(body, 'rank-refresh')[0].click(); await tick();
  assert.match(body.textContent, /42.25 m/); assert.match(body.textContent, /420 分/);
  assert.equal(byClass(body, 'rank-row')[0].children[0].children[0].textContent, '1. <b>游客</b>');
  assert.match(body.textContent, /暂无金币前距离纪录/);
  assert.match(body.textContent, /第一次吃金币前/);
  assert.match(body.textContent, /后来吃金币不影响纪录/);
  const root = byClass(body, 'mobile-leaderboard')[0];
  byClass(body, 'rank-refresh')[0].click(); dispose();
  const text = root.textContent; resolve(data); await tick();
  assert.equal(root.textContent, text); assert.equal(body.children.length, 0);
});

test('空榜、个人排名、返回按钮与 Escape', async t => {
  const { body, all, key } = fakeDom(t); let backs = 0;
  const dispose = createMobileLeaderboard({ list: async () => ({ entries: [], playerName: '游客', personal: { rank: 51, distance: 25.5, score: 250 } }) }, { onBack: () => backs++ });
  await tick(); assert.match(body.textContent, /全服榜暂时为空/); assert.match(body.textContent, /第 51 名/);
  all(body).find(n => n.getAttribute('aria-label') === '返回上一页').click();
  body.children[0].dispatchEvent(key('Escape')); assert.equal(backs, 2); dispose();
});

test('结果页实时更新上传状态且卸载取消订阅', t => {
  const { body } = fakeDom(t); let listener, removed = false;
  const summary = { score: 420, distance: 42, coins: 20, hits: 1, nearMiss: 0, charId: 'char_volt',
    beforeFirstCoin: { distance: 4.2, score: 40, stoppedByCoin: true },
    ranking: { message: '校验中', subscribe: cb => { listener = cb; return () => { removed = true; }; } } };
  const dispose = createMobileResult(summary, 0, { onRetry() {}, onSelect() {}, onLeaderboard() {} });
  listener('已入全服榜'); assert.match(body.textContent, /已入全服榜/); assert.match(body.textContent, /查看金币前距离榜/);
  assert.match(body.textContent, /第一次吃金币前  4.20 m · 40 分/);
  assert.match(body.textContent, /42 m/);
  dispose(); assert.equal(removed, true);
});

test('客户端采用同源 Cookie、JSON 和子路径，不携带可伪造的客户端成绩', async t => {
  fakeDom(t); const calls = [];
  const client = createLeaderboardClient('/thunder-run/', async (url, options) => { calls.push({ url, options }); return { ok: true, json: async () => ({ accepted: true }) }; });
  await client.list(); await client.begin('char_volt', 'rules');
  await client.submit({ runId: 'r', frames: 10, inputs: [] });
  assert.deepEqual(calls.map(c => c.url), ['/thunder-run/api/leaderboard', '/thunder-run/api/runs', '/thunder-run/api/runs/submit']);
  assert.ok(calls.every(c => c.options.credentials === 'same-origin' && c.options.signal));
  assert.equal(calls[1].options.headers['Content-Type'], 'application/json');
  assert.equal('score' in JSON.parse(calls[2].options.body), false);
  const bad = createLeaderboardClient('/', async () => ({ ok: false, status: 503 }));
  await assert.rejects(bad.list(), /503/);
});

test('全服榜默认前4名，50名封顶；展开/收起复用缓存且刷新保留展开状态', async t => {
  const { body, byClass } = fakeDom(t); let calls = 0, resolveRefresh;
  const rows = count => Array.from({ length: count }, (_, i) => ({ rank: i + 1, playerName: '玩家' + (i + 1), distance: 100 - i, score: 1000 - i, charId: 'char_volt' }));
  const service = { list: () => {
    calls++;
    if (calls === 2) return new Promise(resolve => { resolveRefresh = resolve; });
    return Promise.resolve({ entries: rows(51), personal: { rank: 51, distance: 20.5, score: 200 }, playerName: '游客' });
  } };
  const dispose = createMobileLeaderboard(service, { onBack() {} });
  await tick();
  const expand = byClass(body, 'rank-expand')[0];
  const refresh = byClass(body, 'rank-refresh')[0];
  const list = body.children[0].children[0].children.find(node => node.tagName === 'ol');
  const status = byClass(body, 'rank-status')[0];
  assert.equal(byClass(body, 'rank-row').length, 4);
  assert.equal(expand.disabled, false);
  assert.equal(expand.getAttribute('aria-controls'), list.id);
  assert.equal(expand.getAttribute('aria-expanded'), 'false');
  assert.equal(expand.getAttribute('aria-label'), '查看完整50名排行');
  assert.match(status.textContent, /前 4 名/);
  const frame = byClass(body, 'mobile-frame')[0];
  assert.ok(frame.children.indexOf(expand) < frame.children.indexOf(list), 'toggle precedes list to prevent scroll jumps');

  expand.click();
  assert.equal(byClass(body, 'rank-row').length, 50);
  assert.match(byClass(body, 'rank-row')[49].textContent, /50. 玩家50/);
  assert.doesNotMatch(byClass(body, 'rank-row')[49].textContent, /玩家51/);
  assert.match(body.textContent, /第 51 名/);
  assert.equal(expand.textContent, '收起为前4名');
  assert.equal(expand.getAttribute('aria-expanded'), 'true');
  assert.equal(expand.getAttribute('aria-label'), '收起为前4名');
  assert.match(status.textContent, /最多 50 名/);
  assert.equal(calls, 1, 'toggle uses the successful list response');

  expand.click();
  assert.equal(byClass(body, 'rank-row').length, 4);
  assert.equal(expand.getAttribute('aria-expanded'), 'false');
  assert.match(status.textContent, /前 4 名/);
  expand.click();
  refresh.click();
  assert.equal(calls, 2);
  assert.equal(byClass(body, 'rank-row').length, 50);
  assert.match(status.textContent, /正在刷新/);
  resolveRefresh({ entries: rows(51), personal: { rank: 51, distance: 20.5, score: 200 }, playerName: '游客' });
  await tick();
  assert.equal(byClass(body, 'rank-row').length, 50);
  assert.equal(expand.getAttribute('aria-expanded'), 'true');
  assert.equal(calls, 2, 'refresh is the only additional list request');
  expand.click();
  assert.equal(byClass(body, 'rank-row').length, 4);
  dispose();
  const disposeNewPage = createMobileLeaderboard(service, { onBack() {} });
  const newExpand = byClass(body, 'rank-expand')[0];
  assert.equal(newExpand.getAttribute('aria-expanded'), 'false');
  await tick();
  assert.equal(newExpand.getAttribute('aria-expanded'), 'false');
  assert.equal(byClass(body, 'rank-row').length, 4);
  disposeNewPage();
});

test('展开按钮在无数据、4条及空榜时禁用，刷新仍可用', async t => {
  const { body, byClass } = fakeDom(t); let calls = 0, resolveFirst;
  const rows = count => Array.from({ length: count }, (_, i) => ({ rank: i + 1, playerName: '玩家' + (i + 1), distance: 10 - i, score: 100 - i, charId: 'char_volt' }));
  const service = { list: () => {
    calls++;
    if (calls === 1) return new Promise(resolve => { resolveFirst = resolve; });
    return Promise.resolve({ entries: [], personal: null, playerName: '游客' });
  } };
  const dispose = createMobileLeaderboard(service, { onBack() {} });
  const expand = byClass(body, 'rank-expand')[0];
  const refresh = byClass(body, 'rank-refresh')[0];
  assert.equal(expand.disabled, true);
  assert.equal(refresh.disabled, true);
  expand.click();
  assert.equal(calls, 1);
  resolveFirst({ entries: rows(4), personal: null, playerName: '游客' });
  await tick();
  assert.equal(byClass(body, 'rank-row').length, 4);
  assert.equal(expand.disabled, true);
  assert.equal(refresh.disabled, false);
  refresh.click();
  await tick();
  assert.equal(calls, 2);
  assert.equal(byClass(body, 'rank-row').length, 0);
  assert.equal(expand.disabled, true);
  assert.equal(refresh.disabled, false);
  assert.match(body.textContent, /全服榜暂时为空/);
  dispose();
});

test('缓存展开榜单的刷新失败仍可切换，记录缩至4条时自动收起', async t => {
  const { body, byClass } = fakeDom(t); let calls = 0;
  const rows = count => Array.from({length:count},(_,i)=>({rank:i+1,playerName:`玩家${i+1}`,distance:100-i,score:1000-i}));
  const dispose = createMobileLeaderboard({list:async()=>{
    calls++;
    if(calls===2)throw Error('offline');
    return {entries:rows(calls===1?12:4),personal:{rank:51,distance:20,score:200},playerName:'游客'};
  }},{onBack(){}});
  await tick(); const expand=byClass(body,'rank-expand')[0],refresh=byClass(body,'rank-refresh')[0];
  expand.click(); assert.equal(byClass(body,'rank-row').length,12);
  refresh.click(); await tick();
  assert.match(byClass(body,'rank-status')[0].textContent,/加载失败/);
  assert.equal(byClass(body,'rank-row').length,12);
  expand.click(); assert.equal(byClass(body,'rank-row').length,4);
  assert.match(byClass(body,'rank-status')[0].textContent,/加载失败/);
  expand.click(); refresh.click(); await tick();
  assert.equal(byClass(body,'rank-row').length,4); assert.equal(expand.disabled,true);
  assert.equal(expand.getAttribute('aria-expanded'),'false');
  assert.match(body.textContent,/第 51 名/); dispose();
});
