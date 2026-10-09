/**
 * 角色装配测试（docs/09 T2.4；docs/01 §6、docs/03 §4.1-4.2）
 * 关键验收：换角色不改代码 —— 断言全部从 characters.json / skills.json 推导，
 * 并含一条「改 JSON 数值立刻反映到行为」的数据驱动证明。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RunnerSim } from '../packages/game/dist/core/sim/runnerSim.js';
import { buildLoadout, playableCharacters, itemEffects } from '../packages/game/dist/core/sim/character.js';
import { hashSeed } from '../packages/game/dist/core/rng.js';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const NAMES = ['game', 'characters', 'skills', 'items', 'obstacles', 'themes', 'events', 'economy'];
const load = () => Object.fromEntries(NAMES.map(n => [n, JSON.parse(readFileSync(join(root, 'config', `${n}.json`), 'utf8'))]));
let content = load();

const SIM_SEED = () => hashSeed('char-test');
/** 跑 n 秒（不注入任何操作，只让 sim 自己走） */
function run(sim, seconds) { for (let i = 0; i < 60 * seconds; i++) { sim.step(); sim.drainEvents(); } }

test('首发 6 个角色都能装配出完整装备（主动技能 + 被动天赋）', () => {
  const chars = playableCharacters(content);
  assert.equal(chars.length, 6, `应为 6 个可玩角色，实际 ${chars.length}`);
  for (const c of chars) {
    const l = buildLoadout(content, c.id);
    assert.equal(l.charId, c.id);
    assert.ok(l.name && l.name !== c.id, `${c.id} 应有中文显示名`);
    assert.match(l.tint, /^#[0-9A-Fa-f]{6}$/, `${c.id} 应有 tint 配色`);
    assert.ok(l.skill, `${c.id} 应装配主动技能`);
    assert.ok(l.skill.effects.length >= 1, `${c.id} 的技能应至少由 1 个原语组成`);
    assert.equal(l.passive.length >= 1, true, `${c.id} 应有被动天赋`);
    assert.ok(l.skill.cooldownS >= 14 && l.skill.cooldownS <= 24, `技能冷却应在 14-24s（docs/01 §6.2），实际 ${l.skill.cooldownS}`);
  }
});

test('被动天赋在开局即生效（run_start 触发）', () => {
  const cases = {
    char_volt: s => assert.equal(s.fx.coinPct, 5, '小电：金币 +5%'),
    char_ama: s => assert.equal(s.fx.buffPct, 15, '阿玛拉：道具时长 +15%'),
    char_kaze: s => assert.equal(s.fx.slideAddS, 0.2, '风剃：滑铲 +0.2s'),
    char_rina: s => assert.equal(s.fx.shieldLayers, 1, '莉娜：开局 1 层护盾'),
    char_bolt: s => assert.equal(s.fx.cooldownMul, 0.8, '博尔特警长：冷却 ×0.8'),
    // 奶龙复用小电的技能/天赋（GLB 外观角色，玩法不出圈）；模型走 nailoong.glb
    char_nailong: s => assert.equal(s.fx.coinPct, 5, '奶龙：金币 +5%'),
  };
  for (const [id, check] of Object.entries(cases)) {
    const sim = new RunnerSim(content, SIM_SEED(), id);
    check(sim);
  }
});

test('能量按里程积累：跑满 perMeter 规定的米数后技能就绪', () => {
  const sim = new RunnerSim(content, SIM_SEED(), 'char_volt');
  const sk = sim.loadout.skill;
  const needM = sk.energyMax / sk.energyPerMeter; // 1 / 0.02 = 50 米
  assert.equal(needM, 50);
  assert.equal(sim.canCastSkill(), false, '开局能量为 0');
  let readyAt = -1;
  for (let i = 0; i < 60 * 12 && readyAt < 0; i++) {
    sim.step();
    sim.drainEvents();
    if (sim.canCastSkill()) readyAt = sim.state.distance;
  }
  assert.ok(readyAt > 0, `${needM} 米后应攒满能量`);
  assert.ok(readyAt >= needM - 3 && readyAt <= needM + 6, `就绪里程应接近 ${needM}m，实际 ${readyAt.toFixed(1)}m`);
});

test('释放技能：消耗能量、进入冷却、计入次数与 perSkillCast 加分', () => {
  const sim = new RunnerSim(content, SIM_SEED(), 'char_volt');
  run(sim, 8); // 攒满能量（且越过新手保护）
  assert.equal(sim.canCastSkill(), true);
  const scoreBefore = sim.state.score;
  sim.applyAction('skill');
  assert.equal(sim.state.casts, 1);
  assert.equal(sim.state.energy, 0, '能量应清空');
  assert.ok(Math.abs(sim.state.skillCd - sim.loadout.skill.cooldownS) < 0.01, '冷却应开始计时');
  assert.equal(sim.canCastSkill(), false, '冷却中不可再次释放');
  sim.step(); // score 是 step 里派生的，释放后走一步才会体现加分
  assert.ok(sim.state.score - scoreBefore >= 150, `应含 perSkillCast 加分，实际 +${sim.state.score - scoreBefore}`);
  const seen = new Set();
  for (let i = 0; i < 20; i++) { sim.step(); for (const e of sim.drainEvents()) seen.add(e.type); }
  assert.ok(seen.has('cast'), '应产生 cast 事件供渲染层表现');
});

test('冷却中的被动减益生效：警长的 22 秒冷却被天赋缩到 17.6 秒', () => {
  const sim = new RunnerSim(content, SIM_SEED(), 'char_bolt');
  run(sim, 8);
  sim.applyAction('skill');
  assert.ok(Math.abs(sim.state.skillCd - 22 * 0.8) < 0.01, `skillCd=${sim.state.skillCd}`);
});

test('雷霆冲刺（小电）：释放后进入无敌并自动避障，撞墙不判负', () => {
  const sim = new RunnerSim(content, SIM_SEED(), 'char_volt');
  run(sim, 8);
  sim.state.invulnT = 0;
  sim.applyAction('skill');
  assert.equal(sim.fx.invincible, true, 'invincible 原语应已挂上');
  assert.ok(sim.fx.avoidLookahead > 0, 'laneAutoAvoid 原语应已挂上');
  const laneBefore = sim.state.lane;
  sim.obstacles.length = 0;
  sim.obstacles.push({ obsRef: 't_full', cls: 'full', w: 2, h: 3.2, d: 0.8, lane: laneBefore, worldZ: sim.state.distance + 10 });
  run(sim, 3);
  assert.equal(sim.state.alive, true, '无敌期撞墙不应出局');
});

test('磁暴脉冲（阿玛拉）：6 秒内吸走异车道金币', () => {
  const sim = new RunnerSim(content, SIM_SEED(), 'char_ama');
  run(sim, 8);
  const far = { lane: -1, worldZ: sim.state.distance + 20 };
  sim.coinsArr.push(far);
  sim.applyAction('skill');
  assert.ok(sim.fx.magnetT > 0 && sim.fx.magnetRadius >= 20, `半径应覆盖 20 米，实际 ${sim.fx.magnetRadius}`);
  run(sim, 2);
  assert.ok(far.taken, '同前方 20 米的左车道金币应被吸走');
});

test('瞬闪（风剃）：向前瞬移并撞碎路径障碍', () => {
  const sim = new RunnerSim(content, SIM_SEED(), 'char_kaze');
  run(sim, 8);
  sim.obstacles.push({ obsRef: 't_full', cls: 'full', w: 2, h: 3.2, d: 0.8, lane: sim.state.lane, worldZ: sim.state.distance + 6 });
  const d0 = sim.state.distance, nm0 = sim.state.nearMiss;
  sim.applyAction('skill');
  assert.ok(sim.state.distance - d0 >= 12 - 0.5, `应瞬移约 12 米，实际 ${(sim.state.distance - d0).toFixed(1)}`);
  assert.ok(sim.state.nearMiss > nm0, '撞碎障碍应记近失');
  assert.equal(sim.state.alive, true);
});

test('雷神之翼（莉娜）：释放后进入飞行段并生成空中金币带', () => {
  const sim = new RunnerSim(content, SIM_SEED(), 'char_rina');
  run(sim, 8);
  sim.applyAction('skill');
  run(sim, 1.5);
  assert.ok(sim.fx.flyT > 0 && sim.state.y > 1, '应已离地飞行');
  assert.ok(sim.coinsArr.filter(c => (c.y ?? 0) > 3).length > 10, '空中金币带应已生成');
  assert.ok(sim.cloudsArr.length >= 1, '应有云团');
});

test('时缓领域（博尔特警长）：世界推进变慢 30%，角色操作不变', () => {
  const plain = new RunnerSim(content, SIM_SEED(), 'char_bolt');
  run(plain, 8);
  const d0 = plain.state.distance;
  plain.step(); plain.drainEvents();
  const normalDm = plain.state.distance - d0;

  const slowed = new RunnerSim(content, SIM_SEED(), 'char_bolt');
  run(slowed, 8);
  slowed.applyAction('skill');
  const s0 = slowed.state.distance;
  slowed.step(); slowed.drainEvents();
  const slowDm = slowed.state.distance - s0;
  assert.ok(Math.abs(slowDm / normalDm - 0.7) < 0.02, `世界速率比 ${(slowDm / normalDm).toFixed(3)} 应约 0.7`);
});

test('被动天赋整局常驻：跑满 60 秒仍在身上，HUD 不会显示 3595s 这种倒计时', () => {
  const sim = new RunnerSim(content, SIM_SEED(), 'char_kaze');
  for (let i = 0; i < 60 * 60; i++) { sim.step(); sim.drainEvents(); sim.obstacles.length = 0; }
  assert.equal(sim.state.alive, true);
  assert.equal(sim.fx.slideAddS, 0.2, '被动不应随时间过期');
  assert.equal(sim.buffs.left('slideExtend'), Number.POSITIVE_INFINITY, '被动应登记为永久槽位');
});

test('渲染装配同样来自配置：体色/发光色/体量读皮肤 materialOverrides 与 model.scale', () => {
  const volt = buildLoadout(content, 'char_volt');
  assert.equal(volt.skinId, 'skin_volt_default');
  assert.equal(volt.bodyTint, '#F2F4F8');
  assert.equal(volt.emissive, '#FFD84D');
  assert.equal(volt.modelScale, 1.0);
  assert.equal(buildLoadout(content, 'char_bolt').modelScale, 1.05, '警长应比小电高 5%');

  // prefab 直通：GLB 路径进 Loadout（render/animAvatar 据此切 glb 驱动；文件不存在则回退程序化）
  assert.equal(buildLoadout(content, 'char_nailong').prefab, 'assets/characters/nailoong.glb');
  assert.equal(buildLoadout(content, 'char_nailong').bodyTint, '#FFD84D');
  assert.equal(buildLoadout(content, 'char_volt').prefab, 'assets/characters/volt.glb');

  const edited = load();
  edited.characters.items.find(c => c.id === 'skin_volt_default').materialOverrides.emissive = '#00FF88';
  edited.characters.items.find(c => c.id === 'char_volt').model.scale = 1.4;
  const l = buildLoadout(edited, 'char_volt');
  assert.equal(l.emissive, '#00FF88', '改皮肤发光色即换描边/雷核颜色，不需要改代码');
  assert.equal(l.modelScale, 1.4);
});

test('找不到角色 id 时回退到第一个可玩角色（不抛错、不白屏）', () => {
  const sim = new RunnerSim(content, SIM_SEED(), 'char_nobody');
  assert.equal(sim.loadout.charId, playableCharacters(content)[0].id);
  assert.ok(sim.loadout.skill);
});

test('数据驱动证明：改 JSON 里的冷却与倍率，行为立刻跟着变（换角色/调数值不改代码）', () => {
  const base = new RunnerSim(content, SIM_SEED(), 'char_volt');
  run(base, 8);
  base.applyAction('skill');
  assert.ok(Math.abs(base.state.skillCd - 18) < 0.01);

  const edited = load();
  const skill = edited.skills.items.find(s => s.id === 'skill_thunder_dash');
  skill.cooldownS = 7;
  skill.effects.find(e => e.primitive === 'speedMul').mul = 1.5;
  const sim = new RunnerSim(edited, SIM_SEED(), 'char_volt');
  run(sim, 8);
  sim.applyAction('skill');
  assert.ok(Math.abs(sim.state.skillCd - 7) < 0.01, `冷却应读新值 7s，实际 ${sim.state.skillCd}`);
  assert.ok(Math.abs(sim.fx.speedMul - 1.5) < 1e-9, `速度乘区应读新值 1.5，实际 ${sim.fx.speedMul}`);
});

test('道具效果同样从 items.json 读取：stackRule 与时长都不许硬编码', () => {
  const specs = itemEffects(content, 'item_shield');
  assert.equal(specs[0].primitive, 'shieldAdd');
  assert.equal(specs[0].stackRule, 'stack', '护盾应声明为叠层');
  assert.equal(specs[0].label, '球形护盾', 'HUD 名称应取自配置');
  assert.equal(itemEffects(content, 'item_ghost').length, 0, '不存在的道具应返回空');
});

test('同 seed 同角色同操作序列：整局摘要一致（含技能释放，C6 支撑每日挑战）', () => {
  const play = (id) => {
    const sim = new RunnerSim(content, hashSeed('dup'), id);
    for (let i = 0; i < 60 * 45; i++) {
      if (i % 600 === 0) sim.applyAction('skill');
      if (i % 41 === 0) sim.applyAction('jump');
      if (i % 67 === 0) sim.applyAction('laneL');
      if (i % 79 === 0) sim.applyAction('laneR');
      sim.step();
      sim.drainEvents();
    }
    return sim.summary();
  };
  assert.deepEqual(play('char_volt'), play('char_volt'));
  assert.notDeepEqual(play('char_volt'), play('char_rina'), '不同角色的整局结果应不同');
});
