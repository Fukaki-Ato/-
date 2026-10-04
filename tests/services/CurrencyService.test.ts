import { describe, expect, it } from 'vitest';
import { CURRENCY_MAX, FailReason, type CurrencyType } from '../../assets/scripts/core/contracts';
import { createEconomy, seedSave } from './fixtures';

interface CurrencyEvent {
  gold: number;
  diamond: number;
  deltaGold: number;
  deltaDiamond: number;
  reason: string;
}

describe('CurrencyService', () => {
  it('add 更新余额并派发 currency.changed（含 delta 与 reason）', async () => {
    const { ctx, currency } = await createEconomy();
    const events: CurrencyEvent[] = [];
    ctx.events.on('currency.changed', (payload) => events.push(payload));

    currency.add('gold', 100, 'test');
    currency.add('diamond', 30, 'test');

    expect(ctx.save.currency).toEqual({ gold: 100, diamond: 30 });
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ gold: 100, diamond: 0, deltaGold: 100, deltaDiamond: 0, reason: 'test' });
    expect(events[1]).toMatchObject({ gold: 100, diamond: 30, deltaGold: 0, deltaDiamond: 30, reason: 'test' });
  });

  it('add 到达上限时夹取，delta 为实际增加量', async () => {
    const { ctx, currency } = await createEconomy();
    const events: CurrencyEvent[] = [];
    ctx.events.on('currency.changed', (payload) => events.push(payload));
    seedSave(ctx.save, CURRENCY_MAX - 10, 0);

    currency.add('gold', 100, 'overflow');

    expect(currency.get('gold')).toBe(CURRENCY_MAX);
    expect(events).toHaveLength(1);
    expect(events[0].deltaGold).toBe(10);
  });

  it('add 负数被忽略并 warn，非有限值静默忽略', async () => {
    const { ctx, currency } = await createEconomy();
    seedSave(ctx.save, 50, 0);
    const events: CurrencyEvent[] = [];
    ctx.events.on('currency.changed', (payload) => events.push(payload));

    currency.add('gold', -5, 'bad');
    currency.add('gold', Number.NaN, 'bad');

    expect(currency.get('gold')).toBe(50);
    expect(events).toHaveLength(0);
    expect(ctx.log.calls.some((call) => call.level === 'warn' && call.msg.includes('负数货币增加'))).toBe(true);
  });

  it('canAfford 覆盖货币、道具与非法费用', async () => {
    const { ctx, currency } = await createEconomy();
    seedSave(ctx.save, 100, 5, { magnet: 2 });

    expect(currency.canAfford({})).toBe(true);
    expect(currency.canAfford({ gold: 100, diamond: 5 })).toBe(true);
    expect(currency.canAfford({ gold: 101 })).toBe(false);
    expect(currency.canAfford({ diamond: 6 })).toBe(false);
    expect(currency.canAfford({ items: [{ id: 'magnet', count: 2 }] })).toBe(true);
    expect(currency.canAfford({ items: [{ id: 'magnet', count: 3 }] })).toBe(false);
    expect(currency.canAfford({ gold: -1 })).toBe(false);
    expect(currency.canAfford({ gold: Number.NaN })).toBe(false);
    expect(currency.canAfford({ items: [{ id: 'magnet', count: -1 }] })).toBe(false);
  });

  it('spend 货币不足时返回 insufficient 且零变更', async () => {
    const { ctx, currency } = await createEconomy();
    seedSave(ctx.save, 50, 0);
    const events: CurrencyEvent[] = [];
    ctx.events.on('currency.changed', (payload) => events.push(payload));

    const result = currency.spend({ gold: 100 }, 'buy');

    expect(result).toEqual({ ok: false, reason: FailReason.Insufficient });
    expect(ctx.save.currency.gold).toBe(50);
    expect(events).toHaveLength(0);
  });

  it('spend 负数费用返回 insufficient', async () => {
    const { ctx, currency } = await createEconomy();
    seedSave(ctx.save, 100, 0);
    expect(currency.spend({ gold: -1 }, 'bad')).toEqual({ ok: false, reason: FailReason.Insufficient });
    expect(ctx.save.currency.gold).toBe(100);
  });

  it('spend 含道具时原子：道具不足则货币也不扣除', async () => {
    const { ctx, currency } = await createEconomy();
    seedSave(ctx.save, 100, 0, { magnet: 1 });
    const result = currency.spend({ gold: 100, items: [{ id: 'magnet', count: 2 }] }, 'buy');
    expect(result).toEqual({ ok: false, reason: FailReason.Insufficient });
    expect(ctx.save.currency.gold).toBe(100);
    expect(ctx.save.inventory.magnet).toBe(1);
  });

  it('spend 货币不足时道具不扣除', async () => {
    const { ctx, currency } = await createEconomy();
    seedSave(ctx.save, 5, 0, { magnet: 2 });
    const result = currency.spend({ gold: 10, items: [{ id: 'magnet', count: 1 }] }, 'buy');
    expect(result).toEqual({ ok: false, reason: FailReason.Insufficient });
    expect(ctx.save.currency.gold).toBe(5);
    expect(ctx.save.inventory.magnet).toBe(2);
  });

  it('spend 重复道具条目按 id 合并校验（防止绕过）', async () => {
    const { ctx, currency } = await createEconomy();
    seedSave(ctx.save, 0, 0, { magnet: 3 });
    const result = currency.spend({ items: [{ id: 'magnet', count: 2 }, { id: 'magnet', count: 2 }] }, 'buy');
    expect(result).toEqual({ ok: false, reason: FailReason.Insufficient });
    expect(ctx.save.inventory.magnet).toBe(3);
  });

  it('spend 成功时先扣道具再扣货币并派发事件', async () => {
    const { ctx, currency, inventory } = await createEconomy();
    seedSave(ctx.save, 100, 20, { magnet: 2, stone: 1 });
    const currencyEvents: CurrencyEvent[] = [];
    const inventoryEvents: string[][] = [];
    ctx.events.on('currency.changed', (payload) => currencyEvents.push(payload));
    ctx.events.on('inventory.changed', (payload) => inventoryEvents.push(payload.changed.map((stack) => stack.id)));

    const result = currency.spend({ gold: 30, diamond: 5, items: [{ id: 'magnet', count: 1 }, { id: 'stone', count: 1 }] }, 'buy.test');

    expect(result).toEqual({ ok: true });
    expect(ctx.save.currency).toEqual({ gold: 70, diamond: 15 });
    expect(inventory.count('magnet')).toBe(1);
    expect(inventory.count('stone')).toBe(0);
    expect(currencyEvents).toHaveLength(1);
    expect(currencyEvents[0]).toMatchObject({ gold: 70, diamond: 15, deltaGold: -30, deltaDiamond: -5, reason: 'buy.test' });
    expect(inventoryEvents).toEqual([['magnet'], ['stone']]);
    expect(ctx.dirtyCount()).toBeGreaterThan(0);
  });

  it('空费用 spend 成功且不产生事件', async () => {
    const { ctx, currency } = await createEconomy();
    const events: CurrencyEvent[] = [];
    ctx.events.on('currency.changed', (payload) => events.push(payload));
    expect(currency.spend({}, 'noop')).toEqual({ ok: true });
    expect(events).toHaveLength(0);
  });

  it('get 对非法存档值回退为 0', async () => {
    const { ctx, currency } = await createEconomy();
    (ctx.save.currency as unknown as Record<CurrencyType, unknown>).gold = -5;
    expect(currency.get('gold')).toBe(0);
  });
});
