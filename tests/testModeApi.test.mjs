/**
 * 测试模式 API 回归（用户要求：左侧技能开关面板）：
 * 定义全部来自配置、开关语义 = 施加/移除原语、瞬时技能走引擎同一入口。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RunnerSim } from '../packages/game/dist/core/sim/runnerSim.js';
import { installTestApi, uninstallTestApi } from '../packages/game/dist/flow/testApi.js';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const content = {};
for (const n of ['game', 'characters', 'skills', 'items', 'obstacles', 'themes', 'events', 'economy']) {
  content[n] = JSON.parse(readFileSync(join(root, 'config', `${n}.json`), 'utf8'));
}

function setup() {
  const sim = new RunnerSim(content, 4242, 'char_volt');
  for (let k = 0; k < 60; k++) sim.step();
  installTestApi(sim, content);
  return sim;
}

test('面板定义来自配置：开关项覆盖主要原语，且带中文名与分组', () => {
  const sim = setup();
  const api = (globalThis).__trTest;
  const prims = api.toggles().map(t => t.primitive);
  for (const p of ['fly', 'jumpBoost', 'shieldAdd', 'magnet', 'invincible', 'speedMul']) {
    assert.ok(prims.includes(p), `面板应包含 ${p}`);
  }
  assert.ok(api.toggles().every(t => t.label && t.group), '每项都应有中文名与分组');
  assert.ok(api.actions().length >= 1, '至少一个一次性技能');
  const fly = api.toggles().find(t => t.primitive === 'fly');
  assert.ok(fly.params.durationS >= 3600, '开关语义用长效时长');
  uninstallTestApi();
});

test('开关真的驱动 sim：施加→剩余时间>0，关闭→归零，全关→全部归零', () => {
  const sim = setup();
  const api = (globalThis).__trTest;
  api.set('fly', true);
  assert.ok(sim.fx.flyT > 0, '开飞行后 fx.flyT>0');
  assert.ok(api.state().fly > 0, 'state 回报剩余时间');
  api.set('fly', false);
  assert.equal(sim.fx.flyT, 0, '关飞行后归零');
  api.set('shieldAdd', true);
  api.set('magnet', true);
  assert.ok(sim.fx.shieldLayers >= 1 && sim.fx.magnetT > 0, '护盾与磁铁同时生效');
  api.allOff();
  assert.equal(sim.fx.shieldLayers, 0, '全关后护盾层归零');
  assert.equal(sim.fx.magnetT, 0, '全关后磁铁归零');
  assert.equal(sim.fx.flyT, 0, '全关后飞行归零');
  uninstallTestApi();
});

test('一次性技能：dash 前冲并撞碎本车道障碍', () => {
  const sim = setup();
  const api = (globalThis).__trTest;
  const s = sim.state;
  const d0 = s.distance;
  const wall = { obsRef: 't_probe', cls: 'full', w: 2, h: 2.6, d: 0.8, lane: s.lane, worldZ: s.distance + 5 };
  sim.obstacles.push(wall);
  api.fire('dash');
  assert.ok(s.distance - d0 >= 11.9, `dash 应前进约 12m，实际 ${(s.distance - d0).toFixed(2)}m`);
  assert.equal(wall.done, true, 'dash 应撞碎本车道障碍');
  uninstallTestApi();
});

test('卸载：uninstallTestApi 后全局不再暴露', () => {
  const sim = setup();
  assert.ok((globalThis).__trTest, '安装后应可访问');
  uninstallTestApi();
  assert.equal((globalThis).__trTest, undefined, '卸载后应删除');
});
