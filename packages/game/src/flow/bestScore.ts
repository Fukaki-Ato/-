/**
 * 历史最佳分（自 mainFlow 迁出腾行数）：v2 修正键读数，旧版笔误键一次性迁移。
 * mainFlow 以 `export { BEST_KEY } from './bestScore.js'` 保持旧导入路径兼容。
 */
import type { EconomyStore } from './localEconomy.js';

/** 历史最佳分存储键（v2 修正键；旧版笔误键含真省略号 U+2026，见 LEGACY_BEST_KEY） */
export const BEST_KEY = 'thunderrun:best';
/** 旧版笔误键 'thunderrun:b…st'：bestScore() 读取时一次性迁移，避免旧成绩静默丢失 */
const LEGACY_BEST_KEY = 'thunderrun:b\u2026st';

/** 历史最佳分：兼容旧键；脏值按 0，result 仅在破纪录时落盘。 */
export function bestScore(storage: EconomyStore): number {
  const raw = storage.get(BEST_KEY);
  if (raw !== null) { const n = Number(raw); return Number.isFinite(n) && n > 0 ? n : 0; }
  const legacy = storage.get(LEGACY_BEST_KEY);
  if (legacy === null) return 0;
  const n = Number(legacy);
  storage.remove(LEGACY_BEST_KEY);
  if (!Number.isFinite(n) || n <= 0) return 0;
  storage.set(BEST_KEY, String(n));
  return n;
}
