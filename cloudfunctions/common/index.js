'use strict';

/**
 * 雷霆酷跑云函数公共工具（无第三方依赖）。
 *
 * 修改本文件后，进入 `cloudfunctions/` 执行 `node sync-common.js`，
 * 把本目录同步到各云函数目录下的 `common/`（微信开发者工具只上传函数自身目录）。
 */

const SCORE_MAX = 1000000000; // 分数/距离上限（防作弊）
const SAVE_JSON_MAX = 256 * 1024; // 云存档 JSON 上限 256KB（数据库单文档上限 1MB 内留余量）

function ok(data) {
  return Object.assign({ ok: true }, data || {});
}

function fail(code, message) {
  return {
    ok: false,
    code: String(code || 'ERROR'),
    message: String(message || code || 'error'),
  };
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toIntInRange(value, min, max, fallback) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const n = Math.floor(value);
  if (n < min || n > max) return fallback;
  return n;
}

/** 去除控制字符并截断，防止展示层被污染 / 超长字段。 */
function sanitizeText(value, maxLen) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, maxLen);
}

/** 校验 submitScore 入参，返回规范化对象或 { error }。 */
function parseScorePayload(event) {
  const data = isRecord(event) ? event : {};
  const score = data.score;
  if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > SCORE_MAX) {
    return { error: `score 必须是 0-${SCORE_MAX} 的有限数字` };
  }
  const distance = data.distance;
  if (typeof distance !== 'number' || !Number.isFinite(distance) || distance < 0 || distance > SCORE_MAX) {
    return { error: `distance 必须是 0-${SCORE_MAX} 的有限数字` };
  }
  const mode = sanitizeText(data.mode, 32);
  if (!mode) return { error: 'mode 必填且必须是非空字符串' };
  return {
    score: Math.floor(score),
    distance: Math.floor(distance),
    mode,
    nickname: sanitizeText(data.nickname, 32),
    avatarUrl: sanitizeText(data.avatarUrl, 512),
  };
}

/** 校验 syncSave 上传入参，返回规范化对象或 { error }。 */
function parseSavePayload(event) {
  const data = isRecord(event) ? event : {};
  if (!isRecord(data.save)) return { error: 'save 必须是对象' };
  const version = data.version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 0) {
    return { error: 'version 必须是非负整数' };
  }
  const updatedAt = data.updatedAt;
  if (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt) || updatedAt <= 0) {
    return { error: 'updatedAt 必须是正数时间戳' };
  }
  let json;
  try {
    json = JSON.stringify(data.save);
  } catch (err) {
    return { error: 'save 无法序列化' };
  }
  if (!json || json.length > SAVE_JSON_MAX) {
    return { error: `save 序列化后超过 ${SAVE_JSON_MAX} 字节上限` };
  }
  return { save: data.save, version, updatedAt: Math.floor(updatedAt) };
}

/** 校验 getLeaderboard 入参：top 限制 1-100，默认 50；board 仅支持 global。 */
function parseLeaderboardQuery(event) {
  const data = isRecord(event) ? event : {};
  return {
    board: data.board === 'friends' ? 'friends' : 'global',
    top: toIntInRange(data.top, 1, 100, 50),
  };
}

module.exports = {
  SCORE_MAX,
  SAVE_JSON_MAX,
  ok,
  fail,
  isRecord,
  toIntInRange,
  sanitizeText,
  parseScorePayload,
  parseSavePayload,
  parseLeaderboardQuery,
};
