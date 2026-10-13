import type { RunnerState } from './simTypes.js';

export interface FirstCoinStats {
  distance: number;
  score: number;
  stoppedByCoin: boolean;
}

/** The normal score formula, shared with the exact pre-pickup checkpoint. */
export function scoreForState(s: RunnerState, params: Record<string, number>, bonus: number): number {
  return Math.floor(s.distance) * (params.perMeter ?? 10)
    + s.coins * (params.perCoin ?? 5)
    + s.nearMiss * (params.perNearMiss ?? 25) + bonus;
}

/** Freeze once, BEFORE the first actual pickup is credited, regardless of currency multipliers. */
export class FirstCoinRecord {
  private first: FirstCoinStats | null = null;

  capture(distance: number, score: number): void {
    if (this.first === null) this.first = { distance: +distance.toFixed(2), score, stoppedByCoin: true };
  }

  snapshot(final: { distance: number; score: number }): FirstCoinStats {
    return this.first ? { ...this.first } : { distance: final.distance, score: final.score, stoppedByCoin: false };
  }
}
