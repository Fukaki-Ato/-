const { createHash } = require('node:crypto');

const failure = (code, message) => ({ ok: false, error: { code, message } });
const nonempty = value => typeof value === 'string' && value.trim().length > 0;

// 微信调用事件会附加 userInfo；只剥离传输元数据，身份仍以 getWXContext 为准。
function requestPayload(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) return event;
  const { userInfo, ...request } = event;
  return request;
}

function playerIdFor(appId, openId) {
  return `p_${createHash('sha256').update(JSON.stringify([appId, openId])).digest('hex')}`;
}

// Shared by the local build and the function; skins and draft content grant nothing.
function initialContent(characters, themes) {
  const characterIds = characters.items
    .filter(item => item.id.startsWith('char_') && item.kind !== 'skin'
      && item.status === 'live' && item.unlock?.type === 'free')
    .map(item => item.id);
  const themeId = themes.items.find(item => item.status === 'live')?.id;
  if (!characterIds.length || !themeId) throw new Error('Missing live starter content');
  return { characterIds, characterId: characterIds[0], themeId };
}

function newProfile(playerId, content, timestamp) {
  return {
    schemaVersion: 1,
    revision: 0,
    playerId,
    wallet: { coin: 0, diamond: 0 },
    inventory: { characters: [...content.characterIds], items: {} },
    preferences: { characterId: content.characterId, themeId: content.themeId },
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

// Explicit projection keeps DB metadata and any future private identity fields private.
function publicProfile(profile) {
  return {
    schemaVersion: profile.schemaVersion,
    revision: profile.revision,
    playerId: profile.playerId,
    wallet: { coin: profile.wallet.coin, diamond: profile.wallet.diamond },
    inventory: { characters: [...profile.inventory.characters], items: { ...profile.inventory.items } },
    preferences: {
      characterId: profile.preferences.characterId,
      themeId: profile.preferences.themeId,
    },
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
    ...(profile.stats ? { stats: { runs: profile.stats.runs, distanceM: profile.stats.distanceM,
      coins: profile.stats.coins, bestScore: profile.stats.bestScore } } : {}),
    ...(profile.firstCoinBest ? { firstCoinBest: {
      rulesId: profile.firstCoinBest.rulesId, distance: profile.firstCoinBest.distance,
      score: profile.firstCoinBest.score, charId: profile.firstCoinBest.charId,
      stoppedByCoin: profile.firstCoinBest.stoppedByCoin,
      achievedAt: profile.firstCoinBest.achievedAt, order: profile.firstCoinBest.order,
    } } : {}),
  };
}

// store.getOrCreate must atomically read-or-insert and resolve only after commit.
// Its initializer may run more than once on conflict; it must have no external effects.
function createProfileHandler({ getWXContext, getAppId, store, content, handleAction,
  now = () => new Date().toISOString() }) {
  return async function profileHandler(event) {
    const allowedAppId = getAppId();
    if (!nonempty(allowedAppId)) return failure('SERVER_NOT_CONFIGURED', '服务暂未配置');
    let identity;
    try {
      identity = getWXContext();
    } catch {
      return failure('UNAUTHENTICATED', '需要可信微信身份');
    }
    if (!nonempty(identity?.OPENID) || !nonempty(identity?.APPID)) {
      return failure('UNAUTHENTICATED', '需要可信微信身份');
    }
    if (identity.APPID !== allowedAppId) return failure('APP_NOT_ALLOWED', '应用未获授权');
    const playerId = playerIdFor(identity.APPID, identity.OPENID);
    event = requestPayload(event);
    if (event?.action !== 'profile.get') {
      return handleAction ? handleAction(event, { playerId, appId: identity.APPID })
        : failure('INVALID_REQUEST', '不支持的请求');
    }
    try {
      const profile = await store.getOrCreate(playerId, () => newProfile(playerId, content, now()));
      return { ok: true, profile: publicProfile(profile) };
    } catch {
      return failure('PROFILE_UNAVAILABLE', '档案暂时不可用，请稍后重试');
    }
  };
}

module.exports = { createProfileHandler, initialContent, playerIdFor, newProfile, publicProfile };
