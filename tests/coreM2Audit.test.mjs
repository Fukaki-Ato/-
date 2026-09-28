/**
 * M2 core 审计回归测试（任务 core-fix）：
 * 1. 摆锤 swing 字段归一化 + 横向判定防呆
 * 2. nearMiss 首次进深度窗口判定（命中不计数）
 * 3. 飞行落地不重复生成（30 seed 不变量）
 * 4. pickupAll 真空吸取方向
 * 5. 死亡帧不结算拾取/计分
 * 6. 飞行/滑翔期输入缓冲不残留
 * 7. 模板封堵语义（只算不可通过类）与不连续同模板
 * 8. rng 空池防御
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RunnerSim } from '../packages/game/dist/core/sim/runnerSim.js';
import { TrackGen } from '../packages/game/dist/core/sim/trackGen.js';
import { RunRng } from '../packages/game/dist/core/rng.js';
import { hitsRunner, lateralGap, obstacleX, relZ } from '../packages/game/dist/core/sim/collision.js';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const NAMES = ['game', 'characters', 'skills', 'items', 'obstacles', 'themes', 'events', 'economy'];
const content = Object.fromEntries(NAMES.map(n => [n, JSON.parse(readFileSync(join(root, 'config', `${n}.json`), 'utf8'))]));

function cleanSim(seed) {
  const sim = new RunnerSim(content, seed);
  sim.obstacles.length = 0;
  sim.coinsArr.length = 0;
  sim.pickupsArr.length = 0;
  sim.cloudsArr.length = 0;
  return sim;
}
/** buff 走公开入口施加（与 items2/effects 测试同风格） */
function grant(sim, primitive, params) {
  sim.buffs.add(primitive, params, primitive, { distance: sim.state.distance, lane: sim.state.lane });
}

/** 同车道 |ΔworldZ|<3 且深度区间相交的障碍对（返回可读描述） */
function duplicatePairs(obstacles) {
  const byLane = new Map();
  for (const o of obstacles) {
    if (!byLane.has(o.lane)) byLane.set(o.lane, []);
    byLane.get(o.lane).push(o);
  }
  const out = [];
  for (const [lane, list] of byLane) {
    list.sort((a, b) => a.worldZ - b.worldZ);
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const dz = list[j].worldZ - list[i].worldZ;
        if (dz >= 3) break;
        const a = list[i], b = list[j];
        const overlap = Math.min(a.worldZ + a.d / 2, b.worldZ + b.d / 2) - Math.max(a.worldZ - a.d / 2, b.worldZ - b.d / 2);
        if (overlap > 0) out.push(`lane=${lane} ${a.obsRef}@${a.worldZ.toFixed(1)}/${b.obsRef}@${b.worldZ.toFixed(1)} dz=${dz.toFixed(2)}`);
      }
    }
  }
  return out;
}

// ---------------- 1. 摆锤 ----------------

