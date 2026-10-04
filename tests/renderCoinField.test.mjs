/**
 * 金币场渲染回归（用户反馈「弹跳鞋跳到最高点时地上金币消失」）：
 * 根因是两个金币 InstancedMesh 开了视锥剔除——实例矩阵每帧全量重写，基于实例的包围球
 * 在相机抬升（跳跃顶点）时被 three 判出视锥，整组金币闪断 1~2 帧。
 * 修法是 frustumCulled=false（实例内容每帧全变，cull 既无意义又白算 O(count) 包围球）。
 * 无头环境无法复现 three 的 GPU 视锥行为，故用源码契约断言两处开关都在（防回归）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { createCoinField } from '../packages/game/dist/render/coinField.js';

const root = join(fileURLToPath(import.meta.url), '..', '..');

test('金币 InstancedMesh 关闭视锥剔除（防跳跃顶点整组闪断）', () => {
  const src = readFileSync(join(root, 'packages/game/src/render/coinField.ts'), 'utf8');
  assert.ok(src.includes('ringInst.frustumCulled = false'), 'ringInst 必须关视锥剔除');
  assert.ok(src.includes('faceInst.frustumCulled = false'), 'faceInst 必须关视锥剔除');
  const hits = src.match(/frustumCulled\s*=\s*false/g) ?? [];
  assert.equal(hits.length, 2, '有且只有这两个 mesh 关剔除');
});

test('金币场：名单选取与 taken 吸入动画口径不变（修复只关 cull，不改选取逻辑）', () => {
  const scene = new THREE.Scene();
  const field = createCoinField(scene, 2.2);
  const coins = [
    { lane: 0, worldZ: 10, chain: 1 },          // 前方 10m
    { lane: 1, worldZ: 20, chain: 2 },          // 前方 20m
    { lane: -1, worldZ: -30, chain: 3 },        // 身后 30m（窗外）
    { lane: 0, worldZ: 40, y: 4.6, chain: 4 },  // 空中带
  ];
  const taken = { lane: 0, worldZ: 12, chain: 1, taken: true, takenAt: 0 };
  field.update({ coins: [taken, ...coins], t: 0.05, dist: 0, magnetOn: false, playerX: 0, playerY: 0 });
  assert.equal(field.lastCount, 4, '窗外金币不占名额：前方2 + 空中1 + 吸入动画1');
  field.update({ coins: [taken, ...coins], t: 0.5, dist: 0, magnetOn: false, playerX: 0, playerY: 0 });
  assert.equal(field.lastCount, 3, '吸入动画 0.25s 结束后只画未拾取的 3 枚');
});
