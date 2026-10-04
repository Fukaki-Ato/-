/**
 * 雷霆酷跑 - 公共契约（唯一事实来源）
 *
 * 约束：
 * 1. 本文件禁止 import 'cc'、wx 或任何引擎/宿主 API，必须可被 Node/Vitest 直接加载；
 * 2. 所有子会话必须遵循本文件的类型与服务接口，不得擅自变更公共签名；
 * 3. 公共接口如需变更，必须同步更新 docs/02、docs/03 并在会话报告中声明；
 * 4. 货币与道具数量均为非负整数；时间统一使用毫秒时间戳（日期字符串除外）。
 */

// ---------------------------------------------------------------------------
// 基础
// ---------------------------------------------------------------------------

export type ID = string;
export type ItemId = string;
export type CharacterId = string;
export type GoodsId = string;
export type TaskId = string;
export type AchievementId = string;
export type ActivityId = string;
export type DateString = string;
export type GameMode = string;

export const SAVE_VERSION = 1;
export const SAVE_KEY = 'ltkp.save.v1';
export const CURRENCY_MAX = 9_999_999;

export type CurrencyType = 'gold' | 'diamond';

export interface ItemStack {
  id: ItemId;
  count: number;
}

export interface Cost {
  gold?: number;
  diamond?: number;
  items?: ItemStack[];
}

export interface RewardBundle {
  gold?: number;
  diamond?: number;
  items?: ItemStack[];
  characters?: CharacterId[];
}

export interface RewardDisplay {
  kind: 'gold' | 'diamond' | 'item' | 'character';
  id?: string;
  name: string;
  icon: string;
  count: number;
}

export interface OpResult {
  ok: boolean;
  reason?: string;
}

export const FailReason = {
  NotFound: 'not_found',
  Insufficient: 'insufficient',
  SoldOut: 'sold_out',
  LimitReached: 'limit',
  Locked: 'locked',
  Expired: 'expired',
  AlreadyClaimed: 'already_claimed',
  Unsupported: 'unsupported',
  MaxLevel: 'max_level',
  NotImplemented: 'not_implemented',
} as const;

// ---------------------------------------------------------------------------
// 存档
// ---------------------------------------------------------------------------

export interface PlayerProfile {
  uid: string;
  nickname: string;
  avatarUrl: string;
  isGuest: boolean;
  createdAt: number;
}

export interface PlayerCurrency {
  gold: number;
  diamond: number;
}

export interface PlayerStats {
  runs: number;
  bestScore: number;
  totalDistance: number;
  totalCoins: number;
  totalDiamonds: number;
  totalPlayMs: number;
  loginDays: number;
}

export interface PlayerSettings {
  music: boolean;
  sfx: boolean;
}

export interface CharactersState {
  unlocked: CharacterId[];
  levels: Record<CharacterId, number>;
  selected: CharacterId;
}

export interface WelfareState {
  lastSignInDate: DateString;
  signInCycleDay: number;
  signInHistory: DateString[];
}

export interface TaskPeriodState {
  date: string;
  progress: Record<TaskId, number>;
  claimed: TaskId[];
}

export interface TasksState {
  daily: TaskPeriodState;
  weekly: TaskPeriodState;
}

export interface AchievementsState {
  progress: Record<AchievementId, number>;
  claimed: AchievementId[];
}

export interface ShopState {
  dailyBought: Record<GoodsId, number>;
  dailyRefreshDate: DateString;
  adClaimed: Record<GoodsId, number>;
}

export interface ActivitiesState {
  claimed: Record<ActivityId, number[]>;
  progress: Record<ActivityId, number>;
}

