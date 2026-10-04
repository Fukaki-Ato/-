import { describe, expect, it } from 'vitest';
import { FailReason } from '../../assets/scripts/core/contracts';
import { createEconomy } from './fixtures';

describe('InventoryService', () => {
  it('add/count/all 增删查并派发 inventory.changed', async () => {
    const { ctx, inventory } = await createEconomy();
    const changes: Array<{ id: string; count: number }[]> = [];
    ctx.events.on('inventory.changed', (payload) => changes.push(payload.changed));

    inventory.add('magnet', 2);
    inventory.add('magnet', 3);
    inventory.add('stone', 1);

    expect(inventory.count('magnet')).toBe(5);
    expect(inventory.count('stone')).toBe(1);
    expect(inventory.count('ghost')).toBe(0);
    expect(inventory.all()).toEqual([
      { id: 'magnet', count: 5 },
      { id: 'stone', count: 1 },
    ]);
    expect(changes).toEqual([[{ id: 'magnet', count: 2 }], [{ id: 'magnet', count: 5 }], [{ id: 'stone', count: 1 }]]);
  });

  it('add 非正数忽略：负数 warn、0 静默', async () => {
    const { ctx, inventory } = await createEconomy();
    inventory.add('magnet', -3);
    inventory.add('magnet', 0);
    inventory.add('magnet', Number.NaN);

    expect(inventory.count('magnet')).toBe(0);
    expect(ctx.log.calls.some((call) => call.level === 'warn' && call.msg.includes('负数道具增加'))).toBe(true);
  });

  it('remove 不足或负数返回 insufficient 且零变更', async () => {
    const { ctx, inventory } = await createEconomy();
    inventory.add('magnet', 2);
    const changes: unknown[] = [];
    ctx.events.on('inventory.changed', (payload) => changes.push(payload));

    expect(inventory.remove('magnet', 3)).toEqual({ ok: false, reason: FailReason.Insufficient });
    expect(inventory.remove('magnet', -1)).toEqual({ ok: false, reason: FailReason.Insufficient });
    expect(inventory.count('magnet')).toBe(2);
    expect(changes).toHaveLength(0);
  });

  it('remove 0 视为成功且不派发事件', async () => {
    const { ctx, inventory } = await createEconomy();
    const changes: unknown[] = [];
    ctx.events.on('inventory.changed', (payload) => changes.push(payload));
    expect(inventory.remove('magnet', 0)).toEqual({ ok: true });
    expect(changes).toHaveLength(0);
  });

  it('remove 到 0 后 all 不再展示该道具', async () => {
    const { ctx, inventory } = await createEconomy();
    inventory.add('magnet', 2);
    expect(inventory.remove('magnet', 2)).toEqual({ ok: true });
    expect(inventory.count('magnet')).toBe(0);
    expect(inventory.all()).toEqual([]);
    expect(ctx.save.inventory.magnet).toBe(0);
  });

  it('use：道具不存在或无 useEffect 返回 unsupported', async () => {
    const { inventory } = await createEconomy();
    expect(inventory.use('ghost')).toEqual({ ok: false, reason: FailReason.Unsupported });
    expect(inventory.use('stone')).toEqual({ ok: false, reason: FailReason.Unsupported });
  });

  it('use：数量不足返回 insufficient，成功时消耗 1 并返回 effect（不应用效果）', async () => {
    const { ctx, inventory } = await createEconomy();
    expect(inventory.use('magnet')).toEqual({ ok: false, reason: FailReason.Insufficient });

    inventory.add('magnet', 2);
    const result = inventory.use('magnet');
    expect(result).toEqual({ ok: true, effect: { kind: 'runBuff', buffId: 'magnet' } });
    expect(inventory.count('magnet')).toBe(1);

    inventory.add('pouch', 1);
    const grant = inventory.use('pouch');
    expect(grant).toEqual({ ok: true, effect: { kind: 'grant', reward: { gold: 100 } } });
    expect(ctx.save.currency.gold).toBe(0);
  });
});
