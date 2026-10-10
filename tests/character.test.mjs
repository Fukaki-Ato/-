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

test('8 个角色都能装配出完整装备（主动技能 + 被动天赋）', () => {
  const chars = playableCharacters(content);
  assert.equal(chars.length, 8, `应为 8 个可玩角色，实际 ${chars.length}`);
  for (const c of chars) {
    const l = buildLoadout(content, c.id);
    assert.equal(l.charId, c.id);
    assert.ok(l.name && l.name !== c.id, `${c.id} 应有中文显示名`);
    assert.match(l.tint, /^#[0-9A-Fa-f]{6}$/, `${c.id} 应有 tint 配色`);
    assert.ok(l.skill, `${c.id} 应装配主动技能`);
    assert.ok(l.skill.effects.length >= 1, `${c.id} 的技能应至少由 1 个原语组成`);
    assert.equal(l.passive.length >= 1, true, `${c.id} 应有被动天赋`);
    // 释放门槛二选一：下滑积攒型不设冷却窗口，纯冷却型必须在 14-32s 区间
    // （上限 32 是 2026-10-04 人物改版定稿：穿梭时空 25s、捧腹大笑 30s）
    if (l.skill.chargeSlides > 0) {
      assert.ok(l.skill.chargeSlides >= 5 && l.skill.chargeSlides <= 20,
        `${c.id} 下滑积攒门槛应在 5-20 次，实际 ${l.skill.chargeSlides}`);
    } else {
      assert.ok(l.skill.cooldownS >= 14 && l.skill.cooldownS <= 32,
        `${c.id} 技能冷却应在 14-32s，实际 ${l.skill.cooldownS}`);
    }
  }
});

test('被动天赋在开局即生效（run_start 触发）', () => {
  const cases = {
    char_volt: s => assert.equal(s.fx.coinPct, 5, '小电：金币 +5%'),
    char_ama: s => assert.equal(s.fx.buffPct, 15, '阿玛拉：道具时长 +15%'),
    char_kaze: s => assert.equal(s.fx.slideAddS, 0.2, '风剃：滑铲 +0.2s'),
    char_rina: s => assert.equal(s.fx.shieldLayers, 1, '莉娜：开局 1 层护盾'),
    char_bolt: s => assert.equal(s.fx.buffAddS, 2, '时空行者：道具时长 +2s'),
    char_mambo: s => assert.equal(s.fx.duckPass, true, '曼波：身高优势常驻'),
    // 周期被动（奶蛙弹跳之力 / 阿牛蛮牛冲撞）第一步才真正挂上子效果，见各自用例
    char_frog: s => assert.ok(s.buffs.left('periodic') > 0, '奶蛙：周期被动应登记为永久槽位'),
    char_niu: s => assert.ok(s.buffs.left('periodic') > 0, '阿牛：周期被动应登记为永久槽位'),
  };
  for (const [id, check] of Object.entries(cases)) {
    const sim = new RunnerSim(content, SIM_SEED(), id);
    check(sim);
  }
});

test('纯冷却释放：开局第 0 秒技能即亮，不再需要跑里程攒能量', () => {
  for (const id of ['char_volt', 'char_ama', 'char_bolt']) {
    const sim = new RunnerSim(content, SIM_SEED(), id);
    assert.equal(sim.canCastSkill(), true, `${id} 开局应可直接释放（充能已移除）`);
    assert.equal(sim.state.skillCd, 0);
  }
});

test('释放技能：进入冷却、计入次数与 perSkillCast 加分', () => {
  const sim = new RunnerSim(content, SIM_SEED(), 'char_volt');
  run(sim, 8); // 越过新手保护窗口，避免保护期吞掉后续判定
  assert.equal(sim.canCastSkill(), true);
  const scoreBefore = sim.state.score;
  sim.applyAction('skill');
  assert.equal(sim.state.casts, 1);
  assert.equal(sim.state.skillCd > 0, true, '释放后应进入冷却');
  assert.ok(Math.abs(sim.state.skillCd - sim.loadout.skill.cooldownS) < 0.01, '冷却应开始计时');
  assert.equal(sim.canCastSkill(), false, '冷却中不可再次释放');
  sim.step(); // score 是 step 里派生的，释放后走一步才会体现加分
  assert.ok(sim.state.score - scoreBefore >= 150, `应含 perSkillCast 加分，实际 +${sim.state.score - scoreBefore}`);
  const seen = new Set();
  for (let i = 0; i < 20; i++) { sim.step(); for (const e of sim.drainEvents()) seen.add(e.type); }
  assert.ok(seen.has('cast'), '应产生 cast 事件供渲染层表现');
});

test('时间延缓（时空行者）：道具持续时间按固定秒数拉长', () => {
  const plain = new RunnerSim(content, SIM_SEED(), 'char_volt');
  const slow = new RunnerSim(content, SIM_SEED(), 'char_bolt');
  const ctx = { distance: 0, lane: 0 };
  plain.buffs.add('jumpBoost', { durationS: 10, mul: 1.1 }, '弹跳鞋', ctx);
  slow.buffs.add('jumpBoost', { durationS: 10, mul: 1.1 }, '弹跳鞋', ctx);
  assert.ok(Math.abs(plain.buffs.left('jumpBoost') - 10) < 0.01, `无该被动仍 10s，实际 ${plain.buffs.left('jumpBoost')}`);
  assert.ok(Math.abs(slow.buffs.left('jumpBoost') - 12) < 0.01, `应拉长到 12s，实际 ${slow.buffs.left('jumpBoost')}`);
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

test('穿梭时空（时空行者）：瞬移 100 米并把沿途金币全部收走', () => {
  const sim = new RunnerSim(content, SIM_SEED(), 'char_bolt');
  run(sim, 8);
  const d0 = sim.state.distance, coins0 = sim.state.coins;
  const near = [
    { lane: -1, worldZ: d0 + 20 }, { lane: 0, worldZ: d0 + 60 }, { lane: 1, worldZ: d0 + 95 },
  ];
  const far = { lane: 0, worldZ: d0 + 200 }; // 100 米之外，不该被掠走
  sim.coinsArr.push(...near, far);
  sim.applyAction('skill');
  assert.ok(sim.state.distance - d0 >= 100 - 0.5, `应位移约 100 米，实际 ${(sim.state.distance - d0).toFixed(1)}`);
  assert.ok(near.every(c => c.taken), '沿途三枚金币应全部入手');
  assert.equal(far.taken, undefined, '100 米外的金币不该被收走');
  assert.ok(sim.state.coins - coins0 >= 3, `入账至少 3 枚，实际 +${sim.state.coins - coins0}`);
  assert.equal(sim.fx.invincible, true, '落点应带短无敌，避免瞬移终点正卡在障碍里当场判负');
});

test('捧腹大笑（奶蛙）：10 秒无敌，期间撞墙不判负', () => {
  const sim = new RunnerSim(content, SIM_SEED(), 'char_frog');
  sim.state.t = 20;
  sim.applyAction('skill');
  assert.equal(sim.fx.invincible, true);
  assert.ok(Math.abs(sim.buffs.left('invincible') - 10) < 0.01, `无敌应 10 秒，实际 ${sim.buffs.left('invincible')}`);
  sim.obstacles.length = 0;
  sim.obstacles.push({ obsRef: 't_full', cls: 'full', w: 2, h: 3.2, d: 0.8, lane: sim.state.lane, worldZ: sim.state.distance + 8 });
  run(sim, 3);
  assert.equal(sim.state.alive, true, '无敌期撞墙不应出局');
});

test('弹跳之力（奶蛙被动）：每 10 秒自动给一次强跳窗口，窗口过后进入空档', () => {
  const sim = new RunnerSim(content, SIM_SEED(), 'char_frog');
  // 逐帧清障：只验周期计时，别让中途死亡把 buff 时钟冻住
  const steps = (sec) => { for (let i = 0; i < 60 * sec; i++) { sim.obstacles.length = 0; sim.step(); sim.drainEvents(); } };
  steps(0.2); // 周期被动在第一步就触发
  assert.ok(sim.fx.bootsT > 0, '首个周期应已挂上强跳');
  assert.ok(Math.abs(sim.fx.jumpMul - 1.1) < 1e-9, `强跳倍率应读配置（弹跳鞋同值），实际 ${sim.fx.jumpMul}`);
  steps(3); // 2.5 秒窗口过后
  assert.equal(sim.fx.bootsT, 0, '窗口结束应失效');
  steps(7); // 累计约 10 秒 → 下一周期
  assert.ok(sim.fx.bootsT > 0, '下一个 10 秒周期应再次挂上');
});

test('曼波之力：主动下滑 10 次才亮，释放后计数归零', () => {
  const sim = new RunnerSim(content, SIM_SEED(), 'char_mambo');
  assert.equal(sim.canCastSkill(), false, '开局下滑次数为 0，技能不该亮');
  for (let i = 0; i < 9; i++) { sim.obstacles.length = 0; sim.applyAction('slide'); run(sim, 1); }
  assert.equal(sim.state.slideCount, 9);
  assert.equal(sim.canCastSkill(), false, '9 次还不够');
  sim.obstacles.length = 0;
  sim.applyAction('slide');
  run(sim, 1);
  assert.equal(sim.state.slideCount, 10);
  assert.equal(sim.canCastSkill(), true, '第 10 次下滑应解锁');
  sim.applyAction('skill');
  assert.equal(sim.state.slideCount, 0, '释放后积攒清零（不叠加）');
  assert.equal(sim.fx.slideGuardCharges, 2, '护体次数应读配置');
});

test('下滑护体（曼波）：滑行中穿过小型障碍，两次用尽后照常判负', () => {
  const sim = new RunnerSim(content, SIM_SEED(), 'char_mambo');
  sim.state.t = 20; // 越过新手保护，避免保护期替技能挡刀
  assert.equal(sim.state.alive, true);
  // 攒够 10 次下滑留给上一条用例，这里直接经引擎施加护体，只验消耗规则
  sim.buffs.add('slideGuard', { durationS: 12, charges: 2 }, '曼波之力', { distance: sim.state.distance, lane: sim.state.lane });
  const hitLow = () => {
    sim.obstacles.length = 0;
    sim.state.sliding = true;
    sim.state.slideT = 9;
    sim.state.invulnT = 0;
    sim.obstacles.push({ obsRef: 't_low', cls: 'low', w: 2, h: 1.2, d: 0.8, lane: sim.state.lane, worldZ: sim.state.distance + 4 });
    run(sim, 0.5);
  };
  hitLow();
  assert.equal(sim.state.alive, true, '第一次护体应挡下低障');
  assert.equal(sim.fx.slideGuardCharges, 1, '应消耗一次');
  hitLow();
  assert.equal(sim.state.alive, true, '第二次护体应挡下低障');
  assert.equal(sim.fx.slideGuardCharges, 0, '两次用尽');
  hitLow();
  assert.equal(sim.state.alive, false, '护体用尽后低障照常判负');
});

test('身高优势（曼波被动）：不下滑也能穿过高杆，满格墙仍挡死', () => {
  const sim = new RunnerSim(content, SIM_SEED(), 'char_mambo');
  sim.state.t = 20;
  sim.obstacles.length = 0;
  sim.obstacles.push({ obsRef: 't_high', cls: 'high', w: 2, h: 2.6, d: 0.8, lane: sim.state.lane, worldZ: sim.state.distance + 4 });
  run(sim, 0.5);
  assert.equal(sim.state.alive, true, '需下滑的高杆应直接穿过');
  sim.obstacles.length = 0;
  sim.obstacles.push({ obsRef: 't_full', cls: 'full', w: 2, h: 3.2, d: 0.8, lane: sim.state.lane, worldZ: sim.state.distance + 4 });
  run(sim, 0.5);
  assert.equal(sim.state.alive, false, '满格墙不在身高优势覆盖范围内');
});

test('妈妈救我（阿牛）：前方 50 米障碍全部消失，金币与道具箱原样保留', () => {
  const sim = new RunnerSim(content, SIM_SEED(), 'char_niu');
  const d0 = sim.state.distance;
  sim.obstacles.length = 0;
  sim.coinsArr.length = 0;
  sim.pickupsArr.length = 0;
  for (const [lane, ahead] of [[-1, 10], [0, 30], [1, 45], [0, 80]]) {
    sim.obstacles.push({ obsRef: 't_full', cls: 'full', w: 2, h: 3.2, d: 0.8, lane, worldZ: d0 + ahead });
  }
  sim.coinsArr.push({ lane: 0, worldZ: d0 + 25 });
  sim.pickupsArr.push({ itemRef: 'item_shield', lane: 0, worldZ: d0 + 35 });
  sim.applyAction('skill');
  assert.equal(sim.obstacles.length, 1, '50 米内三个障碍消失，只剩 80 米处那一个');
  assert.equal(sim.obstacles[0].worldZ, d0 + 80);
  assert.equal(sim.coinsArr.length, 1, '金币必须保留');
  assert.equal(sim.pickupsArr.length, 1, '道具箱必须保留');
});

test('蛮牛冲撞（阿牛被动）：每 20 秒自动提速，速度顶到地面 maxSpeed，无敌按配置里程到期', () => {
  const talent = content.skills.items.find(s => s.id === 'talent_niu_rush');
  const [speed, inv] = talent.effects[0].effects;
  const maxSpeed = content.game.params.runner.maxSpeed;
  assert.equal(speed.primitive, 'speedMul');
  assert.equal(inv.primitive, 'invincible');
  assert.equal(speed.distanceM, inv.distanceM, '提速与无敌同属一次冲撞，到期里程应一致');
  // mul 写成顶满上限所需的最小值：baseSpeed 12 × 2.2 已 ≥ maxSpeed，再大也只跑 maxSpeed（虚标）
  assert.ok(speed.mul * (content.game.params.runner.baseSpeed ?? 12) >= maxSpeed,
    `提速该顶到上限，实际 ${speed.mul} × baseSpeed 不够`);

  const sim = new RunnerSim(content, SIM_SEED(), 'char_niu');
  sim.obstacles.length = 0;
  sim.step(); sim.drainEvents(); // 周期被动在第一步触发，触发时里程仍为 0
  assert.equal(sim.fx.invincible, true, '第一个周期应触发冲撞');
  assert.ok(sim.fx.speedMul > 1, '冲撞期应提速');
  const d0 = sim.state.distance, t0 = sim.state.t;
  for (let i = 0; i < 30; i++) { sim.obstacles.length = 0; sim.step(); sim.drainEvents(); }
  const v = (sim.state.distance - d0) / (sim.state.t - t0);
  assert.ok(Math.abs(v - maxSpeed) < 0.5, `冲撞期实测速度应顶到 maxSpeed ${maxSpeed}，实际 ${v.toFixed(1)}`);
  let guard = 0;
  while (sim.fx.invincible && guard++ < 60 * 60) { sim.obstacles.length = 0; sim.step(); sim.drainEvents(); }
  assert.equal(sim.fx.invincible, false, '按里程到期后应解除');
  assert.ok(sim.state.distance >= speed.distanceM, `应跑满 ${speed.distanceM} 米才解除，实际 ${sim.state.distance.toFixed(1)}`);
  assert.ok(sim.state.distance < speed.distanceM + 1, `解除不应明显拖过 ${speed.distanceM} 米，实际 ${sim.state.distance.toFixed(1)}`);
  assert.equal(sim.fx.speedMul, 1, '提速与无敌同属一次冲撞，应一起结束');
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
  assert.equal(buildLoadout(content, 'char_bolt').modelScale, 1.05, '时空行者应比小电高 5%');

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
