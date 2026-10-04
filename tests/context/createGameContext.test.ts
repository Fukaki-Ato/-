import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SAVE_KEY,
  type AchievementConfig,
  type ActivityConfig,
  type GameplayResult,
  type IConfigSource,
  type ItemConfig,
  type TaskConfig,
} from '../../assets/scripts/core/contracts';
import { MemoryStorage } from '../../assets/scripts/core/framework/Storage';
import { LocalPlatformAdapter } from '../../assets/scripts/core/platform/LocalPlatformAdapter';
import { createGameContext } from '../../assets/scripts/core/services';
import { silentLog } from '../helpers';
import { at, makeTables, type TestTables } from '../services/fixtures';

function makeSource(overrides: Partial<TestTables> = {}): IConfigSource {
  const tables = { ...makeTables(), ...overrides } as Record<string, unknown>;
  return { load: async (name) => tables[name] };
}

function createPlatform(storage: MemoryStorage = new MemoryStorage()): LocalPlatformAdapter {
  return new LocalPlatformAdapter({ storage, log: silentLog });
}

function task(overrides: Partial<TaskConfig> & { id: string }): TaskConfig {
  return { type: 'daily', name: '测试', desc: '测试', metric: 'run.count', target: 1, reward: {}, order: 1, ...overrides };
}

function activity(overrides: Partial<ActivityConfig> & { id: string }): ActivityConfig {
  return {
    name: overrides.id,
    desc: '测试',
    banner: '测试',
    icon: '测试',
    startTime: '2026-10-01 00:00',
    endTime: '2026-11-01 00:00',
    ruleText: '测试',
    metric: 'login.days',
    milestones: [{ target: 2, reward: { gold: 1 } }],
    order: 1,
    enabled: true,
    ...overrides,
  };
}

