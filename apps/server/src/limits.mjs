import { MISSION_MAX_FRAMES, MISSION_MAX_ACTIONS } from '@tr/game/core/missions/limits.js';
/** Request/replay guardrails; gameplay thresholds remain in economy.json. */
export const DEFAULT_LIMITS = Object.freeze({
  bodyBytes: 1024 * 1024,
  maxFrames: MISSION_MAX_FRAMES,
  maxActions: MISSION_MAX_ACTIONS,
  runTicketTtlMs: 24 * 60 * 60 * 1000,
  replayTimeAllowanceMs: 2000,
  /** 单次回放的墙钟上限：与并发槽共同兜底「超长局打瘫结算」（排行榜 worker 为 15s，审查 S-2） */
  replayWallClockMs: 15 * 1000,
  maxConcurrentReplays: 2,
  ipRequestsPerMinute: 180,
  userRequestsPerMinute: 240,
  rateWindowMs: 60 * 1000,
  /** 限速桶数量上限：超限按插入序驱逐最旧桶，保证内存有界（对齐排行榜 BoundedRateLimiter） */
  rateMaxBuckets: 4096,
  sessionCookieMaxAgeSeconds: 365 * 24 * 60 * 60,
  /** 数据保留与清理：runs 无限增长会拖垮 SQLite（审查 S-3） */
  openRunsPerUser: 4,
  runRetentionMs: 7 * 24 * 60 * 60 * 1000,
  userRetentionMs: 30 * 24 * 60 * 60 * 1000,
  purgeIntervalMs: 30 * 60 * 1000,
});
