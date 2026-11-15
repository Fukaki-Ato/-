/**
 * 奖池表校验（configValidator 拆出保 300 行上限，achievementsValidator/mailValidator 同式）。
 * draws/cost 锁数值形态（cost 货币键=钱包白名单）；entries 引用道具/角色/碎片或货币速记。
 * pity 保底：字段名打错（everN）或非法值时运行时静默回落 0＝无保底，chestView/chestOverlay 的
 * 保底文案同源消失——键白名单（everyN/guarantee）、everyN 正整数、guarantee 承诺与 everyN 配对
 * 三道闸全锁死；schema economy.params.lootTables 的 pity 段（additionalProperties=false）同口径。
 */

type Entry = Record<string, unknown>;

/** loot 表单条结构（economy.params.lootTables 的宽松形态，字段校验在此收口） */
export interface LootTableEntry {
  id?: unknown;
  draws?: unknown;
  cost?: Entry;
  pity?: Entry;
  entries?: Entry[];
}

export function validateLootTables(lootTables: LootTableEntry[], walletKeys: ReadonlySet<string>,
  items: ReadonlySet<string>, chars: ReadonlySet<string>, shards: ReadonlySet<string>): string[] {
  const errors: string[] = [];
  for (const loot of lootTables) {
    // 宝箱档位（loot_chest_*）带 draws（每次开启开出件数）与 cost（钥匙扣价），先锁数值形态
    if (loot.draws !== undefined && (!Number.isInteger(loot.draws) || (loot.draws as number) < 1)) {
      errors.push(`${String(loot.id)}: draws 应为正整数（${String(loot.draws)}）`);
    }
    for (const [k, v] of Object.entries(loot.cost ?? {})) {
      if (!walletKeys.has(k)) errors.push(`${String(loot.id)}: cost 货币键不存在 -> ${k}`);
      if (!Number.isInteger(v) || (v as number) <= 0) errors.push(`${String(loot.id)}: cost.${k} 应为正整数（${String(v)}）`);
    }
    errors.push(...validatePity(String(loot.id), loot.pity));
    for (const e of loot.entries ?? []) {
      const base = String(e.ref).split(':')[0];
      // coin/key/diamond 是货币速记写法；其余必须是道具/角色/碎片 id
      const ok = base === 'coin' || base === 'key' || base === 'diamond'
        || items.has(base) || chars.has(base) || shards.has(base);
      if (!ok) errors.push(`${String(loot.id)}: 奖池引用不存在 -> ${String(e.ref)}`);
    }
  }
  return errors;
}

/** 保底 pity：schema pity 段同口径（未声明键红 / everyN 正整数 / guarantee 承诺必须配 everyN） */
function validatePity(id: string, pity: unknown): string[] {
  if (pity === undefined) return [];
  if (!pity || typeof pity !== 'object' || Array.isArray(pity)) return [`${id}: pity 应为对象`];
  const errors: string[] = [];
  for (const k of Object.keys(pity)) {
    if (k !== 'everyN' && k !== 'guarantee') errors.push(`${id}: pity 不支持的键 -> ${k}`);
  }
  const everyN = (pity as Entry)['everyN'];
  if (everyN !== undefined && (!Number.isInteger(everyN) || (everyN as number) < 1)) {
    errors.push(`${id}: pity.everyN 应为正整数（${String(everyN)}）`);
  }
  if ((pity as Entry)['guarantee'] !== undefined && (!Number.isInteger(everyN) || (everyN as number) < 1)) {
    errors.push(`${id}: pity.guarantee 声明了保底承诺但 everyN 缺失或非法（${String(everyN)}）`);
  }
  return errors;
}
