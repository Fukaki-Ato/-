/**
 * tools/replay/recorder.mjs — 程序化生成重放格式 v1 文件（S19a）
 * 编排规则：伪随机但同 (seed, charId) 逐字节确定——随机源用 core 的 RunRng（禁 Math.random），
 * 派生种子 = hashSeed(`replay-inputs:v1:${seed}:${charId}`)，与赛道 seed 同源但互不影响。
 * 动作以 platform 事件形状落盘（swipe/doubleTap/键盘 code 随机取一，覆盖两种输入通道），
 * 由 runner.mjs 按 docs/replay-format.md §3 的映射表驱动 sim。
 * CLI：node tools/replay/recorder.mjs --seed=777 --char=char_volt [--frames=3600] [--out=path.json]
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { RunRng, hashSeed } from '../../packages/game/dist/core/rng.js';
import { DEFAULT_MAX_FRAMES, DT_MS, REPLAY_VERSION } from './runner.mjs';

/** SimAction → 候选平台事件形状（对齐 packages/platform 的 Gesture 与 onKey code） */
const FORMS = {
  jump: [{ type: 'swipe', payload: { dir: 'up' } }, { type: 'key', payload: { code: 'ArrowUp' } }, { type: 'key', payload: { code: 'Space' } }],
  slide: [{ type: 'swipe', payload: { dir: 'down' } }, { type: 'key', payload: { code: 'ArrowDown' } }],
  laneL: [{ type: 'swipe', payload: { dir: 'left' } }, { type: 'key', payload: { code: 'ArrowLeft' } }],
  laneR: [{ type: 'swipe', payload: { dir: 'right' } }, { type: 'key', payload: { code: 'ArrowRight' } }],
  // doubleTap 的触点坐标由 rng 现场生成（标称 720×1280 屏内），不影响 sim 映射
  skill: [{ type: 'doubleTap' }, { type: 'key', payload: { code: 'KeyE' } }, { type: 'key', payload: { code: 'ShiftLeft' } }],
};

/** 动作编排权重：换道最频繁，技能尝试最少（能量满时才会真正释放，空放是无害 no-op） */
const WEIGHTED_ACTIONS = [['laneL', 24], ['laneR', 24], ['jump', 22], ['slide', 18], ['skill', 12]];

/** 相邻输入事件的帧间隔范围（≈0.17s–0.8s，接近真人节奏） */
const GAP_FRAMES = [10, 48];
/** 首个事件的起始帧（留出开局静止段） */
const START_FRAME = 24;

function emitEvent(rng, action) {
  const form = rng.pick(FORMS[action]);
  if (form.type === 'doubleTap') return { type: 'doubleTap', payload: { x: rng.int(40, 680), y: rng.int(120, 1160) } };
  return { type: form.type, payload: { ...form.payload } };
}

/**
 * 生成脚本化输入序列：[{frame,type,payload}]，帧号非降序、同参数逐字节确定。
 * @param {number} seed 赛道 seed（同时派生输入编排的 rng 种子）
 * @param {string} charId 角色 id（参与派生，不同角色编排不同）
 * @param {{maxFrames?: number, startFrame?: number}} opts
 */
export function scriptInputs(seed, charId = '', opts = {}) {
  const maxFrames = opts.maxFrames ?? DEFAULT_MAX_FRAMES;
  const rng = new RunRng(hashSeed(`replay-inputs:v1:${seed}:${charId}`));
  const inputs = [];
  for (let frame = opts.startFrame ?? START_FRAME; frame < maxFrames; frame += rng.int(...GAP_FRAMES)) {
    const [action] = rng.weighted(WEIGHTED_ACTIONS, (a) => a[1]);
    inputs.push({ frame, ...emitEvent(rng, action) });
  }
  return inputs;
}

/** 组装一份完整的重放格式 v1 对象（可直接 JSON 落盘 / 喂给 runReplay） */
export function makeReplay(seed, charId = '', opts = {}) {
  const maxFrames = opts.maxFrames ?? DEFAULT_MAX_FRAMES;
  return {
    version: REPLAY_VERSION,
    seed,
    charId,
    dtMs: DT_MS,
    maxFrames,
    inputs: scriptInputs(seed, charId, { ...opts, maxFrames }),
  };
}

function parseArgs(argv) {
  const opts = {};
  for (const arg of argv) {
    const m = /^--(\w[\w-]*)=(.*)$/.exec(arg);
    if (m) opts[m[1]] = m[2];
  }
  return opts;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const seed = Number(opts.seed);
  if (!opts.seed || !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    console.error('用法: node tools/replay/recorder.mjs --seed=<uint32> [--char=char_volt] [--frames=3600] [--out=path.json]');
    process.exit(2);
  }
  const replay = makeReplay(seed, opts.char ?? '', opts.frames ? { maxFrames: Number(opts.frames) } : {});
  const text = `${JSON.stringify(replay, null, 2)}\n`;
  if (opts.out) {
    writeFileSync(opts.out, text, 'utf8');
    console.log(`已写入 ${opts.out}（seed=${seed} char=${replay.charId || '(默认)'} 输入 ${replay.inputs.length} 条 maxFrames=${replay.maxFrames}）`);
  } else {
    process.stdout.write(text);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
