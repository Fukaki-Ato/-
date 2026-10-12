/**
 * 赛道生成器不变量测试（docs/08 §4 可解性校验的 M1 简化版）
 * 断言：
 *   1. 任意同一 z 窗口内，"不可跳不可铲"的墙(full/vehicle)最多占 2 条车道（必有活路）；
 *   2. 金币链长度全部落在 chainBuckets 范围内；
 *   3. 多道金币齐头齐尾，长度受跳跃净空限制；三道抽取权重升为 30%。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TrackGen } from '../packages/game/dist/core/sim/trackGen.js';
import { RunRng } from '../packages/game/dist/core/rng.js';
import { coinJumpSpan } from '../packages/game/dist/core/sim/coinJumpSpan.js';
import { layCoinChains } from '../packages/game/dist/core/sim/trackCoins.js';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const NAMES = ['game', 'characters', 'skills', 'items', 'obstacles', 'themes', 'events', 'economy'];
const content = Object.fromEntries(NAMES.map(n => [n, JSON.parse(readFileSync(join(root, 'config', `${n}.json`), 'utf8'))]));

test('高难度封路分布：by≥3 时单道约 80% / 双道约 20%（只计 full/vehicle/moving），三道封堵永不出现', () => {
  const gen = new TrackGen(content, new RunRng(2026));
  const hist = { 1: 0, 2: 0, 3: 0 };
  for (let i = 0; i < 4000; i++) {
    const pat = gen.pickPattern(5); // 难度档 5（1500m+）
    hist[gen.maxBlockedLanes(pat)]++;
  }
  assert.equal(hist[3], 0, '出现三车道封堵');
  const total = hist[1] + hist[2];
  // 「不连续同模板」会让少数 want=2 抽次回落到单道模板（约 +3pp），80/20 的 ±6pp 容差仍覆盖
  assert.ok(Math.abs(hist[1] / total * 100 - 80) < 6, `单道 ${hist[1]} 双道 ${hist[2]} 偏离 80/20`);
});

test('生成 20000m：墙类障碍从不同时封死三条道', () => {
  const gen = new TrackGen(content, new RunRng(42));
  const obstacles = [], coins = [];
  for (let d = 0; d <= 20000; d += 200) gen.ensure(d, 400, obstacles, coins);
  // 按 2m 窗口分桶检查 full/vehicle 的车道占用
  const buckets = new Map();
  for (const o of obstacles) {
    if (o.cls !== 'full' && o.cls !== 'vehicle') continue;
    const b = Math.floor(o.worldZ / 2);
    if (!buckets.has(b)) buckets.set(b, new Set());
    buckets.get(b).add(o.lane);
  }
  for (const [b, lanes] of buckets) {
    // 列车长 24m 会跨多个窗口，同车多窗口属正常；真封死 = 同窗口 3 车道全满
    assert.ok(lanes.size <= 2, `z≈${b * 2}m 三条道同时被墙封死`);
  }
});

test('金币链长度全部在配置范围且不超过该段普通跳跃净空距离', () => {
  const gen = new TrackGen(content, new RunRng(7));
  const obstacles = [], coins = [];
  for (let d = 0; d <= 5000; d += 200) gen.ensure(d, 400, obstacles, coins);
  assert.ok(coins.length > 500);
  for (const c of coins) assert.ok(c.lane >= -1 && c.lane <= 1);
  const chains = new Map();
  for (const c of coins) {
    const key = `${c.chain}:${c.lane}`;
    if (!chains.has(key)) chains.set(key, []);
    chains.get(key).push(c.worldZ);
  }
  const p = content.game.params, r = p.runner;
  const min = Math.min(...p.coins.chainBuckets.map(b => b.min));
  const max = Math.max(...p.coins.chainBuckets.map(b => b.max));
  for (const zs of chains.values()) {
    assert.ok(zs.length >= min && zs.length <= max);
    const speed = Math.min(r.maxSpeed, r.baseSpeed + r.speedRampPer100M * zs[0] / 100);
    assert.ok(zs.at(-1) - zs[0] <= coinJumpSpan(r, speed, p.coins.jumpSpanRatio) + 1e-8);
    for (let i = 1; i < zs.length; i++) assert.ok(Math.abs(zs[i] - zs[i - 1] - p.coins.spacingM) < 1e-8);
  }
});

test('金币不与障碍重叠：同车道深度范围内不存在金币', () => {
  const gen = new TrackGen(content, new RunRng(5));
  const obstacles = [], coins = [];
  for (let d = 0; d <= 10000; d += 200) gen.ensure(d, 400, obstacles, coins);
  assert.ok(coins.length > 300, '样本不足');
  for (const c of coins) {
    for (const o of obstacles) {
      if (o.lane === c.lane && Math.abs(c.worldZ - o.worldZ) < o.d / 2 + 0.3) {
        assert.fail(`重叠: lane=${c.lane} coinZ=${c.worldZ.toFixed(1)} obs=${o.obsRef} obsZ=${o.worldZ.toFixed(1)}`);
      }
    }
  }
});

test('无遮挡窗口按 50/20/30 生成同步金币组（不被强制补链混淆）', () => {
  const rng = new RunRng(99), p = content.game.params.coins;
  const counts = { 1: 0, 2: 0, 3: 0 };
  for (let i = 0; i < 5000; i++) {
    const coins = [];
    layCoinChains({ rng, coins, obstacles: [], winStart: 0, winEnd: 48, safeLane: 0,
      laneWeights: p.laneGroupWeights, chainBuckets: p.chainBuckets, spacing: p.spacingM,
      laneGapM: Infinity, lastCoinZ: { '-1': 0, 0: 0, 1: 0 }, seq: () => 1, maxSpanM: 10 });
    const lanes = [...new Set(coins.map(c => c.lane))];
    counts[lanes.length]++;
    const first = coins.filter(c => c.lane === lanes[0]).map(c => c.worldZ);
    for (const lane of lanes) assert.deepEqual(coins.filter(c => c.lane === lane).map(c => c.worldZ), first);
  }
  for (const n of [1, 2, 3]) assert.ok(Math.abs(counts[n] / 50 - p.laneGroupWeights[n]) < 3, JSON.stringify(counts));
});

test('车道金币覆盖：任意车道断档不超过 laneGapM+一个模板窗（左右道不是金币荒漠）', () => {
  const gen = new TrackGen(content, new RunRng(777));
  const obstacles = [], coins = [];
  for (let d = 0; d <= 20000; d += 200) gen.ensure(d, 400, obstacles, coins);
  const laneGapM = content.game.params.coins.laneGapM;
  // 上限推导：断档>gap 时下一窗即强制补链，链起点最晚在窗尾+链长；24m×2 模板 + 16×1.5 链 + 30 余量
  const limit = laneGapM + 2 * 24 + 16 * 1.5 + 30;
  for (const lane of [-1, 0, 1]) {
    const zs = coins.filter(c => c.lane === lane).map(c => c.worldZ).sort((a, b) => a - b);
    assert.ok(zs.length > 300, `lane=${lane} 样本不足`);
    let maxGap = 0, at = 0;
    for (let i = 1; i < zs.length; i++) {
      const g = zs[i] - zs[i - 1];
      if (g > maxGap) { maxGap = g; at = zs[i]; }
    }
    assert.ok(maxGap <= limit, `lane=${lane} 在 ${at.toFixed(0)}m 处断档 ${maxGap.toFixed(0)}m > ${limit}m`);
  }
});
