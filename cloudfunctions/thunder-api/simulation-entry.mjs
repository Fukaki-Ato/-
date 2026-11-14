// Build input only. esbuild embeds these same-source configs and compiled pure
// core modules; the deployed simulation.cjs has no imports outside the function.
import { RunnerSim } from '../../packages/game/dist/core/sim/runnerSim.js';
import { STEP_DT } from '../../packages/game/dist/core/sim/simTypes.js';
import { leaderboardRulesId, MAX_RANKED_FRAMES, MAX_RANKED_INPUTS } from '../../packages/game/dist/core/leaderboard.js';
import game from '../../config/game.json' with { type: 'json' };
import characters from '../../config/characters.json' with { type: 'json' };
import skills from '../../config/skills.json' with { type: 'json' };
import items from '../../config/items.json' with { type: 'json' };
import obstacles from '../../config/obstacles.json' with { type: 'json' };
export { default as economy } from '../../config/economy.json' with { type: 'json' };
export { default as themes } from '../../config/themes.json' with { type: 'json' };
export { getMissionPeriods } from '../../apps/server/src/periods.mjs';

export const content = { game, characters, skills, items, obstacles };
export const rulesId = leaderboardRulesId(content);
export { MAX_RANKED_FRAMES, MAX_RANKED_INPUTS };

export function replayRun(run, frames, inputs, finishReason) {
  const sim = new RunnerSim(content, run.seed, run.charId);
  let cursor = 0;
  for (let frame = 0; frame < frames; frame++) {
    while (cursor < inputs.length && inputs[cursor].frame === frame) sim.applyAction(inputs[cursor++].action);
    sim.step();
    sim.drainEvents();
    if (!sim.state.alive && frame !== frames - 1) return { accepted: false };
  }
  const summary = sim.summary();
  if ((finishReason !== 'quit' && sim.state.alive) || sim.replayFrames !== frames) return { accepted: false };
  const firstCoinRecord = sim.firstCoinRecord.snapshot(summary);
  if (![summary.coins, summary.score, firstCoinRecord.score].every(n => Number.isSafeInteger(n) && n >= 0)
    || ![summary.distance, firstCoinRecord.distance].every(n => Number.isFinite(n) && n >= 0)) {
    return { accepted: false };
  }
  return { accepted: true, summary, firstCoinRecord, elapsedSeconds: frames * STEP_DT,
    missionStats: sim.missionStats };
}
