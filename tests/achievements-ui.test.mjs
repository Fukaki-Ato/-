/**
 * 成就页双端视图测试（headless UiHost 的 canvas 页 + fakeDom 的 DOM 面板）：
 * - canvas：分节/行文案来自场景层视图数据、进度与状态标记、可领取点击回传、离线锁定不可点、字体图集收字；
 * - DOM：类名+aria 定位（dom-fixture 约定）、progressbar aria、领取状态行与 is-claimed、Esc 返回。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Box, Label, defaultUiConfig, findBox } from '../packages/framework/dist/ui/index.js';
import { UiHost } from '../packages/framework/dist/ui/host.js';
import { createOverlayViews } from '../packages/game/dist/ui/overlayViews.js';
import { importWebModule, fakeDom } from './dom-fixture.mjs';
import { loadTestFontSet } from './ui-helpers.mjs';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const W = 800, H = 600;

function hostFixture() {
  const store = new Map();
  const adapter = {
    version: 2,
    env: 'web',
    canvas: {
      mainCanvas: () => ({}),
      createOffscreenCanvas: () => ({}),
      windowSize: () => ({ width: W, height: H, dpr: 1 }),
      onResize: () => () => {},
    },
    onInput: () => () => {},
    storage: { get: k => store.get(k) ?? null, set: (k, v) => store.set(k, v), remove: k => store.delete(k) },
    fetchJson: async () => { throw new Error('node 环境不联网'); },
    requestFrame: () => 0,
    cancelFrame: () => {},
    onVisibility: () => () => {},
    now: () => 0,
  };
  const host = new UiHost({
    adapter,
    overlayHost: { renderer: null, width: W, height: H, dpr: 1 },
    fonts: loadTestFontSet(),
    config: defaultUiConfig,
  });
  return { host, store };
}

function texts(host) {
  const out = [];
  host.overlay.current?.root.visit(w => { if (w instanceof Label) out.push(w.getText()); });
  return out.filter(t => t !== '');
}

const findWidget = (host, pred) => {
  let found = null;
  host.overlay.current?.root.visit(w => { if (!found && pred(w)) found = w; });
  return found;
};

function clickWidget(host, w) {
  const box = findBox(host.overlay.tree, w.id);
  const x = box.rect.x + box.rect.w / 2, y = box.rect.y + box.rect.h / 2;
  host.pushInput({ type: 'down', x, y, t: 0 });
  host.pushInput({ type: 'up', x, y, t: 0.05 });
}

const rowOf = (host, name) => findWidget(host, w => w instanceof Box && w.children.some(ch => ch instanceof Label && ch.getText() === name));
/** 「领取」按钮（包在状态盒里）：按 Label 文本全树找（测试页每页至多一个可点领取） */
const claimButton = host => findWidget(host, w => w.label && typeof w.label.getText === 'function' && w.label.getText() === '领取');

const rowView = over => ({
  id: 'ach_a', name: '滑行起步', desc: '累计滑铲 100 次', tier: 'bronze', group: 'run', source: 'run',
  target: 100, progress: 100, claimed: false, claimable: false, locked: false, claiming: false,
  rewardText: '金币 ×300', ...over,
});
const pageView = over => ({
  sections: [{ group: 'run', title: '奔跑', note: '里程、跳跃与能量的积累', rows: [] }, { group: 'chars', title: '角色', note: '解锁更多跑者', rows: [] }],
  rows: [], offline: false, offlineMessage: '网络未连接，稍后重试', claimedCount: 0, total: 0, ...over,
});

test('canvas 成就页：分节与行文案、已领取汇总、可领取点击回传、已领取标记', () => {
  const { host } = hostFixture();
  const views = createOverlayViews({ host });
  const calls = [];
  const a = rowView({ id: 'ach_a', claimable: true });
  const b = rowView({ id: 'ach_b', name: '小小阵容', desc: '解锁 3 名角色', tier: 'silver', group: 'chars', source: 'local', progress: 100, claimed: true });
  const c = rowView({ id: 'ach_c', name: '常客', desc: '完成 10 局', tier: 'gold', group: 'run', source: 'run', progress: 3 });
  const page = pageView({
    sections: [
      { group: 'run', title: '奔跑', note: '里程、跳跃与能量的积累', rows: [a, c] },
      { group: 'chars', title: '角色', note: '解锁更多跑者', rows: [b] },
    ],
    rows: [a, c, b], claimedCount: 1, total: 3,
  });
  views.renderAchievements({}, page, {
    onBack: () => calls.push('back'),
    onClaim: id => { calls.push(id); return { ok: true, message: '成就奖励已存入本机钱包' }; },
  });
  host.overlay.current.relayout();

  const t = texts(host);
  for (const s of ['成就', '奔跑', '角色', '滑行起步', '累计滑铲 100 次', '金币 ×300', '常客', '未达成', '小小阵容', '已领取 ✓', '已领取 1/3', '100/100']) {
    assert.ok(t.includes(s), `成就页含「${s}」，实得 ${JSON.stringify(t)}`);
  }

  const claim = claimButton(host);
  assert.ok(claim, '可领取行有「领取」按钮');
  clickWidget(host, claim);
  assert.deepEqual(calls, ['ach_a'], '点「领取」回传成就 id');
  host.dispose();
});

