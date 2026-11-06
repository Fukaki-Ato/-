import { RunnerSim } from '@tr/game/core/sim/runnerSim.js';
import { STEP_DT } from '@tr/game/core/sim/simTypes.js';
import { setImmediate } from 'node:timers/promises';

export { STEP_DT };

/** Replay timeout marker: mission-service maps it to HTTP 408 so the run stays open for retry. */
export class ReplayTimeoutError extends Error {
  constructor() { super('回放超出墙钟上限'); this.code = 'REPLAY_TIMEOUT'; }
}

/** Repeat exactly one applyAction-before-step input batch per deterministic fixed tick.
 *  timeoutMs：墙钟护栏（每 600 帧让步时检查）——不设上限时单账号可用超长局占满并发槽（审查 S-2）。 */
export async function replayRun(content, run, frames, actions, timeoutMs = Number.POSITIVE_INFINITY, items = []) {
  const startedAt = performance.now();
  const sim = new RunnerSim(content, run.seed, run.char_id || undefined, false, items);
  let cursor = 0;
  let completedFrames = 0;
  for (let frame = 0; frame < frames; frame++) {
    while (cursor < actions.length && actions[cursor].frame === frame) {
      sim.applyAction(actions[cursor].action);
      cursor++;
    }
    sim.step();
    sim.drainEvents();
    completedFrames++;
    if (!sim.state.alive) break;
    if (completedFrames % 600 === 0) {
      await setImmediate();
      if (performance.now() - startedAt > timeoutMs) throw new ReplayTimeoutError();
    }
  }
  return {
    frames: completedFrames,
    summary: sim.summary(),
    elapsedSeconds: sim.state.t,
    missionStats: sim.missionStats ?? { slides: 0, itemPickups: 0 },
  };
}
