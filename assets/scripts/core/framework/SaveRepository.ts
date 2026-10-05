import {
  SAVE_KEY,
  SAVE_VERSION,
  type DateString,
  type IClock,
  type ILogger,
  type ISaveRepository,
  type IStorage,
  type PlayerProfile,
  type SaveData,
} from '../contracts';
import { safeJsonParse } from './Utils';

export const DEFAULT_CHARACTER_ID = 'runner_default';
export const SAVE_CORRUPT_PREFIX = 'ltkp.save.corrupt.';

export type SaveMigration = (old: any) => any;

/** 新档工厂：默认角色已解锁并选中、等级 1，货币与道具为空。 */
export function createDefaultSave(
  profile: PlayerProfile,
  gameDay: DateString,
  weekKey: string,
  now: number = Date.now(),
): SaveData {
  return {
    version: SAVE_VERSION,
    profile: { ...profile },
    currency: { gold: 0, diamond: 0 },
    inventory: {},
    characters: {
      unlocked: [DEFAULT_CHARACTER_ID],
      levels: { [DEFAULT_CHARACTER_ID]: 1 },
      selected: DEFAULT_CHARACTER_ID,
    },
    welfare: { lastSignInDate: '', signInCycleDay: 0, signInHistory: [] },
    tasks: {
      daily: { date: gameDay, progress: {}, claimed: [] },
      weekly: { date: weekKey, progress: {}, claimed: [] },
    },
    achievements: { progress: {}, claimed: [] },
    shop: { dailyBought: {}, dailyRefreshDate: gameDay, adClaimed: {} },
    activities: { claimed: {}, progress: {} },
    stats: {
      runs: 0,
      bestScore: 0,
      totalDistance: 0,
      totalCoins: 0,
      totalDiamonds: 0,
      totalPlayMs: 0,
      loginDays: 0,
    },
    settings: { music: true, sfx: true },
    flags: {},
    updatedAt: now,
  };
}

export interface LocalSaveRepositoryOptions {
  storage: IStorage;
  clock: IClock;
  log: ILogger;
  /** 默认档使用的玩家档案；不传时使用本地游客占位档案。 */
  profile?: PlayerProfile;
  /** 逐版本迁移函数，key 为迁移前的版本号。 */
  migrations?: Record<number, SaveMigration>;
}

export class LocalSaveRepository implements ISaveRepository {
  readonly key = SAVE_KEY;

  private readonly storage: IStorage;
  private readonly clock: IClock;
  private readonly log: ILogger;
  private readonly profile?: PlayerProfile;
  private readonly migrations: Record<number, SaveMigration>;

  constructor(opts: LocalSaveRepositoryOptions) {
    this.storage = opts.storage;
    this.clock = opts.clock;
    this.log = opts.log;
    this.profile = opts.profile;
    this.migrations = opts.migrations ?? {};
  }

  load(): SaveData {
    const raw = this.storage.get(this.key);
    if (raw === null) return this.persist(this.createDefault());

    const parsed = safeJsonParse<unknown>(raw);
    if (!isSaveShape(parsed)) return this.recover(raw, '解析失败或结构不合法');
    if (parsed.version > SAVE_VERSION) {
      return this.recover(raw, `存档版本 v${parsed.version} 高于当前 v${SAVE_VERSION}`);
    }
    if (parsed.version < SAVE_VERSION) {
      const migrated = this.migrate(parsed);
      if (migrated === null) return this.recover(raw, '迁移失败或缺少迁移函数');
      return migrated;
    }
    return parsed;
  }

  save(data: SaveData): void {
    data.version = SAVE_VERSION;
    data.updatedAt = this.clock.now();
    this.storage.set(this.key, JSON.stringify(data));
  }

  reset(): SaveData {
    const fresh = this.createDefault();
    this.save(fresh);
    return fresh;
  }

  private createDefault(): SaveData {
    const profile: PlayerProfile = this.profile ?? {
      uid: 'guest_local',
      nickname: '酷跑玩家',
      avatarUrl: '',
      isGuest: true,
      createdAt: this.clock.now(),
    };
    return createDefaultSave(profile, this.clock.gameDay(), this.clock.weekKey(), this.clock.now());
  }

  private persist(data: SaveData): SaveData {
    this.save(data);
    return data;
  }

  private recover(raw: string, reason: string): SaveData {
    const backupKey = `${SAVE_CORRUPT_PREFIX}${this.clock.now()}`;
    this.log.error(`存档不可用（${reason}），已备份到 ${backupKey}`);
    this.storage.set(backupKey, raw);
    return this.persist(this.createDefault());
  }

