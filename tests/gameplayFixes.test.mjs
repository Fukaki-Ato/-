/**
 * 玩法修复批次回归（用户反馈）：
 * 1. 移动挡板（摆锤）：跳够高度可越过；横摆限幅不出路面，极端相位仍威胁最外侧车道
 * 2. 弹跳鞋上车顶：列车顶可落可站（rideTop）；赤脚同一时点起跳撞前脸
 * 3. 冲撞长方体：向玩家冲来、必须换道、沿途撞飞同车道障碍、硬接致死
 * 4. 滚冲小正方体：可跳越；不跳必死
 * 5. 闪电圈：无护具第一次受创、第二次致死（不走普通 hits）；有护盾/头盔先被电掉；跳跃可避
 * 6. 空中金币不再铺满三道（按 laneGroupWeights 抽 1/2/3 道）
 * 7. 落地走廊软清除：障碍保留在数组（done+clearT 下沉动画）但不再判负，掠过身后被回收
 * 8. 登车斜坡（step）：赤脚无弹跳鞋也能登上静止火车——沿可走上去的斜坡走上车顶
 * 8b. 弹跳鞋高度口径：配置 mul 下越 2.6m 高杆有充足时间窗口（用户反馈容错太低）
 * 9. 火车不撞火车：冲撞体沿途撞飞普通障碍，但撞不动 rideTop 列车
 * 10. 弹跳鞋跃过高杆：高度口径 <2.6 判中、≥顶可越；赤脚跳不过、穿鞋可越、滑铲可过
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RunnerSim } from '../packages/game/dist/core/sim/runnerSim.js';
import { TrackGen } from '../packages/game/dist/core/sim/trackGen.js';
import { RunRng } from '../packages/game/dist/core/rng.js';
import { hitsRunner, lateralGap, obstacleX } from '../packages/game/dist/core/sim/collision.js';
import { pickAvatarMode } from '../packages/game/dist/render/avatarRig.js';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const NAMES = ['game', 'characters', 'skills', 'items', 'obstacles', 'themes', 'events', 'economy'];
const content = Object.fromEntries(NAMES.map(n => [n, JSON.parse(readFileSync(join(root, 'config', `${n}.json`), 'utf8'))]));

function cleanSim(seed) {
  const sim = new RunnerSim(content, seed);
  sim.state.t = 20; // 越过新手保护
  sim.obstacles.length = 0;
  sim.coinsArr.length = 0;
  sim.pickupsArr.length = 0;
  sim.cloudsArr.length = 0;
  return sim;
}
function grant(sim, primitive, params) {
  sim.buffs.add(primitive, params, primitive, { distance: sim.state.distance, lane: sim.state.lane });
}

/** 弹跳鞋倍率读配置（不写死）：items.json item_boots 的 jumpBoost.mul */
const BOOTS_MUL = content.items.items.find(i => i.id === 'item_boots').effects[0].mul;

// ---------------- 1. 移动挡板可跳 + 限幅 ----------------

test('移动挡板：跳够高度可越过（moving+jumpable）；横摆限幅不出路面且极端相位仍压到最外侧车道', () => {
  const pend = { obsRef: 'obs_pendulum', cls: 'moving', w: 1.2, h: 1.2, d: 1.2, lane: 0, worldZ: 0, jumpable: true, swing: { ampM: 4.4, periodS: 3.2 } };
  const runner = (y, t = 0) => ({ x: 0, y, sliding: false, t });
  assert.equal(hitsRunner(pend, runner(1.5), 2.2), false, '跳起 1.5m 应越过 1.2m 挡板（阈值 0.9）');
  assert.equal(hitsRunner(pend, runner(0.4), 2.2), true, '贴地通过必须判中');
  assert.equal(hitsRunner({ ...pend, jumpable: false }, runner(3), 2.2), true, '未标 jumpable 的 moving 仍不可跳（保持换道语义）');

  const side = { ...pend, lane: 1 };
  let maxX = 0, minGap = Infinity;
  for (let i = 0; i <= 200; i++) {
    const t = side.swing.periodS * i / 200;
    maxX = Math.max(maxX, Math.abs(obstacleX(side, t, 2.2)));
    minGap = Math.min(minGap, lateralGap(side, { x: 2.2, y: 0, sliding: false, t }, 2.2));
  }
  assert.ok(maxX + side.w / 2 <= 3.9 + 1e-9, `摆锤实体不得扫出路面（最大边缘 ${(maxX + 0.6).toFixed(2)} > 3.9）`);
  assert.ok(minGap < 0, `极端相位仍应压到 lane=1 玩家（minGap=${minGap.toFixed(2)}，不得「躲到地图外」）`);
});

