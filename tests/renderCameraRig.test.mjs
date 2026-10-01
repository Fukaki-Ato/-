/**
 * 相机机位回归（PR #7 评审意见：飞行视角改动幅度不足、视同未通过）。
 * 首版空中机位 y*0.55+2.6 与地面 y*0.5+2.7 在 4.6m 几乎重合（5.13 vs 5.0），
 * 实测无感知；本测试把「空中必须显著区别于地面」固化成阈值，防止被调回中性值。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { camTargets, CAM_Z_GROUND, CAM_Z_AIR, FOV_GROUND, FOV_AIR } from '../packages/game/dist/render/cameraRig.js';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const game = JSON.parse(readFileSync(join(root, 'config', 'game.json'), 'utf8'));
const FLIGHT_H = (game.params.flight ?? {}).heightM ?? 4.6; // 飞行高度（items.json 飞行道具升至此高度）

test('地面机位：本轮抬高后的口径（Z 9.2 / Y 3.3+0.5 随动 / lookY 0.5 随动 / FOV 55）', () => {
  const g0 = camTargets(0, false);
  assert.equal(g0.camZ, 9.2);
  assert.equal(g0.camY, 3.3);
  assert.equal(g0.lookY, 0);
  assert.equal(g0.fov, FOV_GROUND);
  assert.equal(camTargets(2, false).camY, 4.3, '跳跃时机位随动 0.5 口径不变');
  assert.equal(camTargets(2, false).lookY, 1);
});

test('空中机位：飞行高度下与地面机位有可感知差值（camY ≥ +1.8m / camZ ≥ +2m / FOV ≥ +10°）', () => {
  const air = camTargets(FLIGHT_H, true), gnd = camTargets(FLIGHT_H, false);
  assert.ok(air.camY > gnd.camY + 1.8, `机位应明显抬高（air ${air.camY.toFixed(2)} vs ground ${gnd.camY.toFixed(2)}）`);
  assert.ok(air.camZ - gnd.camZ >= 2, `机位应后拉（air ${air.camZ} vs ground ${gnd.camZ}）`);
  assert.ok(air.fov - gnd.fov >= 10, `空中应更广角（air ${air.fov} vs ground ${gnd.fov}）`);
  assert.equal(air.camZ, CAM_Z_AIR);
  assert.equal(air.fov, FOV_AIR);
});

test('空中机位：俯角显著，注视点压在地面与角色之间，同帧装下地面障碍与空中金币带', () => {
  const air = camTargets(FLIGHT_H, true);
  assert.ok(air.camY - air.lookY >= 2.5, `俯角要明显（camY ${air.camY.toFixed(2)} vs lookY ${air.lookY.toFixed(2)}）`);
  assert.ok(air.lookY > 0 && air.lookY < FLIGHT_H * 0.6, `注视点应落在地面(0)与角色(${FLIGHT_H}m)之间偏下：${air.lookY.toFixed(2)}`);
  assert.ok(air.camY > FLIGHT_H && air.lookY < FLIGHT_H, `应形成从角色上方俯视（camY ${air.camY.toFixed(2)} > lookY ${air.lookY.toFixed(2)} < ${FLIGHT_H}）`);
});

test('起飞→滑翔→落地全程：空中机位不贴地、与地面目标差值不归零', () => {
  for (let y = 0; y <= FLIGHT_H + 1e-9; y += 0.2) {
    const air = camTargets(y, true), gnd = camTargets(y, false);
    assert.ok(air.camY > 2.5, `y=${y.toFixed(1)} 机位不得贴地（${air.camY.toFixed(2)}）`);
    assert.ok(air.camY - gnd.camY >= 0.7, `y=${y.toFixed(1)} 空中/地面仍有可见差（${(air.camY - gnd.camY).toFixed(2)}）`);
    assert.equal(air.camZ, CAM_Z_AIR);
  }
});
