import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { RunnerSim } from '../packages/game/dist/core/sim/runnerSim.js';
import { TrackGen } from '../packages/game/dist/core/sim/trackGen.js';
import { hitsRunner, laserOn } from '../packages/game/dist/core/sim/collision.js';
import { initialRunnerState } from '../packages/game/dist/core/sim/simTypes.js';
import { layRainCoins, parseRainCfg } from '../packages/game/dist/core/sim/warps.js';
import { contentForRunTheme } from '../packages/game/dist/core/sim/themeRules.js';
import { buildObstacleEntity } from '../packages/game/dist/core/sim/trackDefs.js';
import { RunRng } from '../packages/game/dist/core/rng.js';

const names = ['game', 'characters', 'skills', 'items', 'obstacles', 'themes', 'events', 'economy'];
const raw = Object.fromEntries(names.map(n => [n, JSON.parse(readFileSync(new URL(`../config/${n}.json`, import.meta.url), 'utf8'))]));

function blank() {
  const c = structuredClone(raw);
  c.obstacles.patterns = [{ id: 'blank', minDifficulty: 0, weight: 1, lengthSegments: 4, cells: [] }];
  c.obstacles.difficultyCurve = [{ by: 0, poolWeights: { blank: 1 } }];
  c.obstacles.dropTable = { weights: {} };
  for (const key of ['zap', 'warp', 'coinRain', 'lowGrav', 'crossings']) delete c.obstacles[key];
  delete c.game.params.revive;
  return c;
}

test('真实激光模板保留 cell phase，4.8m 光束亮时三道站立判中、跳越 h 可过、灭时无伤，倒挂同 yEff', () => {
  const c = blank();
  const pattern = raw.obstacles.patterns.find(p => p.id === 'pat_laser_gate');
  const gen = new TrackGen(c, new RunRng(108)), obstacles = [];
  gen.pickPattern = () => pattern;
  gen.ensure(0, 61, obstacles, []);
  assert.equal(obstacles.length, 2);
  assert.deepEqual(obstacles.map(o => o.laserCfg.phase), [0, 1]);
  assert.notEqual(laserOn(obstacles[0].laserCfg, 1.5), laserOn(obstacles[1].laserCfg, 1.5));
  for (const beam of obstacles) for (const lane of [-1, 0, 1]) {
    assert.equal(beam.w, 4.8);
    const s = { ...initialRunnerState(), x: lane * 2.2, t: 0 };
    assert.equal(hitsRunner(beam, s, 2.2), true, `lane=${lane} phase=${beam.laserCfg.phase}`);
    assert.equal(hitsRunner(beam, { ...s, sliding: true }, 2.2), true, '低光束滑铲仍碰到');
    assert.equal(hitsRunner(beam, { ...s, y: beam.h - 0.001 }, 2.2), true);
    assert.equal(hitsRunner(beam, { ...s, y: beam.h }, 2.2), false, '脚高过可见光束即可通过');
    assert.equal(hitsRunner(beam, { ...s, t: 2.5 }, 2.2), false, '两束均已灭灯');
    const flip = { flip: -1, ceilH: 4.6 };
    assert.equal(hitsRunner(beam, { ...s, y: 4.6 }, 2.2, undefined, flip), true);
    assert.equal(hitsRunner(beam, { ...s, y: 4.6 - beam.h - 0.01 }, 2.2, undefined, flip), false);
  }
});

test('RunnerSim 实际普通跳跃可越过整束亮激光；站立亮灯致死、灭灯无伤', () => {
  const generated = [];
  const gen = new TrackGen(blank(), new RunRng(108));
  gen.pickPattern = () => raw.obstacles.patterns.find(p => p.id === 'pat_laser_gate');
  gen.ensure(0, 61, generated, []);
  const run = (jump, on) => {
    const sim = new RunnerSim(blank(), 108);
    const beam = structuredClone(generated[0]);
    sim.gen.genZ = 10000;
    Object.assign(sim.state, { distance: beam.worldZ - 8, t: on ? 20 : 22 });
    sim.obstacles.push(beam);
    let jumped = false;
    while (sim.state.alive && sim.state.distance < beam.worldZ + 3) {
      if (jump && !jumped && beam.worldZ - sim.state.distance <= 4) { sim.applyAction('jump'); jumped = true; }
      sim.step();
    }
    return sim;
  };
  assert.equal(run(false, true).state.alive, false);
  const jumped = run(true, true);
  assert.equal(jumped.state.alive, true);
  assert.equal(jumped.state.hits, 0);
  assert.equal(jumped.missionStats.jumps, 1);
  assert.equal(run(false, false).state.hits, 0);
});

