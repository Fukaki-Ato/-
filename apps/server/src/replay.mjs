import { RunnerSim } from '@tr/game/core/sim/runnerSim.js';
import { STEP_DT } from '@tr/game/core/sim/simTypes.js';
import { setImmediate } from 'node:timers/promises';

export { STEP_DT };

/** Repeat exactly one applyAction-before-step input batch per deterministic fixed tick. */
export async function replayRun(content, run, frames, actions) {
  const sim = new RunnerSim(content, run.seed, run.char_id || undefined);
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
    if (completedFrames % 600 === 0) await setImmediate();
  }
  return {
    frames: completedFrames,
    summary: sim.summary(),
    elapsedSeconds: sim.state.t,
    missionStats: sim.missionStats ?? { slides: 0, itemPickups: 0 },
  };
}
