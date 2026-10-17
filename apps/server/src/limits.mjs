import { MISSION_MAX_FRAMES, MISSION_MAX_ACTIONS } from '@tr/game/core/missions/limits.js';
/** Request/replay guardrails; gameplay thresholds remain in economy.json. */
export const DEFAULT_LIMITS = Object.freeze({
  bodyBytes: 1024 * 1024,
  maxFrames: MISSION_MAX_FRAMES,
  maxActions: MISSION_MAX_ACTIONS,
  runTicketTtlMs: 24 * 60 * 60 * 1000,
  replayTimeAllowanceMs: 2000,
  maxConcurrentReplays: 2,
  ipRequestsPerMinute: 180,
  userRequestsPerMinute: 240,
  rateWindowMs: 60 * 1000,
  sessionCookieMaxAgeSeconds: 365 * 24 * 60 * 60,
});
