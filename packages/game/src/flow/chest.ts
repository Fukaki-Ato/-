/**
 * 宝箱开启（flow 层，宿主中立）：铜/银/金三档 = economy.lootTables 的 loot_chest_* 三张
 * key 价表（cost 1/2/3 把钥匙、draws 1/2/3 件产出）。抽取纯函数化：随机源一律注入
 * （RunRng.weighted；core 禁 Math.random，注入先例 runSession 的 seed 流），保底 pity
 * 计数按表持久化——距上次 sr+ 累计 everyN 次开启时，本次首抽强制 sr+ 池。
 * 发货复用 grant()；碎片入账后跑 syncShardAutoSynth（攒满 50 自动解锁，含 loot 型角色），
 * onUnlocked 沿用成就 charactersUnlocked 生产接线。
 * 视图契约类型（ChestCardView/ChestOpenResult/ChestActions）也定义在此：views.ts 以
 * type-only 引用（同 SignInState 先例），避免 views.ts 超 300 行架构上限。
 */
import type { GameContent, I18n, NamedEntry } from '../core/config/configTypes.js';
import { hashSeed, mulberry32 } from '../core/rng.js';
import { grant, readCount, spend, walletBalance, withEconomyTransaction, type EconomyStore } from './localEconomy.js';
import { configLocked, isCharacterGated, markUnlocked, syncShardAutoSynth } from './unlock.js';

type Entry = Record<string, unknown>;

/** lootTable 速记 ref 的解析结果（'coin:300' / 'shard_volt:4' / 无冒号=整件） */
export interface RewardView { ref: string; item: string; count: number; rarity: string }

/** 宝箱卡快照（视图层只做展示） */
export interface ChestCardView {
  tableId: string;
  tier: 'bronze' | 'silver' | 'gold';
  /** 档位名（铜宝箱/银宝箱/金宝箱） */
  name: string;
  /** 开启消耗（钥匙数） */
  costKeys: number;
  /** 每次开启开出件数 */
  draws: number;
  /** 保底：每 N 次开启必出 sr+（0=未配置） */
  pityEveryN: number;
}

/** 一次开启的结算：rewards 按抽数给出（已入账），pityTriggered=本次触发保底 */
export interface ChestOpenResult {
  ok: boolean;
  message: string;
  rewards: RewardView[];
  pityTriggered: boolean;
}

/** 宝箱页动作（views.renderChest 消费）：wallet/chests 为快照读数，onOpen 结算一次开启 */
export interface ChestActions {
  onBack(): void;
  wallet(): { coins: number; keys: number; diamonds: number };
  chests(): ChestCardView[];
  onOpen(tableId: string): ChestOpenResult;
}

const CHEST_PREFIX = 'loot_chest_';
const CHEST_TIERS: { tier: ChestCardView['tier']; name: string }[] = [
  { tier: 'bronze', name: '铜宝箱' },
  { tier: 'silver', name: '银宝箱' },
  { tier: 'gold', name: '金宝箱' },
];
const SR_PLUS = new Set(['sr', 'ssr']);

/** 保底计数键（按表持久化：距上次 sr+ 的开启次数） */
function pityKey(tableId: string): string {
  return `thunderrun:loot-pity:${tableId}`;
}

interface LootTableLike {
  id?: unknown;
  draws?: unknown;
  cost?: Entry;
  pity?: Entry;
  entries?: Entry[];
}

function lootTables(content: GameContent): LootTableLike[] {
  return ((content.economy.params?.lootTables ?? []) as LootTableLike[]);
}

