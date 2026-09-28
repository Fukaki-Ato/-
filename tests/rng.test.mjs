/**
 * RNG 单元测试（node --test 运行；对应 docs/08 §2 快照思路的第一批）
 * 验证点：同 seed 可复现、不同 seed 不同序列、hashSeed 稳定、weighted 权重生效。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32, hashSeed, RunRng } from '../packages/game/dist/core/rng.js';

test('mulberry32 同 seed 序列完全一致（确定性）', () => {
  const a = mulberry32(12345), b = mulberry32(12345);
  for (let i = 0; i < 1000; i++) assert.equal(a(), b());
});

test('不同 seed 序列不同', () => {
  const a = mulberry32(1), b = mulberry32(2);
  const diff = Array.from({ length: 20 }, () => a() !== b());
  assert.ok(diff.every(Boolean));
});

test('hashSeed 稳定且分布可用', () => {
  assert.equal(hashSeed('2026-09-22'), hashSeed('2026-09-22'));
  assert.notEqual(hashSeed('a'), hashSeed('b'));
  assert.ok(hashSeed('x') >= 0 && hashSeed('x') <= 0xffffffff);
});

test('RunRng.range/int 边界正确', () => {
  const r = new RunRng(7);
  for (let i = 0; i < 500; i++) {
    const v = r.int(1, 3);
    assert.ok(Number.isInteger(v) && v >= 1 && v <= 3);
    const f = r.range(2, 5);
    assert.ok(f >= 2 && f < 5);
  }
});

test('RunRng.weighted 权重为 0 的项永不被选中', () => {
  const r = new RunRng(99);
  const items = [{ id: 'a', w: 1 }, { id: 'b', w: 0 }];
  for (let i = 0; i < 300; i++) assert.equal(r.weighted(items, x => x.w).id, 'a');
});

test('RunRng.pick 只返回数组内元素', () => {
  const r = new RunRng(5);
  const arr = ['x', 'y', 'z'];
  for (let i = 0; i < 200; i++) assert.ok(arr.includes(r.pick(arr)));
});
