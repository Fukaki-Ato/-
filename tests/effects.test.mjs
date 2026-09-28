/**
 * 效果原语矩阵测试（docs/08 §3）：对 docs/03 §4.3 每个原语验三类用例
 *   A 单独生效 / B 同类叠加（stackRule 正确）/ C 与 invincible·shield 交互
 * 外加参数边界（0/负时长、超上限、未知原语）不崩。对应任务 docs/09 T2.2。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RunnerSim } from '../packages/game/dist/core/sim/runnerSim.js';
import { PRIMITIVES, SUPPORTED_PRIMITIVES, isPrimitiveSupported } from '../packages/game/dist/core/effects/buffEngine.js';
import { hashSeed } from '../packages/game/dist/core/rng.js';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const NAMES = ['game', 'characters', 'skills', 'items', 'obstacles', 'themes', 'events', 'economy'];
const content = Object.fromEntries(NAMES.map(n => [n, JSON.parse(readFileSync(join(root, 'config', `${n}.json`), 'utf8'))]));
const schema = JSON.parse(readFileSync(join(root, 'schema', 'config.schema.json'), 'utf8'));
const ctx = sim => ({ distance: sim.state.distance, lane: sim.state.lane });

/** 净空 sim：清掉赛道内容，只验原语本身 */
function cleanSim(seed = 71) {
  const sim = new RunnerSim(content, seed);
  sim.obstacles.length = 0;
  sim.coinsArr.length = 0;
  sim.pickupsArr.length = 0;
  sim.state.t = 20; // 越过新手保护窗口，避免保护期吞掉受击判定
  return sim;
}
const grant = (sim, p, params, rule) => sim.buffs.add(p, params, p, ctx(sim), rule);
function wall(sim, cls, lane, aheadM, d = 0.8) {
  sim.obstacles.push({ obsRef: 't_' + cls, cls, w: 2, h: cls === 'high' ? 2.6 : 3.2, d, lane, worldZ: sim.state.distance + aheadM });
}
/** 跑 steps 步，返回事件名集合 */
function run(sim, steps) {
  const seen = new Set();
  for (let i = 0; i < steps; i++) { sim.step(); for (const e of sim.drainEvents()) seen.add(e.type); }
  return seen;
}

// ---------------- 注册表本身 ----------------
/** 递归找出 schema 里包含 "invincible" 的那个 enum —— 引擎注册表必须与之完全一致 */
function schemaPrimitiveEnum(node, found = []) {
  if (Array.isArray(node)) {
    if (node.includes('invincible') && node.includes('shieldAdd')) found.push(node);
    for (const c of node) schemaPrimitiveEnum(c, found);
  } else if (node && typeof node === 'object') {
    for (const v of Object.values(node)) schemaPrimitiveEnum(v, found);
  }
  return found;
}

test('注册表与 schema 的原语枚举一一对应（新增原语必须同时改两处）', () => {
  const enums = schemaPrimitiveEnum(schema);
  assert.equal(enums.length, 1, 'schema 应恰好有一处原语 enum');
  assert.deepEqual(SUPPORTED_PRIMITIVES.slice().sort(), enums[0].slice().sort());
  assert.equal(SUPPORTED_PRIMITIVES.length, Object.keys(PRIMITIVES).length);
});

test('配置里所有 effects.primitive 都已被引擎支持', () => {
  const refs = [];
  for (const file of [content.items, content.skills]) {
    for (const e of file.items ?? []) for (const eff of e.effects ?? []) refs.push(eff.primitive);
  }
  assert.ok(refs.length >= 15, `配置应至少引用 15 个原语，实际 ${refs.length}`);
  for (const p of refs) assert.ok(isPrimitiveSupported(p), `未注册原语：${p}`);
  assert.equal(isPrimitiveSupported('notAPrimitive'), false);
});