test('摆锤：swing 归一化为 {ampM,periodS}；跨车道任何时刻不判中，同车道按周期命中/不命中交替', () => {
  const gen = new TrackGen(content, new RunRng(2026));
  const obstacles = [], coins = [];
  for (let d = 0; d <= 4200; d += 200) gen.ensure(d, 400, obstacles, coins);
  const swings = obstacles.filter(o => o.swing);
  assert.ok(swings.length > 0, `2100m 后应生成摆锤，实际 ${swings.length}`);
  for (const o of swings) {
    assert.equal(o.swing.ampM, 4.4, `${o.obsRef} 应把配置 amplitudeM 归一化为 ampM`);
    assert.ok(Number.isFinite(o.swing.ampM) && Number.isFinite(o.swing.periodS) && o.swing.periodS > 0, 'swing 字段应为有限正数');
    for (const t of [0, 0.37, 1.3, 2.9]) assert.ok(Number.isFinite(obstacleX(o, t, 2.2)), 'obstacleX 不得为 NaN');
  }

  const side = swings.find(o => o.lane === 1);
  assert.ok(side, '应有 lane=1 摆锤（pat_hazard_weave）');
  const runner = { x: -2.2, y: 0, sliding: false, t: 0 };
  for (let i = 0; i < 240; i++) {
    runner.t = i / 60;
    assert.equal(hitsRunner(side, runner, 2.2), false, `lane=-1 玩家在 t=${runner.t.toFixed(2)} 不应被 lane=1 摆锤判中`);
  }

  // 同车道：摆幅 ±2.2m 会周期性地扫过玩家，命中/让过必须都出现
  const same = { ...side, lane: 0 };
  runner.x = 0;
  let hit = 0, free = 0;
  const frames = Math.ceil(side.swing.periodS * 60) + 2;
  for (let i = 0; i < frames; i++) {
    runner.t = i / 60;
    if (hitsRunner(same, runner, 2.2)) hit++; else free++;
  }
  assert.ok(hit > 0 && free > 0, `同车道应按周期交替：hit=${hit} free=${free}`);

  // 脏 swing 数据不得产出 NaN：非法 swing 按车道中心处理（间隙=4.4-1.0），无法计算的间隙按未接触处理
  const bad = { obsRef: 'bad', cls: 'moving', w: 1.2, h: 1.2, d: 1.2, lane: 1, worldZ: 0, swing: { ampM: Number.NaN, periodS: 0 } };
  assert.equal(obstacleX(bad, 1, 2.2), 2.2);
  assert.ok(Math.abs(lateralGap(bad, { x: -2.2, y: 0, sliding: false, t: 1 }, 2.2) - 3.4) < 1e-9);
  assert.equal(lateralGap({ ...bad, w: Number.NaN }, { x: -2.2, y: 0, sliding: false, t: 1 }, 2.2), Number.POSITIVE_INFINITY);
});

// ---------------- 2. nearMiss ----------------

test('惊险擦身：相邻车道掠过计 nearMiss≈+25 分；同车道命中不计', () => {
  const miss = cleanSim(101);
  miss.state.t = 20; // 越过新手保护
  miss.obstacles.push({ obsRef: 't_low', cls: 'low', w: 2.8, h: 1.2, d: 0.8, lane: 1, worldZ: miss.state.distance + 20 });
  let nmEvents = 0;
  for (let i = 0; i < 60 * 3; i++) {
    miss.step();
    for (const e of miss.drainEvents()) if (e.type === 'nearMiss') nmEvents++;
  }
  assert.equal(miss.state.alive, true);
  assert.equal(miss.state.nearMiss, 1, '相邻车道一次擦身应恰计 1 次');
  assert.equal(nmEvents, 1, '应发出 1 个 nearMiss 事件');
  assert.equal(
    miss.state.score,
    Math.floor(miss.state.distance) * 10 + miss.state.coins * 5 + miss.state.nearMiss * 25,
    '分数应包含 25×nearMiss',
  );

  const hit = cleanSim(102);
  hit.state.t = 20;
  hit.obstacles.push({ obsRef: 't_low2', cls: 'low', w: 2.0, h: 1.2, d: 0.8, lane: 0, worldZ: hit.state.distance + 10 });
  for (let i = 0; i < 120 && hit.state.alive; i++) hit.step();
  assert.equal(hit.state.alive, false, '同车道直接命中应致死');
  assert.equal(hit.state.hits, 1);
  assert.equal(hit.state.nearMiss, 0, '命中不应计擦身分');
});

// ---------------- 3. 飞行落地不重复 ----------------

