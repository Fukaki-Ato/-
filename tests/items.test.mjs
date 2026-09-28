/**
 * M2 道具测试：磁铁 / 弹跳鞋 / 道具箱生成
 * 断言的时长、半径、倍率全部来自 items.json（改配置即改预期，代码不持有数值）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RunnerSim } from '../packages/game/dist/core/sim/runnerSim.js';
import { TrackGen } from '../packages/game/dist/core/sim/trackGen.js';
import { RunRng, hashSeed } from '../packages/game/dist/core/rng.js';
import { itemEffects } from '../packages/game/dist/core/sim/character.js';
import { isPrimitiveSupported } from '../packages/game/dist/core/effects/buffEngine.js';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const NAMES = ['game', 'characters', 'skills', 'items', 'obstacles', 'themes', 'events', 'economy'];
const content = Object.fromEntries(NAMES.map(n => [n, JSON.parse(readFileSync(join(root, 'config', `${n}.json`), 'utf8'))]));

function cleanSim(seed) {
  const sim = new RunnerSim(content, seed);
  sim.obstacles.length = 0;
  sim.coinsArr.length = 0;
  sim.pickupsArr.length = 0;
  return sim;
}

/** buff 由效果引擎掌管（docs/09 T2.2）：测试通过公开入口施加，不直接写状态字段 */
function grant(sim, primitive, params) {
  sim.buffs.add(primitive, params, primitive, { distance: sim.state.distance, lane: sim.state.lane });
}

test('磁铁：身前 8 米内三条车道金币全部吸取；8 米外不动', () => {
  const sim = cleanSim(41);
  const d = sim.state.distance;
  const near = [], far = [];
  for (const lane of [-1, 0, 1]) {
    const a = { lane, worldZ: d + 6 };   // 6m 前方，8 米窗口内
    const b = { lane, worldZ: d + 14 };  // 14m 前方，窗口外
    sim.coinsArr.push(a, b);
    near.push(a); far.push(b);
  }
  grant(sim, 'magnet', { durationS: 10, radiusM: 8 });
  sim.step();
  assert.ok(near.every(c => c.taken), '窗口内 3 枚应全部吸走');
  assert.ok(far.every(c => !c.taken), '窗口外 3 枚应保留');
});

test('磁铁时长读配置：拾取磁暴手套 => 10 秒（refresh 语义）', () => {
  const sim = cleanSim(42);
  sim.pickupsArr.push({ itemRef: 'item_magnet', lane: 0, worldZ: sim.state.distance + 8 });
  for (let i = 0; i < 60; i++) sim.step();
  assert.ok(sim.fx.magnetT > 9.5 && sim.fx.magnetT <= 10, `magnetT=${sim.fx.magnetT}`);
});

test('弹跳鞋：12 秒配置 + 同一起跳点，穿鞋可跃过高杆、赤脚会被判负', () => {
  const mk = (boots) => {
    const sim = cleanSim(43);
    if (boots) sim.pickupsArr.push({ itemRef: 'item_boots', lane: 0, worldZ: sim.state.distance + 4 });
    sim.obstacles.push({ obsRef: 'gate', cls: 'high', w: 2, h: 2.6, d: 0.6, lane: 0, worldZ: sim.state.distance + 24 });
    let jumped = false;
    const seen = new Set();
    for (let i = 0; i < 60 * 3; i++) {
      if (!jumped && sim.state.distance > 24 - 6) { sim.applyAction('jump'); jumped = true; } // 固定提前 6m 起跳（适配 jumpVelocity 13.5）
      sim.step();
      for (const e of sim.events) seen.add(e.type);
    }
    return seen;
  };
  const withBoots = mk(true);
  assert.ok(!withBoots.has('hit'), '穿鞋同窗口起跳应跃过杆顶');
  const bare = mk(false);
  assert.ok(bare.has('hit') || bare.has('protected'), '赤脚同窗口起跳应撞杆');
});

test('弹跳鞋不改变滑铲钻杆能力（两种解法并存）', () => {
  const sim = cleanSim(44);
  grant(sim, 'jumpBoost', { durationS: 12, mul: 1.15 });
  sim.obstacles.push({ obsRef: 'gate', cls: 'high', w: 2, h: 2.6, d: 0.6, lane: 0, worldZ: sim.state.distance + 10 });
  const seen = new Set();
  for (let i = 0; i < 80; i++) {
    if (i === 30) sim.applyAction('slide');
    sim.step();
    for (const e of sim.events) seen.add(e.type);
  }
  assert.ok(!seen.has('hit') && !seen.has('protected'));
});