test('canvas 成就页：离线状态行 + 置灰领取不可点 + 返回回传', () => {
  const { host } = hostFixture();
  const views = createOverlayViews({ host });
  const calls = [];
  const a = rowView({ id: 'ach_a', claimable: false, locked: true });
  const page = pageView({
    offline: true,
    sections: [{ group: 'run', title: '奔跑', note: '里程、跳跃与能量的积累', rows: [a] }],
    rows: [a], total: 1,
  });
  views.renderAchievements({}, page, {
    onBack: () => calls.push('back'),
    onClaim: id => { calls.push(id); return { ok: false, message: '网络未连接，稍后重试' }; },
  });
  host.overlay.current.relayout();

  assert.ok(texts(host).includes('网络未连接，稍后重试'), '离线状态行');
  const locked = claimButton(host);
  assert.ok(locked, '离线锁定行保留「领取」按钮（置灰而非隐藏）');
  clickWidget(host, locked);
  assert.deepEqual(calls, [], '置灰按钮吞掉点击');

  clickWidget(host, findWidget(host, w => w.label?.getText() === '返回'));
  assert.deepEqual(calls, ['back']);
  host.dispose();
});

test('canvas 成就页：受理中（claiming）领取按钮置灰不可点，状态行优先展示 statusMessage', () => {
  const { host } = hostFixture();
  const views = createOverlayViews({ host });
  const calls = [];
  const a = rowView({ id: 'ach_a', claimable: true, claiming: true });
  const page = pageView({
    offline: true, statusMessage: '本机钱包记录损坏，请保留存档并联系支持',
    sections: [{ group: 'run', title: '奔跑', note: '里程、跳跃与能量的积累', rows: [a] }],
    rows: [a], total: 1,
  });
  views.renderAchievements({}, page, {
    onBack: () => {},
    onClaim: id => { calls.push(id); return { ok: false, message: '正在领取奖励…' }; },
  });
  host.overlay.current.relayout();

  assert.ok(texts(host).includes('本机钱包记录损坏，请保留存档并联系支持'),
    '状态行优先展示 statusMessage（load 失败真实原因），而非默认离线文案');
  const claim = claimButton(host);
  assert.ok(claim, '受理行保留「领取」按钮（置灰而非隐藏）');
  clickWidget(host, claim);
  assert.deepEqual(calls, [], '受理中按钮吞掉点击（防连点重复 POST）');
  host.dispose();
});

test('canvas 成就页文案收进 cjk 字体图集（新文案必须重建图集）', () => {
  const glyphs = new Set(JSON.parse(readFileSync(join(root, 'assets/fonts/cjk.metrics.json'), 'utf8')).glyphs.map(g => g.char));
  for (const ch of [...'成就已领取返回暂无奔跑技巧收集角色网络未连接，稍后重试解锁更多跑者金币×未达成']) {
    assert.ok(glyphs.has(ch), `cjk 图集缺少成就页文案字形「${ch}」`);
  }
});

// ---------------- DOM 面板（fakeDom，按类名+aria 定位） ----------------

