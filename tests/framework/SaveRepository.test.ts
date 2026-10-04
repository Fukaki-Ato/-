import { describe, expect, it, vi } from 'vitest';
import { SAVE_KEY, SAVE_VERSION, type PlayerProfile } from '../../assets/scripts/core/contracts';
import { Clock } from '../../assets/scripts/core/framework/Clock';
import { MemoryStorage } from '../../assets/scripts/core/framework/Storage';
import {
  LocalSaveRepository,
  SAVE_CORRUPT_PREFIX,
  createDefaultSave,
  type SaveMigration,
} from '../../assets/scripts/core/framework/SaveRepository';
import { silentLog } from '../helpers';

const NOW = 1_760_000_000_000;
const PROFILE: PlayerProfile = {
  uid: 'guest_test0001',
  nickname: '酷跑玩家',
  avatarUrl: '',
  isGuest: true,
  createdAt: 123,
};

function setup(migrations?: Record<number, SaveMigration>) {
  const storage = new MemoryStorage();
  const clock = new Clock({ now: () => NOW });
  const repo = new LocalSaveRepository({ storage, clock, log: silentLog, profile: PROFILE, migrations });
  return { storage, clock, repo };
}

describe('createDefaultSave', () => {
  it('默认角色已解锁并选中、等级 1，货币与道具为空', () => {
    const save = createDefaultSave(PROFILE, '2026-10-04', '2026-W40', 42);
    expect(save.version).toBe(SAVE_VERSION);
    expect(save.profile).toEqual(PROFILE);
    expect(save.characters.unlocked).toEqual(['runner_default']);
    expect(save.characters.selected).toBe('runner_default');
    expect(save.characters.levels.runner_default).toBe(1);
    expect(save.currency).toEqual({ gold: 0, diamond: 0 });
    expect(save.inventory).toEqual({});
    expect(save.tasks.daily.date).toBe('2026-10-04');
    expect(save.tasks.weekly.date).toBe('2026-W40');
    expect(save.updatedAt).toBe(42);
  });
});

describe('LocalSaveRepository', () => {
  it('读写往返，保存时刷新 updatedAt', () => {
    const { storage, repo } = setup();
    const save = repo.load();
    save.currency.gold = 123;
    repo.save(save);

    const raw = storage.get(SAVE_KEY);
    expect(raw).not.toBeNull();
    expect((JSON.parse(raw as string) as { updatedAt: number }).updatedAt).toBe(NOW);

    const loaded = repo.load();
    expect(loaded.currency.gold).toBe(123);
    expect(loaded.version).toBe(SAVE_VERSION);
  });

  it('坏 JSON 备份为 ltkp.save.corrupt.<ts> 并返回默认档', () => {
    const { storage, repo } = setup();
    storage.set(SAVE_KEY, '{oops');
    const save = repo.load();
    expect(save.version).toBe(SAVE_VERSION);
    expect(save.currency).toEqual({ gold: 0, diamond: 0 });
    expect(save.profile.uid).toBe(PROFILE.uid);
    expect(storage.get(`${SAVE_CORRUPT_PREFIX}${NOW}`)).toBe('{oops');
  });

  it('结构校验失败同样备份并返回默认档', () => {
    const { storage, repo } = setup();
    storage.set(SAVE_KEY, JSON.stringify({ version: 1, profile: { uid: 1 } }));
    const save = repo.load();
    expect(save.profile.uid).toBe(PROFILE.uid);
    expect(storage.get(`${SAVE_CORRUPT_PREFIX}${NOW}`)).not.toBeNull();
  });

  it('更高版本号视为不可用（备份 + 默认档）', () => {
    const { storage, repo } = setup();
    const future = { ...createDefaultSave(PROFILE, '2026-10-04', '2026-W40', 1), version: SAVE_VERSION + 1 };
    const raw = JSON.stringify(future);
    storage.set(SAVE_KEY, raw);
    const save = repo.load();
    expect(save.version).toBe(SAVE_VERSION);
    expect(save.currency).toEqual({ gold: 0, diamond: 0 });
    expect(storage.get(`${SAVE_CORRUPT_PREFIX}${NOW}`)).toBe(raw);
  });

  it('v0 档逐版本迁移到 v1，且不产生坏档备份', () => {
    const v0 = { ...createDefaultSave(PROFILE, '2026-10-01', '2026-W40', 1), version: 0 };
    const storage = new MemoryStorage();
    storage.set(SAVE_KEY, JSON.stringify(v0));
    const migrate = vi.fn((old: any) => ({ ...old, flags: { ...old.flags, migrated: true } }));
    const repo = new LocalSaveRepository({
      storage,
      clock: new Clock({ now: () => NOW }),
      log: silentLog,
      profile: PROFILE,
      migrations: { 0: migrate },
    });
    const save = repo.load();
    expect(migrate).toHaveBeenCalledTimes(1);
    expect(save.version).toBe(SAVE_VERSION);
    expect(save.flags.migrated).toBe(true);
    expect(storage.get(`${SAVE_CORRUPT_PREFIX}${NOW}`)).toBeNull();
  });

  it('缺少迁移函数时按不可用处理', () => {
    const { storage, repo } = setup();
    storage.set(
      SAVE_KEY,
      JSON.stringify({ ...createDefaultSave(PROFILE, '2026-10-01', '2026-W40', 1), version: 0 }),
    );
    const save = repo.load();
    expect(save.version).toBe(SAVE_VERSION);
    expect(save.flags).toEqual({});
    expect(storage.get(`${SAVE_CORRUPT_PREFIX}${NOW}`)).not.toBeNull();
  });

  it('reset 返回并持久化默认档', () => {
    const { storage, repo } = setup();
    repo.load().currency.gold = 500;
    const fresh = repo.reset();
    expect(fresh.currency.gold).toBe(0);
    const raw = storage.get(SAVE_KEY);
    expect(raw).not.toBeNull();
    expect((JSON.parse(raw as string) as { currency: { gold: number } }).currency.gold).toBe(0);
  });
});