test('飞行落地不变量（30 seed）：同车道近距障碍零重复，落地前方 320m 有正常障碍', () => {
  let landedCount = 0;
  for (let i = 0; i < 30; i++) {
    const seed = 90001 + i * 7919;
    const sim = new RunnerSim(content, seed);
    sim.state.invulnT = 1e9; // 只测生成不变量：屏蔽死亡
    for (let k = 0; k < 600; k++) sim.step();
    // 用真实道具箱触发飞行；但只允许一次 fly 生效——落地帧若恰好又拾到飞行道具，
    // 第二次 startFlight 会清空刚落地区间，干扰「落地后生成恢复」的测量。
    sim.pickupsArr.push({ itemRef: 'item_jetpack', lane: 0, worldZ: sim.state.distance + 8 });
    const addFly = sim.buffs.add.bind(sim.buffs);
    let flyGrants = 0;
    sim.buffs.add = (primitive, params, label, ctx, rule) => {
      if (primitive === 'fly' && flyGrants++ >= 1) return;
      addFly(primitive, params, label, ctx, rule);
    };
    let landedAt = -1, sawFly = false, wasGliding = false;
    for (let k = 0; k < 60 * 30; k++) {
      wasGliding = sim.state.gliding;
      sim.step();
      if (sim.fx.flyT > 0) sawFly = true;
      // 滑翔段结束的那一帧即落地帧（该帧已执行落地净空清理）
      if (sawFly && wasGliding && !sim.state.gliding && sim.state.y === 0) {
        landedAt = sim.state.distance;
        break;
      }
    }
    assert.ok(sawFly, `seed=${seed} 飞行道具未生效`);
    assert.ok(landedAt > 0, `seed=${seed} 未观测到落地`);
    landedCount++;
    const dup = duplicatePairs(sim.obstacles);
    assert.deepEqual(dup, [], `seed=${seed} 出现同车道近距重复障碍：${dup.join(' ; ')}`);
    const ahead = sim.obstacles.filter(o => o.worldZ > landedAt && o.worldZ <= landedAt + 320).length;
    assert.ok(ahead >= 2, `seed=${seed} 落地前方 320m 障碍数=${ahead}，恢复过慢`);
  }
  assert.equal(landedCount, 30);
});

// ---------------- 4. 真空方向 ----------------

test('真空吸取方向：身前 40m 道具箱被吸，身后 10m 不被吸', () => {
  const sim = cleanSim(103);
  const front = { itemRef: 'item_magnet', lane: 1, worldZ: sim.state.distance + 40 };
  const back = { itemRef: 'item_boots', lane: 1, worldZ: sim.state.distance - 10 };
  sim.pickupsArr.push(front, back);
  grant(sim, 'pickupAll', { durationS: 4 });
  sim.step();
  assert.ok(front.taken, '身前 40m 的道具箱应被真空吸取');
  assert.ok(!back.taken, '身后 10m 的道具箱不应被真空吸取');
  assert.ok(sim.drainEvents().some(e => e.type === 'pickup' && e.itemRef === 'item_magnet'), '应发出拾取事件');
});

// ---------------- 5. 死亡帧不结算 ----------------

test('死亡帧不结算拾取与计分：同帧致命障碍 + 金币不入账、分数不涨', () => {
  const sim = cleanSim(104);
  sim.state.t = 20; // 越过新手保护
  const R = content.game.params.runner;
  const wall = { obsRef: 't_full', cls: 'full', w: 2.0, h: 3.2, d: 0.8, lane: 0, worldZ: sim.state.distance + 10 };
  sim.obstacles.push(wall);
  let coin = null, scoreBefore = 0, placed = false;
  for (let i = 0; i < 300 && sim.state.alive; i++) {
    const z = relZ(wall, sim.state.distance);
    // 本帧恰好首次进入深度窗口（无 buff/受击，位移可精确算出）→ 在这一帧放入同车道金币
    const dm = Math.min(R.maxSpeed, R.baseSpeed + R.speedRampPer100M * sim.state.distance / 100) * (1 / 60);
    if (z < -0.8 && z + dm >= -0.8) {
      coin = { lane: 0, worldZ: sim.state.distance + 0.5 };
      sim.coinsArr.push(coin);
      placed = true;
    }
    scoreBefore = sim.state.score;
    sim.step();
  }
  assert.ok(placed, '应捕捉到致死帧');
  assert.equal(sim.state.alive, false, '同帧应判定死亡');
  assert.equal(sim.state.hits, 1);
  assert.ok(!coin.taken, '死亡帧金币不应被收集');
  assert.equal(sim.state.coins, 0, '死亡帧金币不应入账');
  assert.equal(sim.state.score, scoreBefore, '死亡帧分数不应重算上涨');
});

// ---------------- 6. 输入缓冲不残留 ----------------

