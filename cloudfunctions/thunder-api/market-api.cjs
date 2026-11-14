const { RunError, reject, exactRequest } = require('./run-policy.cjs');
const { newProfile } = require('./profile.cjs');
const isMarketAction = action => ['market.get', 'market.buy', 'character.equip', 'theme.select'].includes(action);
const messages = {
  INVALID_REQUEST: '请求格式不正确', INSUFFICIENT_FUNDS: '余额或材料不足', ALREADY_OWNED: '已拥有该角色',
  PURCHASE_LIMIT: '已达到兑换次数上限', OFFER_UNAVAILABLE: '该商品暂不可兑换',
  CATALOG_CHANGED: '报价已更新，请刷新商店后重新确认', PURCHASE_CONFLICT: '交易编号与原购买不匹配，请核对待重试请求',
  CHARACTER_NOT_OWNED: '尚未拥有该角色', INVALID_CHARACTER: '该角色不可出战', INVALID_THEME: '该主题不可选择',
  PROFILE_LIMIT: '账户数值已达到上限', MARKET_UNAVAILABLE: '商店暂时不可用，请稍后重试',
};

function createMarketHandler({ store, content, loadSimulation, now }) {
  return async (event, { playerId }) => {
    try {
      if (event.action === 'market.get') exactRequest(event, ['action']);
      else if (event.action === 'market.buy') {
        exactRequest(event, ['action', 'offerId', 'requestId', 'catalogVersion']);
        if (typeof event.requestId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(event.requestId)
          || typeof event.offerId !== 'string' || !event.offerId || event.offerId.length > 128
          || typeof event.catalogVersion !== 'string' || !event.catalogVersion || event.catalogVersion.length > 128) reject('INVALID_REQUEST');
      } else {
        const key = event.action === 'character.equip' ? 'characterId' : 'themeId';
        exactRequest(event, ['action', key]);
        if (typeof event[key] !== 'string' || !event[key] || event[key].length > 128) reject('INVALID_REQUEST');
      }
      return { ok: true, market: await store.market(playerId,
        timestamp => newProfile(playerId, content, new Date(timestamp).toISOString()), event, loadSimulation(), now) };
    } catch (error) {
      const code = error instanceof RunError ? error.code : 'MARKET_UNAVAILABLE';
      return { ok: false, error: { code, message: messages[code] } };
    }
  };
}

module.exports = { isMarketAction, createMarketHandler };
