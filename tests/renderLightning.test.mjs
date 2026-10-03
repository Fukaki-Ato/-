/**
 * 雷电特效回归（用户要求：闪电圈处天上打雷、场景变亮，MC 式）：
 * 只在 node 里驱动特效状态机（不建 WebGL），断言三段式的可观测行为——
 *   闪白强度曲线 / 天→地锯齿的生成与频闪 / 落点随赛道滚动锚定 / 池化不丢叠打。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { applyLightningFlash, createLightningFx, FLASH_PEAK, FLASH_TINT } from '../packages/game/dist/render/lightning.js';

test('闪电闪白分别恢复天空色与雾色基线', () => {
  const skyBase = new THREE.Color('#8ED0F2');
  const fogBase = new THREE.Color('#CFE9F7');
  const flashTint = new THREE.Color(FLASH_TINT);
  const background = new THREE.Color();
  const fog = new THREE.Color();
  applyLightningFlash(background, fog, skyBase, fogBase, flashTint, 1);
  assert.equal(background.getHex(), skyBase.clone().lerp(flashTint, 0.85).getHex());
  assert.equal(fog.getHex(), fogBase.clone().lerp(flashTint, 0.85).getHex());
  applyLightningFlash(background, fog, skyBase, fogBase, flashTint, 0);
  assert.equal(background.getHex(), skyBase.getHex());
  assert.equal(fog.getHex(), fogBase.getHex());
});

test('触发雷击：闪白立即拉满并随时间衰减归零', () => {
  const fx = createLightningFx(new THREE.Scene());
  assert.equal(fx.update(1 / 60, 0), 0, '未触发时无闪白');
  fx.strike(0, 100, 2.2);
  const peak = fx.update(1 / 60, 100);
  assert.ok(peak > FLASH_PEAK * 0.6, `闪白应在触发瞬间接近峰值，实际 ${peak.toFixed(2)}`);
  let t = 2 / 60, last = peak;
  while (t < 0.6) { last = fx.update(1 / 60, 100); t += 1 / 60; }
  assert.equal(last, 0, `0.6s 后闪白应归零，实际 ${last}`);
  assert.equal(fx.update(1 / 60, 100), 0, '之后保持无闪白');
});

test('落点锚定赛道：闪电组 z 跟随 worldZ - dist 滚动，播完自动隐藏', () => {
  const scene = new THREE.Scene();
  const fx = createLightningFx(scene);
  fx.strike(1, 200, 2.2);
  fx.update(1 / 60, 200);
  const group = scene.children.find(c => c instanceof THREE.Group && c.visible);
  assert.ok(group, '应有一个可见的闪电组');
  assert.equal(group.position.z, 0, 'dist=worldZ 时落点在角色处');
  fx.update(1 / 60, 203);
  assert.equal(group.position.z, -3, '赛道前进 3m 后闪电相对后退 3m（锚定落点）');
  for (let i = 0; i < 30; i++) fx.update(1 / 60, 203 + i * 0.4); // 播完整个寿命
  assert.equal(group.visible, false, '播放结束后闪电组应隐藏');
});

test('池化：连续叠打不抛错，且仍产生闪白', () => {
  const fx = createLightningFx(new THREE.Scene());
  for (let i = 0; i < 6; i++) fx.strike(i % 3 - 1, 100 + i * 40, 2.2);
  const flash = fx.update(1 / 60, 300);
  assert.ok(flash > 0, '叠打后仍应有闪白');
});
