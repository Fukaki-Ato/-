/**
 * 障碍正面海报贴图回归（用户 2026-10-07：广告墙 + 矮障/下蹲横杆/车头都换二次元海报并减薄）。
 * 真实 three 对象图，不建 WebGLRenderer；贴图用假 image（只用宽高）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  AD_POSTERS, POSTER_TABLES, posterFor, posterSize, posterSlotAt, setPosters,
} from '../packages/game/dist/render/adPosters.js';
import { createObstacleLayer } from '../packages/game/dist/render/entityLayers.js';

/** 与 config/obstacles.json 同步：obs_box 2.0×2.0、obs_barrier_low 1.5×1.5、obs_gate_low 杆面 1.4×1.4 */
const WALL = { obsRef: 'obs_adwall', cls: 'full', w: 2, h: 3, d: 0.18, lane: 0, worldZ: 960 };
const BOX = { obsRef: 'obs_box', cls: 'low', w: 2, h: 2.667, d: 0.12, lane: -1, worldZ: 520 };
const BARRIER = { obsRef: 'obs_barrier_low', cls: 'low', w: 1.5, h: 2, d: 0.12, lane: 0, worldZ: 300 };
const CUBE = { obsRef: 'obs_cube_roll', cls: 'low', w: 1.1, h: 1.467, d: 0.12, lane: 0, worldZ: 700, moveZ: -6 };
const GATE = { obsRef: 'obs_gate_low', cls: 'high', w: 1.4, h: 2.6, d: 0.12, lane: 0, worldZ: 640 };
/** 面片浮在挡板正前方的间距，见 entityLayers.POSTER_FRONT */
const FRONT = 0.012;

/** 注入某个池（frame 走表内真值，tex 用带宽高的假 image） */
function inject(kind, w, h) {
  const texes = POSTER_TABLES[kind].map(() => new THREE.Texture({ width: w, height: h }));
  setPosters(kind, POSTER_TABLES[kind].map((p, i) => ({ file: p.file, tex: texes[i] })));
  return texes;
}

function build(o, dist = o.worldZ) {
  const scene = new THREE.Scene();
  const layer = createObstacleLayer(scene, 2.2);
  layer.update([o], dist, 0);
  const boxes = scene.children.filter(m => m.isMesh && m.visible && m.geometry.type === 'BoxGeometry');
  return {
    scene, layer, o,
    bar: boxes.sort((a, b) => b.scale.x - a.scale.x)[0],   // 立柱也是 BoxGeometry，取最宽那个
    poster: scene.children.find(m => m.isMesh && m.geometry.type === 'PlaneGeometry'),
  };
}

function disposeScene(scene) {
  const done = new Set();
  scene.traverse(o => {
    if (o.geometry && !done.has(o.geometry)) { done.add(o.geometry); o.geometry.dispose(); }
    if (o.material && !done.has(o.material)) { done.add(o.material); o.material.dispose(); }
  });
}

test('posterSize：等比内接不越界（留边框，不裁画面）', () => {
  const tall = posterSize(2, 3, 512, 911); // 9:16 海报贴 2:3 广告墙
  assert.equal(tall.h, 3);
  assert.ok(tall.w > 1.6 && tall.w < 2, `应留侧边框，实得宽 ${tall.w}`);
  assert.ok(Math.abs(tall.w / tall.h - 512 / 911) < 1e-9, '宽高比必须等于贴图比例');
  const sq = posterSize(2, 2, 384, 384); // 方图贴正方形板面：正好满贴
  assert.deepEqual(sq, { w: 2, h: 2 });
  const narrow = posterSize(2, 0.6, 384, 384); // 矮栏那种宽扁面：按高内接，两侧留边
  assert.deepEqual(narrow, { w: 0.6, h: 0.6 });
  assert.deepEqual(posterSize(2, 3, 0, 0), { w: 2, h: 3 }, '贴图尺寸脏 ⇒ 退化为铺满挡板');
});

test('posterSlotAt：同一障碍跨帧恒定，脏值不越池，并排两堵不撞同一张', () => {
  assert.equal(posterSlotAt(960.4, 0, 12), posterSlotAt(960.41, 0, 12));
  assert.equal(posterSlotAt(NaN, NaN, 12), 0);
  assert.equal(posterSlotAt(7, 0, 0), 0);
  const lanes = [-1, 0, 1].map(l => posterSlotAt(2000, l, 12));
  assert.equal(new Set(lanes).size, 3, `同 z 不同车道须各拿一张，实得 ${lanes}`);
});

test('posterFor 分类：广告墙走竖版池，矮障/横杆/车头走方版池，坡道电弧摆锤不挂', () => {
  inject('adwall', 512, 911);
  inject('small', 384, 384);
  assert.ok(posterFor('full', 960, 0), 'full 应有海报');
  for (const cls of ['low', 'high', 'vehicle']) assert.ok(posterFor(cls, 960, 0), `${cls} 应有海报`);
  for (const cls of ['step', 'hazard', 'moving']) assert.equal(posterFor(cls, 960, 0), null, `${cls} 不该挂海报`);
  setPosters('adwall', []);
  setPosters('small', []);
  assert.equal(posterFor('full', 960, 0), null, '空池 ⇒ 回落纯色');
});

test('广告墙：正面挂竖版海报，挡板本体取该海报边框色', t => {
  const texes = inject('adwall', 512, 911);
  inject('small', 384, 384);
  const idx = posterSlotAt(WALL.worldZ, WALL.lane, texes.length);
  const { scene, bar, poster } = build(WALL);
  t.after(() => disposeScene(scene));
  assert.equal(bar.material.color.getHex(), AD_POSTERS[idx].frame, '边框色须与分到的那张海报同系');
  assert.ok(poster.visible, '海报面片应可见');
  assert.equal(poster.material.map, texes[idx]);
  assert.ok(Math.abs(poster.scale.y - 3) < 1e-6 && poster.scale.x < 2, '海报吃满 3m 板高、宽留在板内');
  assert.ok(Math.abs(poster.position.z - (WALL.d / 2 + FRONT)) < 1e-6, '面片贴在正面之前');
  assert.ok(Math.abs(poster.position.y - 1.5) < 1e-6, '满格墙海报中心在板高一半');
});

test('正方形矮障（obs_box 2.0×2.0）：方图满贴不留边，海报与盒体同心', t => {
  inject('adwall', 512, 911);
  const texes = inject('small', 384, 384);
  const idx = posterSlotAt(BOX.worldZ, BOX.lane, texes.length);
  const { scene, bar, poster } = build(BOX);
  t.after(() => disposeScene(scene));
  assert.ok(Math.abs(bar.scale.y - 2.0) < 1e-3, `low 可视高度 = h*0.75 = 2.0，实得 ${bar.scale.y}`);
  assert.ok(Math.abs(bar.scale.x - 2) < 1e-6, '板面正方形：宽=可视高');
  assert.ok(poster.visible);
  assert.equal(poster.material.map, texes[idx]);
  assert.ok(Math.abs(poster.scale.x - 2) < 1e-3 && Math.abs(poster.scale.y - 2) < 1e-3, '方图正好铺满正方形板面');
  assert.ok(Math.abs(poster.position.y - 1) < 1e-3, '海报中心与盒体中心同高（底边落地面）');
  assert.ok(poster.material.opacity > 0.99, '矮障海报不透明');
});

test('移动障碍跨帧不换图（回归用户反馈的「乱闪」：moveZ 每帧改 worldZ）', t => {
  inject('adwall', 512, 911);
  inject('small', 384, 384);
  const cube = { ...CUBE };
  const { scene, layer, poster } = build(cube);
  t.after(() => disposeScene(scene));
  const first = poster.material.map;
  assert.ok(first, '第一帧就该拿到海报');
  for (let i = 1; i <= 40; i++) {         // 模拟 runnerSim 的 o.worldZ += moveZ * dt
    cube.worldZ -= 6 / 60;
    layer.update([cube], 900 + i * 0.2, i / 60);
    assert.equal(poster.material.map, first, `第 ${i} 帧换了图`);
  }
});

test('下蹲横杆（杆面 1.4×1.4）：方图满贴且保持半透明，不把后面的金币挡死', t => {
  inject('adwall', 512, 911);
  inject('small', 384, 384);
  const { scene, bar, poster } = build(GATE);
  t.after(() => disposeScene(scene));
  assert.ok(Math.abs(bar.scale.x - 1.4) < 1e-6 && Math.abs(bar.scale.y - 1.4) < 1e-6, '杆面正方形');
  assert.ok(Math.abs(bar.position.y - 1.9) < 1e-6, '横杆中心在 1.2m 以上，下方留钻的空间');
  assert.ok(poster.visible);
  assert.ok(Math.abs(poster.position.y - 1.9) < 1e-6, '海报跟着横杆走，不落地面');
  assert.ok(Math.abs(poster.scale.x - 1.4) < 1e-3 && Math.abs(poster.scale.y - 1.4) < 1e-3, '方图满贴不留边');
  assert.ok(Math.abs(poster.material.opacity - 0.72) < 1e-6, '横杆海报半透明');
  assert.ok(bar.material.opacity < poster.material.opacity, '杆体仍比海报更透');
});

test('每个贴海报的方形板面都满贴不留边（用户：这种小型障碍全改）', t => {
  inject('adwall', 512, 911);
  inject('small', 384, 384);
  for (const o of [BOX, BARRIER, CUBE, GATE]) {
    const { scene, bar, poster } = build(o);
    t.after(() => disposeScene(scene));
    assert.ok(poster.visible, `${o.obsRef} 应有海报`);
    assert.ok(Math.abs(poster.scale.x - bar.scale.x) < 1e-3 && Math.abs(poster.scale.y - bar.scale.y) < 1e-3,
      `${o.obsRef} 海报须铺满板面，板 ${bar.scale.x.toFixed(2)}×${bar.scale.y.toFixed(2)} vs 图 ${poster.scale.x.toFixed(2)}×${poster.scale.y.toFixed(2)}`);
  }
});

test('未注入（微信端无加载链）：全部回落纯色，不挂空面片', t => {
  setPosters('adwall', []);
  setPosters('small', []);
  for (const o of [WALL, BOX, BARRIER, CUBE, GATE]) {
    const { scene, bar, poster } = build(o);
    t.after(() => disposeScene(scene));
    assert.ok(!poster.visible, `${o.cls} 无海报不得留空面片`);
    assert.ok(bar.material.color.getHex() !== 0, `${o.cls} 仍应有纯色`);
  }
});
