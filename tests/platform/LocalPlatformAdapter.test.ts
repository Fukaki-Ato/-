import { describe, expect, it } from 'vitest';
import { MemoryStorage } from '../../assets/scripts/core/framework/Storage';
import { LocalPlatformAdapter, LOCAL_UID_KEY } from '../../assets/scripts/core/platform/LocalPlatformAdapter';
import { silentLog } from '../helpers';

describe('LocalPlatformAdapter', () => {
  it('kind=local，广告默认就绪，init 可等待', async () => {
    const platform = new LocalPlatformAdapter({ storage: new MemoryStorage(), log: silentLog });
    expect(platform.kind).toBe('local');
    expect(platform.ad.isReady('settlement.double')).toBe(true);
    await expect(platform.init()).resolves.toBeUndefined();
  });

  it('登录 uid 跨实例稳定且格式为 guest_<8位>', async () => {
    const storage = new MemoryStorage();
    const first = new LocalPlatformAdapter({ storage, log: silentLog });
    const r1 = await first.login();
    expect(r1.uid).toMatch(/^guest_[a-z0-9]{8}$/);
    expect(r1.nickname).toBe('酷跑玩家');
    expect(r1.avatarUrl).toBe('');
    expect(r1.isGuest).toBe(true);
    expect(storage.get(LOCAL_UID_KEY)).toBe(r1.uid);

    const second = new LocalPlatformAdapter({ storage, log: silentLog });
    const r2 = await second.login();
    expect(r2.uid).toBe(r1.uid);
  });

  it('广告模拟结果按构造配置返回', async () => {
    const platform = new LocalPlatformAdapter({
      storage: new MemoryStorage(),
      adOptions: { completed: false, delayMs: 0 },
      log: silentLog,
    });
    await expect(platform.ad.show('run.revive')).resolves.toEqual({ completed: false });
  });

  it('share 返回 true，pay 返回 unsupported，其余接口可调用', async () => {
    const platform = new LocalPlatformAdapter({ storage: new MemoryStorage(), log: silentLog });
    await expect(platform.share({ title: '雷霆酷跑' })).resolves.toBe(true);
    await expect(platform.pay({ id: 'ltkp.diamond.60', priceFen: 600 })).resolves.toEqual({
      ok: false,
      reason: 'unsupported',
    });
    expect(() => {
      platform.setUserCloudStorage([{ key: 'k', value: 'v' }]);
      platform.vibrate('short');
      platform.copyText('雷霆酷跑');
    }).not.toThrow();
  });

  it('排行榜经由适配器 cloud 返回合法结构', async () => {
    const platform = new LocalPlatformAdapter({ storage: new MemoryStorage(), log: silentLog });
    await platform.login();
    const result = await platform.cloud.getLeaderboard({ board: 'global', top: 10 });
    expect(result.offline).toBe(true);
    expect(result.list).toHaveLength(10);
    expect(result.list.some((entry) => entry.isMe)).toBe(true);
    expect(result.me?.isMe).toBe(true);
    result.list.forEach((entry, index) => {
      expect(entry.rank).toBe(index + 1);
      expect(entry.uid.length).toBeGreaterThan(0);
      expect(entry.score).toBeGreaterThanOrEqual(0);
    });
  });
});
