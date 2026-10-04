import { describe, expect, it } from 'vitest';
import type { GameplayResult, IConfigSource, IGameContext } from '../../assets/scripts/core/contracts';
import { calculateSettlement } from '../../assets/scripts/core/gameplay/Settlement';
import { MemoryStorage } from '../../assets/scripts/core/framework/Storage';
import { LocalPlatformAdapter } from '../../assets/scripts/core/platform/LocalPlatformAdapter';
import { createGameContext } from '../../assets/scripts/core/services';
import { silentLog } from '../helpers';
import { at, makeTables, type TestTables } from '../services/fixtures';

function makeSource(overrides: Partial<TestTables> = {}): IConfigSource {
  const tables = { ...makeTables(), ...overrides } as Record<string, unknown>;
  return { load: async (name) => tables[name] };
}

/** random=0.5 时 Mock 固定产出：score 1650 / distance 700 / coins 160 / diamonds 2。 */
async function createRunContext(): Promise<IGameContext> {
  return createGameContext({
    platform: new LocalPlatformAdapter({ storage: new MemoryStorage(), log: silentLog }),
    configSource: makeSource(),
    now: at(2026, 10, 4),
    gameplay: { delayMs: 0, random: () => 0.5 },
  });
}

describe('跑酷结算闭环（core，无 UI）', () => {
  it('launch → run.finished → 结算 base → 任务/成就/活动进度与红点', async () => {
    const ctx = await createRunContext();
    const started: unknown[] = [];
    const finished: GameplayResult[] = [];
    const settled: Array<{ reward: unknown; doubled: boolean }> = [];
    ctx.events.on('run.started', (payload) => started.push(payload));
    ctx.events.on('run.finished', (payload) => finished.push(payload));
    ctx.events.on('run.settled', (payload) => settled.push({ reward: payload.reward, doubled: payload.doubled }));

    const opts = { mode: 'classic', characterId: 'runner_default', items: ['magnet'] };
    ctx.events.emit('run.started', opts);
    const result = await ctx.gameplay.launch(opts);
    ctx.events.emit('run.finished', result);

    expect(started).toEqual([opts]);
    expect(finished).toEqual([result]);
    expect(ctx.save.stats.runs).toBe(1);
    expect(ctx.save.stats.bestScore).toBe(1650);
    expect(ctx.save.tasks.daily.progress['daily.run1']).toBe(1);
    expect(ctx.save.tasks.weekly.progress['weekly.run5']).toBe(1);
    expect(ctx.save.achievements.progress['ach.run1']).toBe(1);
    expect(ctx.save.activities.progress['act_test']).toBe(1);
    expect(ctx.redDot.isOn('menu.tasks')).toBe(true);
    expect(ctx.redDot.isOn('menu.achievements')).toBe(true);

    const settlement = calculateSettlement(result, ctx.config.run('classic'));
    // gold = 160 + floor(1650 / 10) = 325；diamond = 2 + floor(160 / 500) = 2
    expect(settlement.base).toEqual({ gold: 325, diamond: 2, items: [] });

    ctx.reward.grant(settlement.base, 'settlement');
    ctx.events.emit('run.settled', { result, reward: settlement.base, doubled: false });

    expect(ctx.save.currency.gold).toBe(325);
    expect(ctx.save.currency.diamond).toBe(2);
    expect(settled).toEqual([{ reward: settlement.base, doubled: false }]);

    // 任务领取：奖励累加、红点关闭
    expect(ctx.task.claim('daily.run1')).toEqual({ ok: true });
    expect(ctx.save.currency.gold).toBe(335);
    expect(ctx.redDot.isOn('menu.tasks')).toBe(false);
  });

  it('广告双倍：只发放 double（基础×2）且金额精确', async () => {
    const ctx = await createRunContext();
    const result = await ctx.gameplay.launch({ mode: 'classic', characterId: 'runner_default' });
    ctx.events.emit('run.finished', result);
    const settlement = calculateSettlement(result, ctx.config.run('classic'));

    expect(settlement.double).toEqual({ gold: 650, diamond: 4, items: [] });

    ctx.reward.grant(settlement.double, 'settlement.ad');
    ctx.events.emit('run.settled', { result, reward: settlement.double, doubled: true });

    expect(ctx.save.currency.gold).toBe(650);
    expect(ctx.save.currency.diamond).toBe(4);
    expect(ctx.save.stats.runs).toBe(1);
  });

  it('0 分对局：结算不发货币但 run.count 仍推进', async () => {
    const ctx = await createRunContext();
    const zero: GameplayResult = {
      mode: 'classic',
      score: 0,
      distance: 0,
      coins: 0,
      diamonds: 0,
      durationMs: 0,
      revivedCount: 0,
    };
    ctx.events.emit('run.finished', zero);
    const settlement = calculateSettlement(zero, ctx.config.run('classic'));

    ctx.reward.grant(settlement.base, 'settlement');
    ctx.events.emit('run.settled', { result: zero, reward: settlement.base, doubled: false });

    expect(ctx.save.currency.gold).toBe(0);
    expect(ctx.save.currency.diamond).toBe(0);
    expect(ctx.save.tasks.daily.progress['daily.run1']).toBe(1);
    expect(ctx.save.stats.runs).toBe(1);
    expect(ctx.save.stats.bestScore).toBe(0);
  });
});
