import { describe, expect, it } from 'vitest';
import type {
  CharacterConfig,
  IAchievementService,
  IActivityService,
  ICharacterService,
  IShopService,
  ITaskService,
  IWelfareService,
} from '../../assets/scripts/core/contracts';
import { EventBus } from '../../assets/scripts/core/framework/EventBus';
import { RedDotService, type RedDotSources } from '../../assets/scripts/core/services/RedDotService';
import { createFakeLogger } from '../helpers';
import { createProgress, makeTables } from './fixtures';

interface StubState {
  task: boolean;
  welfareSigned: boolean;
  achievement: boolean;
  activity: boolean;
  canUnlock: boolean;
  canUpgrade: boolean;
  shopNeedAd: boolean;
  shopSoldOut: boolean;
}

function emptyState(): StubState {
  return {
    task: false,
    welfareSigned: true,
    achievement: false,
    activity: false,
    canUnlock: false,
    canUpgrade: false,
    shopNeedAd: false,
    shopSoldOut: false,
  };
}

function makeStubs(state: StubState): RedDotSources {
  return {
    task: { hasClaimable: () => state.task } as unknown as ITaskService,
    achievement: { hasClaimable: () => state.achievement } as unknown as IAchievementService,
    welfare: { signInState: () => ({ todaySigned: state.welfareSigned }) } as unknown as IWelfareService,
    activity: { hasClaimable: () => state.activity } as unknown as IActivityService,
    character: {
      list: () => [{ canUnlock: state.canUnlock, canUpgrade: state.canUpgrade }],
    } as unknown as ICharacterService,
    shop: {
      list: () => [{ needAd: state.shopNeedAd, soldOut: state.shopSoldOut }],
    } as unknown as IShopService,
  };
}

function createRedDot(state: StubState, log = createFakeLogger()): { redDot: RedDotService; events: EventBus } {
  const events = new EventBus(log);
  return { redDot: new RedDotService({ events, log }, makeStubs(state)), events };
}

describe('RedDotService', () => {
  it('初始全灭，翻转时 emit 并通知订阅者，未翻转不发事件', () => {
    const state = emptyState();
    const { redDot, events } = createRedDot(state);
    expect(redDot.isOn('menu.tasks')).toBe(false);

    const emitted: Array<{ key: string; on: boolean }> = [];
    const notified: Array<[string, boolean]> = [];
    events.on('reddot.changed', (payload) => emitted.push(payload));
    redDot.subscribe((key, on) => notified.push([key, on]));

    state.task = true;
    redDot.refresh();
    expect(redDot.isOn('menu.tasks')).toBe(true);
    expect(emitted).toEqual([{ key: 'menu.tasks', on: true }]);
    expect(notified).toEqual([['menu.tasks', true]]);

    redDot.refresh();
    expect(emitted).toHaveLength(1);

    state.task = false;
    redDot.refresh();
    expect(redDot.isOn('menu.tasks')).toBe(false);
    expect(emitted).toHaveLength(2);
    expect(emitted[1]).toEqual({ key: 'menu.tasks', on: false });
    expect(notified).toHaveLength(2);
  });

  it('各红点条件点亮/熄灭', () => {
    const state = emptyState();
    const { redDot } = createRedDot(state);

    state.welfareSigned = false;
    redDot.refresh();
    expect(redDot.isOn('menu.welfare')).toBe(true);
    state.welfareSigned = true;
    redDot.refresh();
    expect(redDot.isOn('menu.welfare')).toBe(false);

    state.achievement = true;
    redDot.refresh();
    expect(redDot.isOn('menu.achievements')).toBe(true);

    state.activity = true;
    redDot.refresh();
    expect(redDot.isOn('menu.activities')).toBe(true);

    state.canUnlock = true;
    redDot.refresh();
    expect(redDot.isOn('menu.characters')).toBe(true);
    state.canUnlock = false;
    state.canUpgrade = true;
    redDot.refresh();
    expect(redDot.isOn('menu.characters')).toBe(true);

    state.shopNeedAd = true;
    redDot.refresh();
    expect(redDot.isOn('menu.shop')).toBe(true);
    state.shopSoldOut = true;
    redDot.refresh();
    expect(redDot.isOn('menu.shop')).toBe(false);
  });

  it('订阅取消后不再收到通知', () => {
    const state = emptyState();
    const { redDot } = createRedDot(state);
    const notified: unknown[] = [];
    const unsubscribe = redDot.subscribe((key, on) => notified.push([key, on]));
    unsubscribe();

    state.task = true;
    redDot.refresh();
    expect(notified).toHaveLength(0);
  });

  it('真实服务聚合：角色可解锁与商店广告商品', async () => {
    const characters = (makeTables().characters as CharacterConfig[]).filter((item) => item.id !== 'runner_gift');
    const { ctx, task, achievement, welfare, activity, character, shop } = await createProgress({ characters });
    const redDot = new RedDotService(
      { events: ctx.events, log: ctx.log },
      { task, achievement, welfare, activity, character, shop },
    );

    redDot.refresh();
    expect(redDot.isOn('menu.shop')).toBe(true);
    expect(redDot.isOn('menu.welfare')).toBe(true);
    expect(redDot.isOn('menu.characters')).toBe(false);

    ctx.save.currency.diamond = 200;
    redDot.refresh();
    expect(redDot.isOn('menu.characters')).toBe(true);
  });

  it('单个订阅回调异常不影响其他订阅者', () => {
    const state = emptyState();
    state.welfareSigned = true;
    const log = createFakeLogger();
    const { redDot } = createRedDot(state, log);
    const notified: unknown[] = [];
    redDot.subscribe(() => {
      throw new Error('boom');
    });
    redDot.subscribe((key, on) => notified.push([key, on]));

    state.task = true;
    redDot.refresh();
    expect(notified).toEqual([['menu.tasks', true]]);
    expect(log.calls.some((call) => call.level === 'warn')).toBe(true);
  });
});