// ---------------- A 单独生效 ----------------
test('invincible：整段无敌，撞上满格墙也不判负、不消耗护盾', () => {
  const sim = cleanSim();
  grant(sim, 'shieldAdd', { layers: 1, durationS: 12 });
  grant(sim, 'invincible', { durationS: 2 });
  wall(sim, 'full', 0, 10);
  const seen = run(sim, 90);
  assert.ok(!seen.has('hit') && !seen.has('death'), '无敌期不应受击');
  assert.equal(sim.state.alive, true);
  assert.equal(sim.fx.shieldLayers, 1, '无敌优先于护盾，护盾不该被消耗');
});

test('speedMul / timeSlow：分别改变世界推进速率（+15% / -30%）', () => {
  const meter = (mutate) => {
    const sim = cleanSim(72);
    mutate(sim);
    const d0 = sim.state.distance;
    for (let i = 0; i < 60; i++) sim.step();
    return sim.state.distance - d0;
  };
  const base = meter(() => {});
  const fast = meter(s => grant(s, 'speedMul', { durationS: 5, mul: 1.15 }));
  const slow = meter(s => grant(s, 'timeSlow', { durationS: 5, worldMul: 0.7 }));
  assert.ok(Math.abs(fast / base - 1.15) < 0.02, `加速倍率 ${(fast / base).toFixed(3)}`);
  assert.ok(Math.abs(slow / base - 0.7) < 0.02, `减速倍率 ${(slow / base).toFixed(3)}`);
});

test('magnet：radiusM 决定吸取纵深（磁暴脉冲 99 米 = 全屏吸附）', () => {
  const sim = cleanSim(73);
  const far = { lane: -1, worldZ: sim.state.distance + 30 };
  sim.coinsArr.push(far);
  grant(sim, 'magnet', { durationS: 6, radiusM: 99 });
  run(sim, 30);
  assert.ok(far.taken, '30 米外的异车道金币应被大半径磁铁吸走');
});

test('jumpBoost：初速乘区让同一时刻起跳能跃过 2.6 米高杆', () => {
  const attempt = (withBoost) => {
    const sim = cleanSim(74);
    if (withBoost) grant(sim, 'jumpBoost', { durationS: 12, mul: 1.15 });
    wall(sim, 'high', 0, 24);
    let jumped = false;
    const seen = new Set();
    for (let i = 0; i < 60 * 3; i++) {
      if (!jumped && sim.state.distance > 18) { sim.applyAction('jump'); jumped = true; }
      sim.step();
      for (const e of sim.drainEvents()) seen.add(e.type);
    }
    return seen;
  };
  assert.ok(!attempt(true).has('hit'), '穿鞋应跃过杆顶');
  assert.ok(attempt(false).has('hit'), '赤脚应撞杆');
});

test('fly：升至配置高度、地面障碍保留（从上方掠过）、燃料尽后滑翔落地', () => {
  const sim = cleanSim(101);
  // 用户反馈修正：起飞不再清空整段地面内容——飞行只是从上方掠过，地面障碍应可俯瞰
  const wallAhead = { obsRef: 't_full', cls: 'full', w: 2.0, h: 3.2, d: 0.8, lane: 0, worldZ: sim.state.distance + 40 };
  sim.obstacles.push(wallAhead);
  grant(sim, 'fly', { durationS: 2 });
  run(sim, 60);
  assert.ok(sim.state.y > 1, '1 秒内应已离地');
  assert.ok(sim.obstacles.includes(wallAhead), '起飞不应清除地面障碍');
  assert.ok(sim.state.alive, '飞越低障不应判负');
  run(sim, 60 * 4);
  assert.equal(sim.state.gliding, false, '应已落地');
  assert.equal(sim.state.y, 0);
});

test('shieldAdd：一层挡一次致命击，挡完即消失且不再挡', () => {
  const sim = cleanSim(75);
  grant(sim, 'shieldAdd', { layers: 1, durationS: 12 });
  wall(sim, 'full', 0, 12);
  assert.ok(run(sim, 80).has('shieldBreak'), '应碎盾');
  assert.equal(sim.state.alive, true);
  assert.equal(sim.fx.shieldLayers, 0);
  sim.obstacles.length = 0;
  wall(sim, 'full', 0, 40);
  assert.ok(run(sim, 60 * 4).has('death'), '无盾后致命击应出局');
});

