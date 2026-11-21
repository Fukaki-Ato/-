/**
 * sim 层可选增强测试：道具时长加成（itemBonusS）与技能等级缩放（skillScale）。
 * 关键验收：缺省（不传 enhance / skillScale=1 / itemBonusS=0）行为与旧签名逐位一致——
 * golden replay（tests/golden.test.mjs）依赖这条零 diff；增强只允许在调用方显式传参时生效。
 * 排位与任务回放通过真实 createRunSession + 最小场景/服务替身验证增强隔离。
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
  const sim = new RunnerSim(content, SEED(), charId, false, undefined, undefined, enhance);
  sim.step();
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
  const boosted = new RunnerSim(content, SEED(), undefined, false, ['item_magnet'], undefined, { itemBonusS: () => 2 });
  assert.equal(boosted.buffs.left('magnet'), 12, '加成后应恰为 12s（10+2，不得有浮点噪声）');
  assert.deepEqual(boosted.initialItems, ['item_magnet'], '开局注入清单不受增强影响');
  // 只加时长：radiusM 等其余参数原样保留
  assert.equal(boosted.fx.magnetRadius, plain.fx.magnetRadius, '半径参数不参与加成');
  // itemBonusS 返回 0：与无增强逐位一致（durationS + 0 不允许引入 -0/浮点噪声）
  const zero = new RunnerSim(content, SEED(), undefined, false, ['item_magnet'], undefined, { itemBonusS: () => 0 });
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
    const sim = new RunnerSim(content, hashSeed('enhance-e2e'), 'char_volt', false, ['item_shield'], undefined, enhance);
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
  const scaled = new RunnerSim(content, SEED(), 'char_volt', false, undefined, undefined, { skillScale: 1.05 });
  const invincible = scaled.loadout.skill.effects.find(e => e.primitive === 'invincible');
  assert.equal(invincible.params.durationS, 2.5 * 1.05, '装配产物应已按比例缩放');
  scaled.applyAction('skill');
  assert.ok(Math.abs(scaled.buffs.left('invincible') - 2.5 * 1.05) < 1e-9,
    `释放后的无敌应 2.625s，实际 ${scaled.buffs.left('invincible')}`);
  const plain = new RunnerSim(content, SEED(), 'char_volt');
  plain.applyAction('skill');
  assert.ok(Math.abs(plain.buffs.left('invincible') - 2.5) < 1e-9, '不传增强应保持 2.5s');
});

test('排位确定性：真实 runSession 对排位禁用增强，强化本机局不上传标准任务回放', async () => {
  const { createRunSession } = await import('../packages/game/dist/flow/runSession.js');
  const { leaderboardRulesId } = await import('../packages/game/dist/flow/leaderboard.js');
  const enhance = { skillScale: 1.05, itemBonusS: () => 2 };
  const start = async (extra) => {
    let sim, tracked = 0;
    const session = createRunSession({ content, charId: 'char_volt', themeId: 'theme_library',
      adapter: { canvas: { mainCanvas: () => ({}), windowSize: () => ({}) } },
      views: { renderBoot: () => ({ setStatus() {} }), mountHud: () => ({ update() {}, dispose() {} }) },
      consumeItems: () => ['item_magnet'],
      trackRun: () => { tracked++; return () => {}; },
      createScene: (_host, _adapter, runner) => { sim = runner; return { dispose() {} }; },
      onSeed() {}, onEnd() {}, onDeath() {}, onCast() {}, onPickup() {}, ...extra,
    });
    await new Promise(resolve => setImmediate(resolve));
    session.dispose();
    return { sim, tracked };
  };
  const local = await start({ enhance });
  assert.equal(local.sim.buffs.left('magnet'), 12);
  assert.equal(local.sim.loadout.skill.effects[0].params.durationS, 2.5 * 1.05);
  assert.equal(local.tracked, 0, '增强局不按标准规则回放');
  const plain = await start({});
  assert.equal(plain.tracked, 1);
  assert.equal(plain.sim.buffs.left('magnet'), 10);
  const ranked = await start({ enhance,
    service: { begin: async () => ({ runId: 'sim-enhance-ticket', seed: 123, rulesId: leaderboardRulesId(content) }) },
  });
  assert.equal(ranked.sim.themeId, 'theme_library');
  assert.deepEqual(ranked.sim.initialItems, []);
  assert.equal(ranked.sim.loadout.skill.effects[0].params.durationS, 2.5);
  assert.equal(ranked.tracked, 1);
  const main = readFileSync(join(root, 'packages/game/src/flow/mainFlow.ts'), 'utf8');
  assert.match(main, /enhance:\s*deps\.account\s*\?\s*undefined\s*:/, '云账户不注入本机强化');
});

test('RunnerSim 第六参主题与第七参增强互不覆盖，默认装配路径保持未增强', () => {
  const sim = new RunnerSim(content, SEED(), 'char_volt', false, ['item_magnet'], 'theme_library', {
    skillScale: 1.05, itemBonusS: () => 2,
  });
  assert.equal(sim.themeId, 'theme_library');
  assert.equal(sim.buffs.left('magnet'), 12);
  assert.equal(sim.loadout.skill.effects[0].params.durationS, 2.5 * 1.05);
  const plain = new RunnerSim(content, SEED(), 'char_volt', false, ['item_magnet'], 'theme_library');
  assert.equal(plain.buffs.left('magnet'), 10);
  assert.equal(plain.loadout.skill.effects[0].params.durationS, 2.5);
});

test('missionStats：只记录实际拾取、按道具分类；初始装备/错道/排空事件不影响计数', () => {
  const sim = new RunnerSim(content, SEED(), undefined, false, ['item_magnet']);
  sim.step(); sim.obstacles.length = 0; sim.coinsArr.length = 0; sim.pickupsArr.length = 0;
  assert.deepEqual(sim.missionStats.itemOf, {});
  assert.equal(sim.missionStats.itemPickups, 0);
  sim.pickupsArr.push(
    { itemRef: 'item_magnet', lane: 0, worldZ: sim.state.distance + 1 },
    { itemRef: 'item_magnet', lane: 0, worldZ: sim.state.distance + 2 },
    { itemRef: 'item_shield', lane: 0, worldZ: sim.state.distance + 3 },
    { itemRef: 'item_boots', lane: 1, worldZ: sim.state.distance + 4 },
  );
  for (let i = 0; i < 30; i++) { sim.step(); sim.drainEvents(); }
  assert.equal(sim.missionStats.itemPickups, 3);
  assert.deepEqual(sim.missionStats.itemOf, { item_magnet: 2, item_shield: 1 });
  const stats = sim.missionStats; stats.itemOf.item_magnet = 99;
  assert.equal(sim.missionStats.itemOf.item_magnet, 2, '返回值是快照');
  sim.state.alive = false;
  sim.pickupsArr.push({ itemRef: 'item_boots', lane: 0, worldZ: sim.state.distance });
  sim.step();
  assert.equal(sim.missionStats.itemPickups, 3, '死亡后不拾取');
});

test('missionStats.jumps：真实地面/滑铲起身/落地缓冲跳各计一次，重复与过期缓冲不加计', () => {
  const sim = cleanSim();
  sim.applyAction('slide'); sim.applyAction('jump'); sim.applyAction('jump');
  assert.equal(sim.missionStats.slides, 1);
  assert.equal(sim.missionStats.jumps, 1);
  assert.equal(sim.state.sliding, false);
  for (let i = 0; i < 10; i++) sim.step();
  sim.applyAction('jump');
  for (let i = 0; i < 60; i++) sim.step();
  assert.equal(sim.missionStats.jumps, 1, '高空缓冲过期不能算起跳');
  sim.applyAction('jump'); sim.step();
  while (!(sim.state.vy < 0 && sim.state.y < 0.2)) sim.step();
  sim.applyAction('jump');
  assert.equal(sim.missionStats.jumps, 2, '缓冲输入时仍未真正跳起');
  for (let i = 0; i < 8 && sim.missionStats.jumps === 2; i++) sim.step();
  assert.equal(sim.missionStats.jumps, 3, '落地执行缓冲才计数');
  assert.ok(sim.state.vy > 0);
  sim.state.alive = false; sim.applyAction('jump'); sim.step();
  assert.equal(sim.missionStats.jumps, 3);
});

test('missionStats.jumps：飞行/滑翔输入被忽略，正常落地后恢复计数', () => {
  const sim = cleanSim();
  sim.buffs.add('fly', { durationS: 0.4 }, 'test_fly', { distance: sim.state.distance, lane: 0 });
  let glided = false;
  for (let i = 0; i < 300 && (sim.fx.flyT > 0 || sim.state.gliding || sim.mv.flyWasActive); i++) {
    sim.applyAction('jump'); sim.step();
    glided ||= sim.state.gliding;
  }
  assert.equal(glided, true);
  assert.equal(sim.missionStats.jumps, 0);
  assert.equal(sim.state.gliding, false);
  sim.applyAction('jump');
  assert.equal(sim.missionStats.jumps, 1);
});
