/**
 * 反重力区事件入口门（render/zoneGates.ts）的回归测试：真实 three.js 建模，不建 WebGL 上下文。
 * 盯四件事：① 窗口判定——门位 ∈ [dist−8, dist+130] 才占槽位，窗外 scale 0 隐藏；
 * ② z 映射符号与 entityLayers 同款（z=dist−worldM，前方为负）；
 * ③ 发光条脉冲——入口门 60m 预告窗内线性爬亮 + sin 呼吸（flipWarn 的世界侧回响）、出口门恒稳光；
 * ④ 槽位复用——窗内门按里程序紧凑重排进槽位，推进 500m 后下一区的门复用同槽位；
 * zones 为空 / 里程越界 / flip=-1 倒挂态 update 不炸。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createZoneGates } from '../packages/game/dist/render/zoneGates.js';

const LW = 2; // laneWidth（车道半宽口径与障碍 lane×laneWidth 一致）
const ZS1 = 600, ZE1 = 690, ZS2 = 1100, ZE2 = 1190; // 区 1 + 推进 500m 后的区 2（everyM=500）
const ZONES = [{ startM: ZS1, endM: ZE1, ceilH: 4.6 }, { startM: ZS2, endM: ZE2, ceilH: 4.6 }];

function build(zones = ZONES) {
  const scene = new THREE.Scene();
  const gates = createZoneGates(scene, LW, zones);
  const inst = scene.children.filter(o => o.isInstancedMesh);
  return { scene, gates, inst, pillars: inst[0], beams: inst[1], bars: inst[2] }; // 场景加入序 = 创建序：塔柱/横梁/发光条
}

const matAt = (mesh, i) => { const m = new THREE.Matrix4(); mesh.getMatrixAt(i, m); return m; };
const xyzOf = (mesh, i) => { const e = matAt(mesh, i).elements; return [e[12], e[13], e[14]]; };
/** 隐藏槽位 = scale 0（零矩阵）：缩放分量与平移分量同时为 0 */
const hidden = (mesh, i) => { const e = matAt(mesh, i).elements; return e[0] === 0 && e[14] === 0; };
const xEdge = 1.5 * LW + 0.55; // 塔柱离路中线（契约：±(1.5×laneWidth+0.55)）
/** 发光条 instanceColor 期望值：与实现同一条路径（setHex sRGB→线性 × 强度） */
const glow = (hex, k) => new THREE.Color(hex).multiplyScalar(k).r;
const PULSE = 0.55 + 1.25 * (1 - 10 / 60); // t=0（呼吸项 sin(0)=0）、距门 10m 的脉冲强度

test('zoneGates 结构：3 个 InstancedMesh（塔柱 8/横梁 4/发光条 4），frustumCulled=false，dispose 释放干净', () => {
  const { scene, gates, inst, pillars, beams, bars } = build();
  assert.equal(inst.length, 3, `应恰为塔柱/横梁/发光条 3 个实例组，实得 ${inst.length}`);
  for (const m of inst) assert.equal(m.frustumCulled, false, '矩阵逐帧重写的实例组须关视锥剔除（coinField 同款）');
  for (const [m, cap, name] of [[pillars, 8, '塔柱'], [beams, 4, '横梁'], [bars, 4, '发光条']]) {
    assert.ok(m, `${name}实例组应存在`);
    assert.equal(m.instanceMatrix.count, cap, `${name}槽容量应为 ${cap}`);
    assert.equal(m.count, cap, `${name}绘制数应为 ${cap}（隐藏走 scale 0，不裁 count）`);
  }
  gates.dispose();
  assert.equal(scene.children.filter(o => o.isInstancedMesh).length, 0, 'dispose 后场景应无残留实例组');
});

test('zoneGates 门外（dist=540）：入口门在窗内可见且 z=dist−startM=−60（entityLayers 口径），出口门仍在窗外', () => {
  const { gates, pillars, beams, bars } = build();
  gates.update(540, 0, 1);
  // 入口门（startM=600）：双塔柱 x=±3.55、柱心 y=2.4、z=−60
  for (const [i, x] of [[0, -xEdge], [1, xEdge]]) {
    assert.deepEqual(xyzOf(pillars, i).map(v => Math.round(v * 100) / 100), [x, 2.4, -60], `塔柱 ${i} 位姿`);
  }
  assert.deepEqual(xyzOf(beams, 0).map(v => Math.round(v * 100) / 100), [0, 4.64, -60], '顶横梁跨路、顶与柱顶平齐');
  assert.deepEqual(xyzOf(bars, 0).map(v => Math.round(v * 100) / 100), [0, 4.4, -60], '梁下发光条贴横梁下沿');
  // 出口门（endM=690 > 540+130=670）：窗外全隐藏
  assert.ok(hidden(pillars, 2) && hidden(pillars, 3) && hidden(beams, 1) && hidden(bars, 1), '出口门外于 130m 窗应 scale 0');
  // 距门恰 60m：预告窗上边界（a=60 ⇒ near=0）⇒ 发光条回到基础亮度 0.55
  assert.ok(Math.abs(bars.instanceColor.getX(0) - glow(0x59d2ff, 0.55)) < 1e-3, '窗沿发光条=基础亮度 0.55');
  gates.dispose();
});

