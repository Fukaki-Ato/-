/**
 * M2 道具批次二测试：安全头盔 / 飞行器（含滑翔降落与空中段生成）
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RunnerSim } from '../packages/game/dist/core/sim/runnerSim.js';
import { hashSeed } from '../packages/game/dist/core/rng.js';

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
function wall(sim, cls, lane, aheadM) {
  sim.obstacles.push({ obsRef: 't_' + cls, cls, w: 2, h: cls === 'high' ? 2.6 : 3.2, d: 0.8, lane, worldZ: sim.state.distance + aheadM });
}
/** buff 由效果引擎掌管（docs/09 T2.2）：施加走公开入口，fly 会同时申请空中段 */
function grant(sim, primitive, params) {
  sim.buffs.add(primitive, params, primitive, { distance: sim.state.distance, lane: sim.state.lane });
}
function runPast(sim, steps) {
  const seen = new Set();
  for (let i = 0; i < steps; i++) { sim.step(); for (const e of sim.events) seen.add(e.type); }
  return seen;
}

test('头盔：20 秒窗口挡下致命一击（计数回退、头盔消失、人活着），下次致命击正常出局', () => {
  const sim = cleanSim(51);
  sim.state.t = 20; // 越过新手保护窗口
  grant(sim, 'lifeAdd', { durationS: 20 });
  wall(sim, 'full', 0, 10);
  const seen1 = runPast(sim, 90);
  assert.ok(seen1.has('helmetSave'), '应触发头盔挡刀');
  assert.ok(seen1.has('hit'));
  assert.equal(sim.state.alive, true);
  assert.equal(sim.state.hits, 0, '挡刀后受击计数应回退');
  assert.equal(sim.fx.helmetT, 0, '头盔已消耗');
  sim.obstacles.length = 0;
  wall(sim, 'full', 0, 30); // 拉远距离，避开挡刀后的无敌帧
  const seen2 = runPast(sim, 60 * 4);
  assert.ok(seen2.has('death'));
  assert.equal(sim.state.alive, false);
});

test('头盔超时自动失效：20 秒后不再挡刀', () => {
  const sim = cleanSim(52);
  sim.state.t = 20;
  grant(sim, 'lifeAdd', { durationS: 0.5 }); // 即将过期
  for (let i = 0; i < 60; i++) sim.step(); // 1 秒后头盔已消失
  assert.equal(sim.fx.helmetT, 0);
  sim.obstacles.length = 0;
  wall(sim, 'full', 0, 10);
  const seen = runPast(sim, 90);
  assert.ok(seen.has('death'), '无头盔保护，致命击应出局');
});

test('飞行器：升至 4.6 米悬停、速度 2.5 倍、地面障碍保留（从上方掠过）、空中有金币带与云', () => {
  const sim = cleanSim(53);
  wall(sim, 'full', 0, 60); // 前方 60m 的墙：飞行从上方掠过（不再整段清空，用户要求可俯瞰地面内容）
  sim.pickupsArr.push({ itemRef: 'item_jetpack', lane: 0, worldZ: sim.state.distance + 8 });
  const seen = new Set();
  let maxSpeedPerStep = 0;
  for (let i = 0; i < 60 * 6; i++) {
    const d0 = sim.state.distance;
    sim.step();
    maxSpeedPerStep = Math.max(maxSpeedPerStep, sim.state.distance - d0);
    for (const e of sim.events) seen.add(e.type);
  }
  assert.ok(seen.has('pickup'));
  assert.ok(sim.fx.flyT > 0, '6 秒后仍在飞行期(13s)');
  assert.ok(sim.state.y > 4.0, `飞行高度应接近 4.6，实际 ${sim.state.y.toFixed(2)}`);
  assert.ok(sim.state.y <= 4.75, '不能飞太高');
  assert.ok(maxSpeedPerStep * 60 > 12 * 2.5 * 0.8, '速度应接近地面 2.5 倍');
  assert.ok(sim.obstacles.some(o => o.worldZ > sim.state.distance), '飞行期地面障碍应保留并继续生成');
  const skyCoins = sim.coinsArr.filter(c => (c.y ?? 0) > 3);
  assert.ok(skyCoins.length > 30, `空中金币带数量=${skyCoins.length}，应明显更多`);
  assert.ok(sim.cloudsArr.length >= 3, '应有云团');
});

