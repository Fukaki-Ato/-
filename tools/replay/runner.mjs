/**
 * tools/replay/runner.mjs — 输入重放格式 v1 的解析/校验 + 无头复跑（S19a，规范见 docs/replay-format.md）
 * 定位：golden-master 与 S18 云函数复跑防作弊共用的「重放执行器」，只依赖 core 的 dist 产物。
 * 模块 API：loadContent / parseReplay / loadReplayFile / eventToAction / runReplay / canonicalJson / sha256Hex
 * CLI：node tools/replay/runner.mjs <replay.json> [--json]   （需先 npm run build）
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { RunnerSim } from '../../packages/game/dist/core/sim/runnerSim.js';
import { STEP_DT } from '../../packages/game/dist/core/sim/simTypes.js';
import { CONTENT_NAMES } from '../../packages/game/dist/core/config/configTypes.js';
import { formatResult } from './report.mjs';

/** 本实现支持的唯一重放格式版本；未知版本一律拒绝加载（docs/replay-format.md §5） */
export const REPLAY_VERSION = 1;
/** v1 锁定 60fps 固定步长（core STEP_DT=1/60 秒）；dtMs 与之不符即拒绝 */
export const DT_MS = STEP_DT * 1000;
/** 未显式给出 maxFrames 时的兜底帧数上限（3 分钟） */
export const DEFAULT_MAX_FRAMES = 60 * 180;

export const repoRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');

/** 从仓库 config/ 读齐全部内容配置（与 tests/*.test.mjs 同源直读，不走网络/缓存链） */
export function loadContent(root = repoRoot) {
  const content = {};
  for (const name of CONTENT_NAMES) {
    content[name] = JSON.parse(readFileSync(join(root, 'config', `${name}.json`), 'utf8'));
  }
  return content;
}