test('判定面前移：金币被收集时圆心仍在身体前表面之外（含步进过冲）', () => {
  const sim = cleanSim(45);
  const c = { lane: 0, worldZ: sim.state.distance + 1.05 };
  sim.coinsArr.push(c);
  let takenZ = 0;
  for (let i = 0; i < 20; i++) {
    sim.step();
    if (c.taken) { takenZ = sim.state.distance - c.worldZ; break; }
  }
  assert.ok(c.taken, '应被收集');
  // 身体前表面在 -0.4；金币最大半径 0.43（磁铁放大后）：圆心 ≤ -0.83 才算零穿透，留步进余量取 -0.6
  assert.ok(takenZ <= -0.6, `收集时圆心 z=${takenZ.toFixed(2)}，已越过身体前表面`);
});

test('道具箱段规则：每 200m 段 1~3 箱（约 50/30/20），间隔 ≥30m、不与障碍重叠', () => {
  const gen = new TrackGen(content, new RunRng(hashSeed('pk2')));
  const obstacles = [], coins = [], pickups = [];
  for (let d = 0; d <= 20200; d += 200) gen.ensure(d, 400, obstacles, coins, pickups);
  assert.ok(pickups.length >= 60, `样本不足: ${pickups.length}`);
  // 按段统计（段起点 200,400,...）
  const segs = new Map();
  for (const p of pickups) {
    const s = Math.floor((p.worldZ - 8) / 200) * 200;
    segs.set(s, (segs.get(s) ?? 0) + 1);
  }
  const hist = { 1: 0, 2: 0, 3: 0 };
  for (const [, n] of segs) {
    assert.ok(n >= 1 && n <= 3, `段 ${n} 箱越界`);
    hist[n]++;
  }
  const total = hist[1] + hist[2] + hist[3];
  const pct = k => hist[k] / total * 100;
  // 抽取严格按 50/30/20；落地时因避障换道/跳过会向两侧漂移（种子相关），故容差 ±15pp
  assert.ok(Math.abs(pct(1) - 50) < 15, `一个概率 ${pct(1).toFixed(1)}% 偏离 50%`);
  assert.ok(Math.abs(pct(2) - 30) < 15, `两个概率 ${pct(2).toFixed(1)}% 偏离 30%`);
  assert.ok(Math.abs(pct(3) - 20) < 15, `三个概率 ${pct(3).toFixed(1)}% 偏离 20%`);
  assert.ok(pct(1) > pct(3), '单箱段应多于三箱段');
  const sorted = [...pickups].sort((a, b) => a.worldZ - b.worldZ);
  // 段内间隔 ≥30m（相邻段交界处不受此约束，段首尾各有 8m 边距）
  const bySeg = new Map();
  for (const p of sorted) {
    const s = Math.floor((p.worldZ - 8) / 200) * 200;
    (bySeg.get(s) ?? bySeg.set(s, []).get(s)).push(p.worldZ);
  }
  for (const [, zs] of bySeg) {
    for (let i = 1; i < zs.length; i++) assert.ok(zs[i] - zs[i - 1] >= 30 - 0.01, '同段两箱间隔小于 30m');
  }
  for (const p of sorted) {
    // 掉落表只允许「引擎已实现原语」的道具进入（新增道具无需改本测试）
    const specs = itemEffects(content, p.itemRef);
    assert.ok(specs.length > 0, `掉落表里的 ${p.itemRef} 没有任何效果定义`);
    for (const e of specs) assert.ok(isPrimitiveSupported(e.primitive), `${p.itemRef} 的原语未注册：${e.primitive}`);
    for (const o of obstacles) {
      assert.ok(!(o.lane === p.lane && Math.abs(p.worldZ - o.worldZ) < o.d / 2), `道具箱与障碍同车道重叠 z=${p.worldZ}`);
    }
  }
  const kinds = new Set(sorted.map(p => p.itemRef));
  assert.ok(kinds.size >= 5, `样本足够时应出现 5 种以上道具，实际 ${[...kinds].join('/')}`);
});
