import type { RunnerSim } from '../sim/runnerSim.js';
import type { SimAction } from '../sim/simTypes.js';
import { MISSION_MAX_FRAMES, MISSION_MAX_ACTIONS } from './limits.js';

/** 记录真实固定步而非渲染帧；不录死亡动画、不修改模拟结果。 */
export function recordMissionRun(sim: RunnerSim) {
  const step = sim.step;
  const apply = sim.applyAction;
  const actions: { frame: number; action: SimAction }[] = [];
  let frames = 0;
  let overflow = false;
  sim.step = function () {
    if (this.state.alive) {
      frames++;
      if (frames > MISSION_MAX_FRAMES) overflow = true;
    }
    step.call(this);
  };
  sim.applyAction = function (action) {
    if (this.state.alive && !overflow) {
      if (actions.length >= MISSION_MAX_ACTIONS) overflow = true;
      else actions.push({ frame: frames, action });
    }
    apply.call(this, action);
  };
  return () => {
    sim.step = step;
    sim.applyAction = apply;
    if (overflow) throw new Error('本局过长，无法同步任务进度');
    return { frames, actions: actions.filter(event => event.frame < frames) };
  };
}
