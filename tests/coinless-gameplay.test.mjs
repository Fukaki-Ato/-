import test from 'node:test';
import assert from 'node:assert/strict';
import { loadContent } from '../tools/replay/runner.mjs';
import { RunnerSim } from '../packages/game/dist/core/sim/runnerSim.js';
import { coinJumpSpan } from '../packages/game/dist/core/sim/coinJumpSpan.js';
import { MAX_RANKED_INPUTS, leaderboardRulesId } from '../packages/game/dist/flow/leaderboard.js';

const content = loadContent();

test('最长同步金币排可在正常跳跃的净空窗口内一跳避开（基础/中速/极速）', () => {
  for (const speed of [12, 19, 26]) {
    const c = structuredClone(content);
    Object.assign(c.game.params.runner, { baseSpeed: speed, maxSpeed: speed, speedRampPer100M: 0 });
    const p = c.game.params.coins;
    const span = coinJumpSpan(c.game.params.runner, speed, p.jumpSpanRatio);
    const count = Math.floor(span / p.spacingM) + 1;
    // Try the actual pickup detector for every possible frame-phase jump timing.
    let avoided = false;
    for (let lead = 1; lead < 30; lead++) {
      const sim = new RunnerSim(c, 5);
      sim.step(); sim.obstacles.length = 0; sim.coinsArr.length = 0;
      for (const lane of [-1, 0, 1]) for (let i = 0; i < count; i++) {
        sim.coinsArr.push({ lane, worldZ: sim.state.distance + c.game.params.runner.coinCollectM + lead * speed / 60 + i * p.spacingM });
      }
      sim.applyAction('jump');
      for (let f = 0; f < 60; f++) { sim.step(); sim.obstacles.length = 0; }
      if (sim.collectedCoins === 0) { avoided = true; break; }
    }
    assert.ok(avoided, `speed ${speed}, span ${span}, coins ${count}`);
    assert.ok(span < speed * (2 * c.game.params.runner.jumpVelocity / -c.game.params.runner.gravity));
  }
});

test('零金币依据实际拾取枚数，不依据货币倍率或分数', () => {
  const sim = new RunnerSim(content, 7);
  sim.step(); sim.obstacles.length = 0; sim.coinsArr.length = 0;
  sim.applyEffects([{ primitive: 'coinValueAdd', params: { pct: -100, durationS: 10 } }], 'test');
  sim.coinsArr.push({ lane: 0, worldZ: sim.state.distance + 1 });
  sim.step();
  assert.equal(sim.state.coins, 0);
  assert.equal(sim.collectedCoins, 1);
});

test('操作按活跃步号录制；重放完全相同，死亡动画不增加帧数', () => {
  const sim = new RunnerSim(content, 101, 'char_volt', true);
  sim.applyAction('laneL'); sim.applyAction('jump');
  for (let frame = 0; sim.state.alive && frame < 5000; frame++) {
    if (frame === 100) sim.applyAction('laneR');
    sim.step();
  }
  assert.equal(sim.state.alive, false);
  const frames = sim.replayFrames;
  sim.step(); sim.applyAction('jump');
  assert.equal(sim.replayFrames, frames);
  const replay = new RunnerSim(content, 101, 'char_volt');
  let idx = 0;
  for (let frame = 0; frame < frames; frame++) {
    while (sim.replayInputs[idx]?.frame === frame) replay.applyAction(sim.replayInputs[idx++].action);
    replay.step();
  }
  assert.deepEqual(replay.summary(), sim.summary());
  assert.equal(replay.collectedCoins, sim.collectedCoins);
});

test('输入录制有界且默认不开；规则签名对配置变化敏感', () => {
  const sim = new RunnerSim(content, 1, 'char_volt', true);
  for (let i = 0; i <= MAX_RANKED_INPUTS; i++) sim.applyAction('jump');
  assert.equal(sim.replayInputs.length, MAX_RANKED_INPUTS);
  assert.equal(sim.replayOverflow, true);
  const normal = new RunnerSim(content, 1); normal.applyAction('jump');
  assert.equal(normal.replayInputs.length, 0);
  const c = structuredClone(content); c.game.params.coins.jumpSpanRatio = 0.8;
  assert.notEqual(leaderboardRulesId(c), leaderboardRulesId(content));
});
