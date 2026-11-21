/** 宿主中立的本机钱包/消费，与微信云账户隔离；角色解锁在 unlock.ts，签到在 signIn.ts。 */
import type { GameContent } from '../core/config/configTypes.js';
import type { OfferPurchaseView, ShopActions, ThemeCardView } from './views.js';
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
export const ITEM_UPGRADE_PREFIX = 'thunderrun:item-upgrade:';
export const CHAR_LEVEL_PREFIX = 'thunderrun:char-level:';
export const THEME_UNLOCKS_KEY = 'thunderrun:theme-unlocks';
/** 设置页「切换场景」所选主题 id（点选即写，run 进局时消费——下一局生效；消费语义见 settingsScene） */
export const THEME_KEY = 'thunderrun:theme';
/** 保留旧导出；是否收费只以 themes.json 的显式 price 为准。 */
export const THEME_UNLOCK_PRICE = 1000;

// 道具强化：每次 +0.5 秒时长、最多 10 次、价格阶梯。
export const ITEM_UPGRADE_MAX = 10;
export const ITEM_UPGRADE_STEP_S = 0.5;
export const ITEM_UPGRADE_BASE_PRICE = 1000;
export const ITEM_UPGRADE_PRICE_STEP = 2000;

export function itemUpgradeCount(store: EconomyStore, itemId: string): number {
  return readCount(store, ITEM_UPGRADE_PREFIX + itemId);
}
/** 第 n 次（0 基已购次数）强化价格：首购 1000 能量币，每购一次下次 +2000 */
export function itemUpgradePrice(count: number): number {
  return ITEM_UPGRADE_BASE_PRICE + count * ITEM_UPGRADE_PRICE_STEP;
}
/** 道具当前时长加成（秒）：开局装备与局内拾取的同一道具共用（sim 经 runEnhance 注入） */
export function itemDurationBonusS(store: EconomyStore, itemId: string): number {
  return itemUpgradeCount(store, itemId) * ITEM_UPGRADE_STEP_S;
}
/** 道具强化购买：仅限 items.json 带 durationS 效果的道具；上限/余额判定后扣币记次 */
export function buyItemUpgrade(store: EconomyStore, content: GameContent, itemId: string): BuyResult {
  return withEconomyTransaction(store, draft => buyItemUpgradeInStore(draft, content, itemId));
}
function buyItemUpgradeInStore(store: EconomyStore, content: GameContent, itemId: string): BuyResult {
  const item = (content.items.items ?? []).find(i => i.id === itemId);
  const timed = (item?.['effects'] as Array<Record<string, unknown>> | undefined)
    ?.some(e => Number.isFinite(Number(e?.['durationS'])));
  if (!item || !timed || !canUseEquippedItem(content, itemId)) return { ok: false, message: '该道具无法强化' };
  const count = itemUpgradeCount(store, itemId);
  if (count >= ITEM_UPGRADE_MAX) return { ok: false, message: '强化已达上限' };
  if (!spend(store, { coin: itemUpgradePrice(count) })) return { ok: false, message: '余额不足' };
  store.set(ITEM_UPGRADE_PREFIX + itemId, String(count + 1));
  return { ok: true, message: `强化成功：时长 +${ITEM_UPGRADE_STEP_S} 秒` };
}

// 角色等级存档（升级扣碎片在 unlock.ts；sim 经 runEnhance 读缩放）。
export function characterLevel(store: EconomyStore, charId: string): number {
  const n = Number(store.get(CHAR_LEVEL_PREFIX + charId));
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}
export function maxCharacterLevel(content: GameContent, charId: string): number {
  const entry = (content.characters.items ?? []).find(c => c.id === charId);
  const max = Number((entry?.['growth'] as Record<string, unknown> | undefined)?.['maxLevel']);
  return Number.isFinite(max) && max >= 1 ? Math.floor(max) : 10;
}
/** 局内增强注入（runSession.enhance，休闲局专用）：道具时长加成 + 技能参数按成长等级缩放。
 *  缩放比例读 growth.effectPerLevel.paramScalePerLevel（配置缺省 0 → 不缩放），保证无强化存档时逐位等价。 */