test('boardArmor：抵消一次碰撞后碎板，且不再提供保护', () => {
  const sim = cleanSim(76);
  grant(sim, 'boardArmor', { durationS: 10 });
  wall(sim, 'full', 0, 12);
  assert.ok(run(sim, 80).has('boardBreak'));
  assert.equal(sim.fx.boardT, 0, '碎板后护甲消失');
  sim.obstacles.length = 0;
  wall(sim, 'full', 0, 40);
  assert.ok(run(sim, 60 * 4).has('death'));
});

test('lifeAdd（头盔）：挡下致命一击后计数回退、头盔消失', () => {
  const sim = cleanSim(77);
  grant(sim, 'lifeAdd', { durationS: 20 });
  wall(sim, 'full', 0, 12);
  const seen = run(sim, 80);
  assert.ok(seen.has('helmetSave') && seen.has('hit'));
  assert.equal(sim.state.hits, 0);
  assert.equal(sim.fx.helmetT, 0);
});

test('laneAutoAvoid：前方挡路时自动换到空车道（确定性扫描，无随机）', () => {
  const sim = cleanSim(78);
  wall(sim, 'full', 0, 14);
  grant(sim, 'laneAutoAvoid', { durationS: 3, lookaheadM: 18 });
  run(sim, 40);
  assert.notEqual(sim.state.lane, 0, '应已自动离开被堵的车道');
  assert.equal(sim.state.alive, true);
});

test('dash：向前瞬移 12 米并撞碎路径障碍，计入近失不判负', () => {
  const sim = cleanSim(79);
  wall(sim, 'full', 0, 6);
  wall(sim, 'full', 0, 11);
  const d0 = sim.state.distance, nm0 = sim.state.nearMiss;
  grant(sim, 'dash', { distanceM: 12, destroyObstacles: true });
  assert.equal(sim.state.distance, d0 + 12);
  assert.equal(sim.state.nearMiss, nm0 + 2, '撞碎 2 个障碍应各记 1 次近失');
  assert.equal(sim.state.alive, true);
  assert.ok(sim.obstacles.every(o => o.done));
});

test('blink：默认被满格墙止步，phase:true 才穿墙', () => {
  const stopped = cleanSim(80);
  wall(stopped, 'full', 0, 6);
  grant(stopped, 'blink', { distanceM: 12 });
  assert.equal(stopped.state.distance, 5.6, '应停在墙的前表面（6 - 深度一半 0.4）');

  const phased = cleanSim(80);
  wall(phased, 'full', 0, 6);
  grant(phased, 'blink', { distanceM: 12, phase: true });
  assert.equal(phased.state.distance, 12, 'phase 应直接穿过去');
});

test('scoreAdd：立即加分计入结算', () => {
  const sim = cleanSim(81);
  const before = sim.state.score;
  grant(sim, 'scoreAdd', { flat: 500 });
  run(sim, 2);
  assert.ok(sim.state.score >= before + 500, `scoreAdd 应计入总分，实际 +${sim.state.score - before}`);
});

test('spawnCoinsRow：按 lanes 数组在前方生成金币排', () => {
  const sim = cleanSim(81);
  grant(sim, 'spawnCoinsRow', { lanes: [-1, 0, 1], lengthM: 9, spacingM: 1.5 });
  assert.equal(sim.coinsArr.length, 18, '三车道各 6 枚');
  assert.ok(sim.coinsArr.every(c => !c.taken));
});

test('pickupAll：无视车道吸取路径上的道具箱', () => {
  const sim = cleanSim(82);
  sim.pickupsArr.push({ itemRef: 'item_magnet', lane: 1, worldZ: sim.state.distance + 40 });
  grant(sim, 'pickupAll', { durationS: 4 });
  assert.ok(run(sim, 60 * 4).has('pickup'), '异车道 40 米外的道具箱也应被收取');
});

