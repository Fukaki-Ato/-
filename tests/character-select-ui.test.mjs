import test from 'node:test';
import assert from 'node:assert/strict';
import { importWebModule, fakeDom } from './dom-fixture.mjs';

const { createCharacterSelectOverlay } = await importWebModule('../apps/web/src/characterSelectOverlay.ts');
const setup = (t, initial = 'char_volt', modify = () => {}) => {
  const fixture = fakeDom(t); modify(fixture.content);
  const calls = [];
  const dispose = createCharacterSelectOverlay(fixture.content, {
    onSelect: id => calls.push(['select',id]), onStartRun: id => calls.push(['start',id]),
    onShop: id => calls.push(['shop',id]), onBack: () => calls.push(['back']),
  }, initial, 'guest', {});
  const root = fixture.body.children[0];
  return {...fixture, root, calls, dispose, find: name => fixture.byClass(root, name)[0]};
};

test('selection showcase uses portrait cutouts and page-scoped keyboard/cycle controls', t => {
  const { root, all, find, calls, dispose, key, body } = setup(t);
  assert.equal(root.getAttribute('role'), 'dialog');
  assert.equal(root.getAttribute('aria-modal'), 'true');
  assert.equal(find('select-name').textContent, '牢大');
  assert.equal(find('select-counter').textContent, '01 / 10');
  assert.equal(find('select-hero-portrait').children[0].tagName, 'img');
  assert.match(find('select-hero-portrait').children[0].src, /bball\.webp$/);
  assert.equal(all(root).filter(node => node.classList.contains('select-roster-card')).length, 10);
  assert.equal(all(root).some(node => node.dataset.charId === 'char_bball'), false);
  assert.equal(all(root).filter(node => node.tagName === 'canvas').length, 0, 'selection does not start another mobile renderer');
  find('select-next').click();
  assert.equal(find('select-name').textContent, '阿玛拉');
  assert.equal(calls.at(-1)[1], 'char_ama');
  find('select-previous').click(); find('select-previous').click();
  assert.equal(find('select-name').textContent, '企鹅娘', 'ama 退两格=牢大→末尾（企鹅娘，名单新末尾）');
  assert.match(find('select-hero-portrait').children[0].src, /penguin\.webp$/);
  document.dispatchEvent(key('ArrowRight'));
  assert.equal(find('select-name').textContent, '企鹅娘', 'unrelated document events do not navigate this page');
  root.dispatchEvent(key('ArrowRight'));
  assert.equal(find('select-name').textContent, '牢大');
  root.dispatchEvent(key('Tab'));
  assert.equal(document.activeElement.getAttribute('aria-label'), '返回主菜单');
  find('select-start-button').click();
  assert.deepEqual(calls.at(-1), ['start','char_volt']);
  root.dispatchEvent(key('Escape'));
  assert.deepEqual(calls.at(-1), ['back']);
  dispose();
  const count = calls.length; root.dispatchEvent(key('Escape'));
  assert.equal(calls.length, count, 'navigation removes selection keyboard handlers');
  assert.equal(body.children.length, 0);
});

test('removed basketball role falls back to 牢大 and starts with its audio identity', t => {
  const { find, calls, dispose } = setup(t, 'char_bball');
  assert.equal(find('select-name').textContent, '牢大');
  assert.match(find('select-hero-portrait').children[0].src, /bball\.webp$/);
  find('select-start-button').click();
  assert.deepEqual(calls.at(-1), ['start', 'char_volt']);
  dispose();
});

test('locked-role preview shows correct data, keeps start disabled, and forwards the preview to shop', t => {
  const { root, byClass, find, calls, dispose } = setup(t, 'char_volt', content => { content.characters.items.find(item => item.id === 'char_ama').locked = true; });
  byClass(root,'select-roster-card').find(card => card.dataset.charId === 'char_ama').click();
  assert.equal(find('select-name').textContent, '阿玛拉');
  assert.match(find('select-state').textContent, /锁定/);
  assert.match(find('select-action-note').textContent, /阿玛拉.*锁定/);
  assert.match(find('select-unlock').textContent, /4,500/);
  assert.equal(find('select-start-button').disabled, true);
  find('select-start-button').click();
  assert.equal(calls.filter(call => call[0] === 'start').length, 0);
  find('select-shop-button').click();
  assert.deepEqual(calls.at(-1), ['shop','char_ama']);
  assert.equal(byClass(root,'select-roster-card').filter(card => card.getAttribute('aria-pressed') === 'true').length, 1);
  dispose();
});

