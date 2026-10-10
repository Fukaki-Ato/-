/**
 * 马耳女仆 char_pony 接入 + 「矮」被动（角色净空 clearance）回归。
 *
 * 背景：碰撞判定原本硬编码 playerH = sliding ? 0.7 : 1.7（collision.ts），角色身高不参与
 * 净空判定——接入 char_pony 后它并不会获得「不用滑铲就能过滑铲挡板」的优势。
 * 本批次把站立净空高改成 per-character 配置（characters.json clearance，缺省 STAND_H=1.7），
 * 高杆门 obs_gate_low 的判定改读它：
 *   - char_pony 净空 1.19 < 横杆下沿 BAR_BOTTOM 1.2 → 站立可直接钻过（tagline「矮个也能直接过挡板」）
 *   - 其余角色净空 ≥1.52 > 1.2 → 站立仍然被挡，必须滑铲（行为与改动前逐字节一致）
 *   - 滑铲净空 SLIDE_H 0.7 所有角色统一（滑铲是姿态不是身高）
 *
 * 为什么 pony 取 1.19 而非建模侧建议的 1.31：实测资产头 mesh 顶 1.18m、贝雷帽 1.301m、
 * 马耳 1.267m，而横杆下沿 1.2m——按 1.31 直接替换站立仍会被挡（1.31 > 1.2），验收不过。
 * 取「头部以下身体净空」1.18 + 0.01 余量；帽/耳超过横杆的部分视为装饰不参与碰撞
 * （站立钻杆时视觉插杆 6.7~10.1cm，属资产侧已知取舍）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RunnerSim } from '../packages/game/dist/core/sim/runnerSim.js';
import { buildLoadout, playableCharacters } from '../packages/game/dist/core/sim/character.js';
import { hitsRunner } from '../packages/game/dist/core/sim/collision.js';
import { BAR_BOTTOM, SLIDE_H, STAND_H } from '../packages/game/dist/core/sim/simTypes.js';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const NAMES = ['game', 'characters', 'skills', 'items', 'obstacles', 'themes', 'events', 'economy'];
const content = Object.fromEntries(NAMES.map(n => [n, JSON.parse(readFileSync(join(root, 'config', `${n}.json`), 'utf8'))]));

/** 滑铲门（obs_gate_low：class=high，size 2×2.6×0.6，杆体占 1.2~2.6m） */
const GATE = { obsRef: 'obs_gate_low', cls: 'high', w: 2, h: 2.6, d: 0.6, lane: 0, worldZ: 0 };
const runner = (y, sliding = false) => ({ x: 0, y, sliding, t: 0 });

test('loadout.clearance：按配置读数，缺省回落 STAND_H', () => {
  assert.equal(STAND_H, 1.7);
  assert.equal(SLIDE_H, 0.7);
  assert.equal(BAR_BOTTOM, 1.2);
  // 马耳女仆：头 mesh 顶实测 1.18 + 0.01 余量（< BAR_BOTTOM 才能站立钻杆）
  assert.equal(buildLoadout(content, 'char_pony').clearance, 1.19);
  // 老角色：显式值均 > BAR_BOTTOM，站立行为与硬编码 1.7 时代一致
  assert.equal(buildLoadout(content, 'char_whale').clearance, 1.52);
  assert.equal(buildLoadout(content, 'char_bball').clearance, 1.70);
  assert.equal(buildLoadout(content, 'char_nailong').clearance, 1.70);
  // 无 clearance 字段的角色（程序化模型/未交付 GLB 的 rina、bolt）回落标准身高
  for (const id of ['char_volt', 'char_ama', 'char_kaze', 'char_rina', 'char_bolt']) {
    assert.equal(buildLoadout(content, id).clearance, STAND_H, `${id} 应回落 ${STAND_H}`);
  }
  // 找不到角色 → 空装备也带默认净空（sim 的 EMPTY_LOADOUT 路径）
  assert.equal(buildLoadout(content, 'char_nope').clearance, STAND_H);
});