test('zoneGates 60m 窗内（dist=590）：入口发光条脉冲爬亮、出口门同窗可见且恒 0.9 稳光', () => {
  const { gates, pillars, bars } = build();
  gates.update(590, 0, 1);
  // t=0（呼吸项 sin(0)=0）距门 10m：k=0.55+1.25×(1−10/60)≈1.59，显著亮于基础档
  assert.ok(Math.abs(bars.instanceColor.getX(0) - glow(0x59d2ff, PULSE)) < 1e-3, `预告窗内脉冲亮度应=0.55+1.25×(1−10/60)，实得 ${bars.instanceColor.getX(0).toFixed(3)}`);
  assert.ok(bars.instanceColor.getX(0) > glow(0x59d2ff, 0.55) * 2, '脉冲亮度应显著高于窗外基础档');
  // 两道门同窗（区长 90m < 138m 窗宽）：入口槽 0、出口槽 1
  assert.deepEqual(xyzOf(pillars, 2)[2], -100, '出口门塔柱 z=590−690=−100');
  assert.ok(!hidden(bars, 1), '出口门发光条在窗内可见');
  assert.ok(Math.abs(bars.instanceColor.getX(1) - glow(0xffb454, 0.9)) < 1e-3, '出口发光条恒 0.9 稳光');
  gates.dispose();
});

test('zoneGates 区内（dist=610）：入口门已过窗不再占任何实例，出口门在窗可见', () => {
  const { gates, pillars, beams, bars } = build();
  gates.update(610, 0, 1);
  // 槽位紧凑复用：入口门（600 < 610−8=602）出窗 ⇒ 不再有实例画它（可见实例只能是出口门，z=−80；
  // 入口门旧位 z=610−600=+10 已在玩家身后，不得残留）。实例矩阵经 Float32 存读取 ⇒ 用 1e-4 容差
  const near = (v, want) => Math.abs(v - want) < 1e-4;
  for (let i = 0; i < 8; i++) {
    if (hidden(pillars, i)) continue;
    const [, y, z] = xyzOf(pillars, i);
    assert.ok(near(z, -80) && near(y, 2.4), `区内可见塔柱只能是出口门（z=−80），槽 ${i} 实得 z=${z}`);
  }
  for (const [i, x] of [[0, -xEdge], [1, xEdge]]) assert.ok(near(xyzOf(pillars, i)[0], x), '出口门塔柱重排进槽 0/1，仍在路两侧');
  assert.ok(hidden(pillars, 2) && hidden(pillars, 3) && hidden(beams, 1) && hidden(bars, 1), '出口门之后的槽位全 scale 0');
  assert.ok(!hidden(bars, 0) && Math.abs(bars.instanceColor.getX(0) - glow(0xffb454, 0.9)) < 1e-3, '出口门稳光可见');
  gates.dispose();
});

test('zoneGates 区外（dist=700）：两道门都在身后窗外，全部槽位隐藏', () => {
  const { gates, pillars, beams, bars } = build();
  gates.update(700, 0, 1);
  for (let i = 0; i < 8; i++) assert.ok(hidden(pillars, i), `塔柱槽 ${i} 应隐藏`);
  for (let i = 0; i < 4; i++) assert.ok(hidden(beams, i) && hidden(bars, i), `横梁/发光条槽 ${i} 应隐藏`);
  gates.dispose();
});

test('zoneGates 池复用：推进 500m 后下一区的入口门复用同槽位（槽 0），旧区门让位', () => {
  const { gates, pillars, beams, bars } = build();
  gates.update(540, 0, 1);
  assert.equal(xyzOf(pillars, 0)[2], -60, '区 1 入口门占槽 0');
  gates.update(1040, 0, 1); // 窗 [1032,1170]：区 1 全出窗，区 2 入口门 1100 进窗
  assert.equal(xyzOf(pillars, 0)[2], -60, '区 2 入口门复用槽 0（z 恰同为 −60）');
  assert.ok(hidden(pillars, 2) && hidden(beams, 1) && hidden(bars, 1), '区 2 出口门（1190>1170）仍在窗外');
  assert.ok(!hidden(beams, 0) && !hidden(bars, 0), '槽 0 的横梁/发光条同步复用');
  gates.dispose();
});

test('zoneGates 鲁棒：zones 为空、里程越界、flip=-1 倒挂态 update 不炸且按地标口径照常渲染', () => {
  const empty = build([]);
  empty.gates.update(600, 1.234, -1); // 不炸
  for (let i = 0; i < 8; i++) assert.ok(hidden(empty.pillars, i), '无区 ⇒ 全隐藏');
  empty.gates.dispose();
  const { gates, pillars } = build();
  gates.update(5000, 0, 1); // 远超所有区
  for (let i = 0; i < 8; i++) assert.ok(hidden(pillars, i), '越界里程 ⇒ 全隐藏');
  gates.update(590, 0.5, -1); // 倒挂态（flip=-1）：拱门是立于路面的世界地标，不随 B-7 镜像，照常可见
  assert.deepEqual(xyzOf(pillars, 0)[2], -10, 'flip=-1 下门位不受影响');
  gates.dispose();
});
