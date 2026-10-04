import { describe, expect, it } from 'vitest';
import { FailReason } from '../../assets/scripts/core/contracts';
import { at, createProgress } from './fixtures';

describe('WelfareService', () => {
  it('初始三态与单日签到推进', async () => {
    const { ctx, welfare } = await createProgress();
    const events: unknown[] = [];
    ctx.events.on('welfare.changed', (payload) => events.push(payload));

    const initial = welfare.signInState();
    expect(initial.todaySigned).toBe(false);
    expect(initial.cycleDay).toBe(0);
    expect(initial.days.map((day) => day.state)).toEqual(['today', 'future', 'future']);

    expect(welfare.signIn()).toEqual({ ok: true });
    expect(ctx.save.currency.gold).toBe(10);
    expect(ctx.save.welfare).toMatchObject({
      signInCycleDay: 1,
      lastSignInDate: '2026-10-04',
      signInHistory: ['2026-10-04'],
    });

    const signed = welfare.signInState();
    expect(signed.todaySigned).toBe(true);
    expect(signed.days.map((day) => day.state)).toEqual(['claimed', 'future', 'future']);
    expect(welfare.signIn()).toEqual({ ok: false, reason: FailReason.AlreadyClaimed });
    expect(events).toHaveLength(1);
  });

  it('连续签到 1→3→循环回第 1 天', async () => {
    const { ctx, welfare } = await createProgress();

    welfare.signIn();
    ctx.setNow(at(2026, 10, 5));
    expect(welfare.signInState().days.map((day) => day.state)).toEqual(['claimed', 'today', 'future']);
    welfare.signIn();
    expect(ctx.save.welfare.signInCycleDay).toBe(2);

    ctx.setNow(at(2026, 10, 6));
    welfare.signIn();
    expect(ctx.save.currency.gold).toBe(60);
    expect(ctx.save.welfare.signInCycleDay).toBe(0);
    expect(ctx.save.welfare.lastSignInDate).toBe('2026-10-06');

    ctx.setNow(at(2026, 10, 7));
    const nextCycle = welfare.signInState();
    expect(nextCycle.days.map((day) => day.state)).toEqual(['today', 'future', 'future']);
    welfare.signIn();
    expect(ctx.save.currency.gold).toBe(70);
  });

  it('签到历史去重并按 90 条 FIFO 裁剪', async () => {
    const { ctx, welfare } = await createProgress();
    const history = Array.from({ length: 90 }, (_, i) => `old-${i}`);
    ctx.save.welfare.signInHistory = [...history, '2026-10-04'];

    welfare.signIn();

    expect(ctx.save.welfare.signInHistory).toHaveLength(90);
    expect(ctx.save.welfare.signInHistory[0]).toBe('old-1');
    expect(ctx.save.welfare.signInHistory[89]).toBe('2026-10-04');
  });

  it('每日免费广告：同日一次、跨天重置', async () => {
    const { ctx, welfare } = await createProgress();
    const events: unknown[] = [];
    ctx.events.on('welfare.changed', (payload) => events.push(payload));

    expect(welfare.dailyFreeAdClaimed()).toBe(false);
    expect(welfare.claimDailyFreeAd()).toEqual({ ok: true });
    expect(ctx.save.currency.gold).toBe(10);
    expect(welfare.dailyFreeAdClaimed()).toBe(true);
    expect(ctx.save.flags['welfare.dailyAdDate']).toBe('2026-10-04');
    expect(welfare.claimDailyFreeAd()).toEqual({ ok: false, reason: FailReason.AlreadyClaimed });

    ctx.setNow(at(2026, 10, 5));
    expect(welfare.dailyFreeAdClaimed()).toBe(false);
    expect(welfare.claimDailyFreeAd()).toEqual({ ok: true });
    expect(ctx.save.currency.gold).toBe(20);
    expect(events).toHaveLength(2);
  });

  it('未配置每日免费奖励时返回 unsupported', async () => {
    const { welfare } = await createProgress({
      welfare: {
        signIn: { days: [{ day: 1, reward: { gold: 10 } }] },
        dailyFreeAd: null,
      },
    });
    expect(welfare.claimDailyFreeAd()).toEqual({ ok: false, reason: FailReason.Unsupported });
  });
});
