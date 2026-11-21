/**
 * sim 层可选增强测试：道具时长加成（itemBonusS）与技能等级缩放（skillScale）。
 * 关键验收：缺省（不传 enhance / skillScale=1 / itemBonusS=0）行为与旧签名逐位一致——
 * golden replay（tests/golden.test.mjs）依赖这条零 diff；增强只允许在调用方显式传参时生效。
 * 排位确定性无法在单测里搭 service 环境，按 tests/shop-view.test.mjs 的源码契约断言模式覆盖。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RunnerSim } from '../packages/game/dist/core/sim/runnerSim.js';
import { buildLoadout, playableCharacters } from '../packages/game/dist/core/sim/character.js';
import { hashSeed } from '../packages/game/dist/core/rng.js';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const NAMES = ['game', 'characters', 'skills', 'items', 'obstacles', 'themes', 'events', 'economy'];
const load = () => Object.fromEntries(NAMES.map(n => [n, JSON.parse(readFileSync(join(root, 'config', `${n}.json`)), 'utf8')]));
const content = load();
const SEED = () => hashSeed('sim-enhance');

/** 净空世界：清掉随机生成的障碍/金币/道具箱，只留测试自放的实体 */
function cleanSim(enhance, charId) {
  const sim = new RunnerSim(content, SEED(), charId, false, undefined, enhance);
  sim.obstacles.length = 0;
  sim.coinsArr.length = 0;
  sim.pickupsArr.length = 0;
  return sim;
}

test('buildLoadout 缺省 / skillScale=1 与旧行为逐位一致（全角色，JSON 串全等）', () => {
  for (const c of playableCharacters(content)) {
    const base = JSON.stringify(buildLoadout(content, c.id));
    assert.equal(JSON.stringify(buildLoadout(content, c.id, undefined)), base, `${c.id}: 缺省应逐位一致`);
    assert.equal(JSON.stringify(buildLoadout(content, c.id, { skillScale: 1 })), base, `${c.id}: skillScale=1 应逐位一致`);
  }
});

test('buildLoadout：skillScale 非有限正数（0/负数/NaN/Infinity）一律视为未缩放', () => {
  const base = JSON.stringify(buildLoadout(content, 'char_volt'));
  for (const bad of [0, -2, NaN, Infinity]) {
    assert.equal(JSON.stringify(buildLoadout(content, 'char_volt', { skillScale: bad })), base, `skillScale=${bad} 不应缩放`);
  }
});

test('buildLoadout skillScale=1.05：小数参数精确缩放，整数参数四舍五入保持整数，冷却/门槛不受影响', () => {
  const l = buildLoadout(content, 'char_volt', { skillScale: 1.05 }); // skill_thunder_dash
  const byPrimitive = Object.fromEntries(l.skill.effects.map(e => [e.primitive, e.params]));
  // durationS 2.5 是小数：保持小数精确缩放
  assert.equal(byPrimitive.invincible.durationS, 2.5 * 1.05);
  assert.equal(byPrimitive.speedMul.durationS, 2.5 * 1.05);
  assert.equal(byPrimitive.speedMul.mul, 1.15 * 1.05);
  // lookaheadM 18 是整数：18×1.05=18.9 → 四舍五入 19，保持整数（离散量不出现小数）
  assert.equal(byPrimitive.laneAutoAvoid.lookaheadM, Math.round(18 * 1.05));
  assert.equal(Number.isInteger(byPrimitive.laneAutoAvoid.lookaheadM), true);
  // cooldownS/chargeSlides 不在 effects.params：天然不受缩放影响
  assert.equal(l.skill.cooldownS, 18);
  assert.equal(l.skill.chargeSlides, 0);
  // 缩放不得改写共享产物：重新按缺省装配，数值仍是原值
  assert.equal(buildLoadout(content, 'char_volt').skill.effects[0].params.durationS, 2.5);
});

test('buildLoadout 缩放数据驱动：改 JSON 数值立刻按比例反映，离散层数缩放后仍为整数', () => {
  const edited = load();
  const skill = edited.skills.items.find(s => s.id === 'skill_magnet_pulse');
  skill.effects[0] = { primitive: 'magnet', durationS: 6.5, radiusM: 20.5 }; // 小数 durationS/radiusM
  skill.effects.push({ primitive: 'shieldAdd', durationS: 10, layers: 3 });  // layers 属离散整数参数
  const l = buildLoadout(edited, 'char_ama', { skillScale: 1.05 });
  assert.equal(l.skill.effects[0].params.durationS, 6.5 * 1.05, '小数 durationS 应精确缩放');
  assert.equal(l.skill.effects[0].params.radiusM, 20.5 * 1.05, '小数 radiusM 应精确缩放');
  const layers = l.skill.effects[1].params.layers;
  assert.equal(layers, Math.round(3 * 1.05), '整数 layers 缩放后四舍五入');
  assert.equal(Number.isInteger(layers), true, 'layers 必须保持整数');
});

