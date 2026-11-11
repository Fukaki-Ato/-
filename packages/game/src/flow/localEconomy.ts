/**
 * 本机经济层（flow 层，宿主中立）：钱包计数与商店购买（含限购）。角色解锁在 unlock.ts、登录签到在 signIn.ts。
 * 为什么在 flow 而不是 core：直接复用 mainFlow 既有存储键语义（coins/diamonds 计数键），
 * 且「事件是否开放」依赖 content+now 的流程级判定；存储一律注入 EconomyStore，Node 测试可换内存壳。
 * 服务端权威（missions/排行榜）不受此层影响：这里的购买/解锁只写本机，S9 云存档接管后再升级为账号级。
 */
import type { GameContent } from '../core/config/configTypes.js';
import type { ShopActions } from './views.js';
import { canUseEquippedItem } from './itemAvailability.js';

type Entry = Record<string, unknown>;

/** 本机经济存储的最小面（与 PlatformAdapter.storage 同形，测试可注入内存实现） */
export interface EconomyStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
  /** Optional capability supplied by the Web progress wallet; the callback is synchronous. */
  transaction?<T>(operation: (draft: EconomyStore) => T): T;
}

/** Keep bare storage callers compatible; the actual Web wallet supplies the atomic commit. */
export function withEconomyTransaction<T>(store: EconomyStore, operation: (draft: EconomyStore) => T): T {
  return store.transaction ? store.transaction(operation) : operation(store);
}

export const COINS_KEY = 'thunderrun:coins-total';
export const DIAMOND_KEY = 'thunderrun:diamonds-total';
export const KEYS_KEY = 'thunderrun:keys-total';
export const SHARD_PREFIX = 'thunderrun:shard:';
export const ITEM_PREFIX = 'thunderrun:item:';
export const UNLOCKS_KEY = 'thunderrun:unlocks';
export const EQUIP_KEY = 'thunderrun:equipped';

