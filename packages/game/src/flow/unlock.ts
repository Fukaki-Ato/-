/**
 * 角色解锁门槛（审查 M4-3）：解锁记录、coin/key 扣价、碎片合成、活动型登记。
 * 与 localEconomy 单向依赖（钱包原语）；选角页动作工厂随迁于此，避免循环导入。
 */
import type { NamedEntry, GameContent } from '@tr/game/core/config/configTypes.js';
import type { CharacterCardView, CharacterSelectPageActions, ShardCardView, ShopActions } from './views.js';
import type { BuyResult, EconomyStore } from './localEconomy.js';
import { addBalance, buyOffer, characterLevel, isEventLive, localPurchaseResult, maxCharacterLevel,
  spend, UNLOCKS_KEY, walletBalance, withEconomyTransaction } from './localEconomy.js';

type Entry = Record<string, unknown>;

function characterEntry(content: GameContent, charId: string): NamedEntry | undefined {
  return (content.characters.items ?? []).find(c => c.id === charId && String(c.id).startsWith('char_'));
}

/** config 层锁定（status=locked / locked=true）——与解锁门槛（unlock 字段）是两回事 */
export function configLocked(content: GameContent, charId: string): boolean {
  const entry = (content.characters.items ?? []).find(c => c.id === charId);
  return entry ? String(entry.status ?? '') === 'locked' || (entry as { locked?: boolean }).locked === true : false;
}

export function unlockedCharacterIds(store: EconomyStore): Set<string> {
  try {
    const raw = JSON.parse(store.get(UNLOCKS_KEY) ?? '[]');
    return new Set(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []);
  } catch { return new Set([]); }
}

export function markUnlocked(store: EconomyStore, charId: string): void {
  const ids = [...unlockedCharacterIds(store), charId];
  store.set(UNLOCKS_KEY, JSON.stringify([...new Set(ids)]));
}

/** 是否被解锁门槛挡住：unlock.type !== 'free' 且本机未解锁（config locked 状态另算，见 mainFlow） */
export function isCharacterGated(content: GameContent, charId: string, store: EconomyStore): boolean {
  const entry = characterEntry(content, charId);
  if (!entry) return false;
  const unlock = (entry as { unlock?: { type?: unknown } }).unlock;
  return !!unlock && unlock.type !== 'free' && !unlockedCharacterIds(store).has(charId);
}

/** 解锁价格文案（视图展示用）：coin/key 直接价；shard 合成取成长 1 级碎片门槛 */
export function unlockPriceText(content: GameContent, charId: string): string {
  const entry = characterEntry(content, charId);
  const unlock = (entry as { unlock?: Entry } | undefined)?.unlock;
  if (!unlock) return '';
  if (unlock.type === 'coin' || unlock.type === 'key') return `${unlock.cost}${unlock.type === 'coin' ? '金币' : '把钥匙'}`;
  if (unlock.type === 'loot') return '宝箱产出';
  if (unlock.type === 'event') return '活动解锁';
  return '';
}

function shardSynthesisNeed(content: GameContent, charId: string): { shardId: string; need: number } | null {
  const shard = ((content.economy.params?.shards ?? []) as Entry[]).find(s => s.grants === charId);
  if (!shard || typeof shard.id !== 'string') return null;
  const need = (shard.need ?? {}) as Record<string, unknown>;
  const n = Number(need['1']);
  return Number.isFinite(n) && n > 0 ? { shardId: shard.id, need: Math.floor(n) } : null;
}

/** 解锁可行性（不落盘）：coin/key 查余额；shard 查合成材料；loot/event 给出原因文案 */
export function canUnlockCharacter(store: EconomyStore, content: GameContent, charId: string, now: Date): BuyResult {
  const entry = characterEntry(content, charId);
  const unlock = (entry as { unlock?: Entry } | undefined)?.unlock;
  if (!entry || !unlock) return { ok: false, message: '角色不存在' };
  if (configLocked(content, charId)) return { ok: false, message: '角色未开放' };
  if (unlock.type === 'free') return { ok: true, message: '' };
  if (unlockedCharacterIds(store).has(charId)) return { ok: true, message: '' };
  if (unlock.type === 'coin' || unlock.type === 'key') {
    const cost = String(unlock.cost);
    const id = unlock.type as string;
    return walletBalance(store, id) >= Number(cost)
      ? { ok: true, message: '' }
      : { ok: false, message: `需要 ${cost}${id === 'coin' ? '金币' : '把钥匙'}` };
  }
  if (unlock.type === 'loot') return { ok: false, message: '开启对应宝箱获得' };
  if (unlock.type === 'event') {
    const ref = typeof unlock.eventRef === 'string' ? unlock.eventRef : '';
    return isEventLive(content, ref, now)
      ? { ok: true, message: '' }
      : { ok: false, message: '活动未开放' };
  }
  return { ok: false, message: '无法解锁' };
}

/** 解锁落盘：coin/key 扣价；shard 合成扣碎片；event 只登记（活动页/服务端后续消费）。
 *  onUnlocked：markUnlocked 实际落盘后的回调（成就在此累计 charactersUnlocked；重复解锁不触发）。 */
export function unlockCharacter(store: EconomyStore, content: GameContent, charId: string, now: Date,
  onUnlocked?: (charId: string) => void): BuyResult {
  const result = withEconomyTransaction(store, draft => unlockCharacterInStore(draft, content, charId, now));
  if (result.ok) onUnlocked?.(charId);
  return result;
}
function unlockCharacterInStore(store: EconomyStore, content: GameContent, charId: string, now: Date): BuyResult {
  const entry = characterEntry(content, charId);
  const unlock = (entry as { unlock?: Entry } | undefined)?.unlock;
  if (!entry || !unlock || unlock.type === 'free') return { ok: false, message: '该角色无需解锁' };
  if (unlockedCharacterIds(store).has(charId)) return { ok: false, message: '已解锁' }; // 防二次扣价
  const check = canUnlockCharacter(store, content, charId, now);
  if (!check.ok) return check;
  if (unlock.type === 'coin' || unlock.type === 'key') {
    if (!spend(store, { [unlock.type as string]: Number(unlock.cost) })) return { ok: false, message: '余额不足' };
  } else if (unlock.type !== 'event') {
    return { ok: false, message: '无法解锁' };
  }
  markUnlocked(store, charId);
  return { ok: true, message: unlock.type === 'event' ? '已解锁' : '解锁成功' };
}

/** 碎片合成解锁（选角页「合成」按钮）：余额达成长 1 级门槛即扣碎片解锁 */
export function canSynthesizeCharacter(store: EconomyStore, content: GameContent, charId: string): BuyResult {
  if (configLocked(content, charId)) return { ok: false, message: '角色未开放' };
  if (!isCharacterGated(content, charId, store)) return { ok: false, message: '该角色无需解锁' };
  const need = shardSynthesisNeed(content, charId);
  if (!need) return { ok: false, message: '该角色没有碎片合成' };
  if (walletBalance(store, need.shardId) < need.need) {
    return { ok: false, message: `碎片不足（${walletBalance(store, need.shardId)}/${need.need}）` };
  }
  return { ok: true, message: '' };
}

export function synthesizeCharacter(store: EconomyStore, content: GameContent, charId: string,
  onUnlocked?: (charId: string) => void): BuyResult {
  const result = withEconomyTransaction(store, draft => {
    const check = canSynthesizeCharacter(draft, content, charId);
    if (!check.ok) return check;
    const need = shardSynthesisNeed(content, charId)!;
    addBalance(draft, need.shardId, -need.need);
    markUnlocked(draft, charId);
    return { ok: true, message: '合成成功' };
  });
  if (result.ok) onUnlocked?.(charId);
  return result;
}

/** 选角页解锁动作：门槛判定 + coin/key 解锁 + 碎片合成（活动型在解锁时只登记） */
export function selectUnlockActions(store: EconomyStore, content: GameContent,
  hooks?: { onUnlocked?(charId: string): void }):
  Pick<CharacterSelectPageActions, 'isGated' | 'gatedPriceText' | 'canUnlock' | 'canSynthesize' | 'onUnlock' | 'onSynthesize'> {
  return {
    isGated: id => isCharacterGated(content, id, store),
    gatedPriceText: id => unlockPriceText(content, id),
    canUnlock: id => canUnlockCharacter(store, content, id, new Date()).ok,
    canSynthesize: id => canSynthesizeCharacter(store, content, id).ok,
    onUnlock: id => localPurchaseResult(() => unlockCharacter(store, content, id, new Date(), hooks?.onUnlocked)),
    onSynthesize: id => localPurchaseResult(() => synthesizeCharacter(store, content, id, hooks?.onUnlocked)),
  };
}

