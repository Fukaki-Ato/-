import { describe, expect, it } from 'vitest';
import { DIAMOND_ICON, GOLD_ICON } from '../../assets/scripts/core/services/RewardService';
import { createEconomy, seedSave } from './fixtures';

describe('RewardService', () => {
  it('一次发放混合奖励（货币 + 道具 + 角色）', async () => {
    const { ctx, reward, currency, inventory, character } = await createEconomy();
    const currencyEvents: number[] = [];
    ctx.events.on('currency.changed', (payload) => currencyEvents.push(payload.deltaGold + payload.deltaDiamond));

    reward.grant({ gold: 100, diamond: 20, items: [{ id: 'magnet', count: 2 }, { id: 'stone', count: 1 }], characters: ['runner_gift'] }, 'test');

    expect(currency.get('gold')).toBe(100);
    expect(currency.get('diamond')).toBe(20);
    expect(inventory.count('magnet')).toBe(2);
    expect(inventory.count('stone')).toBe(1);
    expect(character.get('runner_gift')?.unlocked).toBe(true);
    expect(character.get('runner_gift')?.level).toBe(1);
    expect(currencyEvents).toEqual([100, 20]);
    expect(ctx.log.calls.filter((call) => call.level === 'warn')).toHaveLength(0);
  });

  it('角色已解锁时跳过且不报错、不重复 emit', async () => {
    const { ctx, reward, character } = await createEconomy();
    const events: unknown[] = [];
    ctx.events.on('character.changed', (payload) => events.push(payload));

    reward.grant({ characters: ['runner_default'] }, 'test');

    expect(character.get('runner_default')?.unlocked).toBe(true);
    expect(events).toHaveLength(0);
    expect(ctx.log.calls.filter((call) => call.level === 'warn')).toHaveLength(0);
  });

  it('空 bundle 与缺省字段安全', async () => {
    const { ctx, reward } = await createEconomy();
    const events: unknown[] = [];
    ctx.events.on('currency.changed', (payload) => events.push(payload));
    ctx.events.on('inventory.changed', (payload) => events.push(payload));
    ctx.events.on('character.changed', (payload) => events.push(payload));

    reward.grant({}, 'test');
    reward.grant(undefined as never, 'test');

    expect(reward.describe({})).toEqual([]);
    expect(events).toHaveLength(0);
  });

  it('describe 名称图标查表，查不到用 id 兜底', async () => {
    const { reward } = await createEconomy();
    const displays = reward.describe({
      gold: 100,
      diamond: 20,
      items: [{ id: 'magnet', count: 2 }, { id: 'ghost', count: 1 }],
      characters: ['runner_gift', 'ghost_hero'],
    });

    expect(displays).toEqual([
      { kind: 'gold', name: '金币', icon: GOLD_ICON, count: 100 },
      { kind: 'diamond', name: '钻石', icon: DIAMOND_ICON, count: 20 },
      { kind: 'item', id: 'magnet', name: '磁铁', icon: 'images/items/magnet', count: 2 },
      { kind: 'item', id: 'ghost', name: 'ghost', icon: '', count: 1 },
      { kind: 'character', id: 'runner_gift', name: '礼物侠', icon: 'images/characters/runner_gift', count: 1 },
      { kind: 'character', id: 'ghost_hero', name: 'ghost_hero', icon: '', count: 1 },
    ]);
  });

  it('grant 负数金额被忽略且不改变数据', async () => {
    const { ctx, reward } = await createEconomy();
    seedSave(ctx.save, 10, 10, { magnet: 1 });
    reward.grant({ gold: -100, diamond: -5, items: [{ id: 'magnet', count: -2 }] }, 'bad');
    expect(ctx.save.currency).toEqual({ gold: 10, diamond: 10 });
    expect(ctx.save.inventory.magnet).toBe(1);
  });
});
