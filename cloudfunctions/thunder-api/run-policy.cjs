const { createHash } = require('node:crypto');
const RUN_TTL_MS = 1860 * 1000;
const CLOCK_SLOP_MS = 2000;
const ACTIONS = new Set(['jump', 'slide', 'laneL', 'laneR', 'skill']);

class RunError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const reject = code => { throw new RunError(code); };
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const boardIdFor = (appId, rulesId) => digest([appId, rulesId]);
const recordIdFor = (boardId, playerId) => digest([boardId, playerId]);
const playerNameFor = playerId => `跑者-${playerId.slice(2, 14)}`;

function exactRequest(event, keys) {
  if (!event || typeof event !== 'object' || Array.isArray(event)
    || Object.keys(event).length !== keys.length || !keys.every(key => Object.hasOwn(event, key))) {
    reject('INVALID_REQUEST');
  }
}

function runId(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value)) reject('INVALID_REQUEST');
  return value;
}

function normalizeReplay(event, limits) {
  exactRequest(event, ['action', 'runId', 'frames', 'inputs',
    ...(Object.hasOwn(event, 'finishReason') ? ['finishReason'] : [])]);
  if (Object.hasOwn(event, 'finishReason') && event.finishReason !== 'quit') reject('INVALID_REQUEST');
  runId(event.runId);
  if (!Number.isInteger(event.frames) || event.frames < 1 || event.frames > limits.MAX_RANKED_FRAMES
    || !Array.isArray(event.inputs) || event.inputs.length > limits.MAX_RANKED_INPUTS) reject('INVALID_REPLAY');
  let previous = -1;
  const inputs = event.inputs.map(input => {
    exactRequest(input, ['frame', 'action']);
    if (!Number.isInteger(input.frame) || input.frame < 0 || input.frame >= event.frames
      || input.frame < previous || !ACTIONS.has(input.action)) reject('INVALID_REPLAY');
    previous = input.frame;
    return { frame: input.frame, action: input.action };
  });
  return { frames: event.frames, inputs, ...(event.finishReason ? { finishReason: event.finishReason } : {}) };
}

function checkTicket(run, playerId, rulesId, now, hash, frames) {
  if (!run || run.playerId !== playerId) reject('RUN_UNAVAILABLE');
  if (run.rulesId !== rulesId) reject('RULES_MISMATCH');
  if (run.status === 'finished') {
    if (run.payloadHash !== hash) reject('RUN_CONFLICT');
    return 'finished';
  }
  if (run.status !== 'open') reject('RUN_UNAVAILABLE');
  if (now >= run.expiresAt) reject('RUN_EXPIRED');
  if (now - run.issuedAt < frames * (1000 / 60) - CLOCK_SLOP_MS) reject('RUN_TOO_FAST');
  return 'open';
}

function betterRecord(candidate, previous) {
  return !previous || candidate.distance > previous.distance
    || (candidate.distance === previous.distance && candidate.score > previous.score);
}

function creditProfile(profile, result, now) {
  const { _id, ...stored } = profile; // 数据库返回的 _id 不得传回 DocumentReference.set。
  const stats = profile.stats ?? { runs: 0, distanceM: 0, coins: 0, bestScore: 0 };
  const { summary } = result;
  const coin = profile.wallet.coin + summary.coins;
  const revision = profile.revision + 1;
  const nextStats = {
    runs: stats.runs + 1, distanceM: +(stats.distanceM + summary.distance).toFixed(2),
    coins: stats.coins + summary.coins, bestScore: Math.max(stats.bestScore, summary.score),
  };
  if (![revision, coin, nextStats.runs, nextStats.coins, nextStats.bestScore].every(Number.isSafeInteger)
    || !Number.isFinite(nextStats.distanceM)) reject('PROFILE_LIMIT');
  return { ...stored, revision, wallet: { ...profile.wallet, coin }, stats: nextStats,
    updatedAt: new Date(now).toISOString() };
}

module.exports = { RUN_TTL_MS, RunError, reject, digest, boardIdFor, recordIdFor, playerNameFor,
  exactRequest, runId, normalizeReplay, checkTicket, betterRecord, creditProfile };
