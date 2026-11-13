/**
 * 时空隧道环（render/warpTunnel.ts）的回归测试：真实 three.js 建模，不建 WebGL 上下文。
 * 盯四件事：① 熄灭态——warpActive=false（从创建起未激活/回扩窗走完）16 环全 scale 0 隐藏；
 * ② 激活稳态——世界锚定网格：环钉在 gap 网格世界里程上、渲染 z=dist−worldM ∈(−∞,0.5]（前方/脚下，
 *  2026-11-14 修正：旧实现在 z=dist−6 绝对坐标=玩家身后数百米永不入镜），环距 6m、逐环绕 z 慢旋
 * （角=t×0.8+i×0.4，随 t 变化）、instanceColor 紫罗兰双色交替；
 * ③ 入口压缩沿——false→true 后 0.5s 内环距 12m→6m 单调收缩（被吸进去，两次 update 不同 t 断言矩阵差）；
 * ④ 出口沿对称回扩——true→false 环距 6→12 回扩且渐隐，0.5s 后全环隐藏；dispose 释放干净。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createWarpTunnel } from '../packages/game/dist/render/warpTunnel.js';

const LW = 2, DIST = 100; // laneWidth / 玩家插值距离
const RINGS = 16; // 环数（世界锚定网格每 6m 一环，随奔跑掠过玩家）

function build() {
  const scene = new THREE.Scene();
  const tunnel = createWarpTunnel(scene, LW);
  const mesh = scene.children.find(o => o.isInstancedMesh);
  return { scene, tunnel, mesh };
}

const matAt = (mesh, i) => { const m = new THREE.Matrix4(); mesh.getMatrixAt(i, m); return m; };
const zOf = (mesh, i) => matAt(mesh, i).elements[14];
/** 环局部绕 z 旋角：compose(T·Rz·S) 下 e[1]/e[0]=tanθ×sx，atan2 还原 θ（sx>0） */
const rotZOf = (mesh, i) => { const e = matAt(mesh, i).elements; return Math.atan2(e[1], e[0]); };
/** 隐藏槽位 = scale 0（零矩阵）：缩放分量与平移分量同时为 0 */
const hidden = (mesh, i) => { const e = matAt(mesh, i).elements; return e[0] === 0 && e[14] === 0; };
const gap01 = mesh => zOf(mesh, 0) - zOf(mesh, 1); // 环 0/1 的 z 间距（收缩/回扩的观测量）
/** 归一到 (−π, π]：atan2 值域与 % 2π 值域对齐用 */
const wrapPi = a => { const w = a % (Math.PI * 2); return w > Math.PI ? w - Math.PI * 2 : w; };
const near = (v, want, eps = 1e-3) => Math.abs(v - want) < eps;

test('warpTunnel 结构：单 InstancedMesh 16 环、frustumCulled=false、双色交替 instanceColor、dispose 释放干净', () => {
  const { scene, tunnel, mesh } = build();
  assert.ok(mesh, '应有隧道环实例组');
  assert.equal(mesh.instanceMatrix.count, RINGS, `环池容量应为 ${RINGS}`);
  assert.equal(mesh.count, RINGS, '绘制数应为 16（隐藏走 scale 0，不裁 count）');
  assert.equal(mesh.frustumCulled, false, '矩阵逐帧重写须关视锥剔除（zoneGates 同款）');
  const ca = new THREE.Color(0xb06cff), cb = new THREE.Color(0x7d5cff);
  assert.ok(near(mesh.instanceColor.getX(0), ca.r) && near(mesh.instanceColor.getX(1), cb.r), '环 0/1 应紫罗兰 #b06cff/#7d5cff 交替');
  tunnel.dispose();
  assert.equal(scene.children.filter(o => o.isInstancedMesh).length, 0, 'dispose 后场景应无残留实例组');
});

test('warpTunnel 熄灭：warpActive=false（从创建起未激活）全环 scale 0 隐藏', () => {
  const { tunnel, mesh } = build();
  tunnel.update(DIST, 1.234, false);
  for (let i = 0; i < RINGS; i++) assert.ok(hidden(mesh, i), `环 ${i} 应隐藏`);
  tunnel.dispose();
});

