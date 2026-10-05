'use strict';

/**
 * syncSave：云存档上传/下载（docs/05 §4.2）。
 * - action='upload'：{ action, save, version, updatedAt } → { ok, serverUpdatedAt }
 *   仅当入参 updatedAt 不早于云端时覆盖（防旧档覆盖新档），否则返回 STALE_SAVE + serverUpdatedAt。
 * - action='download'：{ action } → { ok, save, version, updatedAt, serverUpdatedAt }
 */

const cloud = require('wx-server-sdk');
const { ok, fail, isRecord, parseSavePayload } = require('./common');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const SAVES = 'saves';

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return fail('NO_OPENID', '缺少用户标识（OPENID）');
  const data = isRecord(event) ? event : {};
  const action = data.action === 'download' ? 'download' : 'upload';
  try {
    const res = await db.collection(SAVES).where({ _openid: OPENID }).limit(1).get();

    if (action === 'download') {
      if (res.data.length === 0) return ok({ save: null });
      const doc = res.data[0];
      return ok({
        save: doc.save || null,
        version: typeof doc.version === 'number' ? doc.version : 0,
        updatedAt: typeof doc.updatedAt === 'number' ? doc.updatedAt : 0,
        serverUpdatedAt: typeof doc.updatedAt === 'number' ? doc.updatedAt : 0,
      });
    }

    const parsed = parseSavePayload(data);
    if (parsed.error) return fail('INVALID_SAVE', parsed.error);
    const { save, version, updatedAt } = parsed;

    if (res.data.length > 0) {
      const doc = res.data[0];
      const serverUpdatedAt = typeof doc.updatedAt === 'number' ? doc.updatedAt : 0;
      if (serverUpdatedAt > updatedAt) {
        return Object.assign(
          fail('STALE_SAVE', '云端存档更新，已拒绝覆盖'),
          { serverUpdatedAt },
        );
      }
      await db.collection(SAVES).doc(doc._id).update({
        data: { save, version, updatedAt },
      });
    } else {
      await db.collection(SAVES).add({
        data: { _openid: OPENID, save, version, updatedAt },
      });
    }
    return ok({ serverUpdatedAt: updatedAt });
  } catch (err) {
    console.error('[syncSave] 数据库错误', err);
    return fail('DB_ERROR', '数据库错误，请稍后重试');
  }
};
