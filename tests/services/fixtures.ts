import type { AppConfig, IClock, IConfigSource, SaveData, ServiceDeps } from '../../assets/scripts/core/contracts';
import type { RawConfigs } from '../../assets/scripts/core/config/validate';
import { Clock } from '../../assets/scripts/core/framework/Clock';
import { EventBus } from '../../assets/scripts/core/framework/EventBus';
import { createDefaultSave } from '../../assets/scripts/core/framework/SaveRepository';
import { ConfigService } from '../../assets/scripts/core/services/ConfigService';
import { CurrencyService } from '../../assets/scripts/core/services/CurrencyService';
import { InventoryService } from '../../assets/scripts/core/services/InventoryService';
import { CharacterService } from '../../assets/scripts/core/services/CharacterService';
import { RewardService } from '../../assets/scripts/core/services/RewardService';
import { ShopService } from '../../assets/scripts/core/services/ShopService';
import { createFakeLogger, silentLog, type FakeLogger } from '../helpers';

export const at = (year: number, month: number, day: number, hour = 12, minute = 0): number =>
  new Date(year, month - 1, day, hour, minute).getTime();

export interface TestTables {
  app: AppConfig;
  items: unknown[];
  characters: unknown[];
  shop: unknown[];
  tasks: unknown[];
  achievements: unknown[];
  welfare: unknown;
  activities: unknown[];
  run: unknown[];
}

