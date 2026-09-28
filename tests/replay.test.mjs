/**
 * S19a 输入重放格式 v1 单测（node:test）。
 * 覆盖：解析/规范化、非法版本与非法字段拒绝、事件→SimAction 映射表、
 *       runner 确定性（同重放两次摘要一致）、recorder 编排确定性、示例文件可加载。
 * 依赖 tools/replay/*.mjs（其内部 import core 的 dist 产物——先 npm run build）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_MAX_FRAMES, DT_MS, REPLAY_VERSION, canonicalJson, eventToAction,
  loadContent, loadReplayFile, parseReplay, runReplay, sha256Hex,
} from '../tools/replay/runner.mjs';
import { makeReplay, scriptInputs } from '../tools/replay/recorder.mjs';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const content = loadContent(root);

/** 一份最小合法重放（每次深拷贝再改，保证用例互不污染） */
function base(over = {}) {
  return {
    version: 1, seed: 4242, charId: 'char_volt', dtMs: DT_MS,
    inputs: [{ frame: 30, type: 'swipe', payload: { dir: 'up' } }],
    ...over,
  };
}
const clone = (v) => JSON.parse(JSON.stringify(v));
/** 断言「改一处就拒绝」，且错误信息可读（含关键字） */
function assertRejects(mutate, keyword) {
  const bad = clone(base());
  mutate(bad);
  assert.throws(() => parseReplay(bad), (e) => {
    assert.ok(e instanceof Error);
    assert.match(e.message, new RegExp(keyword));
    return true;
  });
}

// ---------- 解析与规范化 ----------

test('合法重放：解析通过并规范化（缺省 maxFrames 补默认值）', () => {
  const r = parseReplay(base());
  assert.equal(r.version, REPLAY_VERSION);
  assert.equal(r.seed, 4242);
  assert.equal(r.charId, 'char_volt');
  assert.equal(r.dtMs, DT_MS);
  assert.equal(r.maxFrames, DEFAULT_MAX_FRAMES);
  assert.equal(r.inputs.length, 1);
});

test('charId 空串合法（=默认装备）；未知顶层字段被忽略（v1 加法演进）', () => {
  const r = parseReplay(base({ charId: '', futureField: { a: 1 } }));
  assert.equal(r.charId, '');
  assert.equal('futureField' in r, false);
});

test('payload 规范化：多余键被剥离，只留规范形状', () => {
  const r = parseReplay(base({
    inputs: [
      { frame: 1, type: 'swipe', payload: { dir: 'up', junk: true } },
      { frame: 2, type: 'doubleTap', payload: { x: 10, y: 20, extra: 'x' } },
      { frame: 3, type: 'key', payload: { code: 'KeyE', repeat: 1 } },
    ],
  }));
  assert.deepEqual(r.inputs, [
    { frame: 1, type: 'swipe', payload: { dir: 'up' } },
    { frame: 2, type: 'doubleTap', payload: { x: 10, y: 20 } },
    { frame: 3, type: 'key', payload: { code: 'KeyE' } },
  ]);
});

test('inputs 允许空数组（挂机重放）', () => {
  assert.deepEqual(parseReplay(base({ inputs: [] })).inputs, []);
});

// ---------- 拒绝非法输入（宁可拒绝不可含糊） ----------

test('未知/非法版本一律拒绝（含数字字符串 "1" 与未来版本 2）', () => {
  assertRejects((r) => { r.version = 2; }, 'version=2');
  assertRejects((r) => { r.version = '1'; }, 'version="1"');
  assertRejects((r) => { delete r.version; }, 'version=缺失');
});

test('非法 seed/charId/dtMs/maxFrames 拒绝', () => {
  assertRejects((r) => { r.seed = -1; }, 'seed');
  assertRejects((r) => { r.seed = 1.5; }, 'seed');
  assertRejects((r) => { r.seed = 2 ** 32; }, 'seed');
  assertRejects((r) => { r.charId = null; }, 'charId');
  assertRejects((r) => { r.dtMs = 33.3; }, 'dtMs');
  assertRejects((r) => { r.maxFrames = 0; }, 'maxFrames');
  assertRejects((r) => { r.inputs = null; }, 'inputs');
});

test('非法事件拒绝：frame 乱序/负数、未知 type、payload 形状错误', () => {
  assertRejects((r) => { r.inputs = [{ frame: 5, type: 'tap', payload: { x: 0, y: 0 } }, { frame: 4, type: 'tap', payload: { x: 0, y: 0 } }]; }, '非降序');
  assertRejects((r) => { r.inputs = [{ frame: -1, type: 'tap', payload: { x: 0, y: 0 } }]; }, 'frame');
  assertRejects((r) => { r.inputs = [{ frame: 1.5, type: 'tap', payload: { x: 0, y: 0 } }]; }, 'frame');
  assertRejects((r) => { r.inputs = [{ frame: 1, type: 'gesture3d', payload: {} }]; }, '未知类型必须拒绝');
  assertRejects((r) => { r.inputs = [{ frame: 1, type: 'swipe', payload: { dir: 'sideways' } }]; }, 'dir');
  assertRejects((r) => { r.inputs = [{ frame: 1, type: 'doubleTap', payload: { x: 'a', y: 0 } }]; }, 'payload\\.x');
  assertRejects((r) => { r.inputs = [{ frame: 1, type: 'key', payload: { code: '' } }]; }, 'code');
});

// ---------- 事件 → SimAction 映射（与 runnerScene.ts 对齐） ----------

