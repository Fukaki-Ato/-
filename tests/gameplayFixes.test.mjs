/**
 * 玩法修复批次回归（用户反馈）——飞行/落地组：
 * 6. 空中金币不再铺满三道（按 laneGroupWeights 抽 1/2/3 道）
 * 7. 落地走廊软清除：障碍保留在数组（done+clearT 下沉动画）但不再判负，掠过身后被回收
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RunnerSim } from '../packages/game/dist/core/sim/runnerSim.js';
import { TrackGen } from '../packages/game/dist/core/sim/trackGen.js';
import { RunRng } from '../packages/game/dist/core/rng.js';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const NAMES = ['game', 'characters', 'skills', 'items', 'obstacles', 'themes', 'events', 'economy'];
const content = Object.fromEntries(NAMES.map(n => [n, JSON.parse(readFileSync(join(root, 'config', `${n}.json`), 'utf8'))]));

function grant(sim, primitive, params) {
  sim.buffs.add(primitive, params, primitive, { distance: sim.state.distance, lane: sim.state.lane });
}

// ---------------- 6. 空中金币车道分布 ----------------

test('空中金币：按 laneGroupWeights 抽 1/2/3 道（单道为主），不再条条铺满三条路', () => {
  const gen = new TrackGen(content, new RunRng(555));
  const coins = [], clouds = [];
  gen.spawnSky(0, 900, 4.6, coins, clouds);
  assert.ok(coins.length > 100, `样本不足: ${coins.length}`);
  assert.ok(coins.every(c => c.y === 4.6), '空中金币应悬浮在飞行高度');
  assert.ok(clouds.length > 10, `云团样本不足: ${clouds.length}`);
  const byChain = new Map();
  for (const c of coins) {
    let e = byChain.get(c.chain);
    if (!e) { e = { start: c.worldZ, lanes: new Set() }; byChain.set(c.chain, e); }
    e.lanes.add(c.lane);
    e.start = Math.min(e.start, c.worldZ);
  }
  const pct = n => {
    const chains = [...byChain.values()];
    return chains.filter(ch => ch.lanes.size === n).length / chains.length * 100;
  };
  assert.ok(byChain.size > 10, `链样本不足: ${byChain.size}`);
  assert.ok(pct(1) > 50, `单道链应占多数（70% 权重），实际 ${pct(1).toFixed(0)}%`);
  assert.ok(pct(1) > pct(2) && pct(2) >= pct(3), `应满足单道>双道>=三道，实际 ${pct(1).toFixed(0)}/${pct(2).toFixed(0)}/${pct(3).toFixed(0)}`);
});

// ---------------- 7. 滑翔期不清障 + 落地只清一小段 ----------------

test('滑翔期不清障：远处障碍全程保留（不再「近处消失远处不动」），落地后超出落地带的障碍仍保留', () => {
  const sim = new RunnerSim(content, 310, 'char_volt');
  for (let k = 0; k < 60; k++) sim.step();
  const s = sim.state;
  const marker = { obsRef: 't_marker', cls: 'full', w: 2, h: 2.6, d: 0.8, lane: s.lane, worldZ: s.distance + 200 };
  sim.obstacles.push(marker);
  grant(sim, 'fly', { durationS: 2 });
  let glided = false, clearedDuringGlide = false, landed = -1;
  for (let i = 0; i < 60 * 20; i++) {
    const wasGliding = s.gliding;
    sim.step();
    if (s.gliding) {
      glided = true;
      if (marker.clearT != null) clearedDuringGlide = true; // 滑翔期任何软清除都算违反「不清障」
    }
    if (wasGliding && !s.gliding && s.y === 0) { landed = s.distance; break; }
  }
  assert.ok(glided && landed > 0, '应完成滑翔落地');
  assert.ok(!clearedDuringGlide, '滑翔期不得清除任何障碍（用户要求：滑翔完全不清障）');
  assert.ok(marker.done !== true, '落地带（±8~14m）之外的障碍应原样保留，不被清除');
  assert.ok(sim.state.alive, '滑翔末段免伤 + 落地缓冲下不应判死');
});

test('落地帧只清落脚点一小段：带内障碍软清除（done+clearT 渐隐），带外不动', () => {
  const sim = new RunnerSim(content, 311, 'char_volt');
  for (let k = 0; k < 60; k++) sim.step();
  const s = sim.state;
  grant(sim, 'fly', { durationS: 2 });
  const inBand = { obsRef: 't_band', cls: 'full', w: 2, h: 2.6, d: 0.8, lane: s.lane, worldZ: 0 };
  let pushed = false, landed = -1;
  for (let i = 0; i < 60 * 20; i++) {
    const wasGliding = s.gliding;
    // 滑翔末段（高度已低于判定线、免伤生效）把障碍放到落脚点前 3m：验证它一路不被清、直到落地帧才被软清除
    if (!pushed && s.gliding && s.y < 1.5 && s.y > 0.2) { inBand.worldZ = s.distance + 3; sim.obstacles.push(inBand); pushed = true; }
    sim.step();
    if (inBand.clearT != null && s.gliding) throw new Error('滑翔期不应软清除带内障碍');
    if (wasGliding && !s.gliding && s.y === 0) { landed = s.distance; break; }
  }
  assert.ok(pushed && landed > 0, '应完成滑翔落地');
  assert.ok(inBand.done === true && inBand.clearT != null, '落地帧应把落脚点前后的障碍软清除（渐隐，不是整批摘除）');
  assert.ok(sim.state.alive, '落地带内障碍被软清除后不应判死');
});