/** 三档宝箱配置快照：按 id 前缀 loot_chest_ 识别，draws/cost 缺省安全兜底；铜→银→金排序 */
export function chestCards(content: GameContent): ChestCardView[] {
  const out: ChestCardView[] = [];
  for (const table of lootTables(content)) {
    const id = typeof table.id === 'string' ? table.id : '';
    if (!id.startsWith(CHEST_PREFIX)) continue;
    const suffix = id.slice(CHEST_PREFIX.length);
    const meta = CHEST_TIERS.find(t => t.tier === suffix) ?? { tier: 'bronze' as const, name: suffix };
    const cost = Number(table.cost?.['key']);
    const draws = Number(table.draws);
    const everyN = Number(table.pity?.['everyN']);
    out.push({
      tableId: id,
      tier: meta.tier,
      name: meta.name,
      costKeys: Number.isInteger(cost) && cost > 0 ? cost : 1,
      draws: Number.isInteger(draws) && draws > 0 ? draws : 1,
      pityEveryN: Number.isInteger(everyN) && everyN > 0 ? everyN : 0,
    });
  }
  return out.sort((a, b) => CHEST_TIERS.findIndex(t => t.tier === a.tier) - CHEST_TIERS.findIndex(t => t.tier === b.tier));
}

function charName(entry: NamedEntry | undefined): string | undefined {
  const name = entry?.name as I18n | undefined;
  return name?.['zh-CN'] ?? name?.['en-US'];
}

/** ref → 展示文案：能量币/钥匙/钻石速记 + 角色碎片（角色名取 characters 配置 zh-CN） */
export function rewardText(content: GameContent, reward: RewardView): string {
  const { item, count } = reward;
  if (item === 'coin') return `能量币×${count}`;
  if (item === 'key') return `钥匙×${count}`;
  if (item === 'diamond') return `钻石×${count}`;
  if (item.startsWith('shard_')) {
    const entry = (content.characters.items ?? []).find(c => c.id === item.replace(/^shard_/, 'char_'));
    return `${charName(entry) ?? item}碎片×${count}`;
  }
  if (item.startsWith('char_')) {
    const entry = (content.characters.items ?? []).find(c => c.id === item);
    return `${charName(entry) ?? item}（整卡）`;
  }
  return `${item}×${count}`;
}

/** 解析速记 ref → {item, count}；无冒号=整件（count 1） */
function parseRef(ref: string): { item: string; count: number } {
  const i = ref.indexOf(':');
  if (i < 0) return { item: ref, count: 1 };
  const n = Number(ref.slice(i + 1));
  return { item: ref.slice(0, i), count: Number.isInteger(n) && n > 0 ? n : 1 };
}

/**
 * 开启一次宝箱：扣钥匙 → draws 连抽（保底触发时首抽强制 sr+ 池）→ grant 发货 → 碎片自动合成扫描。
 * random 可注入（测试传 mulberry32 固定 seed 复现）；缺省为独立熵源的 mulberry32 流
 * （先例 mainFlow 音频随机：hashSeed('chest-' + Date.now())），不污染玩法 RNG。
 */
export function openChest(store: EconomyStore, content: GameContent, tableId: string,
  random?: () => number, hooks?: { onUnlocked?(charId: string): void }): ChestOpenResult {
  const unlocked: string[] = [];
  let result: ChestOpenResult;
  try {
    result = withEconomyTransaction(store, draft => openChestInStore(draft, content, tableId, random, unlocked));
  } catch (error) {
    return { ok: false, message: `开启未完成：${error instanceof Error ? error.message : String(error)}`,
      rewards: [], pityTriggered: false };
  }
  for (const id of unlocked) hooks?.onUnlocked?.(id);
  return result;
}

