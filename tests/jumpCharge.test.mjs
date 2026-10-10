/**
 * 跳跃充能（jumpCharge）与周期叠加语义单测。
 *
 * 覆盖三件容易回归的事：
 *   1. periodic 的子效果能按 stackRule 叠层（此前 addCycle 走 refresh，充能永远只有 1 层）；
 *   2. 起跳消耗一层且倍率按配置读（顶点 2.40m → 3.10m）；
 *   3. 倍率的取值时机：扣掉最后一层会立刻 recompute，fx.jumpChargeMul 随之回落基线。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RunnerSim } from '../packages/game/dist/core/sim/runnerSim.js';
import { SUPPORTED_PRIMITIVES } from '../packages/game/dist/core/effects/primitives.js';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const NAMES = ['game', 'characters', 'skills', 'items', 'obstacles', 'themes', 'events', 'economy'];
const load = () => Object.fromEntries(NAMES.map(n => [n, JSON.parse(readFileSync(join(root, 'config', `${n}.json`), 'utf8'))]));
const content = load();
const SEED = () => 424242;
/** 逐帧推进并清空障碍：只验效果引擎，别让赛道随机障碍把 buff 时钟打断 */
const steps = (sim, sec) => { for (let i = 0; i < 60 * sec; i++) { sim.obstacles.length = 0; sim.step(); sim.drainEvents(); } };
/** 起跳一次并测顶点（返回米） */
function apex(sim) {
  sim.obstacles.length = 0;
  sim.applyAction('jump');
  let peak = 0;
  for (let i = 0; i < 200; i++) {
    sim.obstacles.length = 0;
    sim.step(); sim.drainEvents();
    peak = Math.max(peak, sim.state.y);
    if (sim.state.y <= 0 && i > 5) break;
  }
  return peak;
}

test('jumpCharge 已注册：引擎注册表与 schema 枚举同集合', () => {
  assert.ok(SUPPORTED_PRIMITIVES.includes('jumpCharge'), 'jumpCharge 应在 PRIMITIVES 注册');
  const schema = JSON.parse(readFileSync(join(root, 'schema', 'config.schema.json'), 'utf8'));
  const enums = JSON.stringify(schema).match(/"jumpCharge"/g);
  assert.ok(enums && enums.length > 0, 'schema 的 primitive 枚举应含 jumpCharge');
});

test('周期子效果按 stackRule 叠层：每 10 秒 +1 层，不跳就攒着', () => {
  const sim = new RunnerSim(content, SEED(), 'char_frog');
  steps(sim, 0.2);
  assert.equal(sim.fx.jumpCharges, 1, '开局第一个周期应给 1 层');
  steps(sim, 10);  // 越过 10s 边界（周期首触发在第 1 步，之后每 600 步一次）
  assert.equal(sim.fx.jumpCharges, 2, '第二个周期应叠到 2 层（refresh 语义下这里会永远是 1）');
  steps(sim, 10);
  assert.equal(sim.fx.jumpCharges, 3, '第三个周期应叠到 3 层');
});

test('起跳消耗一层充能，且倍率读配置：顶点 2.40m → 3.10m', () => {
  const talent = content.skills.items.find(s => s.id === 'talent_frog_bounce');
  const mul = talent.effects[0].effects[0].mul;
  const R = content.game.params.runner;
  const theo = m => (R.jumpVelocity * m) ** 2 / (2 * Math.abs(R.gravity));

  // 基础跳参照：小电无被动，顶点应接近理论值 2.40m
  const volt = new RunnerSim(content, SEED(), 'char_volt');
  const basePeak = apex(volt);
  assert.ok(Math.abs(basePeak - theo(1)) < 0.15, `基础跳顶点应接近 ${theo(1).toFixed(2)}m，实际 ${basePeak.toFixed(2)}`);

  // 奶蛙：清掉被动充能后测基础跳，再让周期挂上充能后测充能跳
  const frog = new RunnerSim(content, SEED(), 'char_frog');
  frog.buffs.remove('jumpCharge');
  frog.buffs.remove('periodic');
  assert.equal(frog.fx.jumpCharges, 0, '移除后不应有充能');
  const frogBase = apex(frog);
  assert.ok(Math.abs(frogBase - basePeak) < 0.01, '无充能的奶蛙应与基础跳同高');

  frog.buffs.add('jumpCharge', { mul, stackRule: 'stack' }, '弹跳之力', { distance: 0, lane: 0 });
  assert.equal(frog.fx.jumpCharges, 1);
  const frogCharge = apex(frog);
  assert.equal(frog.fx.jumpCharges, 0, '起跳应消耗一层');
  assert.ok(Math.abs(frogCharge - theo(mul)) < 0.15,
    `充能跳顶点应接近 ${theo(mul).toFixed(2)}m，实际 ${frogCharge.toFixed(2)}`);
  assert.ok(frogCharge > frogBase + 0.5, '充能跳必须明显高于基础跳');
});

