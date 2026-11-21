import test from 'node:test';
import assert from 'node:assert/strict';
import { loadContent } from '../tools/replay/runner.mjs';
import { playableCharacters, isCharacterLocked } from '../packages/game/dist/core/sim/character.js';
import { isCharacterGated, selectUnlockActions } from '../packages/game/dist/flow/unlock.js';
import { COINS_KEY, UNLOCKS_KEY, walletBalance } from '../packages/game/dist/flow/localEconomy.js';
import { createGameFlow, CHAR_KEY } from '../packages/game/dist/flow/mainFlow.js';
import { fakeDom, importWebModule } from './dom-fixture.mjs';

function storage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return { values, get: key => values.get(key) ?? null, set: (key, value) => values.set(key, value), remove: key => values.delete(key) };
}

test('当前十个角色对新旧存档全部免费开放，不扣钱包或覆盖解锁记录', () => {
  const content = loadContent();
  const roles = playableCharacters(content);
  assert.equal(roles.length, 10);
  for (const initial of [{}, { [COINS_KEY]: '100', [UNLOCKS_KEY]: '["char_ama"]' }]) {
    const store = storage(initial);
    const before = [...store.values];
    const actions = selectUnlockActions(store, content);
    for (const role of roles) {
      assert.equal(role.status, 'live');
      assert.deepEqual(role.unlock, { type: 'free' });
      assert.equal(isCharacterLocked(role), false);
      assert.equal(isCharacterGated(content, role.id, store), false);
      assert.equal(actions.isGated(role.id), false);
      assert.equal(actions.onUnlock(role.id).ok, false, '免费角色无需执行解锁交易');
      assert.equal(actions.canSynthesize(role.id), false);
    }
    assert.deepEqual([...store.values], before);
  }
});

test('零余额新玩家可逐个选择十个角色并进入对应跑局', async () => {
  const content = loadContent(), store = storage();
  let actions, active;
  const started = [];
  const flow = createGameFlow({
    adapter: { env: 'web', storage: store, fetchJson: async name => content[name], onInput: () => () => {},
      canvas: { mainCanvas: () => ({}), windowSize: () => ({ width: 390, height: 844, dpr: 1 }) } },
    views: { renderBoot: () => ({ setStatus() {} }),
      renderSelect: (_content, value) => { actions = value; },
      mountHud: () => ({ update() {}, dispose() {} }), toast() {},
    },
    configResolve: name => name,
    createScene: (_host, _adapter, sim) => { active = sim.loadout.charId; started.push(active); return { dispose() {} }; },
  });
  await flow.boot();
  for (const role of playableCharacters(content)) {
    assert.equal(actions.onChooseCharacter(role.id), true);
    assert.equal(store.get(CHAR_KEY), role.id);
    actions.onStartRun(role.id);
    assert.equal(flow.machine.current(), 'run');
    assert.equal(active, role.id);
    flow.machine.go('select');
  }
  assert.equal(started.length, 10);
  assert.equal(walletBalance(store, 'coin'), 0);
  assert.equal(walletBalance(store, 'diamond'), 0);
  assert.equal(store.get(UNLOCKS_KEY), null);
});

test('角色页十张卡均可直接开始，不显示解锁或碎片合成按钮', async t => {
  const fixture = fakeDom(t), store = storage(), started = [];
  const { createCharacterSelectOverlay } = await importWebModule('../apps/web/src/characterSelectOverlay.ts');
  const dispose = createCharacterSelectOverlay(fixture.content, {
    ...selectUnlockActions(store, fixture.content), onSelect() {}, onStartRun: id => started.push(id), onShop() {}, onBack() {},
  }, 'char_volt', 'guest', {});
  const root = fixture.body.children[0];
  const find = name => fixture.byClass(root, name)[0];
  const cards = fixture.byClass(root, 'select-roster-card');
  assert.equal(cards.length, 10);
  for (const card of cards) {
    card.click();
    assert.equal(card.dataset.locked, 'false');
    assert.equal(find('select-start-button').disabled, false);
    assert.equal(find('select-unlock-button').style.display, 'none');
    assert.equal(find('select-synthesize-button').style.display, 'none');
    assert.match(find('select-unlock').textContent, /免费开放/);
    find('select-start-button').click();
  }
  assert.deepEqual(started, cards.map(card => card.dataset.charId));
  dispose(); // 在 fakeDom 的全局恢复 hook 之前清理页面。
});
