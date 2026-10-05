'use strict';

/**
 * login：以调用者 OPENID 初始化/读取 players 档案（docs/05 §4.2）。
 * 入参：无（OPENID 从云函数上下文获取，不需要客户端上传 code）。
 * 返回：{ ok, uid, nickname, avatarUrl, bestScore }
 */

const cloud = require('wx-server-sdk');
const { ok, fail, sanitizeText } = require('./common');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const PLAYERS = 'players';

exports.main = async () => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return fail('NO_OPENID', '缺少用户标识（OPENID）');
  const now = Date.now();
  try {
    const res = await db.collection(PLAYERS).where({ _openid: OPENID }).limit(1).get();
    if (res.data.length > 0) {
      const player = res.data[0];
      await db.collection(PLAYERS).doc(player._id).update({ data: { updatedAt: now } });
      return ok({
        uid: OPENID,
        nickname: sanitizeText(player.nickname, 32),
        avatarUrl: sanitizeText(player.avatarUrl, 512),
        bestScore: typeof player.bestScore === 'number' ? player.bestScore : 0,
      });
    }
    await db.collection(PLAYERS).add({
      data: {
        _openid: OPENID,
        nickname: '',
        avatarUrl: '',
        bestScore: 0,
        createdAt: now,
        updatedAt: now,
      },
    });
    return ok({ uid: OPENID, nickname: '', avatarUrl: '', bestScore: 0 });
  } catch (err) {
    console.error('[login] 数据库错误', err);
    return fail('DB_ERROR', '数据库错误，请稍后重试');
  }
};
