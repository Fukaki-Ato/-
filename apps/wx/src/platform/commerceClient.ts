import type { SyncStorage } from '@tr/framework/platform/platformAdapter.js';
import type { CommerceService, CommerceSnapshot } from '@tr/game/core/commerce.js';
import type { PlayerProfile } from '@tr/game/core/playerProfile.js';
import { CloudApiError, record } from './cloudProtocol.js';
import { parseCommerceSnapshot } from './commerceProtocol.js';

type Send = (action: string, data?: Record<string, unknown>) => Promise<Record<string, unknown>>;
interface PendingBuy { offerId: string; requestId: string; catalogVersion: string }
const definiteRejections = new Set(['INVALID_REQUEST', 'CATALOG_CHANGED', 'OFFER_UNAVAILABLE',
  'INSUFFICIENT_FUNDS', 'ALREADY_OWNED', 'PURCHASE_LIMIT', 'PURCHASE_CONFLICT', 'PURCHASE_NOT_SAVED']);

/** 已确认购买的未明结果保留原请求ID；重进商店只重试这笔交易，不额外生成购买。 */
export function createCommerceClient(send: Send, update: (profile: unknown) => PlayerProfile,
  scope: string, storage?: SyncStorage): CommerceService {
  const key = `thunderrun:pending-purchase:${scope}`;
  let pending: PendingBuy | null = null;
  const stored = storage?.get(key);
  if (stored) {
    let value: unknown;
    try { value = JSON.parse(stored); } catch { value = null; }
    if (record(value) && ['offerId', 'requestId', 'catalogVersion'].every(k => typeof value[k] === 'string' && value[k])) {
      pending = { offerId: value.offerId as string, requestId: value.requestId as string, catalogVersion: value.catalogVersion as string };
    } else storage?.remove(key);
  }
  const persist = (value: PendingBuy | null): void => {
    if (value) storage?.set(key, JSON.stringify(value));
    else storage?.remove(key);
    pending = value;
  };
  const accept = (result: Record<string, unknown>): CommerceSnapshot => {
    const snapshot = parseCommerceSnapshot(result.market);
    update(snapshot.profile);
    return snapshot;
  };
  let inFlight: Promise<CommerceSnapshot> | null = null;
  const buy = async (offerId: string, requestId: string, catalogVersion: string): Promise<CommerceSnapshot> => {
    if (pending && (pending.offerId !== offerId || pending.requestId !== requestId || pending.catalogVersion !== catalogVersion)) {
      throw new CloudApiError('PENDING_PURCHASE', '上一笔交易尚未确认，请刷新商店处理');
    }
    if (inFlight) return inFlight;
    const intent = { offerId, requestId, catalogVersion };
    if (!pending) {
      try { persist(intent); }
      catch { throw new CloudApiError('PURCHASE_NOT_SAVED', '本地交易记录保存失败，购买未发送，请检查存储后重试'); }
    }
    inFlight = send('market.buy', intent).then(result => {
      const snapshot = accept(result); persist(null); return snapshot;
    }).catch(error => {
      if (error instanceof CloudApiError && definiteRejections.has(error.code)) persist(null);
      throw error;
    }).finally(() => { inFlight = null; });
    return inFlight;
  };
  let sequence = 0;
  // 这是幂等标识，不是身份凭据；服务端始终绑定当前可信玩家并校验原请求。
  const salt = Math.random().toString(36).slice(2);
  return {
    newRequestId: () => `buy_${Date.now().toString(36)}_${salt}_${++sequence}`,
    load: () => pending ? buy(pending.offerId, pending.requestId, pending.catalogVersion) : send('market.get').then(accept),
    buy,
    equip: characterId => send('character.equip', { characterId }).then(accept),
    selectTheme: themeId => send('theme.select', { themeId }).then(accept),
  };
}