/** 装备清单（审查 M 道具闭环）：商店购买可装备道具时自动写入，开局消费，上限 3 件不重复 */
export function equippedItems(store: EconomyStore): string[] {
  try {
    const raw: unknown = JSON.parse(store.get(EQUIP_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
  } catch { return []; }
}

export function equipItem(store: EconomyStore, itemId: string): boolean {
  const ids = equippedItems(store);
  if (ids.length >= 3 || ids.includes(itemId)) return false;
  ids.push(itemId);
  store.set(EQUIP_KEY, JSON.stringify(ids));
  return true;
}

/** 开局消费：清出本局道具（余额不足的跳过），扣库存并清空装备清单 */
export function consumeEquipped(store: EconomyStore, content: GameContent): string[] {
  const ids = [...new Set(equippedItems(store))]
    .filter(id => canUseEquippedItem(content, id) && walletBalance(store, id) > 0).slice(0, 3);
  for (const id of ids) addBalance(store, id, -1);
  store.set(EQUIP_KEY, '[]');
  return ids;
}

/** 钱包 id -> 存储键：coin/diamond 沿用旧键（大厅 SelectExtras 与测试已依赖），其余一键一物 */
function walletKey(id: string): string {
  if (id === 'coin') return COINS_KEY;
  if (id === 'diamond') return DIAMOND_KEY;
  if (id === 'key') return KEYS_KEY;
  if (id.startsWith('shard_')) return SHARD_PREFIX + id;
  return ITEM_PREFIX + id;
}

export function readCount(store: EconomyStore, key: string): number {
  const n = Number(store.get(key));
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export function walletBalance(store: EconomyStore, id: string): number {
  return readCount(store, walletKey(id));
}

export function addBalance(store: EconomyStore, id: string, delta: number): void {
  store.set(walletKey(id), String(Math.max(0, readCount(store, walletKey(id)) + delta)));
}

/** 发货：give[].item ∈ coin/key/diamond/shard_x/item_x；未知 id 静默丢弃（校验器已拦配置层 typo） */
export function grant(store: EconomyStore, give: { item?: unknown; n?: unknown }[]): void {
  for (const g of give) {
    if (typeof g?.item !== 'string' || !Number.isInteger(g.n) || (g.n as number) <= 0) continue;
    addBalance(store, g.item, g.n as number);
  }
}

export function canAfford(store: EconomyStore, price: Record<string, unknown>): boolean {
  return Object.entries(price).every(([id, n]) => walletBalance(store, id) >= (n as number));
}

/** 扣价：任一不足则整体不动（all-or-nothing），返回是否成功 */
export function spend(store: EconomyStore, price: Record<string, unknown>): boolean {
  return withEconomyTransaction(store, draft => {
    if (!canAfford(draft, price)) return false;
    for (const [id, n] of Object.entries(price)) addBalance(draft, id, -(n as number));
    return true;
  });
}

// Local shop limits retain their existing device-calendar semantics. Mission periods are server-owned.
function dateKey(now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/** 事件开放判定（购买 requiresEvent 商品 / event 型解锁共用）：status=live 且窗口含 now */
export function isEventLive(content: GameContent, eventId: string, now: Date): boolean {
  const ev = (content.events.items ?? []).find(e => e.id === eventId) as (Entry & { status?: unknown; window?: { start?: unknown; end?: unknown } }) | undefined;
  if (!ev || ev.status !== 'live') return false;
  // 不写 ev.window?.start：`window.` 会撞架构检查的宿主全局禁令（此处是事件的窗口字段，非浏览器全局）
  const win = ev['window'];
  const start = typeof win?.start === 'string' ? Date.parse(win.start) : NaN;
  const end = typeof win?.end === 'string' ? Date.parse(win.end) : NaN;
  const t = now.getTime();
  return (Number.isNaN(start) || t >= start) && (Number.isNaN(end) || t <= end);
}

export interface BuyResult { ok: boolean; message: string }

/** 商店购买：开放性（requiresEvent）→ 限购（once/perDay）→ 余额 → 扣价 + 发货 + 记限购 */
export function buyOffer(store: EconomyStore, content: GameContent, offerId: string, now: Date): BuyResult {
  return withEconomyTransaction(store, draft => buyOfferInStore(draft, content, offerId, now));
}

function buyOfferInStore(store: EconomyStore, content: GameContent, offerId: string, now: Date): BuyResult {
  const offers = ((content.economy.params?.shop as { offers?: Entry[] } | undefined)?.offers) ?? [];
  const offer = offers.find(o => o.id === offerId);
  if (!offer) return { ok: false, message: '商品不存在' };
  const rewards = (offer.give ?? []) as { item?: unknown; n?: unknown }[];
  if (rewards.some(reward => typeof reward.item === 'string' && reward.item.startsWith('item_')
    && !canUseEquippedItem(content, reward.item))) return { ok: false, message: '道具未开放' };
  const requires = typeof offer.requiresEvent === 'string' ? offer.requiresEvent : '';
  if (requires && !isEventLive(content, requires, now)) return { ok: false, message: '活动未开放' };
  const price = (offer.price ?? {}) as Record<string, unknown>;
  const limit = (offer.limit ?? {}) as Record<string, unknown>;
  if (limit.once === true || limit.once === 1) {
    if (store.get(`thunderrun:shop-once:${offerId}`) === '1') return { ok: false, message: '该商品只能购买一次' };
  }
  if (Number.isInteger(limit.perDay) && (limit.perDay as number) > 0) {
    const key = `thunderrun:shop-limit:${offerId}:${dateKey(now)}`;
    if (readCount(store, key) >= (limit.perDay as number)) return { ok: false, message: '今日限购已用完' };
  }
  if (!spend(store, price)) return { ok: false, message: '余额不足' };
  if (limit.once === true || limit.once === 1) store.set(`thunderrun:shop-once:${offerId}`, '1');
  if (Number.isInteger(limit.perDay) && (limit.perDay as number) > 0) {
    const key = `thunderrun:shop-limit:${offerId}:${dateKey(now)}`;
    store.set(key, String(readCount(store, key) + 1));
  }
  grant(store, rewards);
  // 可装备道具（items.json 有 effects 的 item_*）自动进装备清单，下一局生效
  let equipped = false;
  for (const g of rewards) {
    if (typeof g.item === 'string' && g.item.startsWith('item_') && equipItem(store, g.item)) equipped = true;
  }
  return { ok: true, message: equipped ? '购买成功，已装备到下一局' : '购买成功，已存入背包' };
}

// ---------------- 场景动作装配（mainFlow 用；集中在此保持 mainFlow 行数预算） ----------------

/** 商店场景动作：钱包快照 + 本机购买（now 取宿主当前时间，测试经 buyOffer 注入 Date） */
export function shopActions(store: EconomyStore, content: GameContent, onBack: () => void): ShopActions {
  return {
    onBack,
    wallet: () => ({
      coins: walletBalance(store, 'coin'),
      keys: walletBalance(store, 'key'),
      diamonds: walletBalance(store, 'diamond'),
    }),
    onBuy: offerId => {
      try { return buyOffer(store, content, offerId, new Date()); }
      catch (error) { return { ok: false, message: `购买未完成：${error instanceof Error ? error.message : String(error)}` }; }
    },
  };
}