// ---------------- 2. 列车上车顶 ----------------

test('弹跳鞋上车顶：列车顶可落可站（rideTop）；赤脚同一时点起跳撞前脸', () => {
  const mk = (boots, seed) => {
    const sim = cleanSim(seed);
    const train = { obsRef: 'obs_train_static', cls: 'vehicle', w: 2.0, h: 2.4, d: 24, lane: 0, worldZ: sim.state.distance + 40, rideTop: true };
    sim.obstacles.push(train);
    if (boots) grant(sim, 'jumpBoost', { durationS: 30, mul: BOOTS_MUL });
    const front = train.worldZ - train.d / 2;
    let jumped = false, rodeOn = false, hit = false;
    for (let i = 0; i < 60 * 8 && sim.state.alive; i++) {
      if (!jumped && front - sim.state.distance <= 6.2) { sim.applyAction('jump'); jumped = true; }
      sim.step();
      for (const e of sim.drainEvents()) if (e.type === 'hit' || e.type === 'death') hit = true;
      // 「站上车顶」= 支撑面吸附到车顶高度且垂直速度归零（不是跳跃最高点）
      if (sim.obstacles.includes(train) && Math.abs(sim.state.y - 2.4) < 1e-6 && sim.state.vy === 0) rodeOn = true;
    }
    return { sim, rodeOn, hit };
  };
  const withBoots = mk(true, 301);
  assert.ok(!withBoots.hit && withBoots.sim.state.alive, '穿鞋应落上车顶且全程不判负');
  assert.ok(withBoots.rodeOn, '应站上 2.4m 车顶（支撑面吸附 + 垂直速度归零）');
  const bare = mk(false, 302);
  assert.ok(bare.hit || !bare.sim.state.alive, '赤脚同一时点起跳应撞前脸（2.4m 跳不过去）');
});

// ---------------- 3. 冲撞长方体 ----------------

test('冲撞长方体：向玩家冲来、必须换道、沿途撞飞同车道障碍、硬接致死', () => {
  const sim = cleanSim(303);
  const rusher = { obsRef: 'obs_rusher_long', cls: 'vehicle', w: 2.0, h: 2.4, d: 8, lane: 0, worldZ: sim.state.distance + 90, moveZ: -8 };
  const victim = { obsRef: 'obs_box', cls: 'low', w: 2.0, h: 1.2, d: 1.2, lane: 0, worldZ: sim.state.distance + 70 };
  sim.obstacles.push(rusher, victim);
  let sawSmash = false, died = false, moved = false;
  for (let i = 0; i < 60 * 12; i++) {
    const before = rusher.worldZ;
    sim.step();
    if (rusher.worldZ < before) moved = true;
    if (victim.done && victim.clearT != null) sawSmash = true;
    if (!sim.state.alive) { died = true; break; }
  }
  assert.ok(moved, 'moveZ 应让冲撞体向玩家逼近');
  assert.ok(sawSmash, '冲撞体应把沿途同车道障碍撞飞（done+clearT）');
  assert.ok(died, '同车道硬接冲撞体必死（跳不过去，只能换道）');
});

// ---------------- 4. 滚冲小正方体 ----------------

