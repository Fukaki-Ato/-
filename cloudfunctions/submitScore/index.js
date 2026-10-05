'use strict';

/**
 * submitScore：提交单局成绩（docs/05 §4.2）。
 * 入参：{ score, distance, mode, nickname, avatarUrl }
 * 返回：{ ok, bestScore, rank }
 *
 * 存储策略：scores 集合每人只保留最佳一条（按 _openid 唯一），
 * 同时更新 players.bestScore，rank 为「分数严格大于我的记录数 + 1」。
 */

const cloud = require('wx-server-sdk');
const { ok, fail, parseScorePayload } = require('./common');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;
const SCORES = 'scores';
const PLAYERS = 'players';

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return fail('NO_OPENID', '缺少用户标识（OPENID）');
  const parsed = parseScorePayload(event);
  if (parsed.error) return fail('INVALID_SCORE', parsed.error);
  const { score, distance, mode, nickname, avatarUrl } = parsed;
  const now = Date.now();

  try {
    const mine = await db.collection(SCORES).where({ _openid: OPENID }).limit(1).get();
    let bestScore = score;
    if (mine.data.length === 0) {
      await db.collection(SCORES).add({
        data: { _openid: OPENID, score, distance, mode, nickname, avatarUrl, updatedAt: now },
      });
    } else {
      const prev = mine.data[0];
      const prevScore = typeof prev.score === 'number' ? prev.score : 0;
      bestScore = Math.max(prevScore, score);
      await db.collection(SCORES).doc(prev._id).update({
        data: {
          score: bestScore,
          distance,
          mode,
          nickname: nickname || prev.nickname || '',
          avatarUrl: avatarUrl || prev.avatarUrl || '',
          updatedAt: now,
        },
      });
    }

    const playerRes = await db.collection(PLAYERS).where({ _openid: OPENID }).limit(1).get();
    if (playerRes.data.length > 0) {
      const player = playerRes.data[0];
      const playerBest = Math.max(
        typeof player.bestScore === 'number' ? player.bestScore : 0,
        bestScore,
      );
      await db.collection(PLAYERS).doc(player._id).update({
        data: {
          nickname: nickname || player.nickname || '',
          avatarUrl: avatarUrl || player.avatarUrl || '',
          bestScore: playerBest,
          updatedAt: now,
        },
      });
      bestScore = playerBest;
    } else {
      await db.collection(PLAYERS).add({
        data: { _openid: OPENID, nickname, avatarUrl, bestScore, createdAt: now, updatedAt: now },
      });
    }

    const higher = await db.collection(SCORES).where({ score: _.gt(bestScore) }).count();
    return ok({ bestScore, rank: higher.total + 1 });
  } catch (err) {
    console.error('[submitScore] 数据库错误', err);
    return fail('DB_ERROR', '数据库错误，请稍后重试');
  }
};
