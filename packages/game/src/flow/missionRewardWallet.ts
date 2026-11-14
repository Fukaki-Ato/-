/** Local-MVP bridge: server wallet is a cumulative reward ledger, never a spendable balance.
 * Balance and imported high-water marks share ONE storage write, so a failed write is retryable.
 * Existing wallet keys are lazily migrated; unrelated settings keep their original storage.
 */
import type { MissionSnapshot } from '../core/missions/types.js';
import { COINS_KEY, DIAMOND_KEY, KEYS_KEY, SHARD_PREFIX, ITEM_PREFIX, type EconomyStore } from './localEconomy.js';

export const REWARD_WALLET_KEY = 'thunderrun:reward-wallet-v1';
type State = { version: 1; values: Record<string, string | null>; ledgers: Record<string, Record<string, number>> };
export interface RewardWalletStore extends EconomyStore {
  /** 幂等导入快照钱包：只读 rewardLedgerId（账本游标）+wallet（累计奖励）两个字段，
   *  任务与成就快照共用同一账本，故参数按这两字段收窄（AchievementsApi 的 onSnapshot 同款直传）。 */
  syncRewards(snapshot: Pick<MissionSnapshot, 'rewardLedgerId' | 'wallet'>): void;
}
const isWalletKey = (key: string): boolean => [COINS_KEY, DIAMOND_KEY, KEYS_KEY].includes(key)
  || key.startsWith(SHARD_PREFIX) || key.startsWith(ITEM_PREFIX);
const keyFor = (id: string): string | null => id === 'coin' ? COINS_KEY : id === 'diamond' ? DIAMOND_KEY
  : id === 'key' ? KEYS_KEY : /^shard_[a-z0-9_]+$/.test(id) ? SHARD_PREFIX + id : null;
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export function createRewardWalletStore(storage: EconomyStore): RewardWalletStore {
  const read = (): State => {
    const raw = storage.get(REWARD_WALLET_KEY);
    if (raw === null) return { version: 1, values: {}, ledgers: {} };
    // Fail closed: treating a corrupt cursor as empty would mint already-spent rewards again.
    try {
      const state = JSON.parse(raw) as State;
      if (state.version !== 1 || !record(state.values) || !record(state.ledgers)
        || Object.entries(state.values).some(([k, v]) => !isWalletKey(k) || (v !== null && typeof v !== 'string'))
        || Object.values(state.ledgers).some(ledger => !record(ledger)
          || Object.entries(ledger).some(([id, n]) => !keyFor(id) || !Number.isSafeInteger(n) || n < 0))) throw new Error();
      return state;
    } catch { throw new Error('本机钱包记录损坏，请保留存档并联系支持'); }
  };
  const value = (state: State, key: string): string | null => Object.prototype.hasOwnProperty.call(state.values, key)
    ? state.values[key]! : storage.get(key);
  const write = (state: State): void => {
    const raw = JSON.stringify(state);
    storage.set(REWARD_WALLET_KEY, raw);
    // Some platform adapters swallow storage failures. Never report those as successful grants.
    if (storage.get(REWARD_WALLET_KEY) !== raw) throw new Error('本机钱包保存失败，请释放存储空间后重试');
  };
  return {
    get: key => isWalletKey(key) ? value(read(), key) : storage.get(key),
    set(key, next) {
      if (!isWalletKey(key)) { storage.set(key, next); return; }
      const state = read(); state.values[key] = next; write(state);
    },
    remove(key) {
      if (!isWalletKey(key)) { storage.remove(key); return; }
      const state = read(); state.values[key] = null; write(state);
    },
    syncRewards(snapshot) {
      const ledgerId = snapshot.rewardLedgerId;
      if (typeof ledgerId !== 'string' || !/^[a-zA-Z0-9:_-]{1,160}$/.test(ledgerId)) {
        throw new Error('任务奖励账本标识缺失，请更新任务服务后重试');
      }
      if (!record(snapshot.wallet)) throw new Error('任务奖励账本无效');
      const state = read();
      const ledgerKey = `ledger:${ledgerId}`;
      const previous = state.ledgers[ledgerKey] ?? {};
      const next = { ...previous };
      let changed = false;
      for (const [id, total] of Object.entries(snapshot.wallet)) {
        const key = keyFor(id);
        if (!key || !Number.isSafeInteger(total) || total < 0) throw new Error('任务奖励账本无效');
        const imported = previous[id] ?? 0;
        // Out-of-order responses and restored older server snapshots must not roll cursors back.
        if (total <= imported) continue;
        const old = Number(value(state, key));
        const balance = Number.isFinite(old) && old > 0 ? Math.floor(old) : 0;
        const updated = balance + total - imported;
        if (!Number.isSafeInteger(updated)) throw new Error('本机钱包余额超出范围');
        state.values[key] = String(updated);
        next[id] = total; changed = true;
      }
      if (changed) { state.ledgers[ledgerKey] = next; write(state); }
    },
  };
}