/** 覆盖经济服务测试所需分支的最小合法配置集。 */
export function makeTables(): TestTables {
  return {
    app: {
      version: '0.0.0-test',
      cloudEnvId: '',
      dailyResetHour: 0,
      weeklyResetWeekday: 1,
      debug: false,
      privacyPolicy: '测试隐私文本',
      userAgreement: '测试协议文本',
      contact: {},
    },
    items: [
      {
        id: 'magnet',
        name: '磁铁',
        desc: '测试道具',
        icon: 'images/items/magnet',
        type: 'consumable',
        quality: 3,
        stackable: true,
        useEffect: { kind: 'runBuff', buffId: 'magnet' },
        useTargets: ['menu'],
      },
      {
        id: 'revive',
        name: '复活币',
        desc: '测试道具',
        icon: 'images/items/revive',
        type: 'consumable',
        quality: 4,
        stackable: true,
        useEffect: { kind: 'runBuff', buffId: 'revive' },
        useTargets: ['run'],
      },
      {
        id: 'stone',
        name: '强化石',
        desc: '测试材料',
        icon: 'images/items/stone',
        type: 'material',
        quality: 2,
        stackable: true,
      },
      {
        id: 'pouch',
        name: '金币福袋',
        desc: '开袋得金币',
        icon: 'images/items/pouch',
        type: 'consumable',
        quality: 3,
        stackable: true,
        useEffect: { kind: 'grant', reward: { gold: 100 } },
        useTargets: ['menu'],
      },
    ],
    characters: [
      {
        id: 'runner_default',
        name: '阿雷',
        desc: '默认角色',
        icon: 'images/characters/runner_default',
        preview: 'images/characters/runner_default_big',
        quality: 3,
        unlock: { type: 'default' },
        baseAttr: { speed: 10, jump: 10, magnet: 0, coinBonus: 0, scoreBonus: 0 },
        upgrade: {
          maxLevel: 3,
          baseCost: { gold: 500 },
          costFactor: 1.6,
          growth: { speed: 0.6, jump: 0.5, coinBonus: 1 },
        },
      },
      {
        id: 'runner_paid',
        name: '月见',
        desc: '付费角色',
        icon: 'images/characters/runner_paid',
        preview: 'images/characters/runner_paid_big',
        quality: 5,
        unlock: { type: 'currency', cost: { diamond: 200 } },
        baseAttr: { speed: 12, jump: 11, magnet: 5, coinBonus: 10, scoreBonus: 2 },
        upgrade: {
          maxLevel: 2,
          baseCost: { diamond: 50, items: [{ id: 'stone', count: 2 }] },
          costFactor: 2,
          growth: { speed: 0.5 },
        },
      },
      {
        id: 'runner_item',
        name: '林小满',
        desc: '道具解锁',
        icon: 'images/characters/runner_item',
        preview: 'images/characters/runner_item_big',
        quality: 4,
        unlock: { type: 'item', itemId: 'stone', cost: { items: [{ id: 'stone', count: 3 }] } },
        baseAttr: { speed: 9, jump: 9, magnet: 9, coinBonus: 9, scoreBonus: 9 },
        upgrade: {
          maxLevel: 2,
          baseCost: { gold: 100 },
          costFactor: 2,
          growth: { speed: 1 },
        },
      },
      {
        id: 'runner_gift',
        name: '礼物侠',
        desc: '奖励直发角色',
        icon: 'images/characters/runner_gift',
        preview: 'images/characters/runner_gift_big',
        quality: 2,
        unlock: { type: 'default' },
        baseAttr: { speed: 8, jump: 8, magnet: 1, coinBonus: 1, scoreBonus: 1 },
        upgrade: {
          maxLevel: 2,
          baseCost: { gold: 200 },
          costFactor: 2,
          growth: { speed: 0.5 },
        },
      },
    ],
    shop: [
      {
        id: 'ad_gold',
        tab: 'gold',
        name: '免费金币',
        desc: '看广告得金币',
        icon: 'images/ui/ad_gold',
        price: null,
        viaAd: true,
        gain: { gold: 200 },
        dailyLimit: 2,
        order: 1,
      },
      {
        id: 'gold_pack',
        tab: 'gold',
        name: '金币袋',
        desc: '钻石换金币',
        icon: 'images/ui/gold_pack',
        price: { currency: 'diamond', amount: 10 },
        gain: { gold: 1000 },
        order: 2,
      },
      {
        id: 'limited_prop',
        tab: 'props',
        name: '限购磁铁',
        desc: '每日限购 1 次',
        icon: 'images/items/magnet',
        price: { currency: 'gold', amount: 100 },
        gain: { items: [{ id: 'magnet', count: 1 }] },
        dailyLimit: 1,
        order: 1,
      },
      {
        id: 'ad_prop',
        tab: 'props',
        name: '免费复活',
        desc: '看广告得复活币',
        icon: 'images/items/revive',
        price: null,
        viaAd: true,
        gain: { items: [{ id: 'revive', count: 1 }] },
        order: 2,
      },
      {
        id: 'cny_diamond',
        tab: 'diamond',
        name: '60 钻石',
        desc: '充值',
        icon: 'images/ui/cny_diamond',
        price: { currency: 'CNY', amount: 600 },
        productId: 'test.diamond.60',
        gain: { diamond: 60 },
        iosVisible: false,
        order: 1,
      },
      {
        id: 'cny_limited',
        tab: 'diamond',
        name: '限购礼包',
        desc: '每日限购 1 次',
        icon: 'images/ui/cny_limited',
        price: { currency: 'CNY', amount: 1000 },
        productId: 'test.gift.10',
        gain: { diamond: 10 },
        dailyLimit: 1,
        iosVisible: false,
        order: 2,
      },
      {
        id: 'special_bundle',
        tab: 'special',
        name: '成长礼包',
        desc: '限购 2 次',
        icon: 'images/ui/special_bundle',
        price: { currency: 'diamond', amount: 50 },
        gain: { gold: 500, diamond: 5, items: [{ id: 'magnet', count: 2 }] },
        dailyLimit: 2,
        order: 1,
      },
    ],
    tasks: [
      {
        id: 'daily.run1',
        type: 'daily',
        name: '跑 1 局',
        desc: '完成 1 局',
        metric: 'run.count',
        target: 1,
        reward: { gold: 10 },
        order: 1,
      },
      {
        id: 'weekly.run5',
        type: 'weekly',
        name: '跑 5 局',
        desc: '完成 5 局',
        metric: 'run.count',
        target: 5,
        reward: { gold: 50 },
        order: 1,
      },
    ],
    achievements: [
      { id: 'ach.run1', name: '首跑', desc: '完成 1 局', metric: 'run.count', target: 1, reward: { diamond: 5 }, order: 1 },
    ],
    welfare: {
      signIn: {
        days: [
          { day: 1, reward: { gold: 10 } },
          { day: 2, reward: { gold: 20 } },
          { day: 3, reward: { gold: 30 } },
        ],
      },
      dailyFreeAd: { reward: { gold: 10 } },
    },
    activities: [
      {
        id: 'act_test',
        name: '测试活动',
        desc: '测试',
        banner: 'images/ui/act_banner',
        icon: 'images/ui/act_icon',
        startTime: '2026-01-01 00:00',
        endTime: '2026-12-31 23:59',
        ruleText: '测试规则',
        metric: 'run.count',
        milestones: [{ target: 1, reward: { gold: 10 } }],
        order: 1,
        enabled: true,
      },
    ],
    run: [
      {
        mode: 'classic',
        name: '经典模式',
        settle: { coinsToGold: 1, scoreToGoldDivisor: 10, diamondEveryCoins: 500 },
        revive: { adPerRun: 1 },
        buffs: {
          magnet: { name: '磁铁', desc: '吸附金币', durationSec: 10 },
          revive: { name: '复活', desc: '原地复活', count: 1 },
        },
      },
    ],
  };
}