export function runEnhance(store: EconomyStore, content: GameContent, charId: string):
  { itemBonusS: (itemId: string) => number; skillScale: number } | undefined {
  const entry = (content.characters.items ?? []).find(c => c.id === charId);
  const growth = (entry?.['growth'] ?? {}) as Record<string, unknown>;
  const effect = (growth['effectPerLevel'] ?? {}) as Record<string, unknown>;
  const perLevel = Number(effect['paramScalePerLevel']);
  const scale = Number.isFinite(perLevel) && perLevel > 0 ? perLevel : 0;
  const skillScale = 1 + scale * (characterLevel(store, charId) - 1);
  const bonuses = new Map((content.items.items ?? [])
    .filter(item => canUseEquippedItem(content, item.id)
      && (item['effects'] as Entry[] | undefined)?.some(effect => Number(effect['durationS']) > 0))
    .map(item => [item.id, itemDurationBonusS(store, item.id)] as const));
  if (skillScale === 1 && ![...bonuses.values()].some(bonus => bonus > 0)) return undefined;
  return { itemBonusS: itemId => bonuses.get(itemId) ?? 0, skillScale };
}

// 场景解锁：只对显式有价的场景扣币，设置与商店同口径。
export function unlockedThemeIds(store: EconomyStore): Set<string> {
  try {
    const raw: unknown = JSON.parse(store.get(THEME_UNLOCKS_KEY) ?? '[]');
    return new Set(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []);
  } catch { return new Set([]); }
}
export function markThemeUnlocked(store: EconomyStore, themeId: string): void {
  if (unlockedThemeIds(store).has(themeId)) return;
  const ids = [...unlockedThemeIds(store), themeId];
  store.set(THEME_UNLOCKS_KEY, JSON.stringify([...new Set(ids)]));
}
/** 已购、当前/默认和无显式价格的旧场景保持可用；第三参可选以兼容旧调用。 */
export function isThemeUnlocked(store: EconomyStore, themeId: string, content?: GameContent): boolean {
  if (unlockedThemeIds(store).has(themeId) || store.get(THEME_KEY) === themeId) return true;
  if (!content) return false;
  const themes = content.themes.items ?? [];
  return themes.some(theme => theme.id === themeId) && (themeUnlockPrice(content, themeId) === 0
    || (themes.find(theme => theme.status === 'live') ?? themes[0])?.id === themeId);
}
export function themeUnlockPrice(content: GameContent, themeId: string): number {
  const theme = (content.themes.items ?? []).find(t => t.id === themeId);
  const price = (theme?.['price'] ?? {}) as Record<string, unknown>;
  const n = Number(price['coin']);
  return Number.isSafeInteger(n) && n > 0 ? n : 0;
}
/** 解锁场景：status=live 校验 → 未解锁校验 → 扣能量币 → 登记（设置页切换同口径放行） */
export function buyThemeUnlock(store: EconomyStore, content: GameContent, themeId: string): BuyResult {
  return withEconomyTransaction(store, draft => {
    const theme = (content.themes.items ?? []).find(t => t.id === themeId);
    if (!theme) return { ok: false, message: '场景不存在' };
    if (isThemeUnlocked(draft, themeId, content)) return { ok: false, message: '该场景已解锁' };
    if (theme.status !== 'live') return { ok: false, message: '场景未开放' };
    if (!spend(draft, { coin: themeUnlockPrice(content, themeId) })) return { ok: false, message: '余额不足' };
    markThemeUnlocked(draft, themeId);
    return { ok: true, message: '解锁成功，可在设置页切换' };
  });
}
/** 场景卡快照（商店视图：解锁态/使用中/价格） */
export function themeCardState(store: EconomyStore, content: GameContent, themeId: string): ThemeCardView | null {
  const theme = (content.themes.items ?? []).find(t => t.id === themeId);
  if (!theme) return null;
  return {
    themeId,
    owned: isThemeUnlocked(store, themeId, content),
    active: (store.get(THEME_KEY) ?? (content.themes.items ?? []).find(t => t.status === 'live')?.id) === themeId,
    priceCoin: themeUnlockPrice(content, themeId),
  };
}
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
/** UI 消费边界：保存失败可重试，业务原语仍抛出原始存储错误供调用方处理。 */
export function localPurchaseResult(operation: () => BuyResult): BuyResult {
  try { return operation(); }
  catch (error) { return { ok: false, message: `购买未完成：${error instanceof Error ? error.message : String(error)}` }; }
}

