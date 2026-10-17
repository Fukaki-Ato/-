import { GROUND_COIN_CLEAR_Y } from './collect.js';
import { STEP_DT } from './simTypes.js';

/** Unboosted jump's coin-clear window, using the same semi-implicit steps as Movement. */
export function coinJumpSpan(runner: Record<string, number>, speed: number, ratio: number): number {
  let y = 0.001, vy = runner.jumpVelocity ?? 15.2, clearSteps = 0;
  const gravity = runner.gravity ?? -38;
  if (gravity >= 0 || vy <= 0) return 0;
  for (let frame = 0; frame < 600; frame++) {
    vy += gravity * STEP_DT;
    y += vy * STEP_DT;
    if (y >= GROUND_COIN_CLEAR_Y) clearSteps++;
    if (y <= 0) break;
  }
  return Math.max(0, clearSteps - 1) * STEP_DT * speed * ratio;
}
