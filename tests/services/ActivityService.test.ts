import { describe, expect, it } from 'vitest';
import { FailReason, type ActivityConfig } from '../../assets/scripts/core/contracts';
import { at, createProgress } from './fixtures';

function activityConfig(overrides: Partial<ActivityConfig> & { id: string }): ActivityConfig {
  return {
    name: overrides.id,
    desc: '测试',
    banner: '测试',
    icon: '测试',
    startTime: '2026-10-01 00:00',
    endTime: '2026-11-01 00:00',
    ruleText: '测试',
    metric: 'run.count',
    milestones: [{ target: 2, reward: { gold: 10 } }],
    order: 1,
    enabled: true,
    ...overrides,
  };
}

describe('ActivityService', () => {
  it('时间窗三态与 enabled 过滤', async () => {
    const { activity } = await createProgress({
      activities: [
        activityConfig({ id: 'act_active' }),
        activityConfig({ id: 'act_upcoming', startTime: '2026-10-10 00:00', endTime: '2026-11-10 00:00' }),
        activityConfig({ id: 'act_ended', startTime: '2026-08-01 00:00', endTime: '2026-09-01 00:00' }),
        activityConfig({ id: 'act_disabled', enabled: false }),
      ],
    });

    const views = activity.list();
    expect(views.map((view) => view.config.id)).toEqual(['act_active', 'act_upcoming', 'act_ended']);
    expect(views.map((view) => view.status)).toEqual(['active', 'upcoming', 'ended']);
    expect(activity.get('act_disabled')).toBeNull();
    expect(activity.get('ghost')).toBeNull();
    expect(activity.get('act_active')?.status).toBe('active');
  });

  it('track：累加、最高值，未开始/已结束不推进', async () => {
    const { ctx, activity } = await createProgress({
      activities: [
        activityConfig({ id: 'act_run', metric: 'run.distance', milestones: [{ target: 100, reward: {} }] }),
        activityConfig({ id: 'act_score', metric: 'run.score.single', milestones: [{ target: 100, reward: {} }] }),
        activityConfig({ id: 'act_ended', metric: 'run.distance', startTime: '2026-08-01 00:00', endTime: '2026-09-01 00:00' }),
        activityConfig({ id: 'act_upcoming', metric: 'run.distance', startTime: '2026-10-10 00:00', endTime: '2026-11-10 00:00' }),
      ],
    });
    const events: Array<{ ids?: string[] }> = [];
    ctx.events.on('activity.changed', (payload) => events.push(payload));

    activity.track('run.distance', 60);
    activity.track('run.distance', 50);
    expect(ctx.save.activities.progress['act_run']).toBe(110);
    expect(ctx.save.activities.progress['act_ended']).toBeUndefined();
    expect(ctx.save.activities.progress['act_upcoming']).toBeUndefined();

    activity.track('run.score.single', 80);
    activity.track('run.score.single', 30);
    expect(ctx.save.activities.progress['act_score']).toBe(80);
    expect(events).toHaveLength(3);
    expect(events[0].ids).toEqual(['act_run']);
  });

  it('track 忽略 NaN/Infinity 与负数', async () => {
    const { ctx, activity } = await createProgress({
      activities: [activityConfig({ id: 'act_run', metric: 'run.distance', milestones: [{ target: 100, reward: {} }] })],
    });

    activity.track('run.distance', Number.NaN);
    activity.track('run.distance', Number.POSITIVE_INFINITY);
    activity.track('run.distance', -10);
    expect(ctx.save.activities.progress['act_run']).toBeUndefined();

    activity.track('run.distance', 5);
    expect(ctx.save.activities.progress['act_run']).toBe(5);
  });

  it('claim：里程碑领取、重复、未达标、越界与时间窗限制', async () => {
    const { ctx, activity } = await createProgress({
      activities: [
        activityConfig({
          id: 'act_claim',
          metric: 'run.count',
          milestones: [
            { target: 2, reward: { gold: 10 } },
            { target: 4, reward: { diamond: 5 } },
          ],
        }),
        activityConfig({ id: 'act_upcoming', startTime: '2026-10-10 00:00', endTime: '2026-11-10 00:00' }),
        activityConfig({ id: 'act_ended', startTime: '2026-08-01 00:00', endTime: '2026-09-01 00:00' }),
        activityConfig({ id: 'act_disabled', enabled: false }),
      ],
    });

    expect(activity.claim('act_claim', 0)).toEqual({ ok: false, reason: FailReason.Insufficient });
    activity.track('run.count', 2);
    expect(activity.claim('act_claim', 0)).toEqual({ ok: true });
    expect(ctx.save.currency.gold).toBe(10);
    expect(activity.claim('act_claim', 0)).toEqual({ ok: false, reason: FailReason.AlreadyClaimed });
    expect(activity.claim('act_claim', 1)).toEqual({ ok: false, reason: FailReason.Insufficient });
    expect(activity.claim('act_claim', 2)).toEqual({ ok: false, reason: FailReason.NotFound });
    expect(activity.claim('act_claim', -1)).toEqual({ ok: false, reason: FailReason.NotFound });
    expect(activity.claim('ghost', 0)).toEqual({ ok: false, reason: FailReason.NotFound });

    activity.track('run.count', 2);
    expect(activity.claim('act_claim', 1)).toEqual({ ok: true });
    expect(ctx.save.currency.diamond).toBe(5);
    expect(ctx.save.activities.claimed['act_claim']).toEqual([0, 1]);

    expect(activity.claim('act_upcoming', 0)).toEqual({ ok: false, reason: FailReason.Locked });
    expect(activity.claim('act_ended', 0)).toEqual({ ok: false, reason: FailReason.Expired });
    expect(activity.claim('act_disabled', 0)).toEqual({ ok: false, reason: FailReason.NotFound });
  });

  it('refreshIfNeeded 检测状态翻转并只发射一次', async () => {
    const { ctx, activity } = await createProgress(
      {
        activities: [
          activityConfig({ id: 'act_soon', startTime: '2026-10-04 18:00', endTime: '2026-10-05 00:00' }),
        ],
      },
      { now: at(2026, 10, 4, 12) },
    );

    activity.refreshIfNeeded();
    const events: unknown[] = [];
    ctx.events.on('activity.changed', (payload) => events.push(payload));

    ctx.setNow(at(2026, 10, 4, 19));
    activity.refreshIfNeeded();
    expect(events).toEqual([{ ids: ['act_soon'] }]);
    expect(activity.get('act_soon')?.status).toBe('active');

    activity.refreshIfNeeded();
    expect(events).toHaveLength(1);
  });

  it('hasClaimable：进行中的活动点亮，其余不点亮', async () => {
    const { activity } = await createProgress({ activities: [activityConfig({ id: 'act_active' })] });
    expect(activity.hasClaimable()).toBe(true);

    const { activity: ended } = await createProgress({
      activities: [activityConfig({ id: 'act_ended', startTime: '2026-08-01 00:00', endTime: '2026-09-01 00:00' })],
    });
    expect(ended.hasClaimable()).toBe(false);

    const { activity: upcoming } = await createProgress({
      activities: [activityConfig({ id: 'act_upcoming', startTime: '2026-10-10 00:00', endTime: '2026-11-10 00:00' })],
    });
    expect(upcoming.hasClaimable()).toBe(false);

    const { activity: disabled } = await createProgress({
      activities: [activityConfig({ id: 'act_disabled', enabled: false })],
    });
    expect(disabled.hasClaimable()).toBe(false);
  });
});