test('warpTunnel 激活稳态：世界网格锚定 z=dist−worldM∈(−∞,0.5]、环距 6m、绕 z 慢旋角=t×0.8+i×0.4', () => {
  const { tunnel, mesh } = build();
  tunnel.update(DIST, 2, true);
  tunnel.update(DIST, 3, true); // 越过 0.5s 压缩窗：稳态环距 6m
  // 世界锚定（修正回归）：DIST=100 ⇒ 网格基点 102，环 0 在 z=−2（脚下）、向前逐环 −6；绝不出现「身后数百米」
  assert.ok(zOf(mesh, 0) > -6 && zOf(mesh, 0) <= 0.5, `首环应在脚下网格点 z∈(−6,0.5]，实得 ${zOf(mesh, 0)}`);
  assert.ok(near(zOf(mesh, RINGS - 1), zOf(mesh, 0) - (RINGS - 1) * 6, 1e-4), '末环 z=首环−15×6（向前每 6m 一环）');
  for (let i = 0; i < RINGS; i++) assert.ok(zOf(mesh, i) <= 0.5, `环 ${i} 不得落到玩家身后（z≤0.5），实得 ${zOf(mesh, i)}`);
  assert.ok(near(gap01(mesh), 6, 1e-4), `稳态环距应=6m，实得 ${gap01(mesh)}`);
  for (let i = 0; i < RINGS; i++) {
    const want = wrapPi(3 * 0.8 + i * 0.4);
    assert.ok(near(rotZOf(mesh, i), want), `环 ${i} 旋角应=t×0.8+i×0.4≈${want.toFixed(3)}，实得 ${rotZOf(mesh, i).toFixed(3)}`);
  }
  const before = rotZOf(mesh, 0);
  tunnel.update(DIST, 3.5, true);
  assert.ok(Math.abs(rotZOf(mesh, 0) - before) > 0.1, '旋角应随 t 增长（逐环慢旋，Δ≈0.5×0.8）');
  tunnel.dispose();
});

test('warpTunnel 入口压缩沿：false→true 首帧环距≈12m，0.5s 内单调收缩到 6m（被吸进去）', () => {
  const { tunnel, mesh } = build();
  tunnel.update(DIST, 0, true); // 激活沿：k=0，环距=12m
  assert.ok(gap01(mesh) > 11, `激活首帧环距应≈12m，实得 ${gap01(mesh)}`);
  tunnel.update(DIST, 0.25, true); // 压缩中段：k=0.5，环距≈9m
  const mid = gap01(mesh);
  assert.ok(mid > 6.5 && mid < 11.5, `压缩中段环距应≈9m，实得 ${mid}`);
  tunnel.update(DIST, 1, true); // 压缩完成：环距=6m
  assert.ok(near(gap01(mesh), 6, 1e-3), `收拢后环距应=6m，实得 ${gap01(mesh)}`);
  assert.ok(gap01(mesh) < mid, '环距应沿窗单调收缩（矩阵逐帧收紧）');
  tunnel.dispose();
});

test('warpTunnel 出口沿对称回扩：true→false 环距从 6m 回扩并渐隐，0.5s 后全环隐藏', () => {
  const { tunnel, mesh } = build();
  tunnel.update(DIST, 2, true); tunnel.update(DIST, 3, true); // 先进入稳态（环距 6）
  tunnel.update(DIST, 3, false); // 出口沿：k=0 仍可见、环距 6
  assert.ok(!hidden(mesh, 0), '出口沿首帧环仍可见（回扩窗未走完）');
  tunnel.update(DIST, 3.25, false); // 回扩中段：环距≈9 > 6
  const mid = gap01(mesh);
  assert.ok(mid > 6.5, `回扩中段环距应>6m，实得 ${mid}`);
  tunnel.update(DIST, 4, false); // 回扩窗走完：稳态熄灭
  for (let i = 0; i < RINGS; i++) assert.ok(hidden(mesh, i), `回扩完成后环 ${i} 应 scale 0`);
  tunnel.dispose();
});
