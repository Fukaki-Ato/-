/**
 * 鲸鱼女仆（char_whale → assets/characters/whale.glb）GLB 装配回归。
 *
 * 与篮球小子的差异：本资产 10 核心 clip + Laugh 与游戏契约逐字一致（纯配置接入，
 * 不动 animClips 的清单），所以这里重点守的是「鲸鱼特有」的验收口径：
 *   - 朝向：五官网格必须在 -Z 侧（背对镜头）。篮球小子历史上错过（bball.glb 面朝 +Z
 *     正对镜头，建模侧 180° 翻转假设错误），这条门禁防回归；
 *   - 矮体型身高：Chest 0.79m / Head 1.07m（1.7m 级角色是 1.05/1.45），挂点与胸口
 *     爆点按骨骼相对定位，验证不漂移即可；
 *   - Q 版短腿抬脚低：放大后脚骨量程仍只到 ~0.39m，落脚探测阈值 0.24 必须仍能
 *     进出触地区（尘土验收依赖它）；
 *   - ?anim=Laugh 锁播满 2s 一期后自动交还状态机（QA 锁=演示，不永久接管、不定死）。
 *
 * 口径与 tests/renderBballClips.test.mjs 一致：直接走 createAnimAvatar 解析真实 glb。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';

// Node 无 DOM：GLTFLoader 载贴图要走 self.URL / createImageBitmap，垫一层桩（只取骨架+动画）
if (typeof globalThis.self === 'undefined') globalThis.self = globalThis;
if (typeof globalThis.createImageBitmap === 'undefined') {
  globalThis.createImageBitmap = async () => ({ width: 1, height: 1, close() {} });
}
if (typeof URL.createObjectURL !== 'function') URL.createObjectURL = () => 'blob:stub';
if (typeof URL.revokeObjectURL !== 'function') URL.revokeObjectURL = () => {};

const { createAnimAvatar } = await import('../packages/game/dist/render/animAvatar.js');
const { initialRunnerState } = await import('../packages/game/dist/core/sim/simTypes.js');

const WHALE = 'assets/characters/whale.glb';
const adapter = { extras: { readBinary: async (path) => {
  const b = readFileSync(path);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
} } };
const noFx = { flyT: 0, invincible: false, magnetT: 0, helmetT: 0, shieldLayers: 0 };

function runningState(speed, supportY = 0) {
  const s = initialRunnerState();
  s.supportY = supportY;
  s.y = supportY;
  s.distance = 1;
  s.prevDistance = 1;
  return { s, speed };
}

/** 装配 + 驱动 sec 秒；urlParams 支持 'debug'（挂 __trAnim 探针）与 'anim=<Clip>'（QA 锁） */
async function drive(glb, sec, speed = 12, urlParams = 'debug', footfall = null) {
  const avatar = await createAnimAvatar(adapter, glb, 1, new URLSearchParams(urlParams));
  assert.ok(avatar, `GLB 装配失败（${glb}）：核心 clip 缺失或资产不合格`);
  const events = [];
  if (footfall) avatar.setFootfallHandler((x, y, z) => events.push({ x, y, z }));
  const { s } = runningState(speed);
  const dt = 1 / 60;
  const feet = [];
  for (let i = 0; i < Math.round(sec / dt); i++) {
    s.t += dt;
    s.prevDistance = s.distance;
    s.distance += speed * dt;
    avatar.group.position.set(s.x, s.y, 0);
    avatar.update(dt, s, noFx);
    const probe = globalThis.__trAnim;
    if (probe) feet.push({ L: probe.feet.L, R: probe.feet.R, act: probe.act, clip: probe.current, lock: probe.lock });
  }
  const log = globalThis.__trAnim ? [...globalThis.__trAnim.log] : [];
  avatar.setFootfallHandler(null);
  avatar.dispose();
  delete globalThis.__trAnim;
  return { events, feet, log };
}

test('鲸鱼女仆装配成功：10 个核心 clip + Laugh 齐全（纯配置接入，代码零改）', async () => {
  const { log } = await drive(WHALE, 0.2);
  assert.ok(log.length >= 1, '应有 clip 切换记录');
});

test('QA 锁表：Run/Slide/Fly/Death/Laugh 的时长与循环口径', async () => {
  const cases = [
    ['anim=Run', 'Run', 0.75, true],
    ['anim=Slide', 'Slide', 0.7, true],
    ['anim=Fly', 'Fly', 2.0, true],
    ['anim=Hit', 'Hit', 0.9, false],
    ['anim=Death', 'Death', 1.1, false],
    ['anim=Laugh', 'Laugh', 2.0, true], // 无缝循环的笑，loop 口径=循环
  ];
  for (const [param, clip, dur, loop] of cases) {
    const { feet, log } = await drive(WHALE, 0.5, 12, `debug&${param}`);
    assert.equal(feet.at(-1).act.clip, clip, `${param} 应锁到 ${clip}`);
    assert.ok(Math.abs(feet.at(-1).act.dur - dur) < 0.01, `${clip} 时长应为 ${dur}s`);
    assert.equal(log.find(e => e.clip === clip).loop, loop, `${clip} 的 loop 口径应为 ${loop}`);
  }
});

