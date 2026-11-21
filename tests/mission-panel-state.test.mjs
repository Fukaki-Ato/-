import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeDom, importWebModule } from './dom-fixture.mjs';

const { createMissionPanel } = await importWebModule('../apps/web/src/missionPanel.ts');
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const snapshot = (periodId = 'day-1', claimed = false) => ({
  serverTime: 1000, wallet: { coin: claimed ? 10 : 0 },
  daily: { periodId, resetsAt: 2000, missions: [
    { id: 'runs', title: '完成酷跑', progress: 1, target: 1, reward: { coin: 10 }, claimed },
  ] },
  weekly: { periodId: 'week-1', resetsAt: 9000, missions: [] },
});
function setup(t, api) {
  let dispose;
  // Dispose while the fixture's browser globals still exist (after hooks run in registration order).
  t.after(() => dispose?.());
  const dom = fakeDom(t);
  const timers = new Map();
  let timerId = 0;
  window.setTimeout = (callback, delay) => { timers.set(++timerId, { callback, delay }); return timerId; };
  window.clearTimeout = id => { timers.delete(id); };
  dispose = createMissionPanel(api, dom.content, () => {});
  return { ...dom, dispose, timers, node: name => dom.byClass(dom.body, name)[0], fire() {
    assert.equal(timers.size, 1);
    const [id, timer] = [...timers][0];
    timers.delete(id); timer.callback();
  } };
}

for (const succeeds of [true, false]) {
  test(`claim ${succeeds ? 'success' : 'failure'} keeps focus on the rebuilt task and announces its result`, async t => {
    const claim = deferred();
    const page = setup(t, { load: async () => snapshot(), claim: () => claim.promise });
    await tick();
    page.node('mission-claim').focus(); page.node('mission-claim').click();
    assert.equal(document.activeElement, page.node('mission-card'), 'busy claims retain a focusable task context');
    if (succeeds) claim.resolve(snapshot('day-1', true)); else claim.reject(new Error('离线'));
    await tick();
    assert.equal(document.activeElement, page.node(succeeds ? 'mission-card' : 'mission-claim'));
    assert.match(page.node('mission-status').textContent, succeeds ? /完成酷跑.*领取成功/ : /完成酷跑.*领取失败.*离线/);
  });
}

test('claim completion leaves deliberately moved tab or refresh focus alone', async t => {
  const first = deferred(), second = deferred();
  let claims = 0;
  const page = setup(t, { load: async () => snapshot(), claim: () => (++claims === 1 ? first : second).promise });
  await tick();
  page.node('mission-claim').focus(); page.node('mission-claim').click();
  const tab = page.byClass(page.body, 'mission-tab')[1];
  tab.focus(); tab.click();
  first.reject(new Error('离线')); await tick();
  assert.equal(document.activeElement, tab);
  page.byClass(page.body, 'mission-tab')[0].click();
  page.node('mission-claim').focus(); page.node('mission-claim').click();
  const refresh = page.node('mission-refresh'); refresh.focus();
  second.resolve(snapshot('day-1', true)); await tick();
  assert.equal(document.activeElement, refresh);
});

test('manual refresh preserves focus through both list rebuilds and blocks duplicate loads', async t => {
  const reload = deferred();
  let loads = 0;
  const page = setup(t, { load: () => ++loads === 1 ? Promise.resolve(snapshot()) : reload.promise });
  await tick();
  const refresh = page.node('mission-refresh'); refresh.focus(); refresh.click(); refresh.click();
  assert.equal(loads, 2);
  assert.equal(refresh.disabled, undefined);
  assert.equal(refresh.getAttribute('aria-disabled'), 'true');
  assert.equal(document.activeElement, refresh);
  reload.resolve(snapshot()); await tick();
  assert.equal(document.activeElement, refresh);
  assert.equal(refresh.getAttribute('aria-disabled'), 'false');
});

for (const succeeds of [true, false]) {
  test(`expired timer during ${succeeds ? 'successful' : 'failed'} claim performs one serialized reload and rearms`, async t => {
    const claim = deferred(), reload = deferred();
    let loads = 0, claims = 0;
    const page = setup(t, {
      load: () => ++loads === 1 ? Promise.resolve(snapshot()) : reload.promise,
      claim: () => { claims++; return claim.promise; },
    });
    await tick();
    page.node('mission-claim').focus(); page.node('mission-claim').click();
    page.fire(); page.node('mission-refresh').click();
    assert.equal(loads, 1, 'timer must not overlap the claim');
    if (succeeds) claim.resolve(snapshot('day-1', true)); else claim.reject(new Error('周期已更新'));
    await tick();
    assert.equal(loads, 2, 'the consumed timer must be serviced after either claim outcome');
    assert.equal(claims, 1);
    assert.equal(page.timers.size, 0);
    reload.resolve(snapshot('day-2')); await tick();
    assert.equal(loads, 2);
    assert.equal(page.timers.size, 1);
    assert.equal([...page.timers.values()][0].delay, 2000);
    assert.equal(document.activeElement, page.node('mission-tab'), 'a new period must not impersonate the old focused task');
    assert.match(page.node('mission-status').textContent, succeeds ? /领取成功.*已同步最新任务/ : /领取失败.*已同步最新任务/);
  });
}

test('failed deferred cycle sync stops with explicit retry instead of looping', async t => {
  const claim = deferred();
  let loads = 0;
  const page = setup(t, {
    load: async () => { if (++loads === 2) throw new Error('同步离线'); return snapshot('day-2'); },
    claim: () => claim.promise,
  });
  await tick(); page.node('mission-claim').click(); page.fire();
  claim.reject(new Error('周期已更新')); await tick(); await tick();
  assert.equal(loads, 2);
  assert.equal(page.timers.size, 0);
  assert.match(page.node('mission-status').textContent, /领取失败.*同步失败.*同步离线.*请点击重试/);
  page.node('mission-refresh').click(); await tick();
  assert.equal(loads, 3);
  assert.equal(page.timers.size, 1);
});

for (const disposeDuringClaim of [true, false]) {
  test(`dispose during ${disposeDuringClaim ? 'claim' : 'deferred cycle load'} ignores late results`, async t => {
    const claim = deferred(), reload = deferred();
    let loads = 0;
    const page = setup(t, {
      load: () => ++loads === 1 ? Promise.resolve(snapshot()) : reload.promise,
      claim: () => claim.promise,
    });
    await tick(); page.node('mission-claim').click(); page.fire();
    if (!disposeDuringClaim) { claim.resolve(snapshot()); await tick(); }
    page.dispose();
    const focus = document.activeElement;
    if (disposeDuringClaim) claim.resolve(snapshot()); else reload.resolve(snapshot('day-2'));
    await tick();
    assert.equal(loads, disposeDuringClaim ? 1 : 2);
    assert.equal(page.byClass(page.body, 'mobile-missions').length, 0);
    assert.equal(page.timers.size, 0);
    assert.equal(document.activeElement, focus);
  });
}