test('slideExtend（被动）：滑铲时长 0.6 → 0.8 秒', () => {
  const sim = cleanSim(83);
  grant(sim, 'slideExtend', { durationS: 3600, addS: 0.2 });
  sim.applyAction('slide');
  sim.step();
  assert.ok(Math.abs(sim.state.slideT - (0.8 - 1 / 60)) < 1e-6, `slideT=${sim.state.slideT}`);
});

test('buffDurationAdd（被动）：后续 buff 时长按比例拉长', () => {
  const sim = cleanSim(84);
  grant(sim, 'buffDurationAdd', { durationS: 3600, pct: 15 });
  grant(sim, 'magnet', { durationS: 10, radiusM: 8 });
  assert.ok(sim.fx.magnetT > 11.4 && sim.fx.magnetT <= 11.5, `magnetT=${sim.fx.magnetT}`);
});

test('xpMul 是局外原语：施加后不影响任何局内数值', () => {
  const sim = cleanSim(85);
  grant(sim, 'xpMul', { durationS: 1, mul: 2 });
  run(sim, 30);
  assert.equal(sim.fx.coinPct, 0);
  assert.equal(sim.state.alive, true);
});

// ---------------- B 同类叠加（stackRule） ----------------
test('stackRule=refresh：同原语再施加刷新时长与参数，不叠层', () => {
  const sim = cleanSim(86);
  grant(sim, 'magnet', { durationS: 10, radiusM: 8 });
  grant(sim, 'magnet', { durationS: 3, radiusM: 20 }, 'refresh');
  assert.ok(sim.fx.magnetT <= 3 && sim.fx.magnetT > 2.9, `时长应被刷成 3 秒，实际 ${sim.fx.magnetT}`);
  assert.equal(sim.fx.magnetRadius, 20, '参数应整体替换');
});

test('stackRule=stack：护盾按层累加，逐层被消耗', () => {
  const sim = cleanSim(87);
  grant(sim, 'shieldAdd', { layers: 1, durationS: 12 });
  grant(sim, 'shieldAdd', { layers: 1, durationS: 12 }, 'stack');
  assert.equal(sim.fx.shieldLayers, 2, '两箱应叠成 2 层');
  wall(sim, 'full', 0, 12);
  run(sim, 80);
  assert.equal(sim.fx.shieldLayers, 1, '第一次碰撞消耗 1 层');
});

test('stackRule=replace：滑板整条重置（不出现两段时长）', () => {
  const sim = cleanSim(88);
  grant(sim, 'boardArmor', { durationS: 10 });
  grant(sim, 'boardArmor', { durationS: 4 }, 'replace');
  assert.ok(sim.fx.boardT > 3.9 && sim.fx.boardT <= 4, `boardT=${sim.fx.boardT}`);
});

test('同类多来源不叠乘：speedMul 后到的倍率覆盖先前倍率（单槽位语义）', () => {
  const sim = cleanSim(88);
  grant(sim, 'speedMul', { durationS: 10, mul: 1.15 });
  grant(sim, 'speedMul', { durationS: 5, mul: 1.3 });
  assert.ok(Math.abs(sim.fx.speedMul - 1.3) < 1e-9, `speedMul=${sim.fx.speedMul}`);
});

test('coinValueAdd 与 invincible 共存：金币倍率照算，加成分毫不爽', () => {
  const sim = cleanSim(93);
  grant(sim, 'coinValueAdd', { durationS: 15, pct: 100 });
  grant(sim, 'invincible', { durationS: 3 });
  for (let i = 0; i < 20; i++) sim.coinsArr.push({ lane: 0, worldZ: sim.state.distance + 3 + i * 1.5 });
  sim.state.x = 0;
  run(sim, 60 * 3);
  assert.equal(sim.state.coins, 40, '充能倍率（+100%）应让 20 枚金币变 40 枚');
});

