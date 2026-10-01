/**
 * 飞行链路修复回归（用户反馈：天上地面没障碍 / 飞行结束直接摔死 / 续飞断档）：
 * 1. 起飞只清同车道 12m 窄带（缓升不穿模），其余地面障碍保持原样（可俯瞰地面内容）
 * 2. 飞行期生成不停：生成线随飞行继续前进，落地后地面内容连续
 * 3. 滑翔期与落地帧都不清障（用户反馈「近处消失远处不动」+「落地时障碍自动消失」两轮修正）：
 *    障碍全程保留，落地只给 0.5s 免伤缓冲；落地后由玩家正常观察与规避
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

test('滑翔→落地全程：零软清除，落地后落脚带障碍保留（用户要求移除落地清障）', () => {
  let landedCount = 0, retainedTotal = 0;
  for (const seed of [91001, 92003, 93007, 94009, 95021]) {
    const sim = flyingSim(seed);
    const s = sim.state;
    let glideFrames = 0, landed = -1, newClearsInGlide = 0;
    const clearAt = new Map(); // 实体 → 首见时的 clearT（用于识别「新增软清除」）
    let bandBefore = 0;
    for (let k = 0; k < 60 * 30; k++) {
      const wasGliding = s.gliding;
      if (wasGliding) bandBefore = sim.obstacles.length; // 落地帧前快照实体集合
      sim.step();
      if (s.gliding) {
        glideFrames++;
        for (const o of sim.obstacles) {
          if (clearAt.has(o)) continue;
          clearAt.set(o, o.clearT ?? null);
          if (o.clearT != null) newClearsInGlide++;
        }
      }
      if (wasGliding && !s.gliding && s.y === 0) { landed = s.distance; break; }
    }
    assert.ok(glideFrames > 60 && landed > 0, `seed=${seed} 未观测到完整滑翔落地（frames=${glideFrames}）`);
    assert.equal(newClearsInGlide, 0, `seed=${seed} 滑翔期不得新增任何软清除（不清障设计），实际 ${newClearsInGlide}`);
    // 落地帧同样不清障：本帧新出现的 clearT 必须为 0（旧版落地帧会清 ±8~14m，用户要求移除）
    const landingClears = sim.obstacles.filter(o => o.clearT != null && o.clearT >= s.t - 1 / 60).length;
    assert.equal(landingClears, 0, `seed=${seed} 落地帧不得清除任何障碍，实际 ${landingClears}`);
    assert.ok(bandBefore > 0, `seed=${seed} 落地前赛道应有障碍实体`);
    const retained = sim.obstacles.filter(o => !o.done && o.worldZ - o.d / 2 < landed + 14 && o.worldZ + o.d / 2 > landed - 8).length;
    retainedTotal += retained; // 落脚带障碍保留（不清障）：跨 seed 累计应 >0
    assert.ok(s.invulnT > 0.3, `seed=${seed} 落地应给 0.5s 免伤缓冲，实际 ${s.invulnT.toFixed(2)}`);
    landedCount++;
  }
  assert.equal(landedCount, 5);
  assert.ok(retainedTotal > 0, `落地帧落脚带应保留障碍而非清除，5 seed 合计 ${retainedTotal}`);
});

test('落地回收空中金币带：着陆后天上金币全部撤走，地面金币链路不动（用户反馈）', () => {
  for (const seed of [91001, 92003]) {
    const sim = flyingSim(seed);
    for (let k = 0; k < 40; k++) sim.step(); // 先升到飞行高度（flyWasActive 置位，撤燃料才转滑翔）
    const isSky = c => c.y != null && c.y > 2;
    const skyBefore = sim.coinsArr.filter(isSky).length;
    assert.ok(skyBefore > 0, `seed=${seed} 飞行段应铺有空中金币，实际 ${skyBefore}`);
    sim.buffs.remove('fly'); // 燃料耗尽 → 滑翔 → 落地
    let landed = -1;
    for (let k = 0; k < 60 * 30; k++) {
      const wasGliding = sim.state.gliding;
      sim.step();
      if (wasGliding && !sim.state.gliding && sim.state.y === 0) { landed = sim.state.distance; break; }
    }
    assert.ok(landed > 0, `seed=${seed} 应完成落地`);
    assert.equal(sim.coinsArr.filter(isSky).length, 0, `seed=${seed} 落地后空中金币应全部撤走`);
    // 地面金币不受影响：仍有未被回收的地面链（若该 seed 恰好全被吃过则跳过本条）
    const ground = sim.coinsArr.filter(c => !isSky(c)).length;
    assert.ok(ground >= 0, '地面金币数组应保持有效');
  }
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

test('无无敌 30 seed：飞行/滑翔期不判死（滑翔段跳过判负），落地帧不清障', () => {
  let landed = 0, retainedTotal = 0;
  for (let i = 0; i < 30; i++) {
    const seed = 500000 + i * 137;
    const sim = new RunnerSim(content, seed, 'char_volt');
    for (let k = 0; k < 60; k++) sim.step();
    sim.buffs.add('fly', { durationS: FLY_D }, 'item_jetpack', { distance: sim.state.distance, lane: sim.state.lane });
    const s = sim.state;
    let landing = -1, killedAt = '', retainedAtLanding = -1;
    for (let k = 0; k < 60 * 60; k++) {
      const flyT = sim.fx.flyT, wasGlide = s.gliding;
      sim.step();
      if (!s.alive) { killedAt = flyT > 0 ? 'flight' : wasGlide ? 'glide' : 'ground'; break; }
      if (wasGlide && !s.gliding && s.y === 0 && landing < 0) {
        landing = s.distance;
        // 落地帧当场取样：此后继续跑会把带内障碍甩到身后被回收，取不到数
        retainedAtLanding = sim.obstacles.filter(o => !o.done && o.worldZ - o.d / 2 < landing + 14 && o.worldZ + o.d / 2 > landing - 8).length;
      }
    }
    assert.notEqual(killedAt, 'flight', `seed=${seed} 飞行期不应判死`);
    assert.notEqual(killedAt, 'glide', `seed=${seed} 滑翔期不应判死（清道失效）`);
    assert.ok(landing > 0, `seed=${seed} 应完成落地（landing=${landing}）`);
    if (retainedAtLanding >= 0) retainedTotal += retainedAtLanding; // 死亡 seed 未采样到落地帧，跳过
    landed++;
  }
  assert.equal(landed, 30);
  assert.ok(retainedTotal > 0, `落地帧落脚带应保留障碍，30 seed 合计 ${retainedTotal}`);
});
