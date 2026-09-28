/**
 * 飞行链路修复回归（用户反馈：天上地面没障碍 / 飞行结束直接摔死 / 续飞断档）：
 * 1. 起飞只清同车道 12m 窄带（缓升不穿模），其余地面障碍保持原样（可俯瞰地面内容）
 * 2. 飞行期生成不停：生成线随飞行继续前进，落地后地面内容连续
 * 3. 滑翔着陆走廊：下滑路径（剩余时长×速度+余量）内无障碍；落地帧前方 30m 净空
 * 4. 续飞延展：飞行中再吃飞行道具，空中金币/云团补铺到新的终点之后
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RunnerSim } from '../packages/game/dist/core/sim/runnerSim.js';
import { FLY_SPEED_CAP } from '../packages/game/dist/core/sim/simTypes.js';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const NAMES = ['game', 'characters', 'skills', 'items', 'obstacles', 'themes', 'events', 'economy'];
const content = Object.fromEntries(NAMES.map(n => [n, JSON.parse(readFileSync(join(root, 'config', `${n}.json`), 'utf8'))]));
const flight = content.game.params.flight;
const fallMps = flight.heightM / flight.glideS;
const FLY_D = 13; // item_jetpack durationS

function flyingSim(seed) {
  const sim = new RunnerSim(content, seed, 'char_volt');
  sim.state.invulnT = 1e9; // 只测飞行链路不变量：屏蔽死亡
  for (let k = 0; k < 60; k++) sim.step(); // 1s 起步
  sim.buffs.add('fly', { durationS: FLY_D }, 'item_jetpack', { distance: sim.state.distance, lane: sim.state.lane });
  return sim;
}

test('起飞不清场：地面障碍保持原样，且飞行期间生成线继续前进', () => {
  for (const seed of [91001, 92003, 93007]) {
    const sim = flyingSim(seed);
    const s = sim.state;
    const countAhead = () => sim.obstacles.filter(o => o.worldZ > s.distance && o.worldZ < s.distance + 320).length;
    const before = countAhead();
    assert.ok(before > 0, `seed=${seed} 起飞前前方 320m 应有障碍，实际 ${before}`);
    sim.step();
    assert.ok(sim.fx.flyT > 0, `seed=${seed} 应进入飞行`);
    assert.equal(countAhead(), before, `seed=${seed} 起飞不应清空地面障碍`);
    const genZ0 = sim.gen.genZ, d0 = s.distance;
    for (let k = 0; k < 600; k++) sim.step(); // 10s 飞行
    assert.ok(sim.fx.flyT > 0, `seed=${seed} 10s 后仍应在飞`);
    const flew = s.distance - d0;
    assert.ok(flew > 250, `seed=${seed} 10s 飞行距离异常：${flew.toFixed(0)}m`);
    assert.ok(sim.gen.genZ > genZ0 + 40, `seed=${seed} 飞行期生成线应随飞行前进（genZ ${genZ0}→${sim.gen.genZ}，飞了 ${flew.toFixed(0)}m）`);
    const aheadAfter = sim.obstacles.filter(o => o.worldZ > s.distance && o.worldZ < s.distance + 320).length;
    assert.ok(aheadAfter > 0, `seed=${seed} 飞行中前方地面应仍有障碍，实际 ${aheadAfter}`);
  }
});

test('起飞窄带：同车道前方 12m 清空、更远与其他车道保留（缓升不穿模）', () => {
  const sim = new RunnerSim(content, 91001, 'char_volt');
  sim.state.invulnT = 1e9;
  for (let k = 0; k < 60; k++) sim.step();
  const s = sim.state;
  const lane = s.lane, other = lane === 0 ? 1 : 0;
  const mk = (laneNo, worldZ) => ({ obsRef: 't_probe', cls: 'full', w: 2, h: 2.6, d: 0.8, lane: laneNo, worldZ });
  const near = mk(lane, s.distance + 6), far = mk(lane, s.distance + 26), side = mk(other, s.distance + 6);
  sim.obstacles.push(near, far, side);
  sim.buffs.add('fly', { durationS: FLY_D }, 'item_jetpack', { distance: s.distance, lane });
  assert.ok(!sim.obstacles.includes(near), '同车道 6m 障碍应被起飞窄带清除');
  assert.ok(sim.obstacles.includes(far), '同车道 26m 障碍应保留');
  assert.ok(sim.obstacles.includes(side), '其他车道障碍应保留（只清玩家跑道）');
});

test('滑翔着陆走廊：下滑路径无障碍，落地帧前方 30m 净空', () => {
  let landedCount = 0;
  for (const seed of [91001, 92003, 93007, 94009, 95021]) {
    const sim = flyingSim(seed);
    const s = sim.state;
    let glideFrames = 0, landed = -1;
    for (let k = 0; k < 60 * 30; k++) {
      const wasGliding = s.gliding;
      sim.step();
      if (s.gliding) {
        glideFrames++;
        const speed = (s.distance - s.prevDistance) * 60;
        const reach = (s.y / fallMps) * speed + 20; // 略小于实现的 26m 余量
        const inPath = sim.obstacles.filter(o => (o.worldZ - s.distance) > -o.d / 2 && (o.worldZ - s.distance) < reach + o.d / 2);
        assert.equal(inPath.length, 0,
          `seed=${seed} 滑翔路径被障碍占据：${inPath.map(o => `${o.obsRef}@+${(o.worldZ - s.distance).toFixed(1)}m`).join(' ')}（y=${s.y.toFixed(2)}）`);
      }
      if (wasGliding && !s.gliding && s.y === 0) { landed = s.distance; break; }
    }
    assert.ok(glideFrames > 60 && landed > 0, `seed=${seed} 未观测到完整滑翔落地（frames=${glideFrames}）`);
    const blockAhead = sim.obstacles.filter(o => o.worldZ > landed && o.worldZ < landed + 30).length;
    assert.equal(blockAhead, 0, `seed=${seed} 落地帧前方 30m 应净空，实际 ${blockAhead}`);
    landedCount++;
  }
  assert.equal(landedCount, 5);
});

test('续飞延展：飞行中再吃飞行道具，金币带/云团补铺到首段终点之后', () => {
  for (const seed of [91001, 92003]) {
    const sim = flyingSim(seed);
    const s = sim.state;
    const takeoff = s.distance;
    const firstEnd = takeoff + FLY_D * FLY_SPEED_CAP + 70;
    for (let k = 0; k < 120; k++) sim.step(); // 飞 2s 后续时
    sim.buffs.add('fly', { durationS: FLY_D }, 'item_jetpack', { distance: s.distance, lane: s.lane });
    sim.step();
    assert.ok(sim.fx.flyT > FLY_D - 1, `seed=${seed} 续时应刷新飞行剩余时间`);
    const skyCoinsBeyond = sim.coinsArr.filter(c => c.y != null && c.y > 3 && c.worldZ > firstEnd).length;
    assert.ok(skyCoinsBeyond > 0, `seed=${seed} 续时后首段终点之外应有空中金币，实际 ${skyCoinsBeyond}`);
    const cloudsBeyond = sim.cloudsArr.filter(c => c.worldZ > firstEnd).length;
    assert.ok(cloudsBeyond > 0, `seed=${seed} 续时后首段终点之外应有云团，实际 ${cloudsBeyond}`);
  }
});

test('无无敌 30 seed：飞行/滑翔期不判死，落地后清空带 ≥40m', () => {
  let landed = 0;
  for (let i = 0; i < 30; i++) {
    const seed = 500000 + i * 137;
    const sim = new RunnerSim(content, seed, 'char_volt');
    for (let k = 0; k < 60; k++) sim.step();
    sim.buffs.add('fly', { durationS: FLY_D }, 'item_jetpack', { distance: sim.state.distance, lane: sim.state.lane });
    const s = sim.state;
    let landing = -1, killedAt = '';
    for (let k = 0; k < 60 * 60; k++) {
      const flyT = sim.fx.flyT, wasGlide = s.gliding;
      sim.step();
      if (!s.alive) { killedAt = flyT > 0 ? 'flight' : wasGlide ? 'glide' : 'ground'; break; }
      if (wasGlide && !s.gliding && s.y === 0 && landing < 0) landing = s.distance;
    }
    assert.notEqual(killedAt, 'flight', `seed=${seed} 飞行期不应判死`);
    assert.notEqual(killedAt, 'glide', `seed=${seed} 滑翔期不应判死（清道失效）`);
    assert.ok(landing > 0, `seed=${seed} 应完成落地（landing=${landing}）`);
    if (killedAt === 'ground') {
      assert.ok(s.distance - landing >= 40, `seed=${seed} 落地净空带应 ≥40m，实际 ${(s.distance - landing).toFixed(1)}m`);
    }
    landed++;
  }
  assert.equal(landed, 30);
});