  private migrate(data: SaveData): SaveData | null {
    let current: unknown = data;
    for (let version = data.version; version < SAVE_VERSION; version++) {
      const migrate = this.migrations[version];
      if (!migrate) {
        this.log.error(`缺少 v${version} 的存档迁移函数`);
        return null;
      }
      try {
        current = migrate(current);
      } catch (err) {
        this.log.error(`存档 v${version} → v${version + 1} 迁移失败`, err);
        return null;
      }
      if (!current || typeof current !== 'object') {
        this.log.error(`存档 v${version} 迁移结果非法`);
        return null;
      }
    }
    if (!isSaveShape(current)) {
      this.log.error('存档迁移后结构不合法');
      return null;
    }
    current.version = SAVE_VERSION;
    return current;
  }
}

function isNonNegativeInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isNonNegativeIntRecord(value: unknown): value is Record<string, number> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return Object.values(value as Record<string, unknown>).every(isNonNegativeInt);
}

function isStringArrayRecord(value: unknown): value is Record<string, string[]> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return Object.values(value as Record<string, unknown>).every(isStringArray);
}

function isTaskPeriodState(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const state = value as { date?: unknown; progress?: unknown; claimed?: unknown };
  return typeof state.date === 'string'
    && isNonNegativeIntRecord(state.progress)
    && isStringArray(state.claimed);
}

function isPlayerProfile(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const profile = value as Record<string, unknown>;
  return typeof profile.uid === 'string'
    && typeof profile.nickname === 'string'
    && typeof profile.avatarUrl === 'string'
    && typeof profile.isGuest === 'boolean'
    && isFiniteNumber(profile.createdAt);
}

function isPlayerStats(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const stats = value as Record<string, unknown>;
  return ['runs', 'bestScore', 'totalDistance', 'totalCoins', 'totalDiamonds', 'totalPlayMs', 'loginDays']
    .every((field) => isNonNegativeInt(stats[field]));
}

/** 完整结构校验：任一子结构缺失或非法都视为坏档（备份 + 默认档）。 */
function isSaveShape(value: unknown): value is SaveData {
  if (typeof value !== 'object' || value === null) return false;
  const save = value as Record<string, unknown>;
  if (!isNonNegativeInt(save.version)) return false;
  if (!isPlayerProfile(save.profile)) return false;
  if (!isNonNegativeIntRecord(save.inventory)) return false;

  const currency = save.currency as Record<string, unknown> | undefined;
  if (!currency || !isNonNegativeInt(currency.gold) || !isNonNegativeInt(currency.diamond)) return false;

  const characters = save.characters as Record<string, unknown> | undefined;
  if (!characters) return false;
  const unlocked = characters.unlocked;
  if (!isStringArray(unlocked) || unlocked.length === 0) return false;
  if (typeof characters.selected !== 'string' || !unlocked.includes(characters.selected)) return false;
  if (!isNonNegativeIntRecord(characters.levels)) return false;

  const welfare = save.welfare as Record<string, unknown> | undefined;
  if (!welfare || typeof welfare.lastSignInDate !== 'string') return false;
  if (!isNonNegativeInt(welfare.signInCycleDay) || !isStringArray(welfare.signInHistory)) return false;

  const tasks = save.tasks as Record<string, unknown> | undefined;
  if (!tasks || !isTaskPeriodState(tasks.daily) || !isTaskPeriodState(tasks.weekly)) return false;

  const achievements = save.achievements as Record<string, unknown> | undefined;
  if (!achievements || !isNonNegativeIntRecord(achievements.progress) || !isStringArray(achievements.claimed)) return false;

  const shop = save.shop as Record<string, unknown> | undefined;
  if (!shop || !isNonNegativeIntRecord(shop.dailyBought) || !isNonNegativeIntRecord(shop.adClaimed)) return false;
  if (typeof shop.dailyRefreshDate !== 'string') return false;

  const activities = save.activities as Record<string, unknown> | undefined;
  if (!activities || !isStringArrayRecord(activities.claimed) || !isNonNegativeIntRecord(activities.progress)) return false;

  if (!isPlayerStats(save.stats)) return false;

  const settings = save.settings as Record<string, unknown> | undefined;
  if (!settings || typeof settings.music !== 'boolean' || typeof settings.sfx !== 'boolean') return false;

  const flags = save.flags;
  if (typeof flags !== 'object' || flags === null || Array.isArray(flags)) return false;
  const flagsValid = Object.values(flags as Record<string, unknown>).every(
    (item) => typeof item === 'boolean' || typeof item === 'string' || isFiniteNumber(item),
  );
  if (!flagsValid) return false;

  return isFiniteNumber(save.updatedAt);
}
