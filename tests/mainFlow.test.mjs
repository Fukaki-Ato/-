/**
 * 主流程最佳分测试（对应 M2 审计：键名笔误迁移 + 脏值兜底）
 * 通过 createGameFlow + 场景机直接进入 result 场景，用内存 storage mock 观察读写行为。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameFlow, BEST_KEY } from '../packages/game/dist/flow/mainFlow.js';

const LEGACY_KEY = 'thunderrun:b\u2026st'; // 旧版笔误键：b + U+2026 省略号 + st

function makeFlow(initial) {
  const store = new Map(Object.entries(initial ?? {}));
  const seen = { best: null, summary: null };
  const adapter = {
    storage: {
      get: k => (store.has(k) ? store.get(k) : null),
      set: (k, v) => { store.set(k, v); },
      remove: k => { store.delete(k); },
    },
    onInput: () => () => {},
  };
  const views = {
    renderBoot: () => ({ setStatus() {} }),
    renderLogin: () => ({ submit() {} }),
    renderMenu: () => {},
    mountHud: () => ({ update() {}, dispose() {} }),
    renderResult: (summary, best) => { seen.summary = summary; seen.best = best; },
    toast: () => {},
  };
  const flow = createGameFlow({ adapter, views, configResolve: n => `./${n}.json` });
  return { flow, store, seen };
}

const summaryOf = score => ({
  t: 1, distance: 10, coins: 0, nearMiss: 0, hits: 0, score, alive: true, casts: 0, charId: 'char_volt',
});

test('BEST_KEY 是不含省略号的修正键', () => {
  assert.equal(BEST_KEY, 'thunderrun:best');
  assert.ok(!BEST_KEY.includes('\u2026'));
});

test('旧键迁移：新键缺失且旧键为有效值 → 校验后写入新键并删旧键', () => {
  const { flow, store, seen } = makeFlow({ [LEGACY_KEY]: '42' });
  flow.machine.go('result', summaryOf(10));
  assert.equal(seen.best, 42);
  assert.equal(store.get(BEST_KEY), '42');
  assert.equal(store.has(LEGACY_KEY), false);
  assert.equal(seen.summary.score, 10);
});

test('旧键迁移：脏值按 0，不写入新键且旧键清除（不把脏值当好成绩）', () => {
  const { flow, store, seen } = makeFlow({ [LEGACY_KEY]: 'oops' });
  flow.machine.go('result', summaryOf(7));
  assert.equal(seen.best, 0);
  assert.equal(store.get(BEST_KEY), '7'); // 由 result 写入路径落盘
  assert.equal(store.has(LEGACY_KEY), false);
});

test('新键脏值（NaN/Infinity/负数）按 0，真实分数可正常刷新纪录', () => {
  for (const dirty of ['abc', 'Infinity', '-5', '']) {
    const { flow, store, seen } = makeFlow({ [BEST_KEY]: dirty });
    flow.machine.go('result', summaryOf(9));
    assert.equal(seen.best, 0, `dirty=${JSON.stringify(dirty)}`);
    assert.equal(store.get(BEST_KEY), '9', `dirty=${JSON.stringify(dirty)}`);
  }
});

test('平纪录不覆盖好值：score <= best 时不重写存储，best 原样透传视图', () => {
  const { flow, store, seen } = makeFlow({ [BEST_KEY]: '100', [LEGACY_KEY]: '5' });
  flow.machine.go('result', summaryOf(100));
  assert.equal(seen.best, 100);
  assert.equal(store.get(BEST_KEY), '100'); // 未被旧键 5 覆盖，也未因平纪录重写
});
