import { ApiError } from './errors.mjs';

/** Legacy NULL equipment remains empty; stored equipment is not a finish-time client override. */
export function parseItemsJson(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(x => typeof x === 'string') : [];
  } catch { return []; }
}

/** Stable wire normalization; caps belong to the issued ruleset, not a later deployment. */
export function canonicalReplayPayload(frames, actions, limits) {
  if (!Number.isInteger(frames) || frames <= 0 || (limits && frames > limits.maxFrames)) {
    throw new ApiError(400, limits ? `frames 必须是 1 到 ${limits.maxFrames} 的整数` : 'frames 必须是正整数');
  }
  if (!Array.isArray(actions) || (limits && actions.length > limits.maxActions)) throw new ApiError(400, 'actions 数量超出限制');
  let previousFrame = -1;
  for (const action of actions) {
    if (!action || typeof action !== 'object' || Array.isArray(action) || Object.keys(action).some(key => !['frame', 'action'].includes(key))
      || !Number.isInteger(action.frame) || action.frame < 0 || action.frame >= frames || action.frame < previousFrame
      || !['laneL', 'laneR', 'jump', 'slide', 'skill'].includes(action.action)) throw new ApiError(400, 'actions 必须按帧排序，且包含有效 frame/action');
    previousFrame = action.frame;
  }
  return JSON.stringify({ frames, actions: actions.map(({ frame, action }) => ({ frame, action })) });
}
