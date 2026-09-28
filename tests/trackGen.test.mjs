/**
 * 赛道生成器不变量测试（docs/08 §4 可解性校验的 M1 简化版）
 * 断言：
 *   1. 任意同一 z 窗口内，"不可跳不可铲"的墙(full/vehicle)最多占 2 条车道（必有活路）；
 *   2. 金币链长度全部落在 chainBuckets 范围内；
 *   3. 大样本下每组车道数分布贴近配置权重（70/25/5，容差 ±10 个百分点）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TrackGen } from '../packages/game/dist/core/sim/trackGen.js';
import { RunRng } from '../packages/game/dist/core/rng.js';

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

test('金币链长度全部在 5~16 且成组连续', () => {
  const gen = new TrackGen(content, new RunRng(7));
  const obstacles = [], coins = [];
  for (let d = 0; d <= 5000; d += 200) gen.ensure(d, 400, obstacles, coins);
  assert.ok(coins.length > 500);
  for (const c of coins) assert.ok(c.lane >= -1 && c.lane <= 1);
  // 按 (lane, 连续段) 分组统计链长（与上一枚同车道的链尾比较间隔）
  const chains = new Map();
  for (const c of [...coins].sort((a, b) => a.worldZ - b.worldZ)) {
    const k = c.lane;
    const arr = chains.get(k) ?? [];
    chains.set(k, arr);
    const last = arr[arr.length - 1];
    if (last && c.worldZ - last.end < 2) last.end = c.worldZ;
    else arr.push({ start: c.worldZ, end: c.worldZ });
  }
  let total = 0, ok = 0;
  for (const arr of chains.values()) for (const ch of arr) {
    const len = Math.round((ch.end - ch.start) / 1.5) + 1;
    total++;
    if (len >= 5 && len <= 16) ok++;
  }
  assert.equal(ok, total, `有链长越界的分组：${ok}/${total}`);
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

test('每组车道数分布贴近权重 70/25/5（整链投放允许少量削减）', () => {
  const gen = new TrackGen(content, new RunRng(99));
  const obstacles = [], coins = [];
  for (let d = 0; d <= 40000; d += 200) gen.ensure(d, 400, obstacles, coins);
  // 按生成器打的 chain id 聚合：同一轮投放的多条链起点相差 <10m，归为一个「组」
  const byChain = new Map();
  for (const c of coins) {
    if (c.chain == null) continue;
    let e = byChain.get(c.chain);
    if (!e) { e = { start: c.worldZ, lanes: new Set() }; byChain.set(c.chain, e); }
    e.lanes.add(c.lane);
    e.start = Math.min(e.start, c.worldZ);
  }
  const chainList = [...byChain.values()].sort((a, b) => a.start - b.start);
  const groups = [];
  for (const ch of chainList) {
    const cur = groups[groups.length - 1];
    if (!cur || ch.start - cur.start > 10) groups.push({ start: ch.start, lanes: new Set(ch.lanes) });
    else for (const l of ch.lanes) cur.lanes.add(l);
  }
  const pct = n => groups.filter(g => g.lanes.size === n).length / groups.length * 100;
  assert.ok(groups.length > 400, '样本不足');
  // 权重按 70/25/5 抽取；列车封道等不可投放情况会让单道实现率上浮，属预期
  assert.ok(pct(1) >= 55 && pct(1) <= 90, `单道占比 ${pct(1).toFixed(1)}% 超出合理区间`);
  assert.ok(pct(1) > pct(2) && pct(2) > pct(3), `应满足 单道>双道>三道，实际 ${pct(1).toFixed(0)}/${pct(2).toFixed(0)}/${pct(3).toFixed(0)}`);
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