test('?anim=Laugh 播满 2s 一期后自动交还状态机（不永久接管、不会被定死）', async () => {
  // 表演 clip 锁播=演示一期：鲸鱼验收口径「2s 播完自动解锁」。状态机永不播 Laugh，零玩法影响。
  const { feet } = await drive(WHALE, 4, 12, 'debug&anim=Laugh');
  assert.equal(feet[30].clip, 'Laugh', '0.5s 时应锁播 Laugh');
  assert.equal(feet[Math.round(1.5 * 60)].clip, 'Laugh', '1.5s 时仍在演示期');
  assert.equal(feet.at(-1).clip, 'Run', '4s 时应已交还状态机回 Run');
  assert.equal(feet.at(-1).lock, null, '探针 lock 应已清空');
});

test('鲸鱼锁 ?anim=Basketball（资产没有该 clip）→ 回落 Run，不静默不播', async () => {
  const { feet } = await drive(WHALE, 0.5, 12, 'debug&anim=Basketball');
  assert.equal(feet.at(-1).clip, 'Run', '缺失的表演 clip 必须回落 Run');
});

test('朝向：五官网格在 Head 的 -Z 侧（背对镜头，防篮球小子 +Z 回归）', async () => {
  // 历史坑：bball.glb 曾面朝 +Z 正对镜头（建模侧 180° 翻转假设错误）。鲸鱼资产已实测修正，
  // 这里固化成门禁——以后任何新角色资产都该过这一条。
  const avatar = await createAnimAvatar(adapter, WHALE, 1, null);
  assert.ok(avatar);
  // 先落位再跑混流器（与局内顺序一致），否则读到的是未传播的世界矩阵
  const { s } = runningState(0);
  for (let i = 0; i < 30; i++) avatar.update(1 / 60, s, noFx); // 不动 → Idle 姿
  const g = avatar.group;
  const head = g.getObjectByName('Head');
  assert.ok(head, 'Head 骨必须存在');
  const v = new THREE.Vector3();
  const headZ = head.getWorldPosition(v).z;
  let checked = 0;
  for (const name of ['EyeL', 'EyeR', 'Nose', 'Mouth']) {
    const m = g.getObjectByName(name);
    assert.ok(m, `${name} 网格必须存在（五官在 -Z 侧的判据）`);
    const z = m.getWorldPosition(v).z;
    assert.ok(z < headZ - 0.01, `${name} 的 z=${z.toFixed(3)} 应在 Head(z=${headZ.toFixed(3)}) 的 -Z 侧`);
    checked++;
  }
  assert.equal(checked, 4);
  avatar.dispose();
});

test('无锁状态机：贴地前进时 Idle→Run 一次切换后持续循环，不跳 clip', async () => {
  const { log, feet } = await drive(WHALE, 3);
  assert.deepEqual(log.map(e => e.clip), ['Idle', 'Run'],
    `只允许进场那一次 Idle→Run，实测 ${JSON.stringify(log.map(e => e.clip))}`);
  assert.equal(feet.at(-1).clip, 'Run');
});

test('脚部探针 + 落脚尘土：Run 期间双脚坐标合法、持续摆动且喷尘土（Q 版短腿阈值专项）', async () => {
  // 鲸鱼放大后脚骨量程只到 ~0.39m（1.7m 级角色 0.44~0.82），FOOT_ENTER_Y=0.24 必须仍能
  // 进出触地区——否则 inContact 永假、尘土一次都不喷（验收第 5 条）。
  const { events, feet } = await drive(WHALE, 4, 12, 'debug', true);
  assert.ok(feet.length > 200, '采样不足');
  for (const f of feet) {
    for (const foot of [f.L, f.R]) {
      assert.ok(foot && foot.every(Number.isFinite), `脚坐标应合法，实测 ${JSON.stringify(foot)}`);
      assert.ok(foot[1] > 0 && foot[1] < 0.6, `脚高度应在合理区间，实测 ${foot[1]}`);
      assert.ok(Math.abs(foot[0]) < 1.5 && Math.abs(foot[2]) < 1.5, '脚应在角色附近');
    }
  }
  const ys = feet.map(f => f.L[1]);
  assert.ok(Math.max(...ys) - Math.min(...ys) > 0.15, '左脚应有可观测的抬落行程（摆腿放大生效）');
  assert.ok(Math.max(...ys) > 0.24, `左脚峰值 ${Math.max(...ys).toFixed(3)}m 必须高过触地阈值 0.24m，否则尘土不喷`);
  assert.ok(events.length >= 8, `落脚事件 ${events.length} 次过少：FootL/FootR 探测或阈值失效`);
});

test('buff 挂件锚点：Chest/Head 骨骼存在，chestY≈0.79m（Q 版身高，爆点偏低为已知取舍）', async () => {
  const avatar = await createAnimAvatar(adapter, WHALE, 1, null);
  assert.ok(avatar);
  assert.ok(avatar.getBone('Chest'), 'Chest 骨必须存在（喷火/护盾锚点）');
  assert.ok(avatar.getBone('Head'), 'Head 骨必须存在（头盔锚点）');
  assert.ok(Math.abs(avatar.chestY - 0.79) < 0.1, `chestY 应约 0.79m，实测 ${avatar.chestY.toFixed(3)}`);
  avatar.dispose();
});

test('铁律：资产缺失时静默回退（resolve null，不抛异常、不卡开局）', async () => {
  const avatar = await createAnimAvatar(adapter, 'assets/characters/nope.glb', 1, null);
  assert.equal(avatar, null, '拉取失败必须回退程序化模型');
});
