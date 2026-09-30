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

// ---------------- 7. 着陆走廊软清除 ----------------

test('着陆走廊软清除：障碍保留在数组（done+clearT 下沉）但不再判负，掠过身后被回收', () => {
  const sim = new RunnerSim(content, 310, 'char_volt');
  sim.state.invulnT = 1e9; // 只测清道语义，屏蔽死亡干扰
  for (let k = 0; k < 60; k++) sim.step();
  const s = sim.state;
  const marker = { obsRef: 't_marker', cls: 'full', w: 2, h: 2.6, d: 0.8, lane: s.lane, worldZ: s.distance + 60 };
  sim.obstacles.push(marker);
  grant(sim, 'fly', { durationS: 2 });
  let observedSoft = false, removed = false;
  for (let i = 0; i < 60 * 20; i++) {
    sim.step();
    if (marker.done && marker.clearT != null) observedSoft = true;
    if (!sim.obstacles.includes(marker)) { removed = true; break; }
  }
  assert.ok(observedSoft, '着陆走廊障碍应被软清除（done+clearT），而不是整批一帧消失');
  assert.ok(removed, '软清除实体应在被掠过后由 cull 回收');
  assert.ok(sim.state.alive, '软清除后走廊内不应再有可判负障碍');
});
