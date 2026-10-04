import type {
  AchievementConfig,
  AchievementId,
  ActivityConfig,
  ActivityId,
  AppConfig,
  CharacterConfig,
  CharacterId,
  ConfigTableName,
  GoodsId,
  IConfigService,
  IConfigSource,
  ILogger,
  ItemConfig,
  ItemId,
  RunConfig,
  ShopGoodsConfig,
  ShopTab,
  TaskConfig,
  TaskId,
  TaskType,
  WelfareConfig,
} from '../contracts';
import { validateConfigs, type RawConfigs } from '../config/validate';

const TABLE_NAMES: ConfigTableName[] = [
  'app',
  'items',
  'characters',
  'shop',
  'tasks',
  'achievements',
  'welfare',
  'activities',
  'run',
];

const SHOP_TABS: ShopTab[] = ['gold', 'diamond', 'props', 'special'];

export interface ConfigServiceOptions {
  source: IConfigSource;
  log: ILogger;
}

/** 加载并校核全部配置表，提供按 id/分类的索引查询。 */
export class ConfigService implements IConfigService {
  private readonly source: IConfigSource;
  private readonly log: ILogger;
  private loaded = false;

  private appConfig: AppConfig | null = null;
  private readonly itemMap = new Map<ItemId, ItemConfig>();
  private readonly characterMap = new Map<CharacterId, CharacterConfig>();
  private readonly goodsMap = new Map<GoodsId, ShopGoodsConfig>();
  private goodsByTabMap = new Map<ShopTab, ShopGoodsConfig[]>();
  private readonly taskMap = new Map<TaskId, TaskConfig>();
  private tasksByTypeMap = new Map<TaskType, TaskConfig[]>();
  private readonly achievementMap = new Map<AchievementId, AchievementConfig>();
  private achievements: AchievementConfig[] = [];
  private welfareConfig: WelfareConfig | null = null;
  private readonly activityMap = new Map<ActivityId, ActivityConfig>();
  private activities: ActivityConfig[] = [];
  private readonly runMap = new Map<string, RunConfig>();
  private runs: RunConfig[] = [];

  constructor(opts: ConfigServiceOptions) {
    this.source = opts.source;
    this.log = opts.log;
  }

  get ready(): boolean {
    return this.loaded;
  }

  async loadAll(): Promise<void> {
    const loaded = await Promise.all(
      TABLE_NAMES.map(async (name) => [name, await this.source.load(name)] as const),
    );
    const tables = Object.fromEntries(loaded) as RawConfigs;
    const errors = validateConfigs(tables);
    if (errors.length > 0) {
      if (isDebugApp(tables.app)) {
        for (const error of errors) this.log.error(`配置错误：${error}`);
      }
      throw new Error(`配置校验失败（${errors.length} 个错误）：${errors[0]}`);
    }
    this.build(tables);
    this.loaded = true;
    this.log.info(`配置加载完成：${this.itemMap.size} 道具 / ${this.characterMap.size} 角色 / ${this.goodsMap.size} 商品 / ${this.taskMap.size} 任务`);
  }

  app(): AppConfig {
    this.requireReady();
    return this.appConfig!;
  }

  item(id: ItemId): ItemConfig | undefined {
    this.requireReady();
    return this.itemMap.get(id);
  }

  allItems(): ItemConfig[] {
    this.requireReady();
    return Array.from(this.itemMap.values());
  }

  character(id: CharacterId): CharacterConfig | undefined {
    this.requireReady();
    return this.characterMap.get(id);
  }

  allCharacters(): CharacterConfig[] {
    this.requireReady();
    return Array.from(this.characterMap.values());
  }

  goods(id: GoodsId): ShopGoodsConfig | undefined {
    this.requireReady();
    return this.goodsMap.get(id);
  }

  goodsByTab(tab: ShopTab): ShopGoodsConfig[] {
    this.requireReady();
    return [...(this.goodsByTabMap.get(tab) ?? [])];
  }

  task(id: TaskId): TaskConfig | undefined {
    this.requireReady();
    return this.taskMap.get(id);
  }

  tasksByType(type: TaskType): TaskConfig[] {
    this.requireReady();
    return [...(this.tasksByTypeMap.get(type) ?? [])];
  }

  achievement(id: AchievementId): AchievementConfig | undefined {
    this.requireReady();
    return this.achievementMap.get(id);
  }

  allAchievements(): AchievementConfig[] {
    this.requireReady();
    return [...this.achievements];
  }

  welfare(): WelfareConfig {
    this.requireReady();
    return this.welfareConfig!;
  }

  activity(id: ActivityId): ActivityConfig | undefined {
    this.requireReady();
    return this.activityMap.get(id);
  }

  allActivities(): ActivityConfig[] {
    this.requireReady();
    return [...this.activities];
  }

  run(mode: string): RunConfig {
    this.requireReady();
    const config = this.runMap.get(mode);
    if (!config) throw new Error(`未找到跑酷模式配置：${mode}`);
    return config;
  }

  allRuns(): RunConfig[] {
    this.requireReady();
    return [...this.runs];
  }

  private requireReady(): void {
    if (!this.loaded) throw new Error('配置尚未加载，请先调用 loadAll()');
  }

  private build(tables: RawConfigs): void {
    this.appConfig = tables.app as AppConfig;

    this.itemMap.clear();
    for (const item of tables.items as ItemConfig[]) this.itemMap.set(item.id, item);

    this.characterMap.clear();
    for (const character of tables.characters as CharacterConfig[]) this.characterMap.set(character.id, character);

    this.goodsMap.clear();
    this.goodsByTabMap = new Map(SHOP_TABS.map((tab) => [tab, [] as ShopGoodsConfig[]]));
    for (const goods of tables.shop as ShopGoodsConfig[]) {
      this.goodsMap.set(goods.id, goods);
      this.goodsByTabMap.get(goods.tab)?.push(goods);
    }
    for (const list of this.goodsByTabMap.values()) list.sort(byOrder);

    this.taskMap.clear();
    this.tasksByTypeMap = new Map<TaskType, TaskConfig[]>([
      ['daily', []],
      ['weekly', []],
    ]);
    for (const task of tables.tasks as TaskConfig[]) {
      this.taskMap.set(task.id, task);
      this.tasksByTypeMap.get(task.type)?.push(task);
    }
    for (const list of this.tasksByTypeMap.values()) list.sort(byOrder);

    this.achievementMap.clear();
    this.achievements = tables.achievements as AchievementConfig[];
    for (const achievement of this.achievements) this.achievementMap.set(achievement.id, achievement);
    this.achievements = [...this.achievements].sort(byOrder);

    this.welfareConfig = tables.welfare as WelfareConfig;

    this.activityMap.clear();
    this.activities = tables.activities as ActivityConfig[];
    for (const activity of this.activities) this.activityMap.set(activity.id, activity);
    this.activities = [...this.activities].sort(byOrder);

    this.runMap.clear();
    this.runs = tables.run as RunConfig[];
    for (const run of this.runs) this.runMap.set(run.mode, run);
  }
}

function byOrder<T extends { order: number }>(a: T, b: T): number {
  return a.order - b.order;
}

function isDebugApp(app: unknown): boolean {
  return typeof app === 'object' && app !== null && (app as { debug?: unknown }).debug === true;
}