// ---------------- C 与 invincible/shield 的交互 ----------------
test('护盾与滑板同时在身：先碎盾、再碎板、第三次才真受击', () => {
  const sim = cleanSim(89);
  grant(sim, 'shieldAdd', { layers: 1, durationS: 30 });
  grant(sim, 'boardArmor', { durationS: 30 });
  const events = [];
  for (let round = 0; round < 3; round++) {
    sim.obstacles.length = 0;
    sim.state.invulnT = 0; // 每次判定后的无敌帧会吞掉下一次碰撞，逐轮手动解除
    wall(sim, 'full', 0, 12);
    for (let i = 0; i < 80; i++) { sim.step(); for (const e of sim.drainEvents()) events.push(e.type); }
  }
  assert.ok(events.includes('shieldBreak') && events.includes('boardBreak') && events.includes('hit'));
  assert.equal(sim.state.hits, 1, '前两次被道具吃掉，只计 1 次受击');
});

test('无敌 + 护盾：无敌吞掉判定，护盾层数保持完整', () => {
  const sim = cleanSim(90);
  grant(sim, 'shieldAdd', { layers: 2, durationS: 12 });
  grant(sim, 'invincible', { durationS: 3 });
  wall(sim, 'full', 0, 12);
  const seen = run(sim, 80);
  assert.equal(sim.fx.shieldLayers, 2);
  assert.ok(!seen.has('hit') && !seen.has('shieldBreak'));
  assert.equal(sim.state.alive, true);
});

// ---------------- 参数边界 ----------------
test('边界：0/负时长、超上限时长、未知原语都不崩且不产生状态', () => {
  const sim = cleanSim(91);
  grant(sim, 'magnet', { durationS: 0, radiusM: 8 });
  grant(sim, 'invincible', { durationS: -5 });
  grant(sim, 'notAPrimitive', { durationS: 3 });
  grant(sim, 'speedMul', { durationS: Number.MAX_SAFE_INTEGER, mul: 2 });
  assert.equal(sim.fx.magnetT, 0, '0 时长不应挂上 buff');
  assert.equal(sim.fx.invincible, false, '负时长应被丢弃');
  assert.equal(sim.buffs.left('speedMul'), 3600 * 1.5, '超上限时长应被截断到 5400s');
  run(sim, 60);
  assert.ok(sim.fx.speedMul > 1.99, '截断后倍率仍生效');
});

test('边界：同一步内挂满所有原语，fx 合并正确、整局不崩', () => {
  const sim = cleanSim(94);
  const c = ctx(sim);
  for (const [name, def] of Object.entries(PRIMITIVES)) {
    sim.buffs.add(name, { durationS: 6, radiusM: 8, mul: 1.1, worldMul: 0.9, layers: 1, pct: 5, addS: 0.1, lookaheadM: 15, flat: 50, distanceM: 4 }, name, c, def.kind === 'instant' ? 'replace' : 'stack');
  }
  run(sim, 60 * 3);
  assert.equal(sim.state.alive, true);
  assert.ok(sim.fx.magnetT > 0 && sim.fx.shieldLayers >= 1 && sim.fx.avoidLookahead > 0);
  assert.ok(sim.buffList().length <= 24, '槽位有上限，不会无限增长');
});

test('确定性：同 seed + 同释放序列，整局摘要一致（C6）', () => {
  const play = () => {
    const sim = new RunnerSim(content, hashSeed('fx-repro'), 'char_kaze');
    for (let i = 0; i < 60 * 40; i++) {
      if (i % 300 === 0) sim.applyAction('skill');
      if (i % 37 === 0) sim.applyAction('jump');
      if (i % 53 === 0) sim.applyAction('slide');
      if (i % 91 === 0) sim.applyAction(i % 182 === 0 ? 'laneL' : 'laneR');
      sim.step();
      sim.drainEvents();
    }
    return sim.summary();
  };
  assert.deepEqual(play(), play());
});