test('buildLoadout skillScale=2：曼波之力时长/次数翻倍，但下滑积攒门槛（chargeSlides）不变', () => {
  const mambo = buildLoadout(content, 'char_mambo', { skillScale: 2 });
  const guard = mambo.skill.effects[0].params;
  assert.equal(guard.durationS, 24, 'durationS 12×2=24');
  assert.equal(guard.charges, 4, 'charges 2×2=4（整数保持整数）');
  assert.equal(mambo.skill.chargeSlides, 10, '积攒门槛是离散量，绝不缩放');
  assert.equal(mambo.skill.cooldownS, 0);
});

test('RunnerSim itemBonusS：开局装备注入路径时长 = 配置时长 + 额外秒数；返回 0 时逐位不变', () => {
  const plain = new RunnerSim(content, SEED(), undefined, false, ['item_magnet']);
  assert.equal(plain.buffs.left('magnet'), 10, '无增强应恰为配置 10s（磁暴手套 durationS=10）');
  const boosted = new RunnerSim(content, SEED(), undefined, false, ['item_magnet'], { itemBonusS: () => 2 });
  assert.equal(boosted.buffs.left('magnet'), 12, '加成后应恰为 12s（10+2，不得有浮点噪声）');
  assert.deepEqual(boosted.initialItems, ['item_magnet'], '开局注入清单不受增强影响');
  // 只加时长：radiusM 等其余参数原样保留
  assert.equal(boosted.fx.magnetRadius, plain.fx.magnetRadius, '半径参数不参与加成');
  // itemBonusS 返回 0：与无增强逐位一致（durationS + 0 不允许引入 -0/浮点噪声）
  const zero = new RunnerSim(content, SEED(), undefined, false, ['item_magnet'], { itemBonusS: () => 0 });
  assert.equal(zero.buffs.left('magnet'), 10);
});

test('RunnerSim itemBonusS：局内拾取路径（道具箱 → grantItem）同样加成', () => {
  const collect = (enhance) => {
    const sim = cleanSim(enhance);
    sim.pickupsArr.push({ itemRef: 'item_magnet', lane: 0, worldZ: sim.state.distance + 8 });
    for (let i = 0; i < 120 && sim.buffs.left('magnet') <= 0; i++) sim.step();
    assert.ok(sim.buffs.left('magnet') > 0, '道具箱应被拾取（测试自放，120 帧内必中）');
    return sim.buffs.left('magnet');
  };
  assert.equal(collect(undefined), 10, '拾取无加成应恰为 10s');
  assert.equal(collect({ itemBonusS: () => 2 }), 12, '拾取加成后应恰为 12s');
  assert.equal(collect({ itemBonusS: id => (id === 'item_magnet' ? 2 : 0) }), 12, '按 itemId 定向加成同样生效');
});

test('RunnerSim：不传 enhance 与传空/零值 enhance 整局逐字段一致（缺省零 diff）', () => {
  const play = (enhance) => {
    const sim = new RunnerSim(content, hashSeed('enhance-e2e'), 'char_volt', false, ['item_shield'], enhance);
    for (let i = 0; i < 60 * 30; i++) {
      if (i % 500 === 0) sim.applyAction('skill');
      if (i % 37 === 0) sim.applyAction('jump');
      if (i % 71 === 0) sim.applyAction('laneR');
      sim.step();
      sim.drainEvents();
    }
    return { summary: sim.summary(), buffs: sim.buffList() };
  };
  const base = play(undefined);
  assert.deepEqual(play({}), base, '空 enhance 对象应与不传逐字段一致');
  assert.deepEqual(play({ itemBonusS: () => 0, skillScale: 1 }), base, '零值增强（加成 0 + 缩放 1）应与不传逐字段一致');
});

test('RunnerSim enhance.skillScale 透传 buildLoadout：技能数值缩放并体现在释放出的 buff 时长上', () => {
  const scaled = new RunnerSim(content, SEED(), 'char_volt', false, undefined, { skillScale: 1.05 });
  const invincible = scaled.loadout.skill.effects.find(e => e.primitive === 'invincible');
  assert.equal(invincible.params.durationS, 2.5 * 1.05, '装配产物应已按比例缩放');
  scaled.applyAction('skill');
  assert.ok(Math.abs(scaled.buffs.left('invincible') - 2.5 * 1.05) < 1e-9,
    `释放后的无敌应 2.625s，实际 ${scaled.buffs.left('invincible')}`);
  const plain = new RunnerSim(content, SEED(), 'char_volt');
  plain.applyAction('skill');
  assert.ok(Math.abs(plain.buffs.left('invincible') - 2.5) < 1e-9, '不传增强应保持 2.5s');
});

test('排位确定性：runSession 源码契约——排位局不传 enhance，与道具排位跳过同模式（保服务端重放）', () => {
  const src = readFileSync(join(root, 'packages/game/src/flow/runSession.ts'), 'utf8');
  // 道具：排位局 items 强制空数组（既有契约，一并守住）
  assert.match(src, /const items = ticket \? \[\] : d\.consumeItems\?\.\(\) \?\? \[\];/);
  // 增强：排位局（ticket 存在）第 6 参显式 undefined，休闲局透传 d.enhance
  assert.match(src, /new RunnerSim\(d\.content, seed, d\.charId, !!ticket, items, ticket \? undefined : d\.enhance\)/);
  // 依赖声明：RunSessionDeps 上存在可选 enhance 字段
  assert.match(src, /enhance\?: RunEnhance;/);
});