test('最后一层充能也要吃到倍率（倍率读取早于 recompute 回落）', () => {
  // 回归：曾在 consumeJumpCharge() 之后读 fx.jumpChargeMul，扣掉最后一层触发 recompute，
  // 倍率回落基线 1，导致「攒到 1 层时的唯一一次高跳」只有 2.29m。
  const R = content.game.params.runner;
  const mul = 1.1369;
  const sim = new RunnerSim(content, SEED(), 'char_frog');
  sim.buffs.remove('periodic');
  sim.buffs.add('jumpCharge', { mul, stackRule: 'stack' }, '弹跳之力', { distance: 0, lane: 0 });
  assert.equal(sim.fx.jumpCharges, 1, '只有 1 层（最容易被漏掉倍率的场景）');
  const peak = apex(sim);
  const theo = (R.jumpVelocity * mul) ** 2 / (2 * Math.abs(R.gravity));
  assert.ok(peak > 2.9, `单层充能就该给满倍率（约 ${theo.toFixed(2)}m），实际只有 ${peak.toFixed(2)}m`);
});

test('充能叠加后可连续高跳，逐次消耗', () => {
  const sim = new RunnerSim(content, SEED(), 'char_frog');
  steps(sim, 0.2);
  steps(sim, 10); // 攒到 2 层
  assert.equal(sim.fx.jumpCharges, 2);
  const peaks = [apex(sim), apex(sim)];
  assert.deepEqual(sim.fx.jumpCharges, 0, '两跳应把两层用完');
  for (const p of peaks) assert.ok(p > 2.9, `每次都该是充能跳，实际 ${p.toFixed(2)}`);
});

test('没有充能时行为不变：弹跳鞋 mul 仍走 jumpMul，两条乘区互不串', () => {
  const R = content.game.params.runner;
  const sim = new RunnerSim(content, SEED(), 'char_volt');
  sim.buffs.add('jumpBoost', { durationS: 10, mul: 1.1 }, '弹跳鞋', { distance: 0, lane: 0 });
  const peak = apex(sim);
  const theo = (R.jumpVelocity * 1.1) ** 2 / (2 * Math.abs(R.gravity));
  assert.ok(Math.abs(peak - theo) < 0.15, `弹跳鞋顶点应接近 ${theo.toFixed(2)}m，实际 ${peak.toFixed(2)}`);
  assert.equal(sim.fx.jumpCharges, 0, '弹跳鞋不应产生充能层数');
});

test('起跳时机扫描：充能跳可越 2.6m 高杆，3.0m 满格墙仍然只能换道', () => {
  const R = content.game.params.runner;
  // 满格墙 semantics 由 collision.ts 写死（cls=full 恒判负），此断言锁住「加高跳跃不推翻旧定稿」
  const run = (charId, cls, h, useCharge) => {
    const airS = 2 * R.jumpVelocity * 1.1369 / Math.abs(R.gravity);
    let pass = 0, total = 0;
    for (let lead = 0.2; lead <= airS * R.baseSpeed + 0.5; lead += 0.1) {
      total++;
      const sim = new RunnerSim(content, SEED(), charId);
      sim.state.t = 20; // 越过新手保护
      if (useCharge) sim.buffs.add('jumpCharge', { mul: 1.1369, stackRule: 'stack' }, '弹跳之力', { distance: 0, lane: 0 });
      const z = sim.state.distance + 30;
      const place = () => { sim.obstacles.length = 0; sim.obstacles.push({ obsRef: 't', cls, w: 2, h, d: 0.8, lane: sim.state.lane, worldZ: z }); };
      place();
      let jumped = false;
      for (let i = 0; i < 60 * 6; i++) {
        if (!jumped && z - sim.state.distance <= lead) { sim.applyAction('jump'); jumped = true; }
        sim.step(); sim.drainEvents();
        if (!sim.state.alive) break;
        place();
        if (sim.state.distance > z + 2) break;
      }
      if (sim.state.alive) pass++;
    }
    return { pass, total };
  };
  const base = run('char_volt', 'high', 2.6, false);
  assert.equal(base.pass, 0, '基础跳仍不该越过 2.6m 高杆（该走滑铲）');
  const charged = run('char_frog', 'high', 2.6, true);
  assert.ok(charged.pass > 0, '充能跳应能越过 2.6m 高杆');
  const wall = run('char_frog', 'full', 3.0, true);
  assert.equal(wall.pass, 0, '3.0m 满格墙必须保持「只能换道」');
});

test('周期槽位自身不衰减：跑满 60 秒充能仍在累积', () => {
  const sim = new RunnerSim(content, SEED(), 'char_frog');
  for (let i = 0; i < 60 * 60; i++) { sim.obstacles.length = 0; sim.step(); sim.drainEvents(); }
  assert.equal(sim.state.alive, true);
  assert.ok(sim.fx.jumpCharges >= 6, `60 秒应至少充能 6 次，实际 ${sim.fx.jumpCharges}`);
  assert.equal(sim.buffs.left('periodic'), Number.POSITIVE_INFINITY, '周期槽位应登记为永久');
});

test('fx.periodicLive：周期子效果生效期间为真（被动图标亮灯依据）', () => {
  const frog = new RunnerSim(content, SEED(), 'char_frog');
  steps(frog, 0.2);
  assert.equal(frog.fx.periodicLive, true, '奶蛙挂上充能后周期应处于生效中');
  const kaze = new RunnerSim(content, SEED(), 'char_kaze'); // 非周期被动
  assert.equal(kaze.fx.periodicLive, false, '常驻被动不应点亮 periodicLive');
});