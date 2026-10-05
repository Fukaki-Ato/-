import { describe, expect, it } from 'vitest';
import {
  CURRENCY_MAX,
  type GameplayResult,
  type RunConfig,
  type SettleConfig,
} from '../../assets/scripts/core/contracts';
import { calculateSettlement } from '../../assets/scripts/core/gameplay/Settlement';

const SETTLE: SettleConfig = { coinsToGold: 1, scoreToGoldDivisor: 10, diamondEveryCoins: 500 };

function run(overrides: Partial<RunConfig> = {}): RunConfig {
  return {
    mode: 'classic',
    name: '经典模式',
    settle: SETTLE,
    revive: { adPerRun: 1 },
    buffs: {},
    ...overrides,
  };
}

function result(overrides: Partial<GameplayResult> = {}): GameplayResult {
  return {
    mode: 'classic',
    score: 0,
    distance: 0,
    coins: 0,
    diamonds: 0,
    durationMs: 0,
    revivedCount: 0,
    ...overrides,
  };
}

describe('calculateSettlement', () => {
  it('按 docs/02 公式计算基础奖励', () => {
    const settlement = calculateSettlement(result({ score: 250, coins: 100, diamonds: 2 }), run());

    // gold = floor(100 * 1) + floor(250 / 10) = 125；diamond = 2 + floor(100 / 500) = 2
    expect(settlement.base).toEqual({ gold: 125, diamond: 2, items: [] });
    expect(settlement.double).toEqual({ gold: 250, diamond: 4, items: [] });
  });

  it('各字段向下取整：不足一个换算单位不产生奖励', () => {
    const settlement = calculateSettlement(result({ score: 99, coins: 7, diamonds: 0 }), run());

    // gold = 7 + floor(9.9) = 16；diamond = 0 + floor(7 / 500) = 0
    expect(settlement.base.gold).toBe(16);
    expect(settlement.base.diamond).toBe(0);
  });

  it('0 分对局：基础与双倍均为 0', () => {
    const settlement = calculateSettlement(result(), run());

    expect(settlement.base).toEqual({ gold: 0, diamond: 0, items: [] });
    expect(settlement.double).toEqual({ gold: 0, diamond: 0, items: [] });
  });

  it('负数输入按 0 处理', () => {
    const settlement = calculateSettlement(
      result({ score: -100, coins: -20, diamonds: -3, distance: -5, durationMs: -1 }),
      run(),
    );

    expect(settlement.base).toEqual({ gold: 0, diamond: 0, items: [] });
    expect(settlement.double).toEqual({ gold: 0, diamond: 0, items: [] });
  });

  it('字段缺失按 0 处理且不抛错', () => {
    const partial = { mode: 'classic' } as unknown as GameplayResult;
    const settlement = calculateSettlement(partial, run());

    expect(settlement.base).toEqual({ gold: 0, diamond: 0, items: [] });
  });

  it('小数输入向下取整', () => {
    const settlement = calculateSettlement(result({ score: 105.9, coins: 12.7, diamonds: 1.9 }), run());

    // score→105, coins→12：gold = 12 + floor(10.5) = 22；diamond = 1
    expect(settlement.base.gold).toBe(22);
    expect(settlement.base.diamond).toBe(1);
  });

  it('超大输入 clamp 到 CURRENCY_MAX（含双倍）', () => {
    const settlement = calculateSettlement(
      result({ score: Number.MAX_SAFE_INTEGER, coins: Number.MAX_SAFE_INTEGER, diamonds: Number.MAX_SAFE_INTEGER }),
      run(),
    );

    expect(settlement.base.gold).toBe(CURRENCY_MAX);
    expect(settlement.base.diamond).toBe(CURRENCY_MAX);
    expect(settlement.double.gold).toBe(CURRENCY_MAX);
    expect(settlement.double.diamond).toBe(CURRENCY_MAX);
  });

  it('Infinity / NaN 输入按防护值处理，不产生 NaN', () => {
    const settlement = calculateSettlement(
      result({ score: Number.POSITIVE_INFINITY, coins: Number.NaN, diamonds: Number.NEGATIVE_INFINITY }),
      run(),
    );

    expect(settlement.base.gold).toBe(0);
    expect(settlement.base.diamond).toBe(0);
    expect(Number.isNaN(settlement.base.gold)).toBe(false);
  });

  it('除数配置为 0/负数/缺失时该路不发奖，不产生 Infinity', () => {
    const zero = calculateSettlement(result({ score: 1000, coins: 100, diamonds: 1 }), run({
      settle: { coinsToGold: 1, scoreToGoldDivisor: 0, diamondEveryCoins: 0 },
    }));
    expect(zero.base).toEqual({ gold: 100, diamond: 1, items: [] });

    const missing = calculateSettlement(result({ score: 1000, coins: 100, diamonds: 1 }), run({
      settle: { coinsToGold: 1 } as unknown as SettleConfig,
    }));
    expect(missing.base).toEqual({ gold: 100, diamond: 1, items: [] });
  });

  it('double 精确等于 base ×2（未触顶时）', () => {
    const settlement = calculateSettlement(result({ score: 456, coins: 123, diamonds: 5 }), run());

    expect(settlement.base).toEqual({ gold: 123 + 45, diamond: 5, items: [] });
    expect(settlement.double.gold).toBe(settlement.base.gold! * 2);
    expect(settlement.double.diamond).toBe(settlement.base.diamond! * 2);
  });

  it('double.items 为 base.items 的独立浅拷贝且不去重（预留掉落）', () => {
    const settlement = calculateSettlement(result(), run());

    expect(settlement.double.items).not.toBe(settlement.base.items);
    expect(settlement.double.items).toEqual(settlement.base.items);
  });

  it('原样返回对局结果引用（面板展示用）', () => {
    const source = result({ score: 999, distance: 321 });
    const settlement = calculateSettlement(source, run());

    expect(settlement.result).toBe(source);
  });

  it('result/run 为 null 时不抛错（运行时防护）', () => {
    expect(() => calculateSettlement(null as unknown as GameplayResult, null as unknown as RunConfig)).not.toThrow();
    const settlement = calculateSettlement(null as unknown as GameplayResult, null as unknown as RunConfig);
    expect(settlement.base).toEqual({ gold: 0, diamond: 0, items: [] });
  });
});