test('映射表：手势/按键 → SimAction，tap 与未映射按键为 null', () => {
  const ev = (type, payload) => eventToAction({ frame: 0, type, payload });
  assert.equal(ev('swipe', { dir: 'up' }), 'jump');
  assert.equal(ev('swipe', { dir: 'down' }), 'slide');
  assert.equal(ev('swipe', { dir: 'left' }), 'laneL');
  assert.equal(ev('swipe', { dir: 'right' }), 'laneR');
  assert.equal(ev('doubleTap', { x: 1, y: 2 }), 'skill');
  assert.equal(ev('tap', { x: 1, y: 2 }), null);
  assert.equal(ev('key', { code: 'ArrowLeft' }), 'laneL');
  assert.equal(ev('key', { code: 'ArrowRight' }), 'laneR');
  assert.equal(ev('key', { code: 'ArrowUp' }), 'jump');
  assert.equal(ev('key', { code: 'Space' }), 'jump');
  assert.equal(ev('key', { code: 'ArrowDown' }), 'slide');
  for (const code of ['KeyE', 'ShiftLeft', 'ShiftRight']) assert.equal(ev('key', { code }), 'skill');
  assert.equal(ev('key', { code: 'Escape' }), null);
});

test('tap 事件不改变 sim 结果：同 seed 下与无输入重放的推进/结算/事件哈希一致', () => {
  const taps = Array.from({ length: 20 }, (_, i) => ({ frame: i * 10, type: 'tap', payload: { x: 100, y: 200 } }));
  const a = runReplay(content, base({ charId: '', maxFrames: 300, inputs: [] }));
  const b = runReplay(content, base({ charId: '', maxFrames: 300, inputs: taps }));
  assert.equal(b.frames, a.frames);
  assert.deepEqual(b.summary, a.summary);
  assert.deepEqual(b.eventCounts, a.eventCounts);
  assert.equal(b.eventsSha256, a.eventsSha256);
  assert.notEqual(b.inputsSha256, a.inputsSha256, '输入不同则 inputsSha256 必须不同');
});

// ---------- runner 确定性 ----------

test('runner 确定性：同一重放跑两次，摘要逐字段一致（含两个 sha256）', () => {
  const replay = makeReplay(20260922, 'char_ama', { maxFrames: 900 });
  const a = runReplay(content, replay);
  const b = runReplay(content, clone(replay));
  assert.deepEqual(a, b);
  assert.match(a.eventsSha256, /^[0-9a-f]{64}$/);
  assert.match(a.inputsSha256, /^[0-9a-f]{64}$/);
});

test('无输入重放必然出局（一条命 + 随机赛道），且死亡帧停机', () => {
  const r = runReplay(content, base({ charId: '', inputs: [], maxFrames: 60 * 120 }));
  assert.equal(r.summary.alive, false);
  assert.ok(r.eventCounts.death >= 1);
  assert.ok(r.frames < 60 * 120, '死亡后应立即停机而非跑满上限');
});

test('canonicalJson 键序稳定：同数据不同插入序 → 同哈希；改一个事件 → 哈希变化', () => {
  const h = (v) => sha256Hex(canonicalJson(v));
  assert.equal(h({ a: 1, b: [2, { c: 3, d: 4 }] }), h({ b: [2, { d: 4, c: 3 }], a: 1 }));
  const inputs = scriptInputs(777, 'char_volt', { maxFrames: 600 });
  const touched = clone(inputs);
  touched[0] = { ...touched[0], frame: touched[0].frame + 1 };
  assert.notEqual(h(inputs), h(touched));
});

// ---------- recorder 编排确定性 ----------

test('recorder 确定性：同 (seed,charId) 两次编排逐字节一致，不同 seed 编排不同', () => {
  const a = scriptInputs(777, 'char_kaze', { maxFrames: 1800 });
  assert.deepEqual(a, scriptInputs(777, 'char_kaze', { maxFrames: 1800 }));
  assert.notDeepEqual(a, scriptInputs(778, 'char_kaze', { maxFrames: 1800 }));
  assert.ok(a.length > 20, '编排应有足够密度的输入');
  assert.ok(a.every((ev, i) => i === 0 || ev.frame >= a[i - 1].frame), '帧号非降序');
  assert.ok(a.some((ev) => ev.type === 'swipe') && a.some((ev) => ev.type === 'key'),
    '单条编排应同时覆盖手势与键盘两种输入通道');
  // doubleTap 权重低，单条编排可能抽不到——在固定 seed 集的并集上断言（编排确定，断言稳定）
  const union = [...a, ...scriptInputs(20260922, 'char_ama', { maxFrames: 1800 })];
  assert.ok(union.some((ev) => ev.type === 'doubleTap'), '编排全集应覆盖 doubleTap（技能手势）');
});

test('makeReplay 产物直接过 parseReplay 校验', () => {
  const r = parseReplay(makeReplay(101, 'char_ama', { maxFrames: 600 }));
  assert.equal(r.version, 1);
  assert.equal(r.maxFrames, 600);
});

// ---------- 示例文件 ----------

test('规范示例文件存在、可加载并可复跑', () => {
  const path = join(root, 'tools', 'replay', 'examples', 'example-v1.json');
  const replay = loadReplayFile(path);
  assert.equal(replay.version, REPLAY_VERSION);
  assert.equal(replay.seed, 777);
  assert.equal(replay.charId, 'char_volt');
  const r = runReplay(content, replay);
  assert.ok(r.frames > 0 && r.summary.score > 0);
});