test('飞行器到期：进入滑翔降落，滑翔中可换道，最终平稳落地', () => {
  const sim = cleanSim(54);
  grant(sim, 'fly', { durationS: 0.5 }); // 快速进入到期场景
  for (let i = 0; i < 60; i++) sim.step(); // 0.5s 后燃料耗尽
  assert.equal(sim.fx.flyT, 0);
  assert.ok(sim.state.gliding, '应进入滑翔');
  sim.applyAction('laneL'); sim.step();
  assert.equal(sim.state.lane, -1, '滑翔中可变向');
  const yBefore = sim.state.y;
  for (let i = 0; i < 60 * 2; i++) sim.step();
  assert.ok(sim.state.y < yBefore, '滑翔应持续下降');
  assert.ok(!sim.state.gliding && sim.state.y === 0, '2 秒内应落地(glideS=1.8s)');
  assert.equal(sim.state.alive, true);
});

test('飞行期间跳/铲输入被忽略，落地后恢复', () => {
  const sim = cleanSim(55);
  grant(sim, 'fly', { durationS: 5 });
  sim.applyAction('jump'); sim.step();
  const yFly = sim.state.y;
  assert.ok(yFly < 1.5, '飞行中跳不应叠加弹道');
  for (let i = 0; i < 60 * 8; i++) sim.step(); // 等燃料(5s)+滑翔(1.8s)全部结束
  assert.equal(sim.state.gliding, false);
  sim.applyAction('jump'); sim.step();
  assert.ok(sim.state.vy > 10, '落地后跳跃应恢复');
});

test('空中禁吃地面金币：飞行高度掠过同车道地面金币不计入', () => {
  const sim = cleanSim(56);
  grant(sim, 'fly', { durationS: 13 });
  for (let i = 0; i < 40; i++) sim.step(); // 升到 4.6 米
  const ground = { lane: sim.state.lane, worldZ: sim.state.distance + 20 }; // 地面金币（无 y=默认 0.65）
  sim.coinsArr.push(ground);
  for (let i = 0; i < 60 * 3; i++) sim.step(); // 飞过该金币
  assert.ok(!ground.taken, '飞行中不应吃到地面金币');
});

test('空中段落地后：障碍尽快恢复，不留长空窗', () => {
  const sim = new RunnerSim(content, 61);
  grant(sim, 'fly', { durationS: 2 }); // 短飞行
  let landedAt = -1;
  for (let i = 0; i < 60 * 40 && landedAt < 0; i++) {
    sim.step();
    if (sim.state.t > 3 && !sim.state.gliding && sim.fx.flyT === 0 && sim.state.y === 0) landedAt = sim.state.distance;
  }
  assert.ok(landedAt > 0, '应在 40 秒内落地');
  // 落地缓冲(30m)之后 160m 内应重新出现障碍
  const ahead = sim.obstacles.filter(o => o.worldZ > landedAt + 40 && o.worldZ < landedAt + 200);
  assert.ok(ahead.length >= 2, `落地后 160m 内障碍数=${ahead.length}，恢复过慢`);
});

test('seed 复现：同 seed 同输入（含道具）整局摘要一致', () => {
  const play = () => {
    const sim = new RunnerSim(content, hashSeed('repro'));
    for (let i = 0; i < 60 * 30; i++) {
      if (i % 37 === 0) sim.applyAction('jump');
      if (i % 53 === 0) sim.applyAction('slide');
      if (i % 91 === 0) sim.applyAction(i % 182 === 0 ? 'laneL' : 'laneR');
      sim.step();
    }
    return sim.summary();
  };
  assert.deepEqual(play(), play());
});
