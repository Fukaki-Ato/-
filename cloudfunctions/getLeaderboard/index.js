'use strict';

/**
 * getLeaderboard：世界榜（docs/05 §4.2）。
 * 入参：{ board: 'global', top: 50 }（top 限制 1-100）
 * 返回：{ ok, list: [{rank,uid,nickname,avatarUrl,score}], me }
 * rank 从 1 开始；me 为调用者条目（未上榜时为 null）。
 *
 * 好友榜由开放数据域实现（docs/05 §4.3）；如需经云函数返回可在此扩展，
 * 当前主域对 friends 请求降级到本函数 world 榜（见 S10 报告）。
 */

const cloud = require('wx-server-sdk');
const { ok, fail, sanitizeText, parseLeaderboardQuery } = require('./common');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;
const SCORES = 'scores';

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const query = parseLeaderboardQuery(event);
  if (query.board === 'friends') {
    return fail('UNSUPPORTED_BOARD', '好友榜请在开放数据域实现');
  }

  try {
    const res = await db.collection(SCORES)
      .orderBy('score', 'desc')
      .orderBy('updatedAt', 'asc')
      .limit(query.top)
      .get();

    const list = res.data.map((doc, index) => ({
      rank: index + 1,
      uid: doc._openid,
      nickname: sanitizeText(doc.nickname, 32),
      avatarUrl: sanitizeText(doc.avatarUrl, 512),
      score: typeof doc.score === 'number' ? doc.score : 0,
    }));

    let me = null;
    if (OPENID) {
      const mine = await db.collection(SCORES).where({ _openid: OPENID }).limit(1).get();
      if (mine.data.length > 0) {
        const score = typeof mine.data[0].score === 'number' ? mine.data[0].score : 0;
        const higher = await db.collection(SCORES).where({ score: _.gt(score) }).count();
        const inList = list.find((entry) => entry.uid === OPENID);
        me = inList
          ? Object.assign({}, inList, { isMe: true })
          : {
            rank: higher.total + 1,
            uid: OPENID,
            nickname: sanitizeText(mine.data[0].nickname, 32),
            avatarUrl: sanitizeText(mine.data[0].avatarUrl, 512),
            score,
            isMe: true,
          };
      }
    }
    return ok({ list, me });
  } catch (err) {
    console.error('[getLeaderboard] 数据库错误', err);
    return fail('DB_ERROR', '数据库错误，请稍后重试');
  }
};