test('真实配置增量生成：上下游预注册覆盖候选末端和余量，warp↔zone、low↔warp、rain↔zone 从不重叠', () => {
  const gen = new TrackGen(structuredClone(raw), new RunRng(108));
  const obstacles = [], coins = [], pickups = [], crossings = [];
  const disjoint = (a, b, pad, tag) => {
    for (const x of a) for (const y of b) {
      assert.ok(x.endM <= y.startM - pad || x.startM >= y.endM + pad,
        `${tag}: [${x.startM},${x.endM}) / [${y.startM},${y.endM}) pad=${pad}`);
    }
  };
  for (let distance = 0; distance <= 10000; distance += 20) {
    gen.ensure(distance, 320, obstacles, coins, pickups, crossings);
    disjoint(gen.warps, gen.zones, 36, 'warp↔zone');
    disjoint(gen.lows, gen.warps, 36, 'low↔warp');
    disjoint(gen.lows, gen.zones, 36, 'low↔zone');
    disjoint(gen.rains, gen.zones, 12, 'rain↔zone');
  }
  for (const table of [gen.warps, gen.lows, gen.rains]) assert.ok(table.length > 2, '真实事件需有足够样本');
  assert.equal(gen.warps.some(w => w.startM === 2500), false, '2500–2620 候选不能穿进晚登记的 2600–2690 zone');
  assert.equal(gen.lows.some(l => l.startM === 1740), false, '1740–1810 候选不能穿进晚登记的 1800–1920 warp');
  const bulk = new TrackGen(structuredClone(raw), new RunRng(108));
  bulk.ensure(10000, 320, [], []);
  for (const key of ['zones', 'warps', 'lows', 'rains']) assert.deepEqual(gen[key], bulk[key], `${key} 不依赖 ensure 分批大小`);
});

test('金币雨真实 24 枚均可经普通跳跃与收集链路入账，最高币站立不能吃', () => {
  const cfg = parseRainCfg(raw.obstacles), coins = [];
  layRainCoins(coins, { startM: cfg.fromM, endM: cfg.fromM + cfg.spanM, cfg }, 2.2, new RunRng(99));
  assert.equal(coins.length, 24);
  const collect = (coin, jump) => {
    const sim = new RunnerSim(blank(), 99);
    sim.gen.genZ = 10000;
    Object.assign(sim.state, { distance: coin.worldZ - 5, t: 20, lane: Math.round(coin.lane), x: Math.round(coin.lane) * 2.2 });
    sim.coinsArr.push(structuredClone(coin));
    sim.buffs.add('magnet', { durationS: 3, radiusM: 12 }, 'test', { distance: sim.state.distance, lane: sim.state.lane });
    if (jump) sim.applyAction('jump');
    while (sim.state.distance < coin.worldZ + 2) sim.step();
    return sim.collectedCoins;
  };
  for (const coin of coins) {
    assert.ok(coin.y >= 0.5);
    assert.equal(collect(coin, coin.y > 2.2), 1, `高度 ${coin.y} 的金币实际入账`);
  }
  const highest = coins.reduce((a, b) => a.y > b.y ? a : b);
  assert.ok(highest.y > 2.2);
  assert.equal(collect(highest, false), 0, '保持必须跳跃的高币奖励');
});

