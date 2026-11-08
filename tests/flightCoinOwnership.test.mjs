import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { RunnerSim } from '../packages/game/dist/core/sim/runnerSim.js';
import { TrackGen } from '../packages/game/dist/core/sim/trackGen.js';
import { RunRng } from '../packages/game/dist/core/rng.js';
import { layTeachingLines } from '../packages/game/dist/core/sim/trackCoins.js';
import { clearSkyCoins } from '../packages/game/dist/core/sim/landing.js';

const content = Object.fromEntries(['game', 'characters', 'skills', 'items', 'obstacles', 'themes', 'events', 'economy']
  .map(name => [name, JSON.parse(readFileSync(new URL(`../config/${name}.json`, import.meta.url), 'utf8'))]));

test('着陆只回收飞行来源的币，不按高度误删车顶或技能奖励币', () => {
  const gen = new TrackGen(content, new RunRng(42));
  const ground = { lane: 0, worldZ: 30 };
  const roof = { lane: 0, worldZ: 40, y: 3.05 };
  const reward = { lane: 1, worldZ: 50, y: 4.6 };
  const coins = [ground, roof, reward];
  gen.spawnSky(0, 100, 1.5, coins, []); // 即使飞行高度较低，也必须清理来源属于飞行的币。
  assert.ok(coins.length > 3);
  clearSkyCoins(coins);
  assert.deepEqual(new Set(coins), new Set([ground, roof, reward]));
  clearSkyCoins(coins);
  assert.equal(coins.length, 3, '重复落地清理应幂等');
});

test('真实飞行结束落在车顶后，前方车顶教学币保留且可继续拾取', () => {
  const solo = structuredClone(content);
  delete solo.game.params.revive;
  delete solo.obstacles.zap;
  const sim = new RunnerSim(solo, 42, 'char_volt');
  sim.state.t = 20;
  sim.state.distance = 2400;
  sim.gen.genZ = 10000;
  sim.buffs.add('fly', { durationS: 3 }, 'test_flight', { distance: 2400, lane: 0 });
  for (let i = 0; i < 60; i++) sim.step();
  sim.buffs.remove('fly');
  const start = sim.state.distance;
  sim.obstacles.push({ obsRef: 'roof_test', cls: 'vehicle', lane: 0, worldZ: start + 60,
    w: 2, h: 2.4, d: 120, rideTop: true });
  layTeachingLines({ cells: [{ lane: 0, segment: 0, offsetM: 60, surface: 'trainTop', coins: 6 }],
    genZ: start, segLen: 24, coinSpacing: 1.5, chainBuckets: solo.game.params.coins.chainBuckets,
    obstacles: sim.obstacles, coins: sim.coinsArr, maxSpanM: 20, seq: () => 9000 });
  const roofCoins = sim.coinsArr.filter(c => c.chain === 9000);
  assert.equal(roofCoins.length, 6);
  assert.ok(sim.coinsArr.some(c => c.y === solo.game.params.flight.heightM), '飞行币确实存在');
  let landed = false;
  for (let i = 0; i < 180; i++) {
    const wasGliding = sim.state.gliding;
    sim.step();
    if (wasGliding && !sim.state.gliding) { landed = true; break; }
  }
  assert.ok(landed && sim.state.alive);
  assert.equal(sim.state.y, 2.4);
  assert.equal(sim.coinsArr.filter(c => c.flight === true).length, 0);
  assert.ok(roofCoins.every(c => sim.coinsArr.includes(c)), '落到车顶不删除前方教学币');
  for (let i = 0; i < 500 && sim.state.distance < start + 75; i++) sim.step();
  assert.ok(sim.state.alive);
  assert.ok(roofCoins.every(c => c.taken), '落车顶后继续收齐教学币');
});
