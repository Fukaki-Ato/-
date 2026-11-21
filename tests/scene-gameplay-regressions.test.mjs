import test from 'node:test';
import assert from 'node:assert/strict';
import { loadContent } from '../tools/replay/runner.mjs';
import { RunnerSim } from '../packages/game/dist/core/sim/runnerSim.js';
import { cullCrossings, insertCrossing, stepCrossings, CROSSING_DEFAULTS } from '../packages/game/dist/core/sim/crossings.js';
import { buildObstacleEntity } from '../packages/game/dist/core/sim/trackDefs.js';
import { advanceMovingObstacles } from '../packages/game/dist/core/sim/entitySweep.js';
import { TrackGen } from '../packages/game/dist/core/sim/trackGen.js';
import { RunRng } from '../packages/game/dist/core/rng.js';

function blank() {
  const content = loadContent();
  content.obstacles.patterns = [{ id: 'blank', minDifficulty: 0, lengthSegments: 4, cells: [] }];
  content.obstacles.difficultyCurve = [{ by: 0, poolWeights: { blank: 1 } }];
  content.obstacles.dropTable = { weights: {} };
  delete content.obstacles.zap;
  delete content.game.params.revive;
  return content;
}

test('默认/海滨/渔港等普通主题过 600m 不翻转，图书馆才启用反重力', () => {
  const content = blank();
  for (const themeId of [undefined, 'theme_seaside_day', 'theme_dusk_harbor', 'theme_rain_konbini', 'theme_stormspire', 'theme_forgeheart', 'theme_library']) {
    const sim = new RunnerSim(content, 42, undefined, false, [], themeId);
    sim.state.distance = 560; sim.gen.genZ = 560;
    let flipped = false;
    while (sim.state.distance < 720) {
      sim.step();
      flipped ||= sim.state.flip === -1;
    }
    assert.equal(flipped, themeId === 'theme_library', String(themeId));
    assert.equal(sim.tideAware, themeId === 'theme_forgeheart');
    assert.equal(sim.gen.zones.length > 0, themeId === 'theme_library');
    assert.equal(sim.crossings.length > 0, themeId === 'theme_stormspire');
  }
  assert.ok(content.obstacles.antigrav && content.obstacles.tideAware && content.obstacles.crossings, '单局派生不能改共享配置');
});

test('关闭穿环配置时开局也不生成隐藏的 0m 环或发放奖励', () => {
  const sim = new RunnerSim(blank(), 42);
  for (let frame = 0; frame < 10; frame++) {
    sim.step();
    assert.equal(sim.crossings.length, 0);
    assert.equal(sim.drainEvents().some(event => event.type === 'cross'), false);
    assert.equal(sim.state.score, Math.floor(sim.state.distance) * 10);
  }
});

test('穿环奖励在后续帧与首次金币快照保留；死亡帧不提前发放奖励', () => {
  const content = blank();
  const sim = new RunnerSim(content, 42);
  sim.gen.genZ = 10000;
  insertCrossing(sim.crossings, { kind: 'ring', lane: 0, worldZ: 2, yMin: 0, yMax: 3 });
  const reward = content.game.params.score.perCrossing;
  while (!sim.crossings[0].done) sim.step();
  assert.equal(sim.state.score, Math.floor(sim.state.distance) * 10 + reward);
  sim.step();
  assert.equal(sim.state.score, Math.floor(sim.state.distance) * 10 + reward);
  sim.coinsArr.push({ lane: 0, worldZ: sim.state.distance + 1, y: 0.65 });
  while (!sim.collectedCoins) sim.step();
  const record = sim.firstCoinRecord.snapshot(sim.summary());
  assert.equal(record.score, Math.floor(record.distance) * 10 + reward);

  const death = new RunnerSim(content, 42);
  death.gen.genZ = 10000; death.state.t = 20;
  insertCrossing(death.crossings, { kind: 'ring', lane: 0, worldZ: 0.3, yMin: 0, yMax: 3 });
  death.obstacles.push({ obsRef: 'wall', cls: 'full', lane: 0, worldZ: 0.3, w: 2, h: 3, d: 1 });
  death.step();
  assert.equal(death.state.alive, false);
  assert.equal(death.state.score, 0);
  assert.equal(death.drainEvents().some(event => event.type === 'cross'), false);
});

test('穿越体回收保持 worldZ 升序，后续每个环仍可穿越', () => {
  const list = [150, 250, 350, 450].map(worldZ => ({ kind: 'ring', lane: 0, worldZ, yMin: 0, yMax: 3 }));
  const events = [];
  for (const distance of [150, 250, 350, 450]) {
    assert.equal(stepCrossings(list, distance, 1, CROSSING_DEFAULTS, events), 1);
    cullCrossings(list, distance + 14.1, 14);
    assert.deepEqual(list.map(item => item.worldZ), list.map(item => item.worldZ).sort((a, b) => a - b));
  }
  assert.equal(events.length, 4);
});

test('真实冲撞列车进入反重力区外侧净空时消散，不闯入倒挂区', () => {
  const content = loadContent();
  const rusher = buildObstacleEntity(content.obstacles.defs.find(def => def.id === 'obs_rusher_long'), 0, 1760);
  const obstacles = [rusher];
  const zones = [{ startM: 1600, endM: 1690, ceilH: 4.6 }];
  for (let frame = 0; frame < 600 && !rusher.done; frame++) advanceMovingObstacles(obstacles, zones, frame / 60);
  assert.equal(rusher.done, true);
  assert.ok(rusher.worldZ >= 1690 && rusher.worldZ <= 1702);
  assert.ok(Number.isFinite(rusher.clearT));
});

test('地面道具不投放到倒挂区，普通主题与区外仍有真实掉落', () => {
  const generate = antigrav => {
    const content = blank();
    content.obstacles.dropTable = { weights: { item_helmet: 1 }, countWeights: { 1: 1, 2: 0, 3: 0 } };
    if (!antigrav) delete content.obstacles.antigrav;
    const rng = new RunRng(55);
    rng.range = (min, max) => (min + max) / 2;
    const gen = new TrackGen(content, rng), pickups = [];
    gen.genZ = 1000; gen.nextPickupSeg = 550;
    gen.ensure(1000, 1, [], [], pickups);
    return pickups.map(p => p.worldZ);
  };
  assert.deepEqual(generate(false), [650, 850]);
  assert.deepEqual(generate(true), [850], '600–690m 倒挂时无法拾取地面箱，区外850m不受影响');
});
