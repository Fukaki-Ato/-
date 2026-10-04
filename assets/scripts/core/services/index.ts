import {
  FailReason,
  type IConfigSource,
  type IGameContext,
  type IPlatformAdapter,
  type ItemId,
  type OpResult,
  type SaveData,
  type ServiceDeps,
  type TaskMetric,
} from '../contracts';
import { Clock } from '../framework/Clock';
import { EventBus } from '../framework/EventBus';
import { Logger } from '../framework/Logger';
import { LocalSaveRepository } from '../framework/SaveRepository';
import { toInt } from '../framework/Utils';
import { MockGameplayLauncher, type MockGameplayOptions } from '../gameplay/MockGameplayLauncher';
import { ConfigService } from './ConfigService';
import { InventoryService } from './InventoryService';
import { CurrencyService } from './CurrencyService';
import { CharacterService } from './CharacterService';
import { RewardService } from './RewardService';
import { ShopService } from './ShopService';
import { TaskService } from './TaskService';
import { AchievementService } from './AchievementService';
import { WelfareService } from './WelfareService';
import { ActivityService } from './ActivityService';
import { RedDotService } from './RedDotService';

export interface CreateContextOptions {
  platform: IPlatformAdapter;
  configSource: IConfigSource;
  /** 注入固定时间戳（测试用）；缺省跟随 Date.now。 */
  now?: number;
  /** v1 Mock 玩法的可选参数（delayMs/random 可注入，供测试）。 */
  gameplay?: MockGameplayOptions;
}

const SAVE_THROTTLE_MS = 500;

declare const setTimeout: (handler: () => void, timeout?: number) => unknown;
declare const clearTimeout: (handle: unknown) => void;

/**
 * 组合根：加载配置与存档、构造全部服务、集中注册事件联动。
 * 服务之间不互相订阅；跨服务进度与红点刷新统一在本文件完成。
 */