export interface SaveData {
  version: number;
  profile: PlayerProfile;
  currency: PlayerCurrency;
  inventory: Record<ItemId, number>;
  characters: CharactersState;
  welfare: WelfareState;
  tasks: TasksState;
  achievements: AchievementsState;
  shop: ShopState;
  activities: ActivitiesState;
  stats: PlayerStats;
  settings: PlayerSettings;
  flags: Record<string, boolean | number | string>;
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// 配置表
// ---------------------------------------------------------------------------

export type ConfigTableName =
  | 'app'
  | 'items'
  | 'characters'
  | 'shop'
  | 'tasks'
  | 'achievements'
  | 'welfare'
  | 'activities'
  | 'run';

export interface IConfigSource {
  load(name: ConfigTableName): Promise<unknown>;
}

export interface AppConfig {
  version: string;
  cloudEnvId: string;
  dailyResetHour: number;
  weeklyResetWeekday: number;
  debug: boolean;
  privacyPolicy: string;
  userAgreement: string;
  contact: { qq?: string; wechat?: string; email?: string };
}

export type ItemType = 'consumable' | 'material' | 'ticket';

export type ItemEffect =
  | { kind: 'grant'; reward: RewardBundle }
  | { kind: 'runBuff'; buffId: string }
  | { kind: 'unlockCharacter'; id: CharacterId };

export interface ItemConfig {
  id: ItemId;
  name: string;
  desc: string;
  icon: string;
  type: ItemType;
  quality: 1 | 2 | 3 | 4 | 5;
  stackable: boolean;
  useEffect?: ItemEffect;
  useTargets?: Array<'menu' | 'run'>;
}

export interface CharacterAttrs {
  speed: number;
  jump: number;
  magnet: number;
  coinBonus: number;
  scoreBonus: number;
}

export interface CharacterUpgradeConfig {
  maxLevel: number;
  baseCost: Cost;
  costFactor: number;
  growth: Partial<CharacterAttrs>;
}

export interface CharacterConfig {
  id: CharacterId;
  name: string;
  desc: string;
  icon: string;
  preview: string;
  quality: 1 | 2 | 3 | 4 | 5;
  unlock: { type: 'default' | 'currency' | 'item' | 'condition'; cost?: Cost; itemId?: ItemId; condition?: string };
  baseAttr: CharacterAttrs;
  upgrade: CharacterUpgradeConfig;
}

export type ShopTab = 'gold' | 'diamond' | 'props' | 'special';

export interface ShopGoodsConfig {
  id: GoodsId;
  tab: ShopTab;
  name: string;
  desc: string;
  icon: string;
  price: { currency: CurrencyType | 'CNY'; amount: number } | null;
  productId?: string;
  gain: RewardBundle;
  viaAd?: boolean;
  dailyLimit?: number;
  iosVisible?: boolean;
  tag?: string;
  order: number;
}

export type TaskType = 'daily' | 'weekly';

export type TaskMetric =
  | 'run.count'
  | 'run.distance'
  | 'run.score.single'
  | 'run.coins.total'
  | 'run.diamonds.total'
  | 'login.days'
  | 'shop.buy.count'
  | 'character.upgrade.count';

export interface TaskConfig {
  id: TaskId;
  type: TaskType;
  name: string;
  desc: string;
  metric: TaskMetric;
  target: number;
  reward: RewardBundle;
  link?: 'run' | 'shop' | 'character' | 'welfare' | 'none';
  order: number;
}

export interface AchievementConfig {
  id: AchievementId;
  name: string;
  desc: string;
  metric: TaskMetric;
  target: number;
  reward: RewardBundle;
  order: number;
}

export interface WelfareConfig {
  signIn: { days: Array<{ day: number; reward: RewardBundle }> };
  dailyFreeAd: { reward: RewardBundle } | null;
}

export interface ActivityMilestoneConfig {
  target: number;
  reward: RewardBundle;
}

export interface ActivityConfig {
  id: ActivityId;
  name: string;
  desc: string;
  banner: string;
  icon: string;
  startTime: string;
  endTime: string;
  ruleText: string;
  metric: TaskMetric;
  milestones: ActivityMilestoneConfig[];
  order: number;
  enabled: boolean;
}

export interface SettleConfig {
  coinsToGold: number;
  scoreToGoldDivisor: number;
  diamondEveryCoins: number;
}

export interface RunBuffConfig {
  name: string;
  desc: string;
  durationSec?: number;
  count?: number;
}

export interface RunConfig {
  mode: GameMode;
  name: string;
  settle: SettleConfig;
  revive: { adPerRun: number };
  buffs: Record<string, RunBuffConfig>;
}

export interface IConfigService {
  loadAll(): Promise<void>;
  readonly ready: boolean;
  app(): AppConfig;
  item(id: ItemId): ItemConfig | undefined;
  allItems(): ItemConfig[];
  character(id: CharacterId): CharacterConfig | undefined;
  allCharacters(): CharacterConfig[];
  goods(id: GoodsId): ShopGoodsConfig | undefined;
  goodsByTab(tab: ShopTab): ShopGoodsConfig[];
  task(id: TaskId): TaskConfig | undefined;
  tasksByType(type: TaskType): TaskConfig[];
  achievement(id: AchievementId): AchievementConfig | undefined;
  allAchievements(): AchievementConfig[];
  welfare(): WelfareConfig;
  activity(id: ActivityId): ActivityConfig | undefined;
  allActivities(): ActivityConfig[];
  run(mode: GameMode): RunConfig;
  allRuns(): RunConfig[];
}

// ---------------------------------------------------------------------------
// 事件
// ---------------------------------------------------------------------------

export interface GameEventMap {
  'save.loaded': { fresh: boolean };
  'day.changed': { date: DateString; prevDate: DateString };
  'currency.changed': { gold: number; diamond: number; deltaGold: number; deltaDiamond: number; reason: string };
  'inventory.changed': { changed: ItemStack[] };
  'character.changed': { id: CharacterId; reason: 'unlock' | 'upgrade' | 'select' };
  'shop.changed': Record<string, never>;
  'task.changed': { ids?: TaskId[] };
  'achievement.changed': { ids?: AchievementId[] };
  'welfare.changed': Record<string, never>;
  'activity.changed': { ids?: ActivityId[] };
  'reddot.changed': { key: RedDotKey; on: boolean };
  'run.started': GameplayLaunchOptions;
  'run.finished': GameplayResult;
  'run.settled': { result: GameplayResult; reward: RewardBundle; doubled: boolean };
  'toast': { text: string };
}

export interface IEventBus {
  on<K extends keyof GameEventMap>(event: K, cb: (payload: GameEventMap[K]) => void, target?: unknown): void;
  once<K extends keyof GameEventMap>(event: K, cb: (payload: GameEventMap[K]) => void, target?: unknown): void;
  off<K extends keyof GameEventMap>(event: K, cb?: (payload: GameEventMap[K]) => void, target?: unknown): void;
  offTarget(target: unknown): void;
  emit<K extends keyof GameEventMap>(event: K, payload: GameEventMap[K]): void;
}

// ---------------------------------------------------------------------------
// 框架
// ---------------------------------------------------------------------------

export interface ILogger {
  debug(msg: string, ...args: unknown[]): void;
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
}

export interface IClock {
  now(): number;
  dateString(at?: number): DateString;
  gameDay(at?: number): DateString;
  weekKey(at?: number): string;
  readonly resetHour: number;
}

export interface IStorage {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

export interface ISaveRepository {
  readonly key: string;
  load(): SaveData;
  save(data: SaveData): void;
  reset(): SaveData;
}

export interface ServiceDeps {
  save: SaveData;
  events: IEventBus;
  clock: IClock;
  log: ILogger;
  markDirty(): void;
}

// ---------------------------------------------------------------------------
// 业务服务
// ---------------------------------------------------------------------------

export interface ICurrencyService {
  get(type: CurrencyType): number;
  canAfford(cost: Cost): boolean;
  add(type: CurrencyType, amount: number, reason: string): void;
  spend(cost: Cost, reason: string): OpResult;
}

export interface ItemUseResult extends OpResult {
  effect?: ItemEffect;
}

export interface IInventoryService {
  count(id: ItemId): number;
  add(id: ItemId, count: number): void;
  remove(id: ItemId, count: number): OpResult;
  all(): ItemStack[];
  use(id: ItemId): ItemUseResult;
}

export interface IRewardService {
  grant(reward: RewardBundle, source: string): void;
  describe(reward: RewardBundle): RewardDisplay[];
}

export interface ShopGoodsView {
  config: ShopGoodsConfig;
  remainingDaily: number | null;
  soldOut: boolean;
  affordable: boolean;
  needAd: boolean;
  lockReason?: string;
}

export interface PurchaseResult extends OpResult {
  needAd?: boolean;
  needPay?: { productId: string; priceFen: number };
  reward?: RewardBundle;
}

export interface IShopService {
  list(tab: ShopTab): ShopGoodsView[];
  buy(id: GoodsId): PurchaseResult;
  claimAd(id: GoodsId): PurchaseResult;
  claimPay(id: GoodsId): PurchaseResult;
  refreshIfNeeded(): void;
}

export interface CharacterView {
  config: CharacterConfig;
  unlocked: boolean;
  level: number;
  selected: boolean;
  attrs: CharacterAttrs;
  unlockCost?: Cost;
  upgradeCost?: Cost;
  canUnlock: boolean;
  canUpgrade: boolean;
}

export interface ICharacterService {
  list(): CharacterView[];
  get(id: CharacterId): CharacterView | undefined;
  current(): CharacterView;
  unlock(id: CharacterId): OpResult;
  upgrade(id: CharacterId): OpResult;
  select(id: CharacterId): OpResult;
  attrsOf(id: CharacterId): CharacterAttrs;
}

export interface TaskView {
  config: TaskConfig;
  progress: number;
  target: number;
  claimable: boolean;
  claimed: boolean;
}

export interface ITaskService {
  track(metric: TaskMetric, value: number, opts?: { absolute?: boolean }): void;
  onRunFinished(result: GameplayResult): void;
  list(type: TaskType): TaskView[];
  claim(id: TaskId): OpResult;
  claimAll(type: TaskType): { claimed: TaskId[]; reward: RewardBundle };
  refreshIfNeeded(): void;
  hasClaimable(): boolean;
}

export interface AchievementView {
  config: AchievementConfig;
  progress: number;
  target: number;
  claimable: boolean;
  claimed: boolean;
}

export interface IAchievementService {
  track(metric: TaskMetric, value: number, opts?: { absolute?: boolean }): void;
  onRunFinished(result: GameplayResult): void;
  list(): AchievementView[];
  claim(id: AchievementId): OpResult;
  hasClaimable(): boolean;
}

export interface WelfareSignInDayView {
  day: number;
  reward: RewardBundle;
  state: 'claimed' | 'today' | 'future';
}

export interface WelfareSignInState {
  todaySigned: boolean;
  cycleDay: number;
  days: WelfareSignInDayView[];
}

export interface IWelfareService {
  signInState(): WelfareSignInState;
  signIn(): OpResult;
  dailyFreeAdClaimed(): boolean;
  claimDailyFreeAd(): OpResult;
  refreshIfNeeded(): void;
}

export interface ActivityMilestoneView {
  index: number;
  target: number;
  progress: number;
  claimable: boolean;
  claimed: boolean;
  reward: RewardBundle;
}

export interface ActivityView {
  config: ActivityConfig;
  status: 'upcoming' | 'active' | 'ended';
  milestones: ActivityMilestoneView[];
}

export interface IActivityService {
  list(): ActivityView[];
  get(id: ActivityId): ActivityView | null;
  claim(id: ActivityId, milestoneIndex: number): OpResult;
  track(metric: TaskMetric, value: number, opts?: { absolute?: boolean }): void;
  refreshIfNeeded(): void;
  hasClaimable(): boolean;
}

export type RedDotKey =
  | 'menu.tasks'
  | 'menu.welfare'
  | 'menu.achievements'
  | 'menu.activities'
  | 'menu.characters'
  | 'menu.shop';

export interface IRedDotService {
  isOn(key: RedDotKey): boolean;
  refresh(): void;
  subscribe(cb: (key: RedDotKey, on: boolean) => void): () => void;
}

// ---------------------------------------------------------------------------
// 平台适配
// ---------------------------------------------------------------------------

export type AdPlacement = 'settlement.double' | 'shop.free.gold' | 'welfare.daily' | 'run.revive';

export interface AdResult {
  completed: boolean;
}

export interface IAdService {
  isReady(placement: AdPlacement): boolean;
  preload(placement: AdPlacement): void;
  show(placement: AdPlacement): Promise<AdResult>;
}

export interface ShareOptions {
  title?: string;
  imageUrl?: string;
  query?: Record<string, string>;
}

export interface PayProduct {
  id: string;
  priceFen: number;
}

export interface PayResult {
  ok: boolean;
  reason?: 'cancel' | 'unsupported' | 'fail';
}

export interface UserKV {
  key: string;
  value: string;
}

export interface LeaderboardQuery {
  board: 'friends' | 'global';
  top: number;
}

export interface LeaderboardEntry {
  rank: number;
  uid: string;
  nickname: string;
  avatarUrl: string;
  score: number;
  isMe?: boolean;
}

export interface LeaderboardResult {
  list: LeaderboardEntry[];
  me?: LeaderboardEntry;
  offline?: boolean;
}

export interface SubmitScorePayload {
  score: number;
  distance: number;
  mode: GameMode;
  nickname: string;
  avatarUrl: string;
}

export interface SubmitScoreResult {
  ok: boolean;
  bestScore?: number;
  rank?: number;
}

export interface ICloudService {
  init(envId: string): Promise<void>;
  uploadSave(save: SaveData): Promise<{ ok: boolean; serverUpdatedAt?: number }>;
  downloadSave(): Promise<SaveData | null>;
  submitScore(payload: SubmitScorePayload): Promise<SubmitScoreResult>;
  getLeaderboard(query: LeaderboardQuery): Promise<LeaderboardResult>;
}

export interface LoginResult {
  uid: string;
  nickname: string;
  avatarUrl: string;
  isGuest: boolean;
}

export interface IPlatformAdapter {
  readonly kind: 'local' | 'wechat';
  readonly storage: IStorage;
  readonly ad: IAdService;
  readonly cloud: ICloudService;
  init(): Promise<void>;
  login(): Promise<LoginResult>;
  share(opts: ShareOptions): Promise<boolean>;
  pay(product: PayProduct): Promise<PayResult>;
  setUserCloudStorage(kv: UserKV[]): void;
  vibrate(type: 'short' | 'long'): void;
  copyText(text: string): void;
}

// ---------------------------------------------------------------------------
// 玩法边界
// ---------------------------------------------------------------------------

export interface GameplayLaunchOptions {
  mode: GameMode;
  characterId: CharacterId;
  items?: ItemId[];
  seed?: number;
}

export interface GameplayResult {
  mode: GameMode;
  score: number;
  distance: number;
  coins: number;
  diamonds: number;
  durationMs: number;
  revivedCount: number;
  extra?: Record<string, number>;
}

export interface IGameplayLauncher {
  readonly isMock: boolean;
  preload(): Promise<void>;
  launch(opts: GameplayLaunchOptions): Promise<GameplayResult>;
}

export interface SettlementResult {
  result: GameplayResult;
  base: RewardBundle;
  double: RewardBundle;
}

// ---------------------------------------------------------------------------
// 组合根
// ---------------------------------------------------------------------------

export interface IGameContext {
  readonly save: SaveData;
  readonly clock: IClock;
  readonly events: IEventBus;
  readonly config: IConfigService;
  readonly currency: ICurrencyService;
  readonly inventory: IInventoryService;
  readonly reward: IRewardService;
  readonly shop: IShopService;
  readonly character: ICharacterService;
  readonly task: ITaskService;
  readonly achievement: IAchievementService;
  readonly welfare: IWelfareService;
  readonly activity: IActivityService;
  readonly redDot: IRedDotService;
  readonly platform: IPlatformAdapter;
  readonly gameplay: IGameplayLauncher;
  useItem(id: ItemId): OpResult;
  markDirty(): void;
  flush(): void;
  refreshDaily(): void;
}
