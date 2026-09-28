/**
 * tools/replay/report.mjs — 复跑结果的可读输出与逐字段 diff（S19a）
 * 供 runner.mjs CLI、golden-gen.mjs 校验模式与 tests/golden.test.mjs 共用，
 * 保证「失败时打印哪个 seed/角色/字段/期望 vs 实际」只有一份实现。
 */
import { STEP_DT } from '../../packages/game/dist/core/sim/simTypes.js';

/** 把复跑结果摊平成 字段路径 → 标量（summary.score / eventCounts.coin / eventsSha256 …） */
export function flattenResult(result, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(result)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flattenResult(v, key, out);
    else out[key] = v;
  }
  return out;
}

const show = (v) => {
  if (v === undefined) return '(缺失)';
  if (typeof v === 'string' && v.length > 24) return `${v.slice(0, 12)}…(${v.length} 字符)`;
  return JSON.stringify(v);
};

/**
 * 逐字段对比两份复跑结果，返回可读差异列表（空数组 = 完全一致）。
 * 条目形如：`summary.score: 期望 45600, 实际 45590`。
 */
export function diffResults(expected, actual) {
  const e = flattenResult(expected);
  const a = flattenResult(actual);
  const keys = [...new Set([...Object.keys(e), ...Object.keys(a)])].sort();
  const problems = [];
  for (const k of keys) {
    if (JSON.stringify(e[k] ?? null) !== JSON.stringify(a[k] ?? null)) {
      problems.push(`  ${k}: 期望 ${show(e[k])}, 实际 ${show(a[k])}`);
    }
  }
  return problems;
}

/** 人读摘要（runner.mjs CLI 默认输出） */
export function formatResult(replay, result) {
  const s = result.summary;
  const secs = result.frames * STEP_DT;
  const counts = Object.entries(result.eventCounts).map(([k, v]) => `${k}=${v}`).join(' ') || '(无)';
  return [
    `重放 v${replay.version}: seed=${replay.seed} char=${replay.charId || '(默认)'} dtMs=${(STEP_DT * 1000).toFixed(3)} 输入=${replay.inputs.length} 条`,
    `推进: ${result.frames} 帧（${secs.toFixed(1)}s） 终局: ${s.alive ? '存活（达帧数上限）' : '死亡'}`,
    `结算: score=${s.score} distance=${s.distance}m coins=${s.coins} nearMiss=${s.nearMiss} hits=${s.hits} casts=${s.casts} t=${s.t}s`,
    `事件计数: ${counts}`,
    `事件序列 sha256: ${result.eventsSha256}`,
    `输入序列 sha256: ${result.inputsSha256}`,
  ].join('\n');
}
