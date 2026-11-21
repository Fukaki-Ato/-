import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { ApiError } from './errors.mjs';
import { DEFAULT_LIMITS } from './limits.mjs';

export const REPLAY_ABI = 1;
const canonical = value => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
};
const digest = definition => createHash('sha256').update(canonical(definition)).digest('hex');
export const replaySourceHash = source => createHash('sha256').update(source).digest('hex');

/** Trusted build artifact, never a client-provided module/path. */
export function readReplaySource() {
  return readFileSync(new URL('../dist/replay-runtime.mjs', import.meta.url), 'utf8');
}

export function createRuleset({ content, minRunSeconds, limits = DEFAULT_LIMITS, runtimeSource = readReplaySource() }) {
  // Hash the same JSON data that is persisted, including omission of optional undefined fields.
  const definition = { abi: REPLAY_ABI, runtimeSource, content: JSON.parse(JSON.stringify(content)), minRunSeconds,
    maxFrames: limits.maxFrames, maxActions: limits.maxActions };
  const ruleset = { id: digest(definition), definition };
  verifyRuleset(ruleset);
  return ruleset;
}

export function verifyRuleset(ruleset) {
  const definition = ruleset?.definition;
  if (!definition || definition.abi !== REPLAY_ABI || typeof definition.runtimeSource !== 'string' || !definition.runtimeSource
    || !definition.content || typeof definition.content !== 'object'
    || !Number.isFinite(definition.minRunSeconds) || definition.minRunSeconds < 0 || definition.minRunSeconds > 600
    || !Number.isInteger(definition.maxFrames) || definition.maxFrames <= 0
    || !Number.isInteger(definition.maxActions) || definition.maxActions < 0
    || ruleset.id !== digest(definition)) throw new Error('Invalid replay ruleset');
  return definition;
}

/** This project's verified pre-binding production baseline. Other deployments must supply their own. */
export function readLegacyRuleset() {
  const baseline = JSON.parse(readFileSync(new URL('../rules-baselines/38d5116.json', import.meta.url), 'utf8'));
  verifyRuleset(baseline);
  return baseline;
}

export function readBoundRuleset(store, id) {
  try { return verifyRuleset(store.getRuleset(id)); }
  catch { throw new ApiError(503, '这场对局的回放规则暂不可用，请保留记录后重试'); }
}

export async function loadReplayRuntime(definition, trustedHashes) {
  try {
    // Database integrity is not code provenance: trust is anchored outside SQLite in the local
    // current/baseline artifacts or explicitly configured hashes of retained releases.
    if (!trustedHashes.has(replaySourceHash(definition.runtimeSource))) throw new Error('Untrusted replay runtime');
    const module = await import(`data:text/javascript;base64,${Buffer.from(definition.runtimeSource).toString('base64')}`);
    if (typeof module.replayRun !== 'function' || !Number.isFinite(module.STEP_DT) || module.STEP_DT <= 0) throw new Error();
    return module;
  } catch { throw new ApiError(503, '这场对局的回放程序暂不可用，请保留记录后重试'); }
}
