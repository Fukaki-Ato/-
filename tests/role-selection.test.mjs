import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGameFlow, CHAR_KEY, DEFAULT_CHAR } from '../packages/game/dist/flow/mainFlow.js';

const root = fileURLToPath(new URL('../', import.meta.url));

function makeFlow({ storedCharId, lockedCharId } = {}) {
  const store = new Map();
  if (storedCharId) store.set(CHAR_KEY, storedCharId);
  const seen = { select: [], start: [] };
  const adapter = {
    env: 'web',
    storage: {
      get: key => store.get(key) ?? null,
      set: (key, value) => store.set(key, value),
      remove: key => store.delete(key),
    },
    fetchJson: async name => {
      const config = JSON.parse(readFileSync(join(root, 'config', `${name}.json`), 'utf8'));
      if (name === 'characters' && lockedCharId) {
        const role = config.items.find(item => item.id === lockedCharId);
        if (role) role.status = 'locked';
      }
      return config;
    },
    canvas: { mainCanvas: () => ({}), windowSize: () => ({ width: 390, height: 844, dpr: 1 }) },
    onInput: () => () => {},
  };
  const views = {
    renderBoot: () => ({ setStatus() {} }),
    renderStart: actions => { seen.start.push(actions); return { setBusy() {}, setFeedback() {} }; },
    renderSelect: (_content, actions, currentCharId) => seen.select.push({ actions, currentCharId }),
    mountHud: () => ({ update() {}, dispose() {} }),
    renderResult() {},
    toast() {},
  };
  const flow = createGameFlow({ adapter, views, configResolve: name => name });
  return { flow, store, seen };
}

test('built-in lobby persists only available roles and retains the choice after re-entering', async () => {
  const { flow, store, seen } = makeFlow({ storedCharId: 'char_ama', lockedCharId: 'char_ama' });
  await flow.boot();
  assert.equal(flow.machine.current(), 'select');
  assert.equal(store.get(CHAR_KEY), DEFAULT_CHAR, 'locked saved role is normalized');

  const actions = seen.select.at(-1).actions;
  assert.equal(actions.onChooseCharacter('char_ama'), false);
  assert.equal(actions.onStartRun('char_ama'), undefined);
  assert.equal(store.get(CHAR_KEY), DEFAULT_CHAR);
  assert.equal(actions.onChooseCharacter('char_kaze'), true);
  assert.equal(store.get(CHAR_KEY), 'char_kaze');

  flow.machine.go('start');
  seen.start.at(-1).onGuest();
  assert.equal(flow.machine.current(), 'select');
  assert.equal(seen.select.at(-1).currentCharId, 'char_kaze');
  assert.equal(store.get(CHAR_KEY), 'char_kaze');
});
