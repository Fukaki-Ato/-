/**
 * 一局结算计算（docs/02 §3.9 / docs/06 §4）。
 *
 * 纯 TS：仅做数值换算，不发放奖励、不访问存档、不 import 'cc'。
 * 公式：
 *   base.gold    = floor(coins * coinsToGold) + floor(score / scoreToGoldDivisor)
 *   base.diamond = diamonds + floor(coins / diamondEveryCoins)
 *   base.items   = []（预留掉落）
 *   double       = base × 2（金币/钻石翻倍；items 原样浅拷贝，不去重不合并）
 *
 * 输入防护：字段缺失/非有限/负数按 0；超大值 clamp 到 CURRENCY_MAX；
 * 配置系数缺失/非法按 0，除数为 0 时该路不发奖（避免 Infinity/NaN）。
 */
import {
  CURRENCY_MAX,
  type GameplayResult,
  type RewardBundle,
  type RunConfig,
  type SettlementResult,
} from '../contracts';

/** 对局指标防护：非有限、负数按 0；超大值截到 CURRENCY_MAX。 */
function safeAmount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0;
  return Math.min(Math.floor(value), CURRENCY_MAX);
}

/** 结算系数防护：非有限、负数按 0（0 表示该路不发奖）。 */
function safeFactor(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 0;
  return value;
}

/** 货币值防护：非有限、非正数按 0；超过上限截到 CURRENCY_MAX。 */
function clampCurrency(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(value, CURRENCY_MAX);
}

export function calculateSettlement(result: GameplayResult, run: RunConfig): SettlementResult {
  const source = (result ?? undefined) as Partial<GameplayResult> | null | undefined;
  const settle = ((run ?? undefined) as Partial<RunConfig> | null | undefined)?.settle;

  const score = safeAmount(source?.score);
  const coins = safeAmount(source?.coins);
  const diamonds = safeAmount(source?.diamonds);

  const coinsToGold = safeFactor(settle?.coinsToGold);
  const scoreToGoldDivisor = safeFactor(settle?.scoreToGoldDivisor);
  const diamondEveryCoins = safeFactor(settle?.diamondEveryCoins);

  const goldFromCoins = Math.floor(coins * coinsToGold);
  const goldFromScore = scoreToGoldDivisor > 0 ? Math.floor(score / scoreToGoldDivisor) : 0;
  const diamondFromCoins = diamondEveryCoins > 0 ? Math.floor(coins / diamondEveryCoins) : 0;

  const baseGold = clampCurrency(goldFromCoins + goldFromScore);
  const baseDiamond = clampCurrency(diamonds + diamondFromCoins);

  const base: RewardBundle = {
    gold: baseGold,
    diamond: baseDiamond,
    items: [], // 预留掉落
  };
  const double: RewardBundle = {
    gold: clampCurrency(baseGold * 2),
    diamond: clampCurrency(baseDiamond * 2),
    // 预留掉落不翻倍，仅浅拷贝且不去重（重复 id 原样保留）
    items: (base.items ?? []).map((stack) => ({ ...stack })),
  };

  return { result, base, double };
}
