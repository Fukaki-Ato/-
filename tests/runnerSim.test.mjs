/**
 * M1 玩法模拟测试（docs/08 §2 快照思路：同 seed 同输入 => 逐字段一致）
 * 覆盖：确定性、无操作必死、跳跃/滑铲规则、full 墙威胁、新手保护、计分公式。
 * 碰撞类用例直接构造实体（清空随机赛道），保证断言唯一变量。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RunnerSim } from '../packages/game/dist/core/sim/runnerSim.js';
import { hashSeed } from '../packages/game/dist/core/rng.js';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const NAMES = ['game', 'characters', 'skills', 'items', 'obstacles', 'themes', 'events', 'economy'];
const content = Object.fromEntries(NAMES.map(n => [n, JSON.parse(readFileSync(join(root, 'config', `${n}.json`), 'utf8'))]));

/** 造一个「净空世界」的 sim：清掉随机生成的障碍与金币，只放测试实体 */
function cleanSim(seed) {
  const sim = new RunnerSim(content, seed);
  sim.obstacles.length = 0;
  sim.coinsArr.length = 0;
  return sim;
}
function wall(sim, cls, lane, aheadM) {
  sim.obstacles.push({ obsRef: 'test_' + cls, cls, w: 2, h: cls === 'high' ? 2.6 : cls === 'full' ? 3.2 : 1.2, d: cls === 'vehicle' ? 24 : 0.8, lane, worldZ: sim.state.distance + aheadM });
}
/** 推进到越过 aheadM 处（60fps），返回期间出现的事件类型集合 */
function runPast(sim, steps) {
  const seen = new Set();
  for (let i = 0; i < steps; i++) { sim.step(); for (const e of sim.events) seen.add(e.type); }
  return seen;
}

test('确定性：同 seed 同输入 => 结果逐字段一致（快照思想）', () => {
  const actions = [{ at: 60, type: 'jump' }, { at: 200, type: 'laneL' }, { at: 400, type: 'slide' }, { at: 900, type: 'jump' }];
  const run = seed => {
    const sim = new RunnerSim(content, seed);
    for (let i = 0; i < 3000; i++) {
      for (const a of actions.filter(x => x.at === i)) sim.applyAction(a.type);
      sim.step();
    }
    return sim.summary();
  };
  assert.deepEqual(run(777), run(777));
});

test('无操作必然出局（一条命：一次真实受击即终结）', () => {
  const sim = new RunnerSim(content, hashSeed('idle'));
  for (let i = 0; i < 60 * 100 && sim.state.alive; i++) sim.step();
  assert.equal(sim.state.alive, false);
  assert.equal(sim.state.hits, 1);
});

test('滑铲冷却：起身后 0.3 秒内不能再铲，冷却过后恢复', () => {
  const sim = cleanSim(21);
  sim.applyAction('slide'); sim.step();
  assert.ok(sim.state.sliding);
  for (let i = 0; i < 40; i++) sim.step(); // 0.66s：滑行(0.6s)已结束，冷却剩约 0.24s
  assert.ok(!sim.state.sliding);
  sim.applyAction('slide'); sim.step();
  assert.ok(!sim.state.sliding, '冷却期内不应进入滑行');
  for (let i = 0; i < 20; i++) sim.step(); // 再过 0.33s，冷却结束
  sim.applyAction('slide'); sim.step();
  assert.ok(sim.state.sliding, '冷却结束后应可再滑');
});

test('滑行中按跳：立即起身并起跳', () => {
  const sim = cleanSim(22);
  sim.applyAction('slide'); sim.step();
  assert.ok(sim.state.sliding);
  sim.applyAction('jump'); sim.step();
  assert.ok(!sim.state.sliding, '应已起身');
  assert.ok(sim.state.y > 0, '应立即进入跳跃');
});

test('跳跃可越矮障：低/危险地面在跳跃窗口内通过 => 无任何受击事件', () => {
  for (const cls of ['low', 'hazard']) {
    const sim = cleanSim(11);
    wall(sim, cls, 0, 12);
    let jumped = false;
    const seen = new Set();
    for (let i = 0; i < 120; i++) {
      if (!jumped && sim.state.distance > 12 - 2.2) { sim.applyAction('jump'); jumped = true; }
      sim.step();
      for (const e of sim.events) seen.add(e.type);
    }
    assert.ok(jumped);
    assert.ok(!seen.has('hit') && !seen.has('protected'), `${cls} 应被跳过，实际事件: ${[...seen]}`);
    assert.equal(sim.state.hits, 0);
  }
});

