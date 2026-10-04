import { describe, expect, it } from 'vitest';
import { FailReason, type GameplayResult, type TaskConfig } from '../../assets/scripts/core/contracts';
import { at, createProgress } from './fixtures';

function taskTables(): TaskConfig[] {
  return [
    { id: 'daily.run1', type: 'daily', name: '跑 1 局', desc: '测试', metric: 'run.count', target: 1, reward: { gold: 10 }, order: 1 },
    { id: 'daily.score100', type: 'daily', name: '单局 100 分', desc: '测试', metric: 'run.score.single', target: 100, reward: { items: [{ id: 'magnet', count: 2 }] }, order: 2 },
    { id: 'daily.distance50', type: 'daily', name: '跑 50 米', desc: '测试', metric: 'run.distance', target: 50, reward: { gold: 5 }, order: 3 },
    { id: 'weekly.run5', type: 'weekly', name: '本周 5 局', desc: '测试', metric: 'run.count', target: 5, reward: { gold: 50 }, order: 1 },
    { id: 'weekly.distance80', type: 'weekly', name: '本周 80 米', desc: '测试', metric: 'run.distance', target: 80, reward: { diamond: 3 }, order: 2 },
  ];
}

describe('TaskService', () => {
  it('track 累加并 clamp 到 target，未变化不发事件', async () => {
    const { ctx, task } = await createProgress({ tasks: taskTables() });
    const events: unknown[] = [];
    ctx.events.on('task.changed', (payload) => events.push(payload));

    task.track('run.count', 2);
    expect(ctx.save.tasks.daily.progress['daily.run1']).toBe(1);
    expect(ctx.save.tasks.weekly.progress['weekly.run5']).toBe(2);

    task.track('run.count', 10);
    expect(ctx.save.tasks.weekly.progress['weekly.run5']).toBe(5);
    expect(events).toHaveLength(2);

    task.track('run.count', 0);
    task.track('run.count', -5);
    expect(events).toHaveLength(2);
  });

  it('run.score.single 取最高值并 clamp', async () => {
    const { ctx, task } = await createProgress({ tasks: taskTables() });
    const events: Array<{ ids?: string[] }> = [];
    ctx.events.on('task.changed', (payload) => events.push(payload));

    task.track('run.score.single', 60);
    expect(ctx.save.tasks.daily.progress['daily.score100']).toBe(60);

    task.track('run.score.single', 40);
    expect(ctx.save.tasks.daily.progress['daily.score100']).toBe(60);
    expect(events).toHaveLength(1);

    task.track('run.score.single', 999);
    expect(ctx.save.tasks.daily.progress['daily.score100']).toBe(100);
    expect(events).toHaveLength(2);
    expect(events[1].ids).toEqual(['daily.score100']);
  });

  it('opts.absolute 直接覆盖进度', async () => {
    const { ctx, task } = await createProgress({ tasks: taskTables() });
    task.track('run.distance', 30, { absolute: true });
    expect(ctx.save.tasks.daily.progress['daily.distance50']).toBe(30);
    task.track('run.distance', 10, { absolute: true });
    expect(ctx.save.tasks.daily.progress['daily.distance50']).toBe(10);
  });

  it('claim：达标可领、重复已领、未达标与不存在返回对应 reason', async () => {
    const { ctx, task } = await createProgress({ tasks: taskTables() });
    const events: unknown[] = [];
    ctx.events.on('task.changed', (payload) => events.push(payload));

    expect(task.claim('daily.run1')).toEqual({ ok: false, reason: FailReason.Insufficient });
    task.track('run.count', 1);
    expect(task.claim('daily.run1')).toEqual({ ok: true });
    expect(ctx.save.currency.gold).toBe(10);
    expect(ctx.save.tasks.daily.claimed).toEqual(['daily.run1']);
    expect(task.claim('daily.run1')).toEqual({ ok: false, reason: FailReason.AlreadyClaimed });
    expect(task.claim('ghost')).toEqual({ ok: false, reason: FailReason.NotFound });

    const view = task.list('daily').find((item) => item.config.id === 'daily.run1');
    expect(view?.claimed).toBe(true);
    expect(view?.claimable).toBe(false);
    expect(events).toHaveLength(2);
  });

  it('claimAll 汇总奖励并合并道具', async () => {
    const { ctx, task } = await createProgress({
      tasks: [
        ...taskTables(),
        { id: 'daily.coins7', type: 'daily', name: '测试', desc: '测试', metric: 'run.coins.total', target: 7, reward: { diamond: 1, items: [{ id: 'magnet', count: 1 }] }, order: 4 },
      ],
    });
    task.track('run.count', 2);
    task.track('run.score.single', 150);
    task.track('run.coins.total', 7);

    expect(task.hasClaimable()).toBe(true);
    const first = task.claimAll('daily');
    expect(first.claimed).toEqual(['daily.run1', 'daily.score100', 'daily.coins7']);
    expect(first.reward).toEqual({ gold: 10, items: [{ id: 'magnet', count: 3 }], diamond: 1 });
    expect(ctx.save.currency.gold).toBe(10);
    expect(ctx.save.currency.diamond).toBe(1);

    expect(task.claimAll('daily')).toEqual({ claimed: [], reward: {} });
    expect(task.hasClaimable()).toBe(false);
  });

  it('每日重置：仅清空变化周期并发一次事件', async () => {
    const { ctx, task } = await createProgress({ tasks: taskTables() }, { now: at(2026, 10, 3) });
    task.track('run.count', 1);
    task.track('run.distance', 10);
    const weeklyBefore = { ...ctx.save.tasks.weekly };

    const events: unknown[] = [];
    ctx.events.on('task.changed', (payload) => events.push(payload));
    ctx.setNow(at(2026, 10, 4));
    task.refreshIfNeeded();

    expect(ctx.save.tasks.daily.date).toBe('2026-10-04');
    expect(ctx.save.tasks.daily.progress).toEqual({});
    expect(ctx.save.tasks.daily.claimed).toEqual([]);
    expect(ctx.save.tasks.weekly.date).toBe(weeklyBefore.date);
    expect(ctx.save.tasks.weekly.progress).toEqual(weeklyBefore.progress);
    expect(events).toHaveLength(1);

    task.refreshIfNeeded();
    expect(events).toHaveLength(1);
  });

  it('每周重置：weekKey 变化时清空每周进度', async () => {
    const { ctx, task } = await createProgress({ tasks: taskTables() }, { now: at(2026, 10, 4) });
    task.track('run.count', 1);
    const prevWeek = ctx.save.tasks.weekly.date;

    ctx.setNow(at(2026, 10, 5));
    task.refreshIfNeeded();

    expect(ctx.save.tasks.weekly.date).not.toBe(prevWeek);
    expect(ctx.save.tasks.weekly.progress).toEqual({});
    expect(ctx.save.tasks.daily.progress).toEqual({});
  });

  it('hasClaimable 内部先做周期刷新，跨天不残留昨日可领取状态', async () => {
    const { ctx, task } = await createProgress({ tasks: taskTables() }, { now: at(2026, 10, 3) });
    task.track('run.count', 1);
    expect(task.hasClaimable()).toBe(true);

    ctx.setNow(at(2026, 10, 4));
    expect(task.hasClaimable()).toBe(false);
    expect(ctx.save.tasks.daily.progress).toEqual({});
  });

  it('onRunFinished 映射五项指标并推进 stats', async () => {
    const { ctx, task } = await createProgress({ tasks: taskTables() });
    const result: GameplayResult = {
      mode: 'classic',
      score: 42,
      distance: 30,
      coins: 7,
      diamonds: 2,
      durationMs: 5000,
      revivedCount: 0,
    };
    task.onRunFinished(result);

    expect(ctx.save.tasks.daily.progress['daily.run1']).toBe(1);
    expect(ctx.save.tasks.daily.progress['daily.score100']).toBe(42);
    expect(ctx.save.tasks.daily.progress['daily.distance50']).toBe(30);
    expect(ctx.save.stats).toEqual({
      runs: 1,
      bestScore: 42,
      totalDistance: 30,
      totalCoins: 7,
      totalDiamonds: 2,
      totalPlayMs: 5000,
      loginDays: 0,
    });

    task.onRunFinished({ ...result, score: 10, distance: 0, coins: 0, diamonds: 0, durationMs: 0 });
    expect(ctx.save.stats.bestScore).toBe(42);
    expect(ctx.save.stats.runs).toBe(2);
  });
});
