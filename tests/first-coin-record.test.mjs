import test from 'node:test';
import assert from 'node:assert/strict';
import { loadContent } from '../tools/replay/runner.mjs';
import { RunnerSim } from '../packages/game/dist/core/sim/runnerSim.js';
import { leaderboardRulesId } from '../packages/game/dist/flow/leaderboard.js';

const content = loadContent();
const grant = (sim, primitive, params) => sim.applyEffects([{ primitive, params }], 'record-test');
function cleanSim(c = content) {
  const sim = new RunnerSim(c, 7);
  sim.step(); sim.obstacles.length = 0; sim.coinsArr.length = 0; sim.pickupsArr.length = 0;
  return sim;
}
const snapshot = sim => sim.firstCoinRecord.snapshot(sim.summary());

test('first ordinary pickup freezes exact distance and pre-coin score, not the last frame score', () => {
  const c = structuredClone(content); c.game.params.score.perCoin = 1000;
  const sim = cleanSim(c);
  sim.state.distance = 12.9; sim.state.nearMiss = 2;
  grant(sim, 'scoreAdd', { flat: 500 });
  sim.coinsArr.push({ lane: 0, worldZ: 13.9 }, { lane: 0, worldZ: 13.9 });
  sim.step();
  assert.equal(sim.collectedCoins, 2);
  const record = snapshot(sim);
  assert.deepEqual(record, { distance: sim.summary().distance, score: 680, stoppedByCoin: true });
  assert.equal(sim.state.score, record.score + 2000, 'normal full-run score remains unchanged');
  grant(sim, 'scoreAdd', { flat: 900 });
  for(let i=0;i<120;i++) { sim.step(); sim.obstacles.length=0; }
  assert.ok(sim.state.distance > record.distance + 20);
  assert.deepEqual(snapshot(sim), record, 'later running, bonuses and pickups must not extend the prefix');
  record.distance = 9999; assert.notEqual(snapshot(sim).distance, 9999, 'snapshot is not a mutable reference');
});

test('magnet pickup across lanes ends the prefix at pickup time, not at the coin world position', () => {
  const sim = cleanSim();
  grant(sim, 'magnet', { durationS: 10, radiusM: 8 });
  sim.coinsArr.push({ lane: -1, worldZ: sim.state.distance + 6 });
  sim.step();
  assert.equal(sim.collectedCoins, 1);
  assert.equal(snapshot(sim).distance, sim.summary().distance);
  assert.ok(snapshot(sim).distance < 1);
  assert.equal(snapshot(sim).score, 0, 'the first coin bonus is excluded');
});

test('bulk skill collection freezes BEFORE blink advances, and counts even zero-valued coins', () => {
  const sim = cleanSim(); const before = sim.summary();
  grant(sim, 'coinValueAdd', { pct: -100, durationS: 10 });
  sim.coinsArr.push({ lane: -1, worldZ: sim.state.distance + 10 }, { lane: 1, worldZ: sim.state.distance + 25, y: 4.6 });
  grant(sim, 'blink', { distanceM: 40, phase: true, collectCoins: true });
  assert.equal(sim.state.coins, 0); assert.equal(sim.collectedCoins, 2);
  assert.deepEqual(snapshot(sim), { distance: before.distance, score: before.score, stoppedByCoin: true });
  assert.ok(sim.state.distance > before.distance + 39);
  sim.step(); assert.deepEqual(snapshot(sim), { distance: before.distance, score: before.score, stoppedByCoin: true });
});

test('never collecting coins uses the unchanged complete-run result, including death frame conventions', () => {
  const sim = cleanSim();
  sim.state.distance = 20.125; sim.state.score = 200; sim.state.alive = false;
  const final = sim.summary();
  assert.deepEqual(snapshot(sim), { distance: final.distance, score: final.score, stoppedByCoin: false });
  sim.step(); assert.deepEqual(snapshot(sim), { distance: final.distance, score: final.score, stoppedByCoin: false });
});

test('actual char_bolt skill cast freezes before bulk pickup, advance and cast reward; replay agrees', () => {
  const sim = new RunnerSim(content, 7, 'char_bolt', true);
  sim.step(); const before = sim.summary();
  assert.equal(sim.collectedCoins, 0); assert.equal(sim.canCastSkill(), true);
  sim.applyAction('skill');
  assert.equal(sim.state.casts, 1); assert.ok(sim.collectedCoins > 0);
  assert.ok(sim.state.distance >= before.distance + 99.99);
  const record = { distance: before.distance, score: before.score, stoppedByCoin: true };
  assert.deepEqual(snapshot(sim), record, 'cast reward is credited after this pickup and is not part of the prefix');
  for(let frame=0;sim.state.alive&&frame<6000;frame++) sim.step();
  assert.equal(sim.state.alive, false);
  const replay = new RunnerSim(content, 7, 'char_bolt'); let index=0;
  for(let frame=0;frame<sim.replayFrames;frame++) {
    while(sim.replayInputs[index]?.frame===frame) replay.applyAction(sim.replayInputs[index++].action);
    replay.step();
  }
  assert.deepEqual(snapshot(replay), record); assert.deepEqual(replay.summary(), sim.summary());
});

test('recorded input replay reproduces the exact first-coin checkpoint with later coins and death', () => {
  const sim = new RunnerSim(content, 101, 'char_volt', true);
  for(let frame=0;sim.state.alive&&frame<5000;frame++) {
    if(frame===100) sim.applyAction('skill');
    sim.step();
  }
  assert.equal(sim.state.alive,false); assert.ok(sim.collectedCoins>0);
  const replay = new RunnerSim(content,101,'char_volt');let index=0;
  for(let frame=0;frame<sim.replayFrames;frame++) {
    while(sim.replayInputs[index]?.frame===frame) replay.applyAction(sim.replayInputs[index++].action);
    replay.step();
  }
  assert.deepEqual(snapshot(replay),snapshot(sim));
  assert.deepEqual(replay.summary(),sim.summary());
  assert.ok(snapshot(sim).distance < sim.summary().distance);
});

test('new metric gets a different rules identity even with unchanged gameplay configuration', () => {
  const rules = leaderboardRulesId(content);
  assert.match(rules,/^first-coin-v2-/);
  assert.notEqual(rules,'coinless-v1-'+rules.split('-').at(-1));
});
