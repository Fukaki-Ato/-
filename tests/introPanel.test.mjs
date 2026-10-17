/**
 * 登场动画面板回归（characters.json 的 intro → 相机前一块视频面板）。
 * 锁四件事：① 没配 intro / 没注入视频源＝不冻结画面（微信端与注入失败都走这条路）；
 * ② start/end 两个时点各只报一次（音频让位与续播全靠它）；
 * ③ 面板确实立在相机正前方 spec.distanceM 米处并朝向相机（挡住画面中央＝用户口径）；
 * ④ 播放事件丢了也要在 durationS + 余量后强制解冻，不能让游戏永远卡在第一帧。
 */
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createIntroPanel, setIntroSource } from '../packages/game/dist/render/introPanel.js';

const SPEC = { video: 'assets/video/frog_intro.mp4', durationS: 2.38, widthM: 3, heightM: 1.7, distanceM: 4 };

function stage() {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(68, 9 / 16, 0.1, 160);
  camera.position.set(1.2, 4.6, 9.2);
  camera.lookAt(0.4, 2.4, -9.5);
  camera.updateMatrixWorld(true);
  return { scene, camera, stages: [] };
}
const onStage = (log) => (s) => log.push(s);
const flush = () => new Promise(res => setTimeout(res, 0)); // promise 回调是微任务，等一轮才落定

/** 可控的视频源：play 返回一个由测试决定何时 resolve 的 promise */
function fakeSource() {
  let settle = null;
  const calls = { play: 0, stop: 0 };
  setIntroSource('char_frog', {
    texture: new THREE.Texture(),
    play: () => new Promise(res => { calls.play++; settle = res; }),
    stop: () => { calls.stop++; },
  });
  return { calls, settle: () => settle && settle() };
}

afterEach(() => setIntroSource('char_frog', null));

test('没配 intro：不建面板、一个时点都不报', () => {
  const { scene, camera, stages } = stage();
  assert.equal(createIntroPanel(scene, camera, undefined, 'char_frog', onStage(stages)), null);
  assert.deepEqual(stages, []);
});

test('配了 intro 但没有视频源（微信端/注入失败）：只响音效、不冻结画面，时长到后续播 BGM', () => {
  const { scene, camera, stages } = stage();
  const panel = createIntroPanel(scene, camera, SPEC, 'char_frog', onStage(stages));
  assert.ok(panel, '无视频源仍需跟踪音频-only让位生命周期');
  assert.equal(panel.active(), false, '无面板＝主循环照常推进');
  assert.deepEqual(stages, ['start']);
  assert.equal(scene.children.length, 0);
  panel.update(SPEC.durationS - 0.01);
  assert.deepEqual(stages, ['start'], '音效预计时长内继续让位');
  panel.update(0.02);
  assert.deepEqual(stages, ['start', 'end'], '音频-only 让位必须自动结束并续播 BGM');
  assert.equal(panel.active(), false, '计时不能冻结跑酷');
  panel.dispose();
});

test('音频-only 让位在离开场景时取消，不迟到地发送 end', () => {
  const { scene, camera, stages } = stage();
  const panel = createIntroPanel(scene, camera, SPEC, 'char_frog', onStage(stages));
  assert.ok(panel);
  panel.dispose();
  panel.update(SPEC.durationS * 2);
  assert.deepEqual(stages, ['start'], 'scene dispose 后音频导演由 exitRun/death 收尾');
});

test('有视频源：面板立在相机正前方 4 米并朝向相机，播完才报 end 并交还渲染权', async () => {
  const { scene, camera, stages } = stage();
  const src = fakeSource();
  const panel = createIntroPanel(scene, camera, SPEC, 'char_frog', onStage(stages));
  assert.equal(panel.active(), true);
  assert.equal(scene.children.length, 1, '面板 mesh 已挂进场景');
  const mesh = scene.children[0];
  const expect = new THREE.Vector3();
  camera.getWorldDirection(expect);
  expect.multiplyScalar(SPEC.distanceM).add(camera.position);
  assert.ok(mesh.position.distanceTo(expect) < 1e-6, `面板应在相机正前方 ${SPEC.distanceM} 米`);
  assert.ok(Math.abs(mesh.quaternion.angleTo(camera.quaternion)) < 1e-6, '面板必须正对相机');
  assert.equal(mesh.geometry.parameters.width, SPEC.widthM);
  assert.equal(mesh.geometry.parameters.height, SPEC.heightM);
  assert.equal(mesh.renderOrder, 100, '要压在赛道/角色/特效之上');

  panel.update(1 / 60);
  assert.equal(src.calls.play, 1, '第一帧才开始解码播放');
  src.settle();
  await flush();
  assert.deepEqual(stages, ['start', 'end'], '播放结束事件即交还');
  assert.equal(panel.active(), false);
  assert.equal(mesh.visible, false);
  assert.equal(src.calls.stop, 1);
  panel.update(1 / 60);
  assert.deepEqual(stages, ['start', 'end'], '交还后不重复报时点');
  panel.dispose();
  assert.equal(scene.children.length, 0, '面板随局销毁');
});

test('面板逐帧跟回相机：相机移动/转向后面板仍正对镜头且距离不变', () => {
  const { scene, camera, stages } = stage();
  fakeSource();
  const panel = createIntroPanel(scene, camera, SPEC, 'char_frog', onStage(stages));
  panel.update(1 / 60);
  camera.position.set(-2.4, 5.8, 11);
  camera.lookAt(-1.1, 1.2, -9.5);
  camera.updateMatrixWorld(true);
  panel.update(1 / 60);
  const mesh = scene.children[0];
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  assert.ok(Math.abs(mesh.position.distanceTo(camera.position) - SPEC.distanceM) < 1e-6, '仍贴在 4 米处');
  assert.ok(dir.multiplyScalar(SPEC.distanceM).add(camera.position).distanceTo(mesh.position) < 1e-6);
});

test('播放事件丢了：超过 durationS + 余量也要强制解冻', () => {
  const { scene, camera, stages } = stage();
  fakeSource();
  const panel = createIntroPanel(scene, camera, SPEC, 'char_frog', onStage(stages));
  for (let i = 0; i < 60 * 4; i++) panel.update(1 / 60); // 4 秒 > 2.38 + 1.5
  assert.equal(panel.active(), false, '视频卡住也必须把画面交还给跑酷');
  assert.deepEqual(stages, ['start', 'end']);
});

test('play 被拒（自动播放策略）同样交还渲染权，不让画面冻在原地', async () => {
  const { scene, camera, stages } = stage();
  setIntroSource('char_frog', {
    texture: new THREE.Texture(),
    play: () => Promise.reject(new Error('autoplay blocked')),
    stop: () => {},
  });
  const panel = createIntroPanel(scene, camera, SPEC, 'char_frog', onStage(stages));
  panel.update(1 / 60);
  await flush();
  assert.equal(panel.active(), false);
  assert.deepEqual(stages, ['start', 'end']);
});