// ---------------- 商店碎片卡（全角色碎片包 / 自动合成 / 碎片升级） ----------------

/** 合成门槛与每级升级消耗统一 50（economy shards need["1"] 同口径，改配置即可调） */
export const SHARD_SYNTH_STEP = 50;

function shardIdOf(charId: string): string {
  return charId.replace(/^char_/, 'shard_');
}

function shardSynthThreshold(content: GameContent, charId: string): number {
  const shardId = shardIdOf(charId);
  const shard = ((content.economy.params?.shards ?? []) as Entry[]).find(s => s.id === shardId);
  const need = Number((shard?.need as Record<string, unknown> | undefined)?.['1']);
  return Number.isFinite(need) && need > 0 ? Math.floor(need) : SHARD_SYNTH_STEP;
}

/** 碎片包 offer（economy.shop.offers 中 give 为 shard_<char> 的条目）：定价/发货复用 buyOffer 机制 */
function shardPackOfferId(content: GameContent, charId: string): string | null {
  const shardId = shardIdOf(charId);
  const offers = ((content.economy.params?.shop as { offers?: Entry[] } | undefined)?.offers) ?? [];
  const offer = offers.find(o => ((o.give ?? []) as Entry[]).some(g => g.item === shardId));
  return typeof offer?.id === 'string' ? offer.id : null;
}

function packInfo(content: GameContent, charId: string): { size: number; priceCoin: number } {
  const shardId = shardIdOf(charId);
  const offers = ((content.economy.params?.shop as { offers?: Entry[] } | undefined)?.offers) ?? [];
  const offer = offers.find(o => ((o.give ?? []) as Entry[]).some(g => g.item === shardId));
  const give = ((offer?.give ?? []) as Entry[]).find(g => g.item === shardId);
  const price = (offer?.price ?? {}) as Record<string, unknown>;
  return {
    size: Number.isInteger(give?.n) && (give?.n as number) > 0 ? give!.n as number : 5,
    priceCoin: Number.isFinite(Number(price['coin'])) ? Number(price['coin']) : 0,
  };
}

/** 买碎片包：复用 buyOffer 结算；成功后跑一次自动合成扫描（攒满即解锁） */
export function buyShardPack(store: EconomyStore, content: GameContent, charId: string, now: Date,
  hooks?: { onUnlocked?(charId: string): void }): BuyResult {
  const offerId = shardPackOfferId(content, charId);
  if (!offerId) return { ok: false, message: '商店未上架该角色碎片' };
  const unlocked: string[] = [];
  const result = withEconomyTransaction(store, draft => {
    const purchased = buyOffer(draft, content, offerId, now);
    if (purchased.ok) unlocked.push(...syncShardAutoSynth(draft, content));
    return purchased;
  });
  for (const id of unlocked) hooks?.onUnlocked?.(id);
  return result;
}

/** 自动合成扫描：未拥有且碎片达门槛（need["1"]=50）的角色自动扣碎片解锁（含活动/宝箱角色）。
 *  商店打开与每次碎片入账后调用；onUnlocked 沿用成就 charactersUnlocked 生产接线。 */
export function syncShardAutoSynth(store: EconomyStore, content: GameContent,
  hooks?: { onUnlocked?(charId: string): void }): string[] {
  const unlocked = withEconomyTransaction(store, draft => {
    const ids: string[] = [];
    for (const char of (content.characters.items ?? []).filter(c => String(c.id).startsWith('char_'))) {
      const charId = String(char.id);
      if (!isCharacterGated(content, charId, draft) || configLocked(content, charId)) continue;
      const shardId = shardIdOf(charId), threshold = shardSynthThreshold(content, charId);
      if (walletBalance(draft, shardId) < threshold) continue;
      addBalance(draft, shardId, -threshold);
      markUnlocked(draft, charId);
      ids.push(charId);
    }
    return ids;
  });
  for (const id of unlocked) hooks?.onUnlocked?.(id);
  return unlocked;
}