export async function createConfigService(overrides: Partial<TestTables> = {}): Promise<ConfigService> {
  const tables = { ...makeTables(), ...overrides } as RawConfigs;
  const source: IConfigSource = { load: async (name) => tables[name] };
  const service = new ConfigService({ source, log: silentLog });
  await service.loadAll();
  return service;
}

export interface TestContext {
  save: SaveData;
  deps: ServiceDeps;
  events: EventBus;
  log: FakeLogger;
  clock: IClock;
  setNow(ts: number): void;
  advance(ms: number): void;
  dirtyCount(): number;
}

export function createTestContext(opts: { now?: number; save?: SaveData } = {}): TestContext {
  let now = opts.now ?? at(2026, 10, 4);
  const clock = new Clock({ now: () => now });
  const log = createFakeLogger();
  const events = new EventBus(log);
  const save =
    opts.save ??
    createDefaultSave(
      { uid: 'test_user', nickname: '测试玩家', avatarUrl: '', isGuest: true, createdAt: 0 },
      clock.gameDay(),
      clock.weekKey(),
      now,
    );
  let dirty = 0;
  const deps: ServiceDeps = { save, events, clock, log, markDirty: () => { dirty += 1; } };
  return {
    save,
    deps,
    events,
    log,
    clock,
    setNow: (ts) => { now = ts; },
    advance: (ms) => { now += ms; },
    dirtyCount: () => dirty,
  };
}

export interface Economy {
  ctx: TestContext;
  config: ConfigService;
  inventory: InventoryService;
  currency: CurrencyService;
  character: CharacterService;
  reward: RewardService;
  shop: ShopService;
}

export async function createEconomy(
  overrides: Partial<TestTables> = {},
  ctxOpts: { now?: number; save?: SaveData } = {},
): Promise<Economy> {
  const ctx = createTestContext(ctxOpts);
  const config = await createConfigService(overrides);
  const inventory = new InventoryService(ctx.deps, config);
  const currency = new CurrencyService(ctx.deps, inventory);
  const character = new CharacterService(ctx.deps, config, currency, inventory);
  const reward = new RewardService(ctx.deps, config, currency, inventory, character);
  const shop = new ShopService(ctx.deps, config, currency, reward);
  return { ctx, config, inventory, currency, character, reward, shop };
}

export function seedSave(save: SaveData, gold: number, diamond: number, inventory: Record<string, number> = {}): void {
  save.currency.gold = gold;
  save.currency.diamond = diamond;
  save.inventory = { ...inventory };
}
