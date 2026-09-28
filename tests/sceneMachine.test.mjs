/**
 * 场景状态机测试（对应 docs/02 §5）
 * 验证点：切换钩子顺序、同态忽略、未知场景报错、订阅与退订。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneMachine } from '../packages/game/dist/core/scene/sceneMachine.js';

test('切换顺序：exit(prev) → enter(next) → 通知监听', () => {
  const log = [];
  const m = createSceneMachine({
    a: { onEnter: () => log.push('enter-a'), onExit: () => log.push('exit-a') },
    b: { onEnter: ctx => log.push(`enter-b:${ctx}`), onExit: () => log.push('exit-b') },
  }, 'a');
  m.onChange((next, prev) => log.push(`${prev}->${next}`));
  m.go('b', 42);
  assert.deepEqual(log, ['exit-a', 'enter-b:42', 'a->b']);
  assert.equal(m.current(), 'b');
});

test('重复进入同一场景被忽略（初始进入不触发钩子，由 bootstrap 自行渲染）', () => {
  let enters = 0;
  const m = createSceneMachine({ a: { onEnter: () => enters++ } }, 'a');
  m.go('a');
  assert.equal(enters, 0);
});

test('未知场景抛错；退订后不再收到通知', () => {
  const m = createSceneMachine({ a: {}, b: {} }, 'a');
  assert.throws(() => m.go('ghost'), /未知场景/);
  let n = 0;
  const off = m.onChange(() => n++);
  m.go('b'); off(); m.go('a');
  assert.equal(n, 1);
});
