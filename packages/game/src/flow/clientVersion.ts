import type { GameContent } from '../core/config/configTypes.js';
import { SIMULATION_BUILD_ID } from '../core/simulationBuild.js';
import { hashSeed } from '../core/rng.js';
import { leaderboardRulesId as configurationRulesId } from '../core/leaderboard.js';

const canonical = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const data = value as Record<string, unknown>;
  return `{${Object.keys(data).sort().map(key => `${JSON.stringify(key)}:${canonical(data[key])}`).join(',')}}`;
};
const builtId = (value: string): string => {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error('模拟版本未生成，请先执行根目录构建');
  return value;
};

/** Compatibility declaration, not authentication or anti-cheat; the server still owns replay rules. */
export function missionClientRulesId(content: GameContent, buildId = SIMULATION_BUILD_ID): string {
  const json = JSON.parse(JSON.stringify(content));
  return `mission-client-v1:${builtId(buildId)}:${hashSeed(canonical(json)).toString(16).padStart(8, '0')}`;
}

/** Keep the core's configuration-only v2 digest intact; the wire contract is now code-aware v3. */
export function rankedClientRulesId(content: GameContent, buildId = SIMULATION_BUILD_ID): string {
  return `first-coin-v3:${builtId(buildId)}:${configurationRulesId(content)}`;
}
