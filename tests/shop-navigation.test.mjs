import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGameFlow, CHAR_KEY } from '../packages/game/dist/flow/mainFlow.js';

const root = fileURLToPath(new URL('../', import.meta.url));

function makeFlow({ lockedCharId } = {}) {
  const store = new Map();
  const inputs = [];
  const seen = { select: [], characterSelect: [], shop: [] };
  const adapter = {
    storage: {
      get: key => store.has(key) ? store.get(key) : null,
      set: (key, value) => store.set(key, value),
      remove: key => store.delete(key),
    },
    fetchJson: async name => {
      const config = JSON.parse(readFileSync(join(root, 'config', name + '.json'), 'utf8'));
      if (name === 'characters' && lockedCharId) {
        const character = config.items.find(item => item.id === lockedCharId);
        if (character) character.status = 'locked';
      }
      return config;
    },
    canvas: { mainCanvas: () => ({}), windowSize: () => ({ width: 390, height: 844, dpr: 2 }) },
    onInput: callback => { inputs.push(callback); return () => {}; },
  };
  const views = {
    renderBoot: () => ({ setStatus() {} }),
    renderStart: () => ({ setBusy() {}, setFeedback() {} }),
    renderSelect: (_content, actions, currentCharId) => seen.select.push({ actions, currentCharId }),
    renderCharacterSelectPage: (_content, actions, currentCharId) => seen.characterSelect.push({ actions, currentCharId }),
    renderShop: (content, actions) => seen.shop.push({ content, actions }),
    mountHud: () => ({ update() {}, dispose() {} }),
    renderResult() {},
    toast() {},
  };
  const flow = createGameFlow({ adapter, views, configResolve: name => name });
  return { flow, store, seen, inputs };
}

async function readyFlow(options) {
  const fixture = makeFlow(options);
  await fixture.flow.boot();
  assert.equal(fixture.flow.machine.current(), 'select');
  return fixture;
}

test('lobby shop opens read-only view and Back returns to lobby with the active role', async () => {
  const { flow, store, seen, inputs } = await readyFlow();
  const charId = store.get(CHAR_KEY);
  seen.select.at(-1).actions.onShop();
  assert.equal(flow.machine.current(), 'shop');
  const shop = seen.shop.at(-1);
  assert.ok(shop.content);
  assert.equal(typeof shop.actions.onBack, 'function');
  assert.equal(store.get(CHAR_KEY), charId, 'opening the shop does not alter the role');
  for (const input of inputs) input({ type: 'key', phase: 'down', code: 'Escape' });
  assert.equal(flow.machine.current(), 'select');
  assert.equal(seen.select.at(-1).currentCharId, charId);
});

test('character shop returns to its caller and preserves both unlocked and locked selections', async () => {
  const { flow, store, seen, inputs } = await readyFlow({ lockedCharId: 'char_ama' });
  flow.machine.go('characterSelect');

  let page = seen.characterSelect.at(-1);
  page.actions.onSelect('char_kaze');
  page.actions.onShop('char_kaze');
  assert.equal(flow.machine.current(), 'shop');
  seen.shop.at(-1).actions.onBack();
  assert.equal(flow.machine.current(), 'characterSelect');
  assert.equal(seen.characterSelect.at(-1).currentCharId, 'char_kaze');
  assert.equal(store.get(CHAR_KEY), 'char_kaze');

  page = seen.characterSelect.at(-1);
  page.actions.onSelect('char_ama');
  page.actions.onShop('char_ama');
  assert.equal(flow.machine.current(), 'shop');
  for (const input of inputs) input({ type: 'key', phase: 'down', code: 'Escape' });
  assert.equal(flow.machine.current(), 'characterSelect');
  assert.equal(seen.characterSelect.at(-1).currentCharId, 'char_ama');
  assert.equal(store.get(CHAR_KEY), 'char_kaze', 'viewing a locked role does not change the active role');
});
