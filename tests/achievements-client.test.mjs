/**
 * 成就客户端测试（本层=统计埋点/本地持久化/上报时机/双端页面装配）：
 * - pickupTally：drainEvents 包装透传 + 还原（分道具统计的唯一来源）；
 * - tracker：applyRunDelta 累加与 casts→skillCasts 映射、score MAX、脏 JSON 容错、
 *   claimLocal 校验与发货、applyCharacterUnlock 以解锁集合为准自愈（含存量解锁）；
 * - buildAchPageView：快照合并/离线预览锁定/已领取计数（真实 achievements.json）；
 * - 流程级（fake views + 真实配置）：start 场景抽取回归（游客/微信/代次守卫）、成就入口→
 *   achievements 场景→本地/服务端领取、Esc 回大厅、run 局 dispose 收口 trackAchievements
 *   （死亡且时长达标才计、短局不计、调试局不计）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RunnerSim } from '../packages/game/dist/core/sim/runnerSim.js';
import { observePickupEvents } from '../packages/game/dist/core/sim/pickupTally.js';
import { createGameFlow } from '../packages/game/dist/flow/mainFlow.js';
import { ENTRY_KEY } from '../packages/game/dist/flow/session.js';
import { createAchievementTracker, ACH_STATS_KEY, ACH_CLAIMED_KEY, achievementMinRunSeconds } from '../packages/game/dist/flow/achievementTracker.js';
import { buildAchPageView } from '../packages/game/dist/flow/achievementsScene.js';
import { unlockCharacter } from '../packages/game/dist/flow/unlock.js';
import { COINS_KEY, UNLOCKS_KEY } from '../packages/game/dist/flow/localEconomy.js';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const readConfig = name => JSON.parse(readFileSync(join(root, 'config', `${name}.json`), 'utf8'));
const achContent = { achievements: readConfig('achievements'), characters: readConfig('characters'), economy: readConfig('economy') };

const makeStore = (initial = {}) => {
  const map = new Map(Object.entries(initial));
  return {
    map,
    get: k => (map.has(k) ? map.get(k) : null),
    set: (k, v) => { map.set(k, v); },
    remove: k => { map.delete(k); },
  };
};

const runSummaryOf = over => ({
  t: 12, distance: 120.5, coins: 30, nearMiss: 2, hits: 0, score: 5000, alive: false,
  casts: 3, charId: 'char_volt', revives: 0, ...over,
});

// ---------------- pickupTally ----------------

test('observePickupEvents：pickup 事件回调 itemRef、其余事件透传、还原后不再回调', () => {
  const events = [];
  const sim = { events, drainEvents: () => events.splice(0) };
  const seen = [];
  const restore = observePickupEvents(sim, id => seen.push(id));
  events.push({ type: 'pickup', itemRef: 'item_magnet' }, { type: 'coin' }, { type: 'pickup', itemRef: 'item_shield' });
  const drained = sim.drainEvents();
  assert.deepEqual(seen, ['item_magnet', 'item_shield']);
  assert.deepEqual(drained.map(e => e.type), ['pickup', 'coin', 'pickup'], '透传给既有消费方（渲染层）');
  restore();
  events.push({ type: 'pickup', itemRef: 'item_jetpack' });
  sim.drainEvents();
  assert.deepEqual(seen, ['item_magnet', 'item_shield'], '还原后不再打点');
});

// ---------------- tracker ----------------

test('applyRunDelta：累加 + casts→skillCasts 映射 + score MAX + itemOf 分道具 + runs+1', () => {
  const store = makeStore();
  const tracker = createAchievementTracker(store);
  tracker.applyRunDelta(runSummaryOf({ hits: 1 }), { slides: 2, jumps: 3, itemPickups: 4 }, { item_magnet: 2 });
  tracker.applyRunDelta(runSummaryOf({ score: 9000 }), { slides: 1, jumps: 1, itemPickups: 1 }, { item_shield: 1, item_magnet: 1 });
  const t = tracker.totals();
  assert.equal(t.slides, 3);
  assert.equal(t.jumps, 4);
  assert.equal(t.skillCasts, 6, 'summary.casts 映射进指标名 skillCasts');
  assert.equal(t.itemPickups, 5);
  assert.equal(t.itemOf['item_magnet'], 3);
  assert.equal(t.itemOf['item_shield'], 1);
  assert.equal(t.runs, 2);
  assert.deepEqual([t.distanceM, t.coins, t.nearMiss], [240, 60, 4], 'distanceM 每局取整累加（120.5→120）');
  assert.equal(t.cleanRuns, 1, 'hits===0 的局才计 cleanRuns');
  assert.equal(t.score, 9000, 'score=单局最佳（MAX）');
  assert.equal(JSON.parse(store.map.get(ACH_STATS_KEY)).runs, 2, '落盘 ACH_STATS_KEY');
});

test('脏 JSON 容错归零：坏 totals/claimed 都不炸、后续照常累计', () => {
  const store = makeStore({ [ACH_STATS_KEY]: '{oops', [ACH_CLAIMED_KEY]: 'not-json' });
  const tracker = createAchievementTracker(store);
  assert.equal(tracker.totals().runs, 0);
  assert.equal(tracker.claimedIds().size, 0);
  tracker.applyRunDelta(runSummaryOf({}), { slides: 1, jumps: 0, itemPickups: 0 }, {});
  assert.equal(tracker.totals().runs, 1);
});

test('claimLocal：正整数奖励校验、重复领取拒绝、run 条目拒绝、发货落钱包', () => {
  const store = makeStore();
  const tracker = createAchievementTracker(store);
  const defOf = id => achContent.achievements.items.find(i => i.id === id);
  assert.equal(tracker.claimLocal(defOf('ach_slides_100')).ok, false, 'run 条目由服务端发放');
  const broken = { ...defOf('ach_chars_3'), reward: { coin: 0 } };
  assert.equal(tracker.claimLocal(broken).ok, false, '零值奖励=发不出的死条目，领取拒绝');
  const result = tracker.claimLocal(defOf('ach_chars_3')); // coin 800
  assert.equal(result.ok, true);
  assert.equal(JSON.parse(store.map.get(COINS_KEY)), 800);
  assert.deepEqual([...tracker.claimedIds()], ['ach_chars_3']);
  assert.equal(tracker.claimLocal(defOf('ach_chars_3')).ok, false, '重复领取拒绝');
});

test('applyCharacterUnlock：存量解锁即见进度、解锁事件自愈 MAX、重复回调不涨', () => {
  const store = makeStore({ [UNLOCKS_KEY]: JSON.stringify(['char_ama', 'char_kaze']), [COINS_KEY]: '999999' });
  const tracker = createAchievementTracker(store);
  assert.equal(tracker.totals().charactersUnlocked, 2, '成就上线前已解锁的存量角色读即对账');
  const hooks = { onUnlocked: () => tracker.applyCharacterUnlock() };
  unlockCharacter(store, achContent, 'char_frog', new Date(), hooks.onUnlocked); // coin 型角色
  assert.equal(tracker.totals().charactersUnlocked, 3);
  tracker.applyCharacterUnlock();
  assert.equal(tracker.totals().charactersUnlocked, 3, '重复回调不重复计');
});

test('achievementMinRunSeconds：镜像服务端解析（缺省 10、越界回 10）', () => {
  assert.equal(achievementMinRunSeconds(achContent), 10);
  assert.equal(achievementMinRunSeconds(null), 10);
  assert.equal(achievementMinRunSeconds({ economy: { params: { missions: { minRunSeconds: 0 } } } }), 0);
  assert.equal(achievementMinRunSeconds({ economy: { params: { missions: { minRunSeconds: -3 } } } }), 10);
  assert.equal(achievementMinRunSeconds({ economy: { params: { missions: { minRunSeconds: 601 } } } }), 10);
});

// ---------------- buildAchPageView ----------------

const snapshotOf = over => ({
  serverTime: 0, rewardLedgerId: 'u1', wallet: { coin: 10 },
  achievements: [
    { id: 'ach_slides_100', name: {}, desc: {}, stat: 'slides', target: 100, tier: 'bronze', group: 'run', reward: { coin: 300 }, progress: 100, claimed: false },
  ], ...over,
});

test('buildAchPageView：run 条目吃快照、local 条目吃 totals、分节与计数齐', () => {
  const tracker = createAchievementTracker(makeStore({ [UNLOCKS_KEY]: JSON.stringify(['char_ama']) }));
  const page = buildAchPageView(achContent, { snapshot: snapshotOf(), totals: tracker.totals(), claimed: tracker.claimedIds() });
  const slides = page.rows.find(r => r.id === 'ach_slides_100');
  assert.equal(slides.progress, 100);
  assert.equal(slides.claimable, true, '快照达标未领=可领取');
  assert.equal(slides.source, 'run');
  const chars = page.rows.find(r => r.id === 'ach_chars_3');
  assert.equal(chars.progress, 1, 'local 条目按本机 totals（存量解锁对账）');
  assert.equal(chars.claimable, false);
  assert.equal(page.offline, false);
  assert.deepEqual(page.sections.map(s => s.group), ['run', 'skill', 'collect', 'chars']);
  assert.equal(page.total, achContent.achievements.items.length);
  assert.equal(page.claimedCount, 0);
  const shield = page.rows.find(r => r.id === 'ach_shield_50');
  assert.equal(shield.rewardText, '金币 ×1000', '奖励文案按 config 金币口径（奖励已统一按难度分档的金币）');
  // shard 文案分支（查 characters 配置出角色碎片名）真实配置已无 shard 条目，用合成条目保持覆盖
  const shardContent = { ...achContent, achievements: { ...achContent.achievements, items: [...achContent.achievements.items,
    { id: 'ach_shard_test', status: 'live', name: { 'zh-CN': '碎片测试' }, desc: { 'zh-CN': '合成条目' }, stat: 'slides', target: 1, tier: 'silver', source: 'run', group: 'run', reward: { shard: 'shard_volt:20' } }] } };
  const shardPage = buildAchPageView(shardContent, { snapshot: snapshotOf(), totals: tracker.totals(), claimed: tracker.claimedIds() });
  const shard = shardPage.rows.find(r => r.id === 'ach_shard_test');
  assert.ok(shard.rewardText.includes('碎片'), `shard 奖励查 characters 配置出文案，实得「${shard.rewardText}」`);
});

test('buildAchPageView：离线口径——run 条目本机预览、达标置灰（locked），local 照常可领', () => {
  const tracker = createAchievementTracker(makeStore({ [UNLOCKS_KEY]: JSON.stringify(['char_ama', 'char_kaze', 'char_frog']) }));
  const page = buildAchPageView(achContent, { snapshot: null, totals: tracker.totals(), claimed: tracker.claimedIds() });
  assert.equal(page.offline, true);
  const slides = page.rows.find(r => r.id === 'ach_slides_100');
  assert.equal(slides.progress, 0, '离线预览走本机 totals');
  assert.equal(slides.locked, false, '未达标只显示进度');
  assert.equal(slides.claimable, false);
  const chars = page.rows.find(r => r.id === 'ach_chars_3');
  assert.equal(chars.claimable, true, 'local 条目离线照常可领');
  const runs = page.rows.find(r => r.id === 'ach_runs_10');
  assert.equal(runs.claimable, false);
  tracker.applyRunDelta(runSummaryOf({}), { slides: 100, jumps: 0, itemPickups: 0 }, {});
  const locked = buildAchPageView(achContent, { snapshot: null, totals: tracker.totals(), claimed: tracker.claimedIds() });
  assert.equal(locked.rows.find(r => r.id === 'ach_slides_100').locked, true, '达标但服务端不可得=置灰领取');
  assert.equal(locked.rows.find(r => r.id === 'ach_chars_3').locked, false);
});

test('buildAchPageView：draft/retired 条目不进页面也不进计数（下线口径，缺 status 按 live）', () => {
  const content = {
    ...achContent,
    achievements: {
      ...achContent.achievements,
      items: achContent.achievements.items.map(e => e.id === 'ach_slides_100' ? { ...e, status: 'retired' }
        : e.id === 'ach_jumps_100' ? { ...e, status: 'draft' } : e),
    },
  };
  const tracker = createAchievementTracker(makeStore({ [UNLOCKS_KEY]: JSON.stringify(['char_ama']) }));
  const page = buildAchPageView(content, { snapshot: snapshotOf(), totals: tracker.totals(), claimed: tracker.claimedIds() });
  assert.equal(page.rows.find(r => r.id === 'ach_slides_100'), undefined, 'retired 不渲染');
  assert.equal(page.rows.find(r => r.id === 'ach_jumps_100'), undefined, 'draft 不渲染');
  assert.equal(page.rows.find(r => r.id === 'ach_slides_1000')?.name, '贴地滑手', 'live 条目照常展示');
  assert.equal(page.total, achContent.achievements.items.length - 2, '总数随下线条目收缩');
});

// ---------------- 流程级（fake views + 真实配置） ----------------

function makeFlow({ initial, debug, test: testMode, qa, achievementsApi } = {}) {
  const store = makeStore(initial);
  const inputs = [];
  const seen = { start: [], select: [], achievements: [], scenes: [], toasts: [], feedback: [] };
  const adapter = {
    env: 'web',
    storage: store,
    fetchJson: async name => readConfig(name),
    canvas: { mainCanvas: () => ({}), windowSize: () => ({ width: 390, height: 844, dpr: 2 }) },
    onInput: cb => { inputs.push(cb); return () => {}; },
  };
  const views = {
    renderBoot: () => ({ setStatus() {} }),
    renderStart: actions => { seen.start.push(actions); return { setBusy() {}, setFeedback: (text, isError) => seen.feedback.push({ text, isError }) }; },
    renderSelect: (_c, actions) => seen.select.push({ actions }),
    renderAchievements: (_c, page, actions) => seen.achievements.push({ page, actions }),
    mountHud: () => ({ update() {}, dispose() {} }),
    renderResult() {},
    toast: msg => seen.toasts.push(msg),
  };
  const createScene = (_host, _adapter, sim, _content, _cb, opts) => { seen.scenes.push({ sim, opts }); return { dispose() {} }; };
  const flow = createGameFlow({ adapter, views, configResolve: n => n, createScene, debug, test: testMode, qa, achievementsApi });
  const key = code => inputs.forEach(cb => cb({ type: 'key', code, phase: 'down' }));
  return { flow, store, seen, key };
}

const tick = () => new Promise(r => setImmediate(r));

test('start 场景抽取回归：游客直入主界面、微信失败停留+反馈、成功与代次守卫', async () => {
  { // 游客
    const { flow, store, seen } = makeFlow();
    await flow.boot();
    flow.machine.go('start');
    seen.start.at(-1).onGuest();
    assert.equal(flow.machine.current(), 'select');
    assert.equal(store.map.get(ENTRY_KEY), 'guest');
  }
  { // 微信路径：登录成功后落库 wechat 并跳主界面；失败停留本页带原因
    const store = makeStore();
    const inputs = [];
    const seen = { start: [], feedback: [] };
    let login = () => Promise.reject(new Error('用户取消'));
    const adapter = {
      env: 'wx', extras: { login: () => login() },
      storage: store, onInput: cb => { inputs.push(cb); return () => {}; },
    };
    const flow = createGameFlow({
      adapter,
      views: {
        renderBoot: () => ({ setStatus() {} }),
        renderStart: actions => { seen.start.push(actions); return { setBusy() {}, setFeedback: (text, isError) => seen.feedback.push({ text, isError }) }; },
        renderSelect: () => {}, mountHud: () => ({ update() {}, dispose() {} }), renderResult() {}, toast() {},
      },
      configResolve: n => n,
    });
    await flow.boot();
    flow.machine.go('start');
    seen.start.at(-1).onWechat();
    await tick();
    assert.equal(flow.machine.current(), 'start', '登录失败停留本页');
    assert.ok(seen.feedback.at(-1).text.includes('微信登录失败'), seen.feedback.at(-1).text);
    login = () => Promise.resolve({ openid: 'o1' });
    seen.start.at(-1).onWechat();
    await tick();
    assert.equal(flow.machine.current(), 'select');
    assert.equal(store.map.get(ENTRY_KEY), 'wechat');
  }
  { // 代次守卫：离开开始页又重进后，上一轮登录 promise 回来不串页
    const store = makeStore();
    let login = () => new Promise(() => {});
    const adapter = {
      env: 'wx', extras: { login: () => login() },
      storage: store, onInput: () => () => {},
    };
    const seenStart = [];
    const flow = createGameFlow({
      adapter,
      views: {
        renderBoot: () => ({ setStatus() {} }),
        renderStart: actions => { seenStart.push(actions); return { setBusy() {}, setFeedback() {} }; },
        renderSelect: () => {}, mountHud: () => ({ update() {}, dispose() {} }), renderResult() {}, toast() {},
      },
      configResolve: n => n,
    });
    await flow.boot();
    flow.machine.go('start');
    const first = seenStart.at(-1);
    first.onWechat();
    flow.machine.go('select'); // 中途离开（gen 0 失效）
    flow.machine.go('start'); // 重进（gen 1）
    login = () => Promise.resolve({ openid: 'o1' });
    first.onWechat(); // 第一次进页捕获的 onWechat：busy 已 true 直接返回
    await tick();
    assert.equal(flow.machine.current(), 'start', '旧代次的登录结果不触发跳转');
  }
});

test('成就入口 → achievements 场景：离线预览先行、快照到达重绘、local/run 领取分流、Esc 回大厅', async () => {
  const apiCalls = [];
  let snapshot = snapshotOf();
  const achievementsApi = {
    load: async () => { apiCalls.push('load'); return snapshot; },
    claim: async id => {
      apiCalls.push(`claim:${id}`);
      snapshot = { ...snapshot, achievements: snapshot.achievements.map(a => a.id === id ? { ...a, claimed: true } : a), wallet: { coin: 310 } };
      return snapshot;
    },
  };
  const { flow, store, seen, key } = makeFlow({ initial: { [UNLOCKS_KEY]: JSON.stringify(['char_ama', 'char_kaze', 'char_frog']) }, achievementsApi });
  await flow.boot();
  const actions = seen.select.at(-1).actions;
  assert.equal(typeof actions.onAchievements, 'function', 'renderAchievements + api 双在则入口亮起');

  actions.onAchievements();
  assert.equal(flow.machine.current(), 'achievements');
  const first = seen.achievements.at(-1);
  assert.equal(first.page.offline, true, '先渲染离线预览（load 未回）');
  assert.equal(first.page.total, achContent.achievements.items.length);
  await tick();
  const loaded = seen.achievements.at(-1);
  assert.notEqual(loaded, first, '快照到达后重绘');
  assert.equal(loaded.page.offline, false);
  assert.equal(loaded.page.rows.find(r => r.id === 'ach_slides_100').claimable, true);

  // local 领取：本机发货 + 领取记录落盘 + 即时重绘
  const localResult = loaded.actions.onClaim('ach_chars_3');
  assert.equal(localResult.ok, true);
  assert.equal(JSON.parse(store.map.get(COINS_KEY)), 800);
  assert.deepEqual([...JSON.parse(store.map.get(ACH_CLAIMED_KEY))], ['ach_chars_3']);
  assert.equal(seen.achievements.at(-1).page.rows.find(r => r.id === 'ach_chars_3').claimed, true, '领取后重绘');
  assert.equal(seen.achievements.at(-1).page.statusMessage, '成就奖励已存入本机钱包',
    'local 领取提示经 statusMessage 随重绘保留（整页替换会丢弃旧节点的写入）');

  // run 领取：分流 api.claim，乐观受理即重绘（受理行置灰防连点），回包重绘 + toast
  const runResult = seen.achievements.at(-1).actions.onClaim('ach_slides_100');
  assert.equal(runResult.ok, true, 'run 条目乐观受理');
  assert.deepEqual(apiCalls.filter(c => c === 'claim:ach_slides_100'), ['claim:ach_slides_100'], '受理只发一次 claim');
  const pending = seen.achievements.at(-1).page;
  assert.equal(pending.rows.find(r => r.id === 'ach_slides_100').claiming, true, '受理行渲染为置灰（防连点）');
  assert.equal(pending.statusMessage, '正在领取奖励…', '受理提示随重绘上状态行');
  const repeat = seen.achievements.at(-1).actions.onClaim('ach_slides_100');
  assert.equal(repeat.ok, false, '受理中重复点击不再发请求');
  assert.deepEqual(apiCalls.filter(c => c === 'claim:ach_slides_100').length, 1, '无重复 POST');
  await tick();
  assert.ok(apiCalls.includes('claim:ach_slides_100'));
  const settled = seen.achievements.at(-1).page;
  assert.equal(settled.rows.find(r => r.id === 'ach_slides_100').claimed, true);
  assert.equal(settled.rows.find(r => r.id === 'ach_slides_100').claiming, false, '回包后受理态清除');
  assert.ok(seen.toasts.includes('奖励已存入本机钱包'));

  key('Escape');
  assert.equal(flow.machine.current(), 'select', 'Esc 回大厅');
});

test('成就入口在缺 API 或缺 renderAchievements 时不亮（防死按钮）', async () => {
  const withoutApi = makeFlow({});
  await withoutApi.flow.boot();
  assert.equal(withoutApi.seen.select.at(-1).actions.onAchievements, undefined);
  const withApi = makeFlow({ achievementsApi: { load: async () => snapshotOf(), claim: async () => snapshotOf() } });
  await withApi.flow.boot();
  assert.equal(typeof withApi.seen.select.at(-1).actions.onAchievements, 'function');
});

test('成就页 load 失败：真实原因上状态行（statusMessage），离线锁定口径不变', async () => {
  const achievementsApi = {
    load: async () => { throw new Error('本机钱包记录损坏，请保留存档并联系支持'); },
    claim: async () => snapshotOf(),
  };
  const { flow, seen } = makeFlow({ initial: { [UNLOCKS_KEY]: JSON.stringify(['char_ama', 'char_kaze', 'char_frog']) }, achievementsApi });
  await flow.boot();
  seen.select.at(-1).actions.onAchievements();
  await tick();
  const page = seen.achievements.at(-1).page;
  assert.equal(page.offline, true, '快照不可得仍按离线口径锁定 run 领取');
  assert.equal(page.offlineMessage, '网络未连接，稍后重试', '默认口径保留，不与真实原因混淆');
  assert.ok((page.statusMessage ?? '').includes('钱包记录损坏'), `状态行显示真实原因，实得「${page.statusMessage}」`);
  const slides = page.rows.find(r => r.id === 'ach_slides_100');
  assert.equal(slides.claimable, false, '离线 run 条目不可领');
  assert.equal(page.rows.find(r => r.id === 'ach_chars_3').claimable, true, 'local 条目照常可领');
});

test('run 局成就收口：死亡且时长达标才计、拾取事件按道具归账、Esc 中退与短局不计', async () => {
  const { flow, store, seen, key } = makeFlow({});
  await flow.boot();
  const totalsOf = () => JSON.parse(store.map.get(ACH_STATS_KEY) ?? '{}');

  seen.select.at(-1).actions.onStartRun('char_volt');
  const sim1 = seen.scenes.at(-1).sim;
  sim1.state.alive = false; sim1.state.t = 5; // 短局（< minRunSeconds）
  key('Escape');
  assert.equal(flow.machine.current(), 'select');
  assert.equal(store.map.has(ACH_STATS_KEY), false, '短局死亡不计');

  seen.select.at(-1).actions.onStartRun('char_volt');
  const sim2 = seen.scenes.at(-1).sim;
  sim2.events.push({ type: 'pickup', itemRef: 'item_magnet' }, { type: 'pickup', itemRef: 'item_magnet' });
  assert.deepEqual(sim2.drainEvents().map(e => e.itemRef), ['item_magnet', 'item_magnet'], '观察器经包装的 drainEvents 打点');
  sim2.state.alive = false; sim2.state.t = 12;
  key('Escape'); // Esc 中退也走 dispose 收口：死亡局按死亡口径结算（死后 step 早退、状态留存）
  const totals = totalsOf();
  assert.equal(totals.runs, 1);
  assert.equal(totals.itemOf['item_magnet'], 2, '分道具拾取归账');
  assert.equal(totals.skillCasts, 0);

  seen.select.at(-1).actions.onStartRun('char_volt');
  const sim3 = seen.scenes.at(-1).sim;
  sim3.state.alive = true; sim3.state.t = 30; // 存活中退出
  key('Escape');
  assert.equal(totalsOf().runs, 1, 'Esc 存活中退局不计');
});

test('调试局（?debug/?test/?anim/?ui=demo 口径位）不做成就统计', async () => {
  for (const flags of [{ debug: true }, { test: true }, { qa: true }]) {
    const { flow, store, seen, key } = makeFlow(flags);
    await flow.boot();
    seen.select.at(-1).actions.onStartRun('char_volt');
    const sim = seen.scenes.at(-1).sim;
    sim.state.alive = false; sim.state.t = 30;
    key('Escape');
    assert.equal(store.map.has(ACH_STATS_KEY), false, JSON.stringify(flags));
  }
});

test('真实 RunnerSim 的 missionStats 经观察器链路进 totals（movement.totalJumps 同源）', async () => {
  const { flow, store, seen, key } = makeFlow({});
  await flow.boot();
  seen.select.at(-1).actions.onStartRun('char_volt');
  const sim = seen.scenes.at(-1).sim;
  sim.applyAction('jump');
  for (let i = 0; i < 70; i++) sim.step(); // 完整跳弧落地（空中按跳只进缓冲，movement.ts:57）
  sim.applyAction('jump'); sim.step();
  assert.equal(sim.missionStats.jumps, 2);
  sim.state.alive = false; sim.state.t = 11;
  key('Escape');
  const totals = JSON.parse(store.map.get(ACH_STATS_KEY));
  assert.equal(totals.jumps, 2, '起跳计数来自 movement.totalJumps');
});
