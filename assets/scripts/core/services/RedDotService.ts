import type {
  IAchievementService,
  IActivityService,
  ICharacterService,
  IEventBus,
  ILogger,
  IRedDotService,
  IShopService,
  ITaskService,
  IWelfareService,
  RedDotKey,
  ShopTab,
} from '../contracts';

export interface RedDotSources {
  task: ITaskService;
  achievement: IAchievementService;
  welfare: IWelfareService;
  activity: IActivityService;
  character: ICharacterService;
  shop: IShopService;
}

const RED_DOT_KEYS: RedDotKey[] = [
  'menu.tasks',
  'menu.welfare',
  'menu.achievements',
  'menu.activities',
  'menu.characters',
  'menu.shop',
];

const SHOP_TABS: ShopTab[] = ['gold', 'diamond', 'props', 'special'];

/** 聚合各服务的红点状态；仅在状态翻转时 emit 并通知订阅者。 */
export class RedDotService implements IRedDotService {
  private readonly events: IEventBus;
  private readonly log: ILogger;
  private readonly sources: RedDotSources;
  private readonly states = new Map<RedDotKey, boolean>();
  private readonly subscribers = new Set<(key: RedDotKey, on: boolean) => void>();
  private refreshing = false;

  constructor(deps: { events: IEventBus; log: ILogger }, sources: RedDotSources) {
    this.events = deps.events;
    this.log = deps.log;
    this.sources = sources;
  }

  isOn(key: RedDotKey): boolean {
    return this.states.get(key) === true;
  }

  refresh(): void {
    if (this.refreshing) return;
    this.refreshing = true;
    try {
      for (const key of RED_DOT_KEYS) {
        const on = this.compute(key);
        if (on === this.isOn(key)) continue;
        this.states.set(key, on);
        this.events.emit('reddot.changed', { key, on });
        this.notify(key, on);
      }
    } finally {
      this.refreshing = false;
    }
  }

  subscribe(cb: (key: RedDotKey, on: boolean) => void): () => void {
    this.subscribers.add(cb);
    return () => {
      this.subscribers.delete(cb);
    };
  }

  private compute(key: RedDotKey): boolean {
    switch (key) {
      case 'menu.tasks':
        return this.sources.task.hasClaimable();
      case 'menu.welfare':
        return !this.sources.welfare.signInState().todaySigned;
      case 'menu.achievements':
        return this.sources.achievement.hasClaimable();
      case 'menu.activities':
        return this.sources.activity.hasClaimable();
      case 'menu.characters':
        return this.sources.character.list().some((view) => view.canUnlock || view.canUpgrade);
      case 'menu.shop':
        return SHOP_TABS.some((tab) =>
          this.sources.shop.list(tab).some((view) => view.needAd && !view.soldOut),
        );
      default:
        return false;
    }
  }

  private notify(key: RedDotKey, on: boolean): void {
    for (const cb of Array.from(this.subscribers)) {
      try {
        cb(key, on);
      } catch (err) {
        this.log.warn(`红点订阅回调异常：${key}`, err);
      }
    }
  }
}
