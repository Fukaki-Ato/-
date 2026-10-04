import { describe, expect, it } from 'vitest';
import { FailReason, type AchievementConfig, type GameplayResult } from '../../assets/scripts/core/contracts';
import { createProgress } from './fixtures';

function achievementTables(): AchievementConfig[] {
  return [
    { id: 'ach.run1', name: '首跑', desc: '测试', metric: 'run.count', target: 1, reward: { diamond: 5 }, order: 1 },
    { id: 'ach.score50', name: '高分开局', desc: '测试', metric: 'run.score.single', target: 50, reward: { gold: 20 }, order: 2 },
  ];
}

describe('AchievementService', () => {
  it('track 累加/最高值/clamp，未变化不发事件', async () => {
    const { ctx, achievement } = await createProgress({ achievements: achievementTables() });
    const events: unknown[] = [];
    ctx.events.on('achievement.changed', (payload) => events.push(payload));

    achievement.track('run.count', 1);
    expect(ctx.save.achievements.progress['ach.run1']).toBe(1);

    achievement.track('run.count', 3);
    expect(ctx.save.achievements.progress['ach.run1']).toBe(1);
    expect(events).toHaveLength(1);

    achievement.track('run.score.single', 60);
    achievement.track('run.score.single', 40);
    achievement.track('run.score.single', 999);
    expect(ctx.save.achievements.progress['ach.score50']).toBe(50);
    expect(events).toHaveLength(2);
    expect(events[1]).toEqual({ ids: ['ach.score50'] });
  });

  it('claim：重复/未达标/不存在的失败路径', async () => {
    const { ctx, achievement } = await createProgress({ achievements: achievementTables() });
    expect(achievement.claim('ach.run1')).toEqual({ ok: false, reason: FailReason.Insufficient });
    achievement.track('run.count', 1);
    expect(achievement.claim('ach.run1')).toEqual({ ok: true });
    expect(ctx.save.currency.diamond).toBe(5);
    expect(achievement.claim('ach.run1')).toEqual({ ok: false, reason: FailReason.AlreadyClaimed });
    expect(achievement.claim('ghost')).toEqual({ ok: false, reason: FailReason.NotFound });
    expect(achievement.hasClaimable()).toBe(false);

    achievement.track('run.score.single', 50);
    expect(achievement.hasClaimable()).toBe(true);
    const view = achievement.list().find((item) => item.config.id === 'ach.score50');
    expect(view).toMatchObject({ progress: 50, target: 50, claimable: true, claimed: false });
  });

  it('onRunFinished 只推进成就，不重复累计 stats', async () => {
    const { ctx, achievement } = await createProgress({ achievements: achievementTables() });
    const result: GameplayResult = {
      mode: 'classic',
      score: 80,
      distance: 10,
      coins: 1,
      diamonds: 0,
      durationMs: 1000,
      revivedCount: 0,
    };
    achievement.onRunFinished(result);

    expect(ctx.save.achievements.progress['ach.run1']).toBe(1);
    expect(ctx.save.achievements.progress['ach.score50']).toBe(50);
    expect(ctx.save.stats.runs).toBe(0);
    expect(ctx.save.stats.bestScore).toBe(0);
  });
});