function openChestInStore(store: EconomyStore, content: GameContent, tableId: string,
  random: (() => number) | undefined, unlocked: string[]): ChestOpenResult {
  const fail = (message: string): ChestOpenResult => ({ ok: false, message, rewards: [], pityTriggered: false });
  const table = lootTables(content).find(t => t.id === tableId);
  if (!table || typeof table.id !== 'string') return fail('宝箱不存在');
  const cost = Number(table.cost?.['key']);
  if (!Number.isInteger(cost) || cost <= 0) return fail('宝箱配置缺少钥匙价');
  const entries = (table.entries ?? []).filter(e => typeof e.ref === 'string');
  if (!entries.length) return fail('宝箱配置为空');
  if (walletBalance(store, 'key') < cost) return fail('钥匙不足，去完成任务赚钥匙吧');

  if (!spend(store, { key: cost })) return fail('钥匙不足，去完成任务赚钥匙吧');
  const next = random ?? mulberry32(hashSeed('chest-' + Date.now()));
  const weighted = (pool: Entry[]): Entry => weightedBy(pool, next);
  const draws = Number(table.draws);
  const count = Number.isInteger(draws) && draws > 0 ? Math.min(10, draws) : 1;

  // 保底：距上次 sr+ 已开 everyN-1 次（本次计入即满）→ 本次首抽只在 sr+ 池里抽
  const since = readCount(store, pityKey(tableId));
  const everyN = Number(table.pity?.['everyN']);
  const pityEveryN = Number.isInteger(everyN) && everyN > 0 ? everyN : 0;
  const pityTriggered = pityEveryN > 0 && since + 1 >= pityEveryN;

  const rewards: RewardView[] = [];
  for (let i = 0; i < count; i++) {
    const pool = pityTriggered && i === 0
      ? entries.filter(e => SR_PLUS.has(String(e.rarity)))
      : entries;
    const pick = weighted(pool.length ? pool : entries);
    const parsed = parseRef(String(pick.ref));
    rewards.push({ ref: String(pick.ref), item: parsed.item, count: parsed.count, rarity: String(pick.rarity ?? 'common') });
  }
  // 整卡写角色解锁表；不能把 char_* 当作 item 库存，否则展示获得却仍无法选角。
  for (const reward of rewards.filter(r => r.item.startsWith('char_'))) {
    if (isCharacterGated(content, reward.item, store) && !configLocked(content, reward.item)) {
      markUnlocked(store, reward.item);
      unlocked.push(reward.item);
    }
  }
  grant(store, rewards.filter(r => !r.item.startsWith('char_')).map(r => ({ item: r.item, n: r.count })));

  // 保底计数：本次含 sr+（自然或强制）即清零，否则 +1
  const hitSrPlus = rewards.some(r => SR_PLUS.has(r.rarity));
  store.set(pityKey(tableId), String(hitSrPlus ? 0 : since + 1));

  // 碎片入账后扫描自动合成（攒满即解锁——unlockPriceText「宝箱产出」的兑现路径）
  unlocked.push(...syncShardAutoSynth(store, content));
  const text = rewards.map(r => rewardText(content, r)).join('、');
  return { ok: true, message: (pityTriggered ? '保底触发！' : '') + `开启成功：${text}`, rewards, pityTriggered };
}

/** 裸随机源（0..1) 的权重抽取：与 RunRng.weighted 同式，注入的纯函数随机源走同一条路径 */
function weightedBy(pool: Entry[], next: () => number): Entry {
  let total = 0;
  for (const e of pool) total += Math.max(0, Number(e.weight) || 0);
  let roll = next() * Math.max(1, total);
  for (const e of pool) {
    roll -= Math.max(0, Number(e.weight) || 0);
    if (roll < 0) return e;
  }
  return pool[pool.length - 1]!;
}

/** 宝箱页动作装配（chestScene 用；random/hooks 透传 openChest） */
export function chestActions(store: EconomyStore, content: GameContent, onBack: () => void,
  opts?: { random?: () => number; hooks?: { onUnlocked?(charId: string): void } }): ChestActions {
  return {
    onBack,
    wallet: () => ({
      coins: walletBalance(store, 'coin'),
      keys: walletBalance(store, 'key'),
      diamonds: walletBalance(store, 'diamond'),
    }),
    chests: () => chestCards(content),
    onOpen: tableId => openChest(store, content, tableId, opts?.random, opts?.hooks),
  };
}