test('滚冲小正方体：可跳越；不跳必死', () => {
  const run = (doJump, seed) => {
    const sim = cleanSim(seed);
    const cube = { obsRef: 'obs_cube_roll', cls: 'low', w: 1.1, h: 1.1, d: 1.1, lane: 0, worldZ: sim.state.distance + 60, moveZ: -6 };
    sim.obstacles.push(cube);
    let hit = false;
    for (let i = 0; i < 60 * 10 && sim.state.alive; i++) {
      const gap = cube.worldZ - sim.state.distance;
      if (doJump && sim.state.y <= 0 && gap < 7 && gap > 2.5) sim.applyAction('jump');
      sim.step();
      for (const e of sim.drainEvents()) if (e.type === 'hit' || e.type === 'death') hit = true;
      if (!sim.obstacles.includes(cube)) break; // 正方体掠过身后被回收：此后是常规赛道内容，不在本用例观测范围
    }
    return { alive: sim.state.alive, hit };
  };
  const jumped = run(true, 304);
  assert.ok(jumped.alive && !jumped.hit, '时机得当应跳过滚冲正方体');
  const idle = run(false, 305);
  assert.ok(!idle.alive, '站着不动应被正方体撞死');
});

// ---------------- 5. 闪电圈 ----------------

const ZAP = (sim, ahead, lane = 0) => ({ obsRef: 'obs_lightning_circle', cls: 'hazard', w: 2.2, h: 0.12, d: 2.2, lane, worldZ: sim.state.distance + ahead, zap: true });

test('闪电圈：无护具第一次受创不致死（不走 hits），第二次直接致死', () => {
  const sim = cleanSim(306);
  sim.obstacles.push(ZAP(sim, 15));
  let died = false, zaps = 0;
  for (let i = 0; i < 60 * 4; i++) {
    sim.step();
    for (const e of sim.drainEvents()) if (e.type === 'zap') zaps++;
    if (!sim.state.alive) died = true;
  }
  assert.equal(sim.state.shocks, 1, '第一次触电应记 1 次');
  assert.equal(zaps, 1, '应发出 1 个 zap 事件');
  assert.equal(died, false, '第一次触电不应致死');
  assert.equal(sim.state.hits, 0, '触电受创不占普通碰撞计数（否则一条命会被第一次电死）');
  sim.obstacles.push(ZAP(sim, 45));
  let died2 = false;
  for (let i = 0; i < 60 * 8 && sim.state.alive; i++) sim.step();
  died2 = !sim.state.alive;
  assert.ok(died2, '无护具第二次触电应直接致死');
});

test('闪电圈：先把头盔/护盾电掉（护具挡一次），此后无护具再电一次才死；跳跃可避开', () => {
  const s1 = cleanSim(307);
  grant(s1, 'shieldAdd', { durationS: 60, layers: 1 });
  s1.obstacles.push(ZAP(s1, 15));
  let gear = null, broke = false;
  for (let i = 0; i < 60 * 3; i++) {
    s1.step();
    for (const e of s1.drainEvents()) { if (e.type === 'zap') gear = e.gear; if (e.type === 'shieldBreak') broke = true; }
  }
  assert.equal(gear, 'shield', '触电应先电掉护盾');
  assert.ok(broke && s1.fx.shieldLayers === 0, '护盾层应被电掉');
  assert.equal(s1.state.shocks, 0, '有护具挡下时不应记「无护具受创」');
  assert.ok(s1.state.alive, '有护具不应致死');

  const s2 = cleanSim(308);
  grant(s2, 'lifeAdd', { durationS: 60 });
  s2.obstacles.push(ZAP(s2, 15));
  let gear2 = null;
  for (let i = 0; i < 60 * 3; i++) {
    s2.step();
    for (const e of s2.drainEvents()) if (e.type === 'zap') gear2 = e.gear;
  }
  assert.equal(gear2, 'helmet', '触电应先电掉头盔');
  assert.equal(s2.fx.helmetT, 0, '头盔应被电掉');
  assert.ok(s2.state.alive, '有头盔不应致死');

  const s3 = cleanSim(309);
  s3.obstacles.push(ZAP(s3, 18));
  let zaps3 = 0, jumped = false;
  for (let i = 0; i < 60 * 4; i++) {
    const gap = 18 - s3.state.distance;
    // 闪电圈纵深 3m（±1.5）：起跳时机须让整个穿越窗口处于滞空段（太早会在圈尾落地被判中）
    if (!jumped && s3.state.y <= 0 && gap < 5.5 && gap > 3) { s3.applyAction('jump'); jumped = true; }
    s3.step();
    for (const e of s3.drainEvents()) if (e.type === 'zap') zaps3++;
  }
  assert.equal(zaps3, 0, '跳过闪电圈不应触电');
  assert.equal(s3.state.shocks, 0);
  assert.ok(s3.state.alive, '跳过闪电圈应存活');
});

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
  assert.ok(sim.state.alive, '滑翔期不判负（落地后判罚另见下条用例）');
});