test('empty roster disables all run/cycle controls without dispatching a role choice', t => {
  const { find, calls, dispose } = setup(t, '', content => { content.characters.items = []; });
  assert.equal(find('select-name').textContent, '暂无可选角色');
  assert.equal(find('select-counter').textContent, '00 / 00');
  for (const name of ['select-start-button','select-previous','select-next']) assert.equal(find(name).disabled, true);
  assert.equal(calls.length, 0);
  dispose();
});

test('unknown future roles retain the generic fallback instead of requiring a shipped portrait', t => {
  const { find, dispose } = setup(t, 'char_future', content => {
    content.characters.items.push({...content.characters.items[0], id:'char_future', name:{'zh-CN':'新伙伴'}, tint:'#448866'});
  });
  assert.equal(find('select-name').textContent, '新伙伴');
  assert.ok(find('select-hero-portrait').classList.contains('is-generic-art'));
  assert.equal(find('select-hero-portrait').children[0].textContent, '新');
  dispose();
});

test('compact abilities open complete details without leaving selection or cycling the role', t => {
  const { root, find, calls, dispose, key } = setup(t);
  const frame = find('character-select-frame');
  const summary = find('select-ability-board').children[0];
  summary.focus(); summary.click();
  assert.equal(find('select-details').hidden, false);
  assert.equal(frame.inert, true);
  assert.equal(frame.getAttribute('aria-hidden'), 'true');
  assert.match(find('select-details-content').textContent, /2.5 秒无敌/);
  assert.match(find('select-details-content').textContent, /金币收益/);
  assert.equal(document.activeElement.getAttribute('aria-label'), '关闭角色能力');
  const before = calls.length;
  root.dispatchEvent(key('ArrowRight'));
  assert.equal(calls.length, before);
  root.dispatchEvent(key('Tab'));
  assert.equal(document.activeElement.getAttribute('aria-label'), '关闭角色能力');
  root.dispatchEvent(key('Escape'));
  assert.equal(find('select-details').hidden, true);
  assert.equal(frame.inert, false);
  assert.equal(frame.getAttribute('aria-hidden'), null);
  assert.equal(document.activeElement, summary);
  assert.equal(calls.filter(call => call[0] === 'back').length, 0, 'first Escape closes details, not the selection page');
  dispose();
});


test('shard synthesis is independently enabled and never repeats or bypasses config locks', async t => {
  const { selectUnlockActions } = await import('../packages/game/dist/flow/unlock.js');
  const { grant, walletBalance } = await import('../packages/game/dist/flow/localEconomy.js');
  const fixture = fakeDom(t);
  const map = new Map();
  const store = { get: k => map.get(k) ?? null, set: (k, v) => map.set(k, v) };
  grant(store, [{ item: 'shard_ama', n: 120 }]);
  const actions = selectUnlockActions(store, fixture.content);
  const dispose = createCharacterSelectOverlay(fixture.content, {
    ...actions, onSelect() {}, onStartRun() {}, onShop() {}, onBack() {},
  }, 'char_ama', 'guest', {});
  const root = fixture.body.children[0];
  const find = name => fixture.byClass(root, name)[0];
  assert.equal(find('select-unlock-button').disabled, true, 'no coins');
  assert.equal(find('select-synthesize-button').disabled, false, 'enough shards');
  find('select-synthesize-button').click();
  assert.equal(find('select-start-button').disabled, false);
  assert.equal(walletBalance(store, 'shard_ama'), 60);
  assert.equal(actions.onSynthesize('char_ama').ok, false);
  assert.equal(walletBalance(store, 'shard_ama'), 60, 'duplicate action does not spend');
  dispose();
  fixture.content.characters.items.find(c => c.id === 'char_kaze').locked = true;
  grant(store, [{ item: 'shard_kaze', n: 60 }]);
  assert.equal(actions.canSynthesize('char_kaze'), false);
  assert.equal(actions.onSynthesize('char_kaze').ok, false);
  assert.equal(walletBalance(store, 'shard_kaze'), 60);
  const disposeLocked = createCharacterSelectOverlay(fixture.content, {
    ...actions, onSelect() {}, onStartRun() {}, onShop() {}, onBack() {},
  }, 'char_kaze', 'guest', {});
  const locked = fixture.body.children[0];
  assert.equal(fixture.byClass(locked, 'select-synthesize-button')[0].style.display, 'none');
  assert.equal(fixture.byClass(locked, 'select-start-button')[0].disabled, true);
  disposeLocked();
});