test('滑铲可钻高杆：滑行窗口内通过 high => 无受击事件', () => {
  const sim = cleanSim(12);
  wall(sim, 'high', 0, 10);
  let slid = false;
  const seen = new Set();
  for (let i = 0; i < 100; i++) {
    // slideS=0.6s=36帧；提前 30 帧起铲，滑行覆盖通过面
    if (!slid && sim.state.distance > 10 - 1.2 * (30 / 60) - 0.5) { sim.applyAction('slide'); slid = true; }
    sim.step();
    for (const e of sim.events) seen.add(e.type);
  }
  assert.ok(!seen.has('hit') && !seen.has('protected'), `high 应被钻过，实际事件: ${[...seen]}`);
});

test('full 墙与慢行列车无法跳/铲：只能换道，硬闯必受击', () => {
  for (const cls of ['full', 'vehicle']) {
    const sim = cleanSim(13);
    wall(sim, cls, 0, 8);
    // 第二撞要等无敌帧(1.4s≈18m)过后再放；列车长 24m 要留更远距离
    wall(sim, cls, 0, cls === 'vehicle' ? 45 : 26);
    const seen = runPast(sim, 60 * 4);
    assert.ok(seen.has('protected'), cls + ' 第一撞应触发新手保护');
    assert.ok(seen.has('hit'), cls + ' 第二撞应真实受击');
    assert.equal(sim.state.hits, 1);
    assert.equal(sim.state.alive, false, '一条命：受击一次即出局');
  }
});

test('换道可避墙：撞墙前换到空车道 => 无受击', () => {
  const sim = cleanSim(14);
  wall(sim, 'full', 0, 10);
  let moved = false;
  const seen = new Set();
  for (let i = 0; i < 90; i++) {
    if (!moved && sim.state.distance > 10 - 3) { sim.applyAction('laneR'); moved = true; } // 3m 提前量足够 0.18s 换道
    sim.step();
    for (const e of sim.events) seen.add(e.type);
  }
  assert.ok(!seen.has('hit') && !seen.has('protected'));
});

test('新手保护：开局 15 秒内首次碰撞不计受击、保护后再次硬闯计受击', () => {
  const sim = cleanSim(15);
  wall(sim, 'full', 0, 8);
  runPast(sim, 90);
  assert.equal(sim.state.hits, 0); // 第一次：保护
  sim.obstacles.length = 0;
  wall(sim, 'full', 0, 26); // 等无敌帧(1.4s)结束（wall 的 aheadM 参数本身就是「前方多少米」）
  const seen = runPast(sim, 60 * 3);
  assert.ok(seen.has('hit'));      // 第二次：正常受击
  assert.equal(sim.state.hits, 1);
});

test('一条命审计：保护撞长列车后穿出全程不被二次判负，下一障碍才致命', () => {
  const sim = cleanSim(31);
  // 24m 列车：重叠约 2s > 无敌 1.4s。旧实现会在无敌结束后补刀致死
  wall(sim, 'vehicle', 0, 8);
  const seen1 = runPast(sim, 60 * 4);
  assert.ok(seen1.has('protected'));
  assert.ok(!seen1.has('hit'), '同一列车不应在无敌结束后二次判定');
  assert.ok(sim.state.alive, '穿出列车后应存活');
  // 再来一面墙：真实受击即出局
  sim.obstacles.length = 0;
  wall(sim, 'full', 0, 30);
  const seen2 = runPast(sim, 60 * 4);
  assert.ok(seen2.has('hit'));
  assert.equal(sim.state.alive, false, '一条命：一次真实受击即终结');
});

test('一条命审计：lives 从配置读取（改成 3 即恢复三命）', () => {
  const three = JSON.parse(JSON.stringify(content));
  three.game.params.runner.lives = 3;
  const sim = new RunnerSim(three, 5);
  assert.equal(sim.lives, 3);
  // 第 1 撞会被新手保护吞掉，所以需要 4 面墙才能凑满 3 次真实受击
  for (let k = 0; k < 4 && sim.state.alive; k++) {
    sim.obstacles.length = 0;
    sim.obstacles.push({ obsRef: 't', cls: 'full', w: 2, h: 3.2, d: 0.8, lane: 0, worldZ: sim.state.distance + 30 });
    for (let i = 0; i < 60 * 4 && sim.state.alive; i++) sim.step();
  }
  assert.equal(sim.state.hits, 3);
  assert.equal(sim.state.alive, false);
});

test('计分公式：score = 距离×10 + 金币×5 + 近失×25', () => {
  const sim = new RunnerSim(content, hashSeed('score'));
  for (let i = 0; i < 1200 && sim.state.alive; i++) sim.step();
  const s = sim.summary();
  // 死亡帧不结算（core-fix #5）：分数停在死亡帧开始时的距离（prevDistance），而非死亡帧末的距离
  const scoredDistance = sim.state.alive ? sim.state.distance : sim.state.prevDistance;
  assert.equal(s.score, Math.floor(scoredDistance) * 10 + s.coins * 5 + s.nearMiss * 25);
});