test('落地帧不清障不给无敌：带内障碍原样保留，落地即恢复判定（无免伤窗口）', () => {
  const sim = new RunnerSim(content, 311, 'char_volt');
  sim.state.t = 20; // 越过新手保护（protectionS）：只测落地判定，不吃教程保护
  for (let k = 0; k < 60; k++) sim.step();
  const s = sim.state;
  grant(sim, 'fly', { durationS: 2 });
  const inBand = { obsRef: 't_band', cls: 'full', w: 2, h: 2.6, d: 0.8, lane: s.lane, worldZ: 0 };
  let pushed = false, landed = -1, invulnAtLanding = 0;
  for (let i = 0; i < 60 * 20; i++) {
    const wasGliding = s.gliding;
    // 滑翔末段（即将贴地）把障碍放到落脚点前 4m：落地时还没接触到（本帧不撞），
    // 之后无无敌护着，再跑约 2m 就应撞上判负
    if (!pushed && s.gliding && s.y < 0.35 && s.y > 0.05) { inBand.worldZ = s.distance + 4; sim.obstacles.push(inBand); pushed = true; }
    sim.step();
    if (inBand.clearT != null && s.gliding) throw new Error('滑翔期不应软清除带内障碍');
    if (wasGliding && !s.gliding && s.y === 0) { landed = s.distance; invulnAtLanding = s.invulnT; break; }
  }
  assert.ok(pushed && landed > 0, '应完成滑翔落地');
  // 用户要求「飞行落下的时候不要无敌」：落地瞬间无免伤窗口
  assert.equal(invulnAtLanding, 0, `落地帧不应给无敌，实际 ${invulnAtLanding}`);
  // 用户要求：落地时障碍自动消失这个行为移除——带内障碍保持原状（不下沉、不渐隐、不摘除）
  assert.ok(inBand.done !== true && inBand.clearT == null, '落地帧不得软清除带内障碍（用户要求移除落地清障）');
  // 落地后无保护：再往前走几步就会撞上带内障碍判负（证明判定已恢复）
  let died = false;
  for (let i = 0; i < 60; i++) { sim.step(); if (!sim.state.alive) { died = true; break; } }
  assert.ok(died, '落地后无无敌，撞上保留的障碍应判负');
  assert.ok(sim.obstacles.includes(inBand), '带内障碍实体应仍在赛道数组中（不清障）');
});

// ---------------- 8. 登车板（step）：赤脚也能上静止火车 ----------------