/** 限购快照（商店视图「今日剩余/已售罄」展示用）：与 buyOffer 同一限购键语义，只读不落盘 */
export function offerPurchaseState(store: EconomyStore, content: GameContent, offerId: string, now: Date): OfferPurchaseView | null {
  const offers = ((content.economy.params?.shop as { offers?: Entry[] } | undefined)?.offers) ?? [];
  const offer = offers.find(o => o.id === offerId);
  if (!offer) return null;
  const limit = (offer.limit ?? {}) as Record<string, unknown>;
  const once = limit.once === true || limit.once === 1;
  const oncePurchased = once && store.get(`thunderrun:shop-once:${offerId}`) === '1';
  const perDay = Number.isInteger(limit.perDay) && (limit.perDay as number) > 0 ? limit.perDay as number : null;
  const boughtToday = perDay ? readCount(store, `thunderrun:shop-limit:${offerId}:${dateKey(now)}`) : 0;
  const remaining = perDay ? Math.max(0, perDay - boughtToday) : oncePurchased ? 0 : null;
  return { remaining, perDay, boughtToday, oncePurchased };
}

/** 商店购买：开放性（requiresEvent）→ 限购（once/perDay）→ 余额 → 扣价 + 发货 + 记限购 */
export function buyOffer(store: EconomyStore, content: GameContent, offerId: string, now: Date): BuyResult {
  return withEconomyTransaction(store, draft => buyOfferInStore(draft, content, offerId, now));
}
function buyOfferInStore(store: EconomyStore, content: GameContent, offerId: string, now: Date): BuyResult {
  const offers = ((content.economy.params?.shop as { offers?: Entry[] } | undefined)?.offers) ?? [];
  const offer = offers.find(o => o.id === offerId);
  if (!offer) return { ok: false, message: '商品不存在' };
  const rewards = (offer.give ?? []) as { item?: unknown; n?: unknown }[];
  if (rewards.some(reward => typeof reward.item === 'string' && reward.item.startsWith('char_')))
    return { ok: false, message: '角色请在角色卡中选择或解锁' }; // 保留给云 commerce 的报价不能在本机重复收费。
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

export function shopActions(store: EconomyStore, content: GameContent, onBack: () => void): ShopActions {
  return {
    onBack,
    wallet: () => ({
      coins: walletBalance(store, 'coin'),
      keys: walletBalance(store, 'key'),
      diamonds: walletBalance(store, 'diamond'),
    }),
    onBuy: offerId => localPurchaseResult(() => buyOffer(store, content, offerId, new Date())),
    purchaseState: offerId => offerPurchaseState(store, content, offerId, new Date()),
    itemUpgradeState: itemId => {
      const count = itemUpgradeCount(store, itemId);
      return { count, max: ITEM_UPGRADE_MAX, priceCoin: itemUpgradePrice(count), bonusS: itemDurationBonusS(store, itemId) };
    },
    onBuyItemUpgrade: itemId => localPurchaseResult(() => buyItemUpgrade(store, content, itemId)),
    themeCardState: themeId => themeCardState(store, content, themeId),
    onBuyTheme: themeId => localPurchaseResult(() => buyThemeUnlock(store, content, themeId)),
  };
}