/** 键序稳定的规范 JSON：同数据在任何机器/语言序列化结果一致，sha256 才可跨端比对（S18 复用点） */
export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonicalJson(value[k])}`);
  return `{${entries.join(',')}}`;
}

export function sha256Hex(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

const SWIPE_DIRS = new Set(['up', 'down', 'left', 'right']);

/**
 * 重放事件 → SimAction。映射与 packages/render/src/runnerScene.ts 的输入路由逐条对齐
 * （swipe/双击手势 + KeyboardEvent.code），保证「录制的操作」与「真机操作」驱动 sim 的方式一致。
 * tap 与未映射按键是合法记录事件但不驱动 sim，返回 null。
 */
export function eventToAction(ev) {
  if (ev.type === 'doubleTap') return 'skill';
  if (ev.type === 'swipe') {
    return { up: 'jump', down: 'slide', left: 'laneL', right: 'laneR' }[ev.payload.dir] ?? null;
  }
  if (ev.type === 'key') {
    return {
      ArrowLeft: 'laneL', ArrowRight: 'laneR', ArrowUp: 'jump', Space: 'jump',
      ArrowDown: 'slide', KeyE: 'skill', ShiftLeft: 'skill', ShiftRight: 'skill',
    }[ev.payload.code] ?? null;
  }
  return null; // tap：仅记录，不产生 sim 动作
}

/** 单条输入事件的形状校验 + payload 规范化（未知 type/payload 一律拒绝，防语义漂移） */
function normalizeEvent(ev, at, fail) {
  if (!ev || typeof ev !== 'object' || Array.isArray(ev)) fail(`${at} 必须是对象`);
  if (!Number.isInteger(ev.frame) || ev.frame < 0) fail(`${at}.frame 必须是 ≥0 的整数，实际 ${JSON.stringify(ev.frame)}`);
  const p = ev.payload;
  if (!p || typeof p !== 'object' || Array.isArray(p)) fail(`${at}.payload 必须是对象`);
  if (ev.type === 'swipe') {
    if (!SWIPE_DIRS.has(p.dir)) fail(`${at}.payload.dir 必须是 up|down|left|right，实际 ${JSON.stringify(p.dir)}`);
    return { frame: ev.frame, type: 'swipe', payload: { dir: p.dir } };
  }
  if (ev.type === 'tap' || ev.type === 'doubleTap') {
    for (const k of ['x', 'y']) {
      if (typeof p[k] !== 'number' || !Number.isFinite(p[k])) fail(`${at}.payload.${k} 必须是有限数字`);
    }
    return { frame: ev.frame, type: ev.type, payload: { x: p.x, y: p.y } };
  }
  if (ev.type === 'key') {
    if (typeof p.code !== 'string' || !p.code) fail(`${at}.payload.code 必须是非空字符串（KeyboardEvent.code）`);
    return { frame: ev.frame, type: 'key', payload: { code: p.code } };
  }
  fail(`${at}.type=${JSON.stringify(ev.type)} 不是 v${REPLAY_VERSION} 已知事件（swipe|tap|doubleTap|key），未知类型必须拒绝`);
}

/**
 * 校验并规范化重放数据；任何不合法字段抛 Error（宁可拒绝也不含糊——防作弊语义）。
 * 未知的顶层字段被忽略（v1 内的加法式演进，见 docs/replay-format.md §5）。
 */
export function parseReplay(data) {
  const fail = (msg) => { throw new Error(`[replay v${REPLAY_VERSION}] ${msg}`); };
  if (!data || typeof data !== 'object' || Array.isArray(data)) fail('顶层必须是 JSON 对象');
  if (data.version !== REPLAY_VERSION) {
    const got = data.version === undefined ? '缺失' : JSON.stringify(data.version);
    fail(`version=${got}：仅支持整数 ${REPLAY_VERSION}，未知版本必须拒绝加载（见 docs/replay-format.md §5）`);
  }
  if (!Number.isInteger(data.seed) || data.seed < 0 || data.seed > 0xffffffff) {
    fail(`seed 必须是 32 位无符号整数，实际 ${JSON.stringify(data.seed)}`);
  }
  if (typeof data.charId !== 'string') {
    fail(`charId 必须是字符串（空串=默认装备无角色），实际 ${JSON.stringify(data.charId)}`);
  }
  if (typeof data.dtMs !== 'number' || Math.abs(data.dtMs - DT_MS) > 1e-9) {
    fail(`dtMs 必须是 ${DT_MS}（v1 锁定 core STEP_DT=1/60s 固定步长），实际 ${JSON.stringify(data.dtMs)}`);
  }
  let maxFrames = DEFAULT_MAX_FRAMES;
  if (data.maxFrames !== undefined) {
    if (!Number.isInteger(data.maxFrames) || data.maxFrames <= 0) fail(`maxFrames 必须是正整数，实际 ${JSON.stringify(data.maxFrames)}`);
    maxFrames = data.maxFrames;
  }
  if (!Array.isArray(data.inputs)) fail('inputs 必须是数组（可为空）');
  const inputs = [];
  let prevFrame = 0;
  data.inputs.forEach((ev, i) => {
    const norm = normalizeEvent(ev, `inputs[${i}]`, fail);
    if (norm.frame < prevFrame) fail(`inputs[${i}].frame=${norm.frame} 小于前一事件 ${prevFrame}：inputs 必须按帧号非降序`);
    prevFrame = norm.frame;
    inputs.push(norm);
  });
  return { version: REPLAY_VERSION, seed: data.seed, charId: data.charId, dtMs: DT_MS, maxFrames, inputs };
}

/** 从磁盘加载重放文件（JSON 解析失败给出带路径的可读错误） */
export function loadReplayFile(path) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (e) {
    throw new Error(`[replay] 无法读取重放文件 ${path}: ${e.message}`);
  }
  try {
    return parseReplay(JSON.parse(text));
  } catch (e) {
    throw new Error(`[replay] 文件 ${path} 校验失败: ${e.message}`);
  }
}

/**
 * 无头执行一份重放：逐帧「按数组序 applyAction 该帧输入 → step() → drainEvents() 归属该帧」。
 * 停机：step 后首次 !alive（含该帧），或跑满 maxFrames。同 build 同配置下结果逐字节确定。
 * @returns {frames, summary, eventCounts, eventsSha256, inputsSha256}
 */
export function runReplay(content, data) {
  const replay = parseReplay(data);
  const sim = new RunnerSim(content, replay.seed, replay.charId || undefined);
  const eventLog = [];
  const counts = {};
  let cursor = 0;
  let frames = 0;
  while (frames < replay.maxFrames) {
    while (cursor < replay.inputs.length && replay.inputs[cursor].frame === frames) {
      const action = eventToAction(replay.inputs[cursor++]);
      if (action) sim.applyAction(action);
    }
    sim.step();
    frames++;
    for (const ev of sim.drainEvents()) {
      eventLog.push([frames - 1, ev]);
      counts[ev.type] = (counts[ev.type] ?? 0) + 1;
    }
    if (!sim.state.alive) break;
  }
  const eventCounts = Object.fromEntries(Object.entries(counts).sort(([a], b) => (a < b ? -1 : 1)));
  return {
    frames,
    summary: sim.summary(),
    eventCounts,
    eventsSha256: sha256Hex(canonicalJson(eventLog)),
    inputsSha256: sha256Hex(canonicalJson(replay.inputs)),
  };
}

/** CLI 入口：仅在以脚本方式直接运行时执行（被 import 时不触发） */
function main() {
  const args = process.argv.slice(2);
  const file = args.find(a => !a.startsWith('--'));
  if (!file) {
    console.error('用法: node tools/replay/runner.mjs <replay.json> [--json]');
    process.exit(2);
  }
  const replay = loadReplayFile(file);
  const result = runReplay(loadContent(), replay);
  if (args.includes('--json')) {
    const { inputs, ...meta } = replay;
    console.log(JSON.stringify({ ...meta, inputCount: inputs.length, result }, null, 2));
  } else {
    console.log(formatResult(replay, result));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