test('登车斜坡：赤脚不起跳，沿可走上去的斜坡走上火车顶（坡中高度随深度线性升高）', () => {
  const sim = cleanSim(311);
  const s = sim.state;
  // 斜坡：坡底贴地、坡顶接火车前脸（与 pat_train_top_run 模板同构：坡远端 = 列车近端）
  const ramp = { obsRef: 'obs_mount_step', cls: 'step', w: 2.0, h: 2.4, d: 6, lane: 0, worldZ: s.distance + 20 };
  const train = { obsRef: 'obs_train_static', cls: 'vehicle', w: 2.0, h: 2.4, d: 24, lane: 0, worldZ: ramp.worldZ + ramp.d / 2 + 12, rideTop: true };
  sim.obstacles.push(ramp, train);
  let midRampY = -1, midRampZ = 0, midErr = 0, rodeOn = false;
  for (let i = 0; i < 60 * 12 && sim.state.alive; i++) {
    sim.step(); // 全程不给任何输入：能不能上车只靠「走」
    const z = s.distance - ramp.worldZ;
    if (midRampY < 0 && z > -0.5 && z < 0.5) { // 坡中取样：截面高度应≈2.4*(0.5+z/4)
      midRampY = s.y; midRampZ = z;
      midErr = Math.abs(s.y - ramp.h * Math.min(1, (z + ramp.d / 2) / (ramp.d - 0.8)));
    }
    if (Math.abs(s.y - 2.4) < 1e-6 && s.vy === 0 && s.distance > train.worldZ - 12) rodeOn = true;
    if (s.distance > train.worldZ + train.d / 2 + 1) break; // 骑过整列车即证明登车成功，不再往后跑（后续生成内容与本用例无关）
  }
  assert.ok(midRampY > 0.8 && midRampY < 1.6, `坡中应被抬到约 1.2m（0.8~1.6m），实际 ${midRampY.toFixed(2)}`);
  assert.ok(midErr < 0.05, `坡中高度应贴合斜坡截面（z=${midRampZ.toFixed(2)}，实际 ${midRampY.toFixed(2)}）`);
  assert.ok(rodeOn, '赤脚沿坡应走上火车顶（吸附 y=2.4 且 vy=0）');
  assert.ok(sim.state.alive, '登车全程不应判负');
});

// ---------------- 8b. 弹跳鞋高度口径 ----------------

test('弹跳鞋高度口径：配置 mul 下顶点与越 2.6m 高杆的时间窗口都富裕（用户反馈高度不够、容错太低）', () => {
  const { gravity, jumpVelocity } = content.game.params.runner;
  const g = -gravity;
  const apex = (jumpVelocity * BOOTS_MUL) ** 2 / (2 * g);
  assert.ok(BOOTS_MUL >= 1.4, `弹跳鞋倍率应 ≥1.4（实际 ${BOOTS_MUL}）`);
  assert.ok(apex > 4, `弹跳鞋顶点应 >4m（实际 ${apex.toFixed(2)}m）`);
  // 越杆窗口：抛物线上高于 2.6m 的持续时间（秒）——容错的量化口径
  const v = jumpVelocity * BOOTS_MUL, h = 2.6;
  const disc = v * v - 2 * g * h;
  assert.ok(disc > 0, '弹跳鞋顶点必须高于杆顶');
  const win = 2 * Math.sqrt(disc) / g;
  assert.ok(win >= 0.6, `越杆时间窗口应 ≥0.6s（实际 ${win.toFixed(2)}s）`);
  // 赤脚顶点必须仍低于杆顶：否则弹跳鞋失去存在意义
  const bareApex = jumpVelocity ** 2 / (2 * g);
  assert.ok(bareApex < h, `赤脚顶点应 <2.6m（实际 ${bareApex.toFixed(2)}m）`);
});

// ---------------- 8c. 滑翔落火车顶 ----------------

test('滑翔落到火车顶：下方是 rideTop 列车时正常落在车顶（不穿模、不判负、不给无敌）', () => {
  const sim = cleanSim(313);
  const s = sim.state;
  // 火车的位置 = 滑翔末段下方：飞行 2s（2.5 倍速约 60m）+ 滑翔约 1.8s（滑翔速约 19m/s）
  const train = { obsRef: 'obs_train_static', cls: 'vehicle', w: 2.0, h: 2.4, d: 24, lane: s.lane, worldZ: s.distance + 78, rideTop: true };
  sim.obstacles.push(train);
  grant(sim, 'fly', { durationS: 2 });
  let landedY = -1, landedOnTrain = false;
  for (let i = 0; i < 60 * 8 && sim.state.alive; i++) {
    const wasGliding = s.gliding;
    sim.step();
    if (wasGliding && !s.gliding) {
      landedY = s.y;
      landedOnTrain = Math.abs(s.y - train.h) < 1e-6; // 支撑面吸附到车顶高度且 vy=0
      break;
    }
  }
  assert.ok(landedY >= 0, '应结束滑翔');
  assert.ok(landedOnTrain, `应落在 2.4m 车顶上（实际 y=${landedY}）`);
  assert.equal(s.invulnT, 0, '落在车顶同样不给无敌（用户要求：落下不要无敌）');
  assert.ok(sim.state.alive, '落车顶不应判负');
  // 站在车顶上继续跑：支撑面保持，仍存活
  for (let i = 0; i < 60; i++) sim.step();
  assert.ok(sim.state.alive && Math.abs(s.y - 2.4) < 1e-6, '应继续站在车顶');
});

// ---------------- 9. 火车不撞火车 ----------------

test('火车不撞火车：冲撞体撞飞普通障碍，但撞不动 rideTop 列车', () => {
  const sim = cleanSim(312);
  const s = sim.state;
  const rusher = { obsRef: 'obs_rusher_long', cls: 'vehicle', w: 2.0, h: 2.4, d: 8, lane: 0, worldZ: s.distance + 90, moveZ: -8 };
  const victim = { obsRef: 'obs_box', cls: 'low', w: 2.0, h: 1.2, d: 1.2, lane: 0, worldZ: s.distance + 78 };
  const train = { obsRef: 'obs_train_static', cls: 'vehicle', w: 2.0, h: 2.4, d: 24, lane: 0, worldZ: s.distance + 60, rideTop: true };
  sim.obstacles.push(rusher, victim, train);
  let sawSmash = false, moved = false;
  for (let i = 0; i < 60 * 12 && sim.state.alive; i++) {
    const before = rusher.worldZ;
    sim.step();
    if (rusher.worldZ < before) moved = true;
    if (victim.done && victim.clearT != null) sawSmash = true;
    assert.ok(train.clearT == null, '列车不得被冲撞体撞飞（火车不撞火车）');
  }
  assert.ok(moved, '冲撞体应向玩家逼近');
  assert.ok(sawSmash, '冲撞体仍应撞飞沿途普通障碍');
});

// ---------------- 10. 弹跳鞋跃过高杆 ----------------

test('弹跳鞋跃过高杆：赤脚跳不过、穿鞋可越、滑铲可过', () => {
  const gate = { obsRef: 'obs_gate_low', cls: 'high', w: 2, h: 2.6, d: 0.6, lane: 0, worldZ: 0 };
  const runner = (y, sliding = false) => ({ x: 0, y, sliding, t: 0 });
  assert.equal(hitsRunner(gate, runner(1.0), 2.2), true, '杆体区间（1.2~2.6m）站立必中');
  assert.equal(hitsRunner(gate, runner(2.4), 2.2), true, '赤脚跳顶点 2.4 < 2.6 仍判中');
  assert.equal(hitsRunner(gate, runner(3.2), 2.2), false, '弹跳鞋顶点 > 2.6 可越过高杆');
  assert.equal(hitsRunner(gate, runner(0, true), 2.2), false, '滑铲从杆下通过');

  const run = (boots, seed) => {
    const sim = cleanSim(seed);
    const g = { obsRef: 'obs_gate_low', cls: 'high', w: 2, h: 2.6, d: 0.6, lane: 0, worldZ: sim.state.distance + 40 };
    sim.obstacles.push(g);
    if (boots) grant(sim, 'jumpBoost', { durationS: 30, mul: BOOTS_MUL });
    let jumped = false, hit = false;
    for (let i = 0; i < 60 * 6 && sim.state.alive; i++) {
      // 弹跳鞋 y≥2.6 的窗口覆盖起跳点前方一段：在 4.5m 处起跳，过杆时仍在杆顶之上
      const gap = g.worldZ - sim.state.distance;
      if (!jumped && gap <= 4.5 && gap > 0.5) { sim.applyAction('jump'); jumped = true; }
      sim.step();
      for (const e of sim.drainEvents()) if (e.type === 'hit' || e.type === 'death') hit = true;
    }
    return { alive: sim.state.alive, hit };
  };
  assert.ok(run(true, 321).alive && !run(true, 321).hit, '穿弹跳鞋应能跃过高杆');
  assert.ok(run(false, 322).hit || !run(false, 322).alive, '赤脚跳不高杆必中');
});