/** 碎片升级：已拥有角色扣 50 碎片升 1 级（上限 growth.maxLevel），强化技能效果由 sim 按级缩放 */
export function upgradeCharacter(store: EconomyStore, content: GameContent, charId: string): BuyResult {
  return withEconomyTransaction(store, draft => upgradeCharacterInStore(draft, content, charId));
}
function upgradeCharacterInStore(store: EconomyStore, content: GameContent, charId: string): BuyResult {
  if (!characterEntry(content, charId) || configLocked(content, charId)) return { ok: false, message: '角色未开放' };
  // 免费角色不在解锁表里（从未 markUnlocked），按「非 gated 即已拥有」判定（与 shardCardState 同口径）
  const owned = unlockedCharacterIds(store).has(charId) || !isCharacterGated(content, charId, store);
  if (!owned) return { ok: false, message: '角色未解锁' };
  const level = characterLevel(store, charId);
  const max = maxCharacterLevel(content, charId);
  if (level >= max) return { ok: false, message: '已达最高等级' };
  const shardId = shardIdOf(charId);
  const step = shardSynthThreshold(content, charId);
  if (walletBalance(store, shardId) < step) {
    return { ok: false, message: `碎片不足（${walletBalance(store, shardId)}/${step}）` };
  }
  addBalance(store, shardId, -step);
  store.set(`thunderrun:char-level:${charId}`, String(level + 1));
  return { ok: true, message: `升级成功：Lv.${level + 1}` };
}

/** 碎片卡快照（商店视图渲染进度条/已拥有/升级按钮态用；未上架角色返回 null） */
export function shardCardState(store: EconomyStore, content: GameContent, charId: string): ShardCardView | null {
  if (!characterEntry(content, charId) || !shardPackOfferId(content, charId)) return null;
  const owned = unlockedCharacterIds(store).has(charId) || !isCharacterGated(content, charId, store);
  const pack = packInfo(content, charId);
  return {
    charId,
    owned,
    level: characterLevel(store, charId),
    maxLevel: maxCharacterLevel(content, charId),
    shards: walletBalance(store, shardIdOf(charId)),
    step: shardSynthThreshold(content, charId),
    packSize: pack.size,
    packPriceCoin: pack.priceCoin,
  };
}

/** 商店碎片卡动作（mainFlow 展开进 ShopActions）：onUnlocked 沿用成就生产接线 */
export function shardShopActions(store: EconomyStore, content: GameContent, hooks?: { onUnlocked?(charId: string): void }):
  Pick<ShopActions, 'shardCardState' | 'onBuyShardPack' | 'onUpgradeCharacter'> {
  return {
    shardCardState: charId => shardCardState(store, content, charId),
    onBuyShardPack: charId => localPurchaseResult(() => buyShardPack(store, content, charId, new Date(), hooks)),
    onUpgradeCharacter: charId => localPurchaseResult(() => upgradeCharacter(store, content, charId)),
  };
}

// ---------------- 角色本体卡（商店角色分类：全角色上架，coin/key 直接解锁） ----------------

function characterUnlockKind(content: GameContent, charId: string): CharacterCardView['unlockKind'] {
  const unlock = (characterEntry(content, charId)?.['unlock'] ?? {}) as Entry;
  const type = unlock['type'];
  return type === 'coin' || type === 'key' || type === 'loot' || type === 'event' ? type : 'free';
}

/** 角色本体卡快照：owned 与碎片卡同口径（解锁表或非 gated）；loot/event 只展示引导文案 */
export function characterCardState(store: EconomyStore, content: GameContent, charId: string): CharacterCardView | null {
  if (!characterEntry(content, charId)) return null;
  const kind = characterUnlockKind(content, charId);
  return {
    charId,
    owned: !isCharacterGated(content, charId, store),
    unlockKind: kind,
    priceText: unlockPriceText(content, charId) || (kind === 'free' ? '初始伙伴' : ''),
  };
}

/** 商店角色本体卡动作（mainFlow 展开进 ShopActions）：解锁走 unlockCharacter（coin/key 扣价，onUnlocked 接成就） */
export function characterShopActions(store: EconomyStore, content: GameContent, hooks?: { onUnlocked?(charId: string): void }):
  Pick<ShopActions, 'characterCardState' | 'onUnlockCharacter'> {
  return {
    characterCardState: charId => characterCardState(store, content, charId),
    onUnlockCharacter: charId => localPurchaseResult(() => unlockCharacter(store, content, charId, new Date(), hooks?.onUnlocked)),
  };
}