test('飞行/滑翔期缓冲衰减：落地后不残留自动起跳/滑铲，新输入仍生效', () => {
  const sim = cleanSim(105);
  sim.applyAction('jump'); sim.step();
  sim.applyAction('jump'); // 空中补跳 → 进缓冲
  assert.ok(sim.mv.pendingJump > 0, '跳缓冲应已写入');
  grant(sim, 'fly', { durationS: 1 });
  let landed = false;
  for (let i = 0; i < 60 * 8; i++) {
    sim.step();
    if (sim.fx.flyT === 0 && !sim.state.gliding && sim.state.y === 0) { landed = true; break; }
  }
  assert.ok(landed, '应在 8 秒内落地');
  for (let i = 0; i < 30; i++) {
    sim.step();
    assert.equal(sim.state.y, 0, `落地后第 ${i + 1} 帧不应自动起跳`);
    assert.equal(sim.state.vy, 0, '不应有残留起跳速度');
  }
  sim.applyAction('jump'); sim.step();
  assert.ok(sim.state.y > 0, '落地后新按跳应正常起跳');

  const s2 = cleanSim(106);
  s2.applyAction('jump'); s2.step();
  s2.applyAction('slide'); // 空中铲 → 进缓冲
  assert.ok(s2.mv.pendingSlide > 0, '铲缓冲应已写入');
  grant(s2, 'fly', { durationS: 1 });
  let landed2 = false;
  for (let i = 0; i < 60 * 8; i++) {
    s2.step();
    if (s2.fx.flyT === 0 && !s2.state.gliding && s2.state.y === 0) { landed2 = true; break; }
  }
  assert.ok(landed2, '应在 8 秒内落地');
  for (let i = 0; i < 30; i++) {
    s2.step();
    assert.ok(!s2.state.sliding, `落地后第 ${i + 1} 帧不应自动滑铲`);
    assert.equal(s2.state.y, 0);
  }
});

// ---------------- 7. 模板封堵语义与不连抽 ----------------

test('封堵计数只算不可通过类（full/vehicle/moving）；by=9 抽 1000 次 ≥3 种且不连续同模板', () => {
  const pats = content.obstacles.patterns;
  const byId = id => pats.find(p => p.id === id);
  const gen0 = new TrackGen(content, new RunRng(1));
  assert.equal(gen0.maxBlockedLanes(byId('pat_mid_wall_dodge')), 2, '双面 full 墙应计 2');
  assert.equal(gen0.maxBlockedLanes(byId('pat_train_top_run')), 1, '列车应计 1');
  assert.equal(gen0.maxBlockedLanes(byId('pat_hazard_weave')), 1, '摆锤(moving)计 1；电弧/低障不计');
  assert.equal(gen0.maxBlockedLanes(byId('pat_mid_gate_combo')), 1, '高杆/低障可跳铲不计，只算列车');

  const gen = new TrackGen(content, new RunRng(2026));
  const ids = [];
  for (let i = 0; i < 1000; i++) ids.push(gen.pickPattern(9).id);
  const distinct = new Set(ids);
  assert.ok(distinct.size >= 3, `不同模板数 ${distinct.size} < 3：${[...distinct].join('/')}`);
  let consecutive = 0;
  for (let i = 1; i < ids.length; i++) if (ids[i] === ids[i - 1]) consecutive++;
  assert.equal(consecutive, 0, `不应连续同模板，实际 ${consecutive} 次`);
  for (const id of distinct) assert.ok(byId(id), `抽取到未知模板 ${id}`);
});

// ---------------- 8. rng 空池防御 ----------------

test('防御：难度带模板池/金币链桶为空时不崩且能继续生成', () => {
  const clone = JSON.parse(JSON.stringify(content));
  clone.obstacles.difficultyCurve = [{ by: 0, poolWeights: {}, coinDensity: 1, pickupRate: 1 }];
  const gen = new TrackGen(clone, new RunRng(7));
  const pat = gen.pickPattern(0);
  assert.ok(pat && typeof pat.id === 'string' && pat.cells.length > 0, '空池应退回难度可用模板');

  clone.game.params.coins.chainBuckets = []; // 防御：空桶数组回落到默认桶
  clone.obstacles.difficultyCurve = content.obstacles.difficultyCurve;
  const gen2 = new TrackGen(clone, new RunRng(8));
  const obstacles = [], coins = [];
  assert.doesNotThrow(() => {
    for (let d = 0; d <= 600; d += 200) gen2.ensure(d, 400, obstacles, coins);
  });
});