// ---------------- 11. 车顶判定 2.1m 口径 ----------------

test('车顶判定口径：2.1m 以下判撞死、≥2.1m 算落顶/站顶（用户定稿）', () => {
  const train = { obsRef: 'obs_train_static', cls: 'vehicle', w: 2.0, h: 2.4, d: 24, lane: 0, worldZ: 0, rideTop: true };
  const mk = y => ({ x: 0, y, sliding: false, t: 0 });
  assert.equal(hitsRunner(train, mk(2.0), 2.2), true, 'y=2.0（<2.1）应判撞前脸');
  assert.equal(hitsRunner(train, mk(2.05), 2.2), true, 'y=2.05（<2.1）应判撞前脸');
  assert.equal(hitsRunner(train, mk(2.1), 2.2), false, 'y=2.1 应算站顶（不判）');
  assert.equal(hitsRunner(train, mk(2.39), 2.2), false, 'y=2.39（车顶下沿附近）应算站顶');
  assert.equal(hitsRunner(train, mk(2.4), 2.2), false, 'y=2.4（满高）应算站顶');
  // 非 rideTop 载具（冲撞长方体）不看高度：恒判
  const rusher = { obsRef: 'obs_rusher_long', cls: 'vehicle', w: 2.0, h: 2.4, d: 8, lane: 0, worldZ: 0, moveZ: -8 };
  assert.equal(hitsRunner(rusher, mk(5), 2.2), true, '冲撞长方体无 rideTop：任何高度都判');
});

// ---------------- 12. 火车顶跑动姿态（动画模式门） ----------------

test('站在车顶是跑动姿态：supportY 写回 + pickAvatarMode 按支撑面判空', () => {
  const sim = cleanSim(314);
  const s = sim.state;
  const train = { obsRef: 'obs_train_static', cls: 'vehicle', w: 2.0, h: 2.4, d: 24, lane: s.lane, worldZ: s.distance + 40, rideTop: true };
  sim.obstacles.push(train);
  grant(sim, 'jumpBoost', { durationS: 30, mul: BOOTS_MUL });
  // 起跳落到车顶：y 应=2.4 且 supportY 同步=2.4（渲染层据此播跑动动画）
  let jumped = false, sawStand = false;
  for (let i = 0; i < 60 * 8 && sim.state.alive; i++) {
    const front = train.worldZ - train.d / 2;
    if (!jumped && front - s.distance <= 6.2) { sim.applyAction('jump'); jumped = true; }
    sim.step();
    if (jumped && Math.abs(s.y - 2.4) < 1e-6 && s.vy === 0) {
      assert.equal(s.supportY, 2.4, `站顶时 supportY 应为 2.4，实际 ${s.supportY}`);
      sawStand = true;
      break;
    }
  }
  assert.ok(sawStand, '应站上火车顶（y=2.4, vy=0）');
  assert.equal(pickAvatarMode(s), 'run', '站在车顶上应为跑动姿态（旧版 y>0.05 会误判空中）');
  assert.equal(pickAvatarMode({ ...s, y: 2.4 + 0.2 }), 'air', '离车顶 0.2m 才算腾空');
  assert.equal(pickAvatarMode({ ...s, y: 0, supportY: 0 }), 'run', '地面站立仍是跑动');
});