test('每局主题门控保留主线语义：三事件只在雷脊、ring/rib 分别在雷脊/泰坦，派生不改原内容', () => {
  for (const theme of raw.themes.items) {
    const ob = contentForRunTheme(raw, theme.id).obstacles;
    for (const key of ['warp', 'coinRain', 'lowGrav']) assert.equal(!!ob[key], theme.scenery === 'stormspire', `${theme.id} ${key}`);
    assert.equal(!!ob.antigrav, theme.scenery === 'library');
    assert.equal(!!ob.tideAware, theme.scenery === 'forgeheart');
    assert.equal(!!ob.crossings?.ring, theme.scenery === 'stormspire');
    assert.equal(!!ob.crossings?.rib, theme.scenery === 'titan');
  }
  assert.ok(raw.obstacles.warp && raw.obstacles.antigrav && raw.obstacles.crossings.rib);
});

test('真实弹跳垫/发射斜坡各触发一次弹射，追击者受击拉近后继续奔跑拉远', () => {
  for (const id of ['obs_bounce_pad', 'obs_launch_ramp']) {
    const def = raw.obstacles.defs.find(o => o.id === id);
    assert.ok(def, id);
    const sim = new RunnerSim(blank(), 55);
    sim.gen.genZ = 10000;
    const obstacle = buildObstacleEntity(def, 0, 20);
    sim.obstacles.push(obstacle);
    const bounces = [];
    let apex = 0;
    while (sim.state.distance < 50) {
      sim.step();
      bounces.push(...sim.drainEvents().filter(e => e.type === 'bounce'));
      apex = Math.max(apex, sim.state.y);
    }
    assert.equal(bounces.length, 1, id);
    assert.equal(bounces[0].vy, def.bounceVY ?? def.launchVY);
    assert.ok(apex > 3, `${id} 应实际弹起，apex=${apex}`);
    assert.equal(sim.missionStats.jumps, 0, '自动弹射不计手动跳跃成就');
  }
  const sim = new RunnerSim(blank(), 55);
  sim.gen.genZ = 10000;
  sim.state.hits = 1;
  sim.step();
  assert.equal(sim.state.chaserDist, 42);
  sim.step();
  assert.ok(sim.state.chaserDist > 42);
});

test('三事件实际跑局按输入重放逐帧一致，保留增强/跳跃/分道具统计及首次金币记录', () => {
  const c = blank();
  for (const key of ['warp', 'coinRain', 'lowGrav']) c.obstacles[key] = structuredClone(raw.obstacles[key]);
  c.obstacles.lowGrav.fromM = 100; // 首个低重力窗置于隧道前，让此短回放覆盖三种事件。
  c.obstacles.dropTable = { weights: { item_magnet: 1 } };
  const enhance = { skillScale: 1.05, itemBonusS: () => 2 };
  const create = record => new RunnerSim(c, 55, 'char_volt', record, ['item_magnet'], 'theme_stormspire', enhance);
  const sim = create(true), frames = [], seen = new Set();
  for (let frame = 0; frame < 6000; frame++) {
    if (frame % 80 === 0) sim.applyAction('jump');
    if (frame % 137 === 0) sim.applyAction('slide');
    if (frame % 400 === 0) sim.applyAction(frame % 800 === 0 ? 'laneR' : 'laneL');
    if (frame % 1000 === 0) sim.applyAction('skill');
    sim.step();
    const events = sim.drainEvents();
    for (const event of events) seen.add(event.type);
    frames.push({ state: { ...sim.state }, events });
  }
  const replay = create(false);
  let index = 0;
  for (let frame = 0; frame < frames.length; frame++) {
    while (sim.replayInputs[index]?.frame === frame) replay.applyAction(sim.replayInputs[index++].action);
    replay.step();
    assert.deepEqual({ state: { ...replay.state }, events: replay.drainEvents() }, frames[frame], `frame=${frame}`);
  }
  for (const type of ['warp', 'coinRain', 'pickup', 'cast']) assert.ok(seen.has(type), type);
  assert.ok(frames.some(frame => frame.state.lowGravRemain > 0), '重放覆盖真实低重力区');
  assert.ok(sim.missionStats.jumps > 0 && sim.missionStats.itemOf.item_magnet > 0);
  assert.deepEqual(replay.missionStats, sim.missionStats);
  assert.deepEqual(replay.firstCoinRecord.snapshot(replay.summary()), sim.firstCoinRecord.snapshot(sim.summary()));
});