test('高杆门判定矩阵：矮个站立可钻、其余站立被挡、全员滑铲可过、越顶可过', () => {
  // 站立：净空 ≤ 横杆下沿才过得去
  assert.equal(hitsRunner(GATE, runner(0), 2.2, 1.19), false, 'char_pony（1.19<1.2）站立应直接钻过');
  assert.equal(hitsRunner(GATE, runner(0), 2.2, 1.2), false, '净空恰好等于横杆下沿也算过（不大于）');
  assert.equal(hitsRunner(GATE, runner(0), 2.2, 1.21), true, '净空高出杆沿 1cm 即判中');
  assert.equal(hitsRunner(GATE, runner(0), 2.2, 1.52), true, '鲸鱼女仆站立必须被挡');
  assert.equal(hitsRunner(GATE, runner(0), 2.2, 1.7), true, '标准身高站立必须被挡（老行为）');
  // 滑铲：任何净空都过得去（SLIDE_H 0.7 < 1.2）
  for (const c of [1.19, 1.52, 1.7]) {
    assert.equal(hitsRunner(GATE, runner(0, true), 2.2, c), false, `滑铲（净空 ${c}）应从杆下通过`);
  }
  // 越顶：y ≥ 杆顶 2.6 仍可过（弹跳鞋路径不受净空改动影响）
  assert.equal(hitsRunner(GATE, runner(2.9), 2.2, 1.7), false, '弹跳鞋顶点越杆不受影响');
  assert.equal(hitsRunner(GATE, runner(2.4), 2.2, 1.7), true, '赤脚跳顶点 2.4 < 2.6 仍判中');
  // 防呆：脏数据回落标准身高，绝不让碰撞判定因坏字段失效
  assert.equal(hitsRunner(GATE, runner(0), 2.2, NaN), true, 'NaN 净空回落 1.7 → 被挡');
  assert.equal(hitsRunner(GATE, runner(0), 2.2, 0), true, '非正净空回落 1.7 → 被挡');
  assert.equal(hitsRunner(GATE, runner(0), 2.2, -3), true, '负净空回落 1.7 → 被挡');
  // 不传第 4 参（旧调用点/测试）行为不变
  assert.equal(hitsRunner(GATE, runner(0), 2.2), true, '缺省净空=STAND_H，老调用点行为不变');
});

/** 隔离变量的 sim 差分：只在车道 0 注入一座滑铲门，零输入直冲 */
function gateSim(charId) {
  const sim = new RunnerSim(content, 4242, charId);
  sim.state.t = 20; // 越过新手保护（protectionS 15s）
  sim.obstacles.length = 0;
  sim.coinsArr.length = 0;
  sim.pickupsArr.length = 0;
  sim.cloudsArr.length = 0;
  const gate = { obsRef: 'obs_gate_low', cls: 'high', w: 2, h: 2.6, d: 0.6, lane: 0, worldZ: sim.state.distance + 40 };
  sim.obstacles.push(gate);
  for (let i = 0; i < 60 * 8 && sim.state.alive; i++) {
    // 每帧只保留注入的门：清掉赛道生成物，确保死的（如果有）只能是这座门
    sim.obstacles.length = 0;
    sim.obstacles.push(gate);
    sim.step();
  }
  return { sim, gate };
}

test('sim 差分：char_pony 零输入站立冲过滑铲门；对照角色同一时点被挡死', () => {
  const pony = gateSim('char_pony');
  assert.ok(pony.sim.state.alive, 'char_pony 应活着（站立钻过滑铲门）');
  assert.ok(pony.sim.state.distance > pony.gate.worldZ + 1,
    `应已越过门（dist=${pony.sim.state.distance.toFixed(1)} > ${pony.gate.worldZ + 1}）`);
  assert.equal(pony.sim.state.hits, 0, '全程不应受击');

  for (const id of ['char_whale', 'char_bball', 'char_volt']) {
    const ctrl = gateSim(id);
    assert.ok(!ctrl.sim.state.alive, `${id} 站立冲滑铲门应被挡死`);
    assert.ok(ctrl.sim.state.distance < ctrl.gate.worldZ + 2,
      `${id} 应停在门处（dist=${ctrl.sim.state.distance.toFixed(1)}，门 z=${ctrl.gate.worldZ}）`);
  }
});

test('sim 差分：char_pony 滑铲同样能过（净空被动不破坏滑铲路径）', () => {
  const sim = new RunnerSim(content, 4242, 'char_pony');
  sim.state.t = 20;
  sim.obstacles.length = 0; sim.coinsArr.length = 0; sim.pickupsArr.length = 0; sim.cloudsArr.length = 0;
  const gate = { obsRef: 'obs_gate_low', cls: 'high', w: 2, h: 2.6, d: 0.6, lane: 0, worldZ: sim.state.distance + 40 };
  sim.obstacles.push(gate);
  let slid = false;
  for (let i = 0; i < 60 * 8 && sim.state.alive; i++) {
    sim.obstacles.length = 0;
    sim.obstacles.push(gate);
    const gap = gate.worldZ - sim.state.distance;
    if (!slid && gap <= 3 && gap > 0.5) { sim.applyAction('slide'); slid = true; }
    sim.step();
  }
  assert.ok(slid, '应触发过滑铲');
  assert.ok(sim.state.alive, 'char_pony 滑铲也应能过');
});
