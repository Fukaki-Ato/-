/**
 * 角色解锁门槛（审查 M4-3）：解锁记录、coin/key 扣价、碎片合成、活动型登记。
 * 与 localEconomy 单向依赖（钱包原语）；选角页动作工厂随迁于此，避免循环导入。
 */
import type { NamedEntry, GameContent } from '@tr/game/core/config/configTypes.js';
import type { CharacterSelectPageActions } from './views.js';
import type { BuyResult, EconomyStore } from './localEconomy.js';
import { addBalance, isEventLive, spend, UNLOCKS_KEY, walletBalance } from './localEconomy.js';

type Entry = Record<string, unknown>;

// ---------------- 角色解锁 ----------------

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
  const entry = characterEntry(content, charId);
  const unlock = (entry as { unlock?: Entry } | undefined)?.unlock;
  if (!entry || !unlock || unlock.type === 'free') return { ok: false, message: '该角色无需解锁' };
  if (unlockedCharacterIds(store).has(charId)) return { ok: false, message: '已解锁' }; // 防二次扣价
  const check = canUnlockCharacter(store, content, charId, now);
  if (!check.ok) return check;
  if (unlock.type === 'coin' || unlock.type === 'key') {
    spend(store, { [unlock.type as string]: Number(unlock.cost) });
  } else if (unlock.type === 'event') {
    markUnlocked(store, charId);
    onUnlocked?.(charId);
    return { ok: true, message: '已解锁' };
  } else {
    return { ok: false, message: '无法解锁' };
  }
  markUnlocked(store, charId);
  onUnlocked?.(charId);
  return { ok: true, message: '解锁成功' };
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
  const check = canSynthesizeCharacter(store, content, charId);
  if (!check.ok) return check;
  const need = shardSynthesisNeed(content, charId)!;
  addBalance(store, need.shardId, -need.need);
  markUnlocked(store, charId);
  onUnlocked?.(charId);
  return { ok: true, message: '合成成功' };
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
    onUnlock: id => unlockCharacter(store, content, id, new Date(), hooks?.onUnlocked),
    onSynthesize: id => synthesizeCharacter(store, content, id, hooks?.onUnlocked),
  };
}