describe('createGameContext', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('装配：配置、时钟、默认存档与首启 day.changed', async () => {
    const ctx = await createGameContext({
      platform: createPlatform(),
      configSource: makeSource(),
      now: at(2026, 10, 4),
    });

    expect(ctx.config.ready).toBe(true);
    expect(ctx.clock.resetHour).toBe(0);
    expect(ctx.platform.kind).toBe('local');
    expect(ctx.gameplay.isMock).toBe(true);
    expect(ctx.save.stats.loginDays).toBe(1);
    expect(ctx.save.flags.lastGameDay).toBe('2026-10-04');
  });

  it('reward.grant 派发 currency.changed', async () => {
    const ctx = await createGameContext({
      platform: createPlatform(),
      configSource: makeSource(),
      now: at(2026, 10, 4),
    });
    const events: Array<Record<string, unknown>> = [];
    ctx.events.on('currency.changed', (payload) => events.push(payload));

    ctx.reward.grant({ gold: 123, diamond: 4 }, 'test.grant');

    expect(events).toEqual([
      expect.objectContaining({ gold: 123, diamond: 0, deltaGold: 123, deltaDiamond: 0, reason: 'test.grant' }),
      expect.objectContaining({ gold: 123, diamond: 4, deltaGold: 0, deltaDiamond: 4, reason: 'test.grant' }),
    ]);
  });

  it('商店购买 → shop.buy.count 任务进度 → 可领取', async () => {
    const tasks = [task({ id: 'daily.buy1', metric: 'shop.buy.count', target: 1, reward: { gold: 50 } })];
    const ctx = await createGameContext({
      platform: createPlatform(),
      configSource: makeSource({ tasks }),
      now: at(2026, 10, 4),
    });
    ctx.save.currency.gold = 100;

    expect(ctx.shop.buy('limited_prop')).toEqual({ ok: true, reward: { items: [{ id: 'magnet', count: 1 }] } });
    const view = ctx.task.list('daily')[0];
    expect(view.progress).toBe(1);
    expect(view.claimable).toBe(true);
    expect(ctx.redDot.isOn('menu.tasks')).toBe(true);

    expect(ctx.task.claim('daily.buy1')).toEqual({ ok: true });
    expect(ctx.save.currency.gold).toBe(50);
    expect(ctx.task.list('daily')[0].claimable).toBe(false);
  });

  it('同日重启：构造后红点立即计算（不依赖事件）', async () => {
    const storage = new MemoryStorage();
    const tasks = [task({ id: 'daily.login1', metric: 'login.days', target: 1, reward: { gold: 5 } })];
    const first = await createGameContext({
      platform: createPlatform(storage),
      configSource: makeSource({ tasks }),
      now: at(2026, 10, 4),
    });
    expect(first.redDot.isOn('menu.tasks')).toBe(true);
    first.flush();

    const second = await createGameContext({
      platform: createPlatform(storage),
      configSource: makeSource({ tasks }),
      now: at(2026, 10, 4),
    });
    expect(second.save.stats.loginDays).toBe(1);
    expect(second.save.flags.lastGameDay).toBe('2026-10-04');
    expect(second.redDot.isOn('menu.tasks')).toBe(true);
    expect(second.redDot.isOn('menu.welfare')).toBe(true);
  });

  it('character.changed(upgrade) 同时推进任务与成就', async () => {
    const tasks = [task({ id: 'daily.upgrade1', metric: 'character.upgrade.count', target: 1, reward: { gold: 10 } })];
    const achievements: AchievementConfig[] = [
      { id: 'ach.upgrade5', name: '测试', desc: '测试', metric: 'character.upgrade.count', target: 5, reward: {}, order: 1 },
    ];
    const ctx = await createGameContext({
      platform: createPlatform(),
      configSource: makeSource({ tasks, achievements }),
      now: at(2026, 10, 4),
    });
    ctx.save.currency.gold = 1000;

    expect(ctx.character.upgrade('runner_default')).toEqual({ ok: true });

    expect(ctx.save.tasks.daily.progress['daily.upgrade1']).toBe(1);
    expect(ctx.save.achievements.progress['ach.upgrade5']).toBe(1);
  });

  it('refreshDaily 跨天：任务重置、login.days 推进、无虚假商店进度与节流落盘', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 4, 12, 0, 0));
    const storage = new MemoryStorage();
    const tasks = [
      task({ id: 'daily.run5', metric: 'run.count', target: 5 }),
      task({ id: 'daily.login1', metric: 'login.days', target: 1, reward: { gold: 5 } }),
      task({ id: 'daily.buy1', metric: 'shop.buy.count', target: 1, reward: { gold: 5 } }),
      task({ id: 'weekly.run9', type: 'weekly', metric: 'run.count', target: 9 }),
    ];
    const achievements: AchievementConfig[] = [
      { id: 'ach.run5', name: '测试', desc: '测试', metric: 'run.count', target: 5, reward: {}, order: 1 },
      { id: 'ach.login2', name: '测试', desc: '测试', metric: 'login.days', target: 2, reward: {}, order: 2 },
    ];
    const activities = [activity({ id: 'act_login' })];
    const ctx = await createGameContext({
      platform: createPlatform(storage),
      configSource: makeSource({ tasks, achievements, activities }),
    });

    expect(ctx.save.stats.loginDays).toBe(1);
    expect(ctx.save.tasks.daily.progress['daily.login1']).toBe(1);
    expect(ctx.save.achievements.progress['ach.login2']).toBe(1);
    expect(ctx.save.activities.progress['act_login']).toBe(1);

    ctx.task.track('run.count', 1);
    ctx.achievement.track('run.count', 1);
    ctx.save.currency.gold = 100;
    ctx.shop.buy('limited_prop');
    expect(ctx.save.tasks.daily.progress['daily.buy1']).toBe(1);

    const dayEvents: unknown[] = [];
    ctx.events.on('day.changed', (payload) => dayEvents.push(payload));
    vi.setSystemTime(new Date(2026, 9, 5, 12, 0, 0));
    ctx.refreshDaily();

    expect(dayEvents).toEqual([{ date: '2026-10-05', prevDate: '2026-10-04' }]);
    expect(ctx.save.stats.loginDays).toBe(2);
    expect(ctx.save.tasks.daily.progress).toEqual({ 'daily.login1': 1 });
    expect(ctx.save.tasks.weekly.progress).toEqual({});
    expect(ctx.save.achievements.progress).toEqual({ 'ach.run5': 1, 'ach.login2': 2 });
    expect(ctx.save.activities.progress['act_login']).toBe(2);
    expect(ctx.save.shop.dailyRefreshDate).toBe('2026-10-05');

    const buyView = ctx.task.list('daily').find((view) => view.config.id === 'daily.buy1');
    expect(buyView?.progress).toBe(0);
    expect(buyView?.claimable).toBe(false);

    vi.advanceTimersByTime(500);
    const stored = JSON.parse(storage.get(SAVE_KEY)!) as { stats: { loginDays: number }; tasks: { daily: { progress: unknown } } };
    expect(stored.stats.loginDays).toBe(2);
    expect(stored.tasks.daily.progress).toEqual({ 'daily.login1': 1 });

    ctx.save.stats.runs = 7;
    ctx.flush();
    expect((JSON.parse(storage.get(SAVE_KEY)!) as { stats: { runs: number } }).stats.runs).toBe(7);
  });

  it('run.finished 联动任务/成就/活动与 stats', async () => {
    const tasks = [
      task({ id: 'daily.run5', metric: 'run.count', target: 5 }),
      task({ id: 'daily.dist500', metric: 'run.distance', target: 500 }),
    ];
    const achievements: AchievementConfig[] = [
      { id: 'ach.score', name: '测试', desc: '测试', metric: 'run.score.single', target: 600, reward: {}, order: 1 },
    ];
    const activities = [activity({ id: 'act_dist', metric: 'run.distance' })];
    const ctx = await createGameContext({
      platform: createPlatform(),
      configSource: makeSource({ tasks, achievements, activities }),
      now: at(2026, 10, 4),
    });
    const result: GameplayResult = {
      mode: 'classic',
      score: 600,
      distance: 100,
      coins: 5,
      diamonds: 1,
      durationMs: 60_000,
      revivedCount: 0,
    };

    ctx.events.emit('run.finished', result);

    expect(ctx.save.tasks.daily.progress['daily.run5']).toBe(1);
    expect(ctx.save.tasks.daily.progress['daily.dist500']).toBe(100);
    expect(ctx.save.achievements.progress['ach.score']).toBe(600);
    expect(ctx.save.activities.progress['act_dist']).toBe(100);
    expect(ctx.save.stats.runs).toBe(1);
    expect(ctx.save.stats.bestScore).toBe(600);
    expect(ctx.save.stats.totalDistance).toBe(100);
  });

  it('useItem：grant / runBuff(menu) / unlockCharacter，不支持时不消耗', async () => {
    const items: ItemConfig[] = [
      ...(makeTables().items as ItemConfig[]),
      {
        id: 'char_unlock',
        name: '角色解锁券',
        desc: '测试',
        icon: '测试',
        type: 'consumable',
        quality: 5,
        stackable: true,
        useEffect: { kind: 'unlockCharacter', id: 'runner_paid' },
        useTargets: ['menu'],
      },
    ];
    const ctx = await createGameContext({
      platform: createPlatform(),
      configSource: makeSource({ items }),
      now: at(2026, 10, 4),
    });
    ctx.save.inventory = { magnet: 2, pouch: 1, char_unlock: 1, revive: 1 };
    ctx.save.currency.diamond = 200;

    expect(ctx.useItem('magnet')).toEqual({ ok: true });
    expect(ctx.inventory.count('magnet')).toBe(1);
    expect(ctx.save.flags['pendingBuff.magnet']).toBe(1);

    expect(ctx.useItem('pouch')).toEqual({ ok: true });
    expect(ctx.save.currency.gold).toBe(100);

    expect(ctx.useItem('char_unlock')).toEqual({ ok: true });
    expect(ctx.save.currency.diamond).toBe(0);
    expect(ctx.save.characters.unlocked).toContain('runner_paid');

    expect(ctx.useItem('revive')).toEqual({ ok: false, reason: 'unsupported' });
    expect(ctx.inventory.count('revive')).toBe(1);
    expect(ctx.useItem('stone')).toEqual({ ok: false, reason: 'unsupported' });
    expect(ctx.useItem('ghost')).toEqual({ ok: false, reason: 'unsupported' });
  });

  it('useItem unlockCharacter：资源不足时不消耗道具', async () => {
    const items: ItemConfig[] = [
      ...(makeTables().items as ItemConfig[]),
      {
        id: 'char_unlock',
        name: '角色解锁券',
        desc: '测试',
        icon: '测试',
        type: 'consumable',
        quality: 5,
        stackable: true,
        useEffect: { kind: 'unlockCharacter', id: 'runner_paid' },
        useTargets: ['menu'],
      },
    ];
    const ctx = await createGameContext({
      platform: createPlatform(),
      configSource: makeSource({ items }),
      now: at(2026, 10, 4),
    });
    ctx.save.inventory = { char_unlock: 1 };
    ctx.save.currency.diamond = 0;

    expect(ctx.useItem('char_unlock')).toEqual({ ok: false, reason: 'insufficient' });
    expect(ctx.inventory.count('char_unlock')).toBe(1);
    expect(ctx.save.characters.unlocked).not.toContain('runner_paid');
  });

  it('gameplay 暴露 Mock 玩法并支持注入 delay/random', async () => {
    const ctx = await createGameContext({
      platform: createPlatform(),
      configSource: makeSource(),
      now: at(2026, 10, 4),
      gameplay: { delayMs: 0, random: () => 0 },
    });
    const result = await ctx.gameplay.launch({ mode: 'classic', characterId: 'runner_default' });
    expect(result).toEqual({
      mode: 'classic',
      score: 300,
      distance: 200,
      coins: 20,
      diamonds: 0,
      durationMs: 60_000,
      revivedCount: 0,
    });
  });
});
