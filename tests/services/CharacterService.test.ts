import { describe, expect, it } from 'vitest';
import { FailReason } from '../../assets/scripts/core/contracts';
import { createEconomy, seedSave } from './fixtures';

describe('CharacterService', () => {
  it('默认角色已解锁并选中，属性为基础值，索引齐全', async () => {
    const { character } = await createEconomy();
    const current = character.current();
    expect(current.config.id).toBe('runner_default');
    expect(current.unlocked).toBe(true);
    expect(current.level).toBe(1);
    expect(current.selected).toBe(true);
    expect(current.attrs).toEqual({ speed: 10, jump: 10, magnet: 0, coinBonus: 0, scoreBonus: 0 });
    expect(current.canUpgrade).toBe(false);
    expect(character.list()).toHaveLength(4);
    expect(character.attrsOf('runner_default')).toEqual(current.attrs);

    const paid = character.get('runner_paid');
    expect(paid?.unlocked).toBe(false);
    expect(paid?.level).toBe(0);
    expect(paid?.attrs).toEqual({ speed: 12, jump: 11, magnet: 5, coinBonus: 10, scoreBonus: 2 });
    expect(paid?.unlockCost).toEqual({ diamond: 200 });
    expect(paid?.canUnlock).toBe(false);
    expect(paid?.canUpgrade).toBe(false);
  });

  it('货币解锁：扣钻石、发事件、重复调用幂等', async () => {
    const { ctx, character } = await createEconomy();
    seedSave(ctx.save, 0, 200);
    const events: unknown[] = [];
    ctx.events.on('character.changed', (payload) => events.push(payload));

    expect(character.unlock('runner_paid')).toEqual({ ok: true });
    expect(ctx.save.currency.diamond).toBe(0);
    expect(ctx.save.characters.unlocked).toContain('runner_paid');
    expect(ctx.save.characters.levels.runner_paid).toBe(1);
    expect(events).toEqual([{ id: 'runner_paid', reason: 'unlock' }]);

    expect(character.unlock('runner_paid')).toEqual({ ok: true });
    expect(events).toHaveLength(1);
  });

  it('货币解锁余额不足返回 insufficient 且不解锁', async () => {
    const { ctx, character } = await createEconomy();
    seedSave(ctx.save, 0, 10);
    expect(character.unlock('runner_paid')).toEqual({ ok: false, reason: FailReason.Insufficient });
    expect(ctx.save.characters.unlocked).not.toContain('runner_paid');
    expect(ctx.save.currency.diamond).toBe(10);
  });

  it('道具解锁：消耗碎片；不足时零变更', async () => {
    const { ctx, character, inventory } = await createEconomy();
    seedSave(ctx.save, 0, 0, { stone: 3 });
    expect(character.unlock('runner_item')).toEqual({ ok: true });
    expect(inventory.count('stone')).toBe(0);
    expect(ctx.save.characters.unlocked).toContain('runner_item');
    expect(ctx.save.characters.levels.runner_item).toBe(1);

    const second = await createEconomy();
    seedSave(second.ctx.save, 0, 0, { stone: 2 });
    expect(second.character.unlock('runner_item')).toEqual({ ok: false, reason: FailReason.Insufficient });
    expect(second.inventory.count('stone')).toBe(2);
    expect(second.ctx.save.characters.unlocked).not.toContain('runner_item');
  });

  it('升级费用与属性按公式计算（1→2、2→3、满级）', async () => {
    const { ctx, character } = await createEconomy();
    seedSave(ctx.save, 10_000, 0);
    const events: unknown[] = [];
    ctx.events.on('character.changed', (payload) => events.push(payload));

    expect(character.get('runner_default')?.upgradeCost).toEqual({ gold: 500 });
    expect(character.upgrade('runner_default')).toEqual({ ok: true });
    expect(ctx.save.currency.gold).toBe(9500);
    expect(character.get('runner_default')?.level).toBe(2);
    expect(character.attrsOf('runner_default')).toEqual({ speed: 11, jump: 11, magnet: 0, coinBonus: 1, scoreBonus: 0 });

    expect(character.get('runner_default')?.upgradeCost).toEqual({ gold: 800 });
    expect(character.upgrade('runner_default')).toEqual({ ok: true });
    expect(ctx.save.currency.gold).toBe(8700);
    expect(character.attrsOf('runner_default')).toEqual({ speed: 11, jump: 11, magnet: 0, coinBonus: 2, scoreBonus: 0 });

    expect(character.upgrade('runner_default')).toEqual({ ok: false, reason: FailReason.MaxLevel });
    expect(ctx.save.currency.gold).toBe(8700);
    expect(events).toEqual([
      { id: 'runner_default', reason: 'upgrade' },
      { id: 'runner_default', reason: 'upgrade' },
    ]);
  });

  it('升级余额不足/未解锁/不存在分别返回 insufficient/locked/not_found', async () => {
    const { ctx, character } = await createEconomy();
    seedSave(ctx.save, 100, 0);
    expect(character.upgrade('runner_default')).toEqual({ ok: false, reason: FailReason.Insufficient });
    expect(character.get('runner_default')?.level).toBe(1);
    expect(character.upgrade('runner_item')).toEqual({ ok: false, reason: FailReason.Locked });
    expect(character.upgrade('ghost')).toEqual({ ok: false, reason: FailReason.NotFound });
    expect(character.unlock('ghost')).toEqual({ ok: false, reason: FailReason.NotFound });
  });

  it('混合费用升级（钻石 + 道具）原子扣除', async () => {
    const { ctx, character, inventory } = await createEconomy();
    seedSave(ctx.save, 0, 500, { stone: 2 });
    expect(character.unlock('runner_paid')).toEqual({ ok: true });
    expect(ctx.save.currency.diamond).toBe(300);

    expect(character.upgrade('runner_paid')).toEqual({ ok: true });
    expect(ctx.save.currency.diamond).toBe(250);
    expect(inventory.count('stone')).toBe(0);
    expect(character.get('runner_paid')?.level).toBe(2);
    expect(character.upgrade('runner_paid')).toEqual({ ok: false, reason: FailReason.MaxLevel });

    const second = await createEconomy();
    seedSave(second.ctx.save, 0, 500, { stone: 1 });
    second.character.unlock('runner_paid');
    expect(second.character.upgrade('runner_paid')).toEqual({ ok: false, reason: FailReason.Insufficient });
    expect(second.ctx.save.currency.diamond).toBe(300);
    expect(second.inventory.count('stone')).toBe(1);
    expect(second.character.get('runner_paid')?.level).toBe(1);
  });

  it('select：未解锁返回 locked，已解锁切换并派发事件', async () => {
    const { ctx, character } = await createEconomy();
    seedSave(ctx.save, 0, 200);
    const events: unknown[] = [];
    ctx.events.on('character.changed', (payload) => events.push(payload));

    expect(character.select('runner_paid')).toEqual({ ok: false, reason: FailReason.Locked });
    expect(character.select('ghost')).toEqual({ ok: false, reason: FailReason.NotFound });
    expect(character.unlock('runner_paid')).toEqual({ ok: true });
    expect(character.select('runner_paid')).toEqual({ ok: true });
    expect(ctx.save.characters.selected).toBe('runner_paid');
    expect(character.current().config.id).toBe('runner_paid');
    expect(character.current().selected).toBe(true);
    expect(events).toEqual([
      { id: 'runner_paid', reason: 'unlock' },
      { id: 'runner_paid', reason: 'select' },
    ]);

    expect(character.select('runner_paid')).toEqual({ ok: true });
    expect(events).toHaveLength(2);
  });

  it('列表视图 canUnlock/canUpgrade 随资源变化', async () => {
    const { ctx, character } = await createEconomy();
    seedSave(ctx.save, 500, 200, { stone: 3 });

    expect(character.get('runner_paid')?.canUnlock).toBe(true);
    expect(character.get('runner_item')?.canUnlock).toBe(true);
    const hero = character.get('runner_default');
    expect(hero?.canUpgrade).toBe(true);
    expect(hero?.upgradeCost).toEqual({ gold: 500 });
    expect(character.get('runner_paid')?.upgradeCost).toBeUndefined();
  });
});