test('DOM 成就面板：分组行、progressbar aria、领取状态行与 is-claimed、Esc 返回、dispose 移除', async t => {
  const mod = await importWebModule('../apps/web/src/mobileAchievements.ts');
  const f = fakeDom(t);
  const a = rowView({ id: 'ach_a', claimable: true });
  const b = rowView({ id: 'ach_b', name: '小小阵容', desc: '解锁 3 名角色', tier: 'gold', group: 'chars', source: 'local', progress: 100, claimable: false, locked: true });
  const c = rowView({ id: 'ach_c', name: '常客', desc: '完成 10 局', tier: 'silver', group: 'run', source: 'run', progress: 3 });
  const page = pageView({
    offline: true,
    sections: [
      { group: 'run', title: '奔跑', note: '里程、跳跃与能量的积累', rows: [a, c] },
      { group: 'chars', title: '角色', note: '解锁更多跑者', rows: [b] },
    ],
    rows: [a, c, b], claimedCount: 0, total: 3,
  });
  const seen = [];
  const dispose = mod.createMobileAchievements({}, page, {
    onBack: () => seen.push('back'),
    onClaim: id => { seen.push(id); return { ok: true, message: '成就奖励已存入本机钱包' }; },
  });

  const rows = f.byClass(f.body, 'ach-row');
  assert.equal(rows.length, 3);
  assert.equal(f.byClass(f.body, 'ach-row--bronze').length, 1, '档位=行外框颜色（bronze 行类名）');
  assert.equal(f.byClass(f.body, 'ach-row--silver').length, 1, '档位=行外框颜色（silver 行类名）');
  assert.equal(f.byClass(f.body, 'ach-row--gold').length, 1, '档位=行外框颜色（gold 行类名）');
  assert.equal(f.byClass(f.body, 'ach-tier').length, 0, '铜/银/金徽标已移除（档位改由外框色表达）');
  assert.ok(rows[0].textContent.includes('金币 ×300'), '行内展示奖励文案');
  assert.equal(f.byClass(f.body, 'ach-flag--pending').length, 1, '未达标行右侧白底「未达成」状态框');
  assert.ok(rows[1].textContent.includes('未达成'), '未达标行状态框文案');
  assert.ok(f.byClass(f.body, 'ach-panel').every(p => p.children.some(c => c.tagName === 'h2')), '分节标题');
  const progress = f.all(f.body).find(n => n.getAttribute('role') === 'progressbar');
  assert.equal(progress.getAttribute('aria-valuemin'), '0');
  assert.equal(progress.getAttribute('aria-valuemax'), '100');
  assert.equal(progress.getAttribute('aria-valuenow'), '100');

  const claim = f.byClass(f.body, 'ach-claim')[0];
  claim.click();
  assert.deepEqual(seen, ['ach_a']);
  const status = f.byClass(f.body, 'ach-status')[0];
  assert.equal(status.textContent, '成就奖励已存入本机钱包', 'role=status 状态行回显领取结果');
  assert.equal(f.byClass(f.body, 'ach-row')[0].classList.contains('is-claimed'), true, '领取行加 is-claimed');

  const locked = f.byClass(f.body, 'ach-claim').find(b => b.disabled);
  assert.ok(locked, '离线锁定领取按钮置灰');
  locked.click();
  assert.deepEqual(seen, ['ach_a'], '置灰按钮不触发领取');

  const rootEl = f.body.children[0];
  rootEl.dispatchEvent(f.key('Escape'));
  assert.deepEqual(seen, ['ach_a', 'back'], 'Esc 回大厅');
  assert.equal(rootEl.children[0].children[0].children[0].getAttribute('aria-label'), '返回上一页', 'pageHeader 返回钮（root→frame→header→back）');

  dispose();
  assert.equal(f.body.children.length, 0, 'dispose 移除整页');
});

test('DOM 成就面板：已领取行渲染「已领取 ✓」且不出现领取按钮', async t => {
  const mod = await importWebModule('../apps/web/src/mobileAchievements.ts');
  const f = fakeDom(t);
  const a = rowView({ id: 'ach_a', claimed: true, claimable: false });
  const page = pageView({
    sections: [{ group: 'run', title: '奔跑', note: '里程、跳跃与能量的积累', rows: [a] }],
    rows: [a], claimedCount: 1, total: 1,
  });
  const dispose = mod.createMobileAchievements({}, page, { onBack() {}, onClaim() { throw new Error('已领取行不应出现领取按钮'); } });
  const row = f.byClass(f.body, 'ach-row')[0];
  assert.equal(row.classList.contains('is-claimed'), true);
  assert.ok(f.byClass(f.body, 'ach-flag--claimed')[0].textContent.includes('已领取'), '已领取状态框（灰底）');
  assert.equal(f.byClass(f.body, 'ach-claim').length, 0);
  dispose();
});

test('DOM 成就面板：statusMessage 优先上状态行（load 失败真实原因），受理中按钮置灰', async t => {
  const mod = await importWebModule('../apps/web/src/mobileAchievements.ts');
  const f = fakeDom(t);
  const a = rowView({ id: 'ach_a', claimable: true, claiming: true });
  const page = pageView({
    offline: true, statusMessage: '本机钱包记录损坏，请保留存档并联系支持',
    sections: [{ group: 'run', title: '奔跑', note: '里程、跳跃与能量的积累', rows: [a] }],
    rows: [a], total: 1,
  });
  const dispose = mod.createMobileAchievements({}, page, {
    onBack() {},
    onClaim() { throw new Error('受理中按钮不应可点'); },
  });
  assert.match(f.byClass(f.body, 'ach-status')[0].textContent, /钱包记录损坏/, '状态行优先展示 statusMessage，而非默认离线文案');
  const claim = f.byClass(f.body, 'ach-claim')[0];
  assert.equal(claim.disabled, true, '受理中（claiming）领取按钮置灰');
  claim.click();
  dispose();
});