export async function createGameContext(opts: CreateContextOptions): Promise<IGameContext> {
  const log = new Logger();
  const config = new ConfigService({ source: opts.configSource, log });
  await config.loadAll();
  const app = config.app();
  log.setEnabled(app.debug);

  const injectedNow = opts.now;
  const clock = new Clock({
    resetHour: app.dailyResetHour,
    now: injectedNow === undefined ? undefined : () => injectedNow,
  });
  const events = new EventBus(log);
  const repo = new LocalSaveRepository({ storage: opts.platform.storage, clock, log });
  const save = repo.load();

  let dirtyTimer: unknown = null;
  const flush = (): void => {
    if (dirtyTimer !== null) {
      clearTimeout(dirtyTimer);
      dirtyTimer = null;
    }
    repo.save(save);
  };
  const markDirty = (): void => {
    if (dirtyTimer !== null) return;
    dirtyTimer = setTimeout(() => {
      dirtyTimer = null;
      repo.save(save);
    }, SAVE_THROTTLE_MS);
  };

  const deps: ServiceDeps = { save, events, clock, log, markDirty };
  const inventory = new InventoryService(deps, config);
  const currency = new CurrencyService(deps, inventory);
  const character = new CharacterService(deps, config, currency, inventory);
  const reward = new RewardService(deps, config, currency, inventory, character);
  const shop = new ShopService(deps, config, currency, reward);
  const task = new TaskService(deps, config, reward);
  const achievement = new AchievementService(deps, config, reward);
  const welfare = new WelfareService(deps, config, reward);
  const activity = new ActivityService(deps, config, reward);
  const redDot = new RedDotService({ events, log }, { task, achievement, welfare, activity, character, shop });
  const gameplay = new MockGameplayLauncher(opts.gameplay ?? {});

  /** 同一指标同时分发到任务/成就/活动（docs/03 §2.3：三者的进度来源一致）。 */
  const trackAll = (metric: TaskMetric, value: number): void => {
    task.track(metric, value);
    achievement.track(metric, value);
    activity.track(metric, value);
  };

  // shop.changed 无法从载荷区分“购买”与“跨天重置/惰性刷新”，用商店已用次数快照区分：
  // 次数增加视为一次商店行为（buy/claimAd/claimPay）；重置导致的减少忽略，避免凭空 +1。
  let shopUsage = countShopUsage(save);
  events.on('shop.changed', () => {
    const next = countShopUsage(save);
    if (next > shopUsage) trackAll('shop.buy.count', next - shopUsage);
    shopUsage = next;
    redDot.refresh();
  });

  events.on('character.changed', (payload) => {
    if (payload.reason === 'upgrade') trackAll('character.upgrade.count', 1);
    redDot.refresh();
  });

  events.on('run.finished', (result) => {
    task.onRunFinished(result);
    achievement.onRunFinished(result);
    // 活动进度统一在装配层映射；Task/Achievement 的服务内部不引用其他服务。
    activity.track('run.count', 1);
    activity.track('run.distance', result.distance);
    activity.track('run.score.single', result.score);
    activity.track('run.coins.total', result.coins);
    activity.track('run.diamonds.total', result.diamonds);
  });

  events.on('day.changed', () => {
    // 先重置任务周期，再刷新其他服务：后者可能 emit changed 事件并触发 redDot.refresh，
    // 避免红点在任务重置前读到上一周期的可领取状态。
    task.refreshIfNeeded();
    welfare.refreshIfNeeded();
    activity.refreshIfNeeded();
    shop.refreshIfNeeded();
    save.stats.loginDays += 1;
    markDirty();
    trackAll('login.days', 1);
    redDot.refresh();
  });

  for (const event of ['task.changed', 'achievement.changed', 'welfare.changed', 'activity.changed', 'currency.changed', 'inventory.changed'] as const) {
    events.on(event, () => redDot.refresh());
  }

  const useItem = (id: ItemId): OpResult => {
    const item = config.item(id);
    if (!item || !item.useEffect) return { ok: false, reason: FailReason.Unsupported };
    const effect = item.useEffect;
    if (effect.kind === 'runBuff' && !item.useTargets?.includes('menu')) {
      return { ok: false, reason: FailReason.Unsupported };
    }
    // 消耗前校验解锁可行性，避免道具已扣但角色解锁失败。
    if (effect.kind === 'unlockCharacter') {
      const view = character.get(effect.id);
      if (!view) return { ok: false, reason: FailReason.NotFound };
      if (view.unlocked) return { ok: false, reason: FailReason.AlreadyClaimed };
      if (!view.canUnlock) {
        return { ok: false, reason: view.unlockCost ? FailReason.Insufficient : FailReason.Locked };
      }
    }
    const used = inventory.use(id);
    if (!used.ok) return used;
    if (effect.kind === 'grant') {
      reward.grant(effect.reward, `item.${id}`);
    } else if (effect.kind === 'runBuff') {
      const key = `pendingBuff.${effect.buffId}`;
      const current = save.flags[key];
      const count = typeof current === 'number' && Number.isFinite(current) ? toInt(current) : 0;
      save.flags[key] = Math.max(0, count) + 1;
      markDirty();
    } else {
      const unlocked = character.unlock(effect.id);
      if (!unlocked.ok) log.warn(`使用道具 ${id} 解锁角色 ${effect.id} 失败（${unlocked.reason}）`);
    }
    return { ok: true };
  };

  const refreshDaily = (): void => {
    const today = clock.gameDay();
    const prev = typeof save.flags.lastGameDay === 'string' ? save.flags.lastGameDay : '';
    if (prev === today) return;
    save.flags.lastGameDay = today;
    markDirty();
    events.emit('day.changed', { date: today, prevDate: prev });
  };

  const context: IGameContext = {
    save,
    clock,
    events,
    config,
    currency,
    inventory,
    reward,
    shop,
    character,
    task,
    achievement,
    welfare,
    activity,
    redDot,
    platform: opts.platform,
    gameplay,
    useItem,
    markDirty,
    flush,
    refreshDaily,
  };

  // 首次启动也执行一次：建立 lastGameDay 基线并使 loginDays 从 1 开始。
  refreshDaily();
  // 无论游戏日是否变化都先计算一次红点（同日重启不会触发 day.changed）。
  redDot.refresh();
  return context;
}

function countShopUsage(save: SaveData): number {
  let total = 0;
  for (const record of [save.shop.dailyBought, save.shop.adClaimed]) {
    for (const value of Object.values(record)) {
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) total += toInt(value);
    }
  }
  return total;
}
