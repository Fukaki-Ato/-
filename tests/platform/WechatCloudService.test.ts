import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SaveData } from '../../assets/scripts/core/contracts';
import { createDefaultSave } from '../../assets/scripts/core/framework/SaveRepository';
import { WechatCloudService } from '../../assets/scripts/ui/platform/wechat/WechatCloudService';
import type { WxApi, WxCloudApi } from '../../assets/scripts/ui/platform/wechat/WechatTypes';
import { silentLog } from '../helpers';

interface FakeCloud {
  cloud: WxCloudApi;
  calls: Array<{ name: string; data?: Record<string, unknown> }>;
}

function createFakeCloud(
  handler: (name: string, data?: Record<string, unknown>) => unknown | Promise<unknown>,
): FakeCloud {
  const calls: FakeCloud['calls'] = [];
  const cloud: WxCloudApi = {
    init: () => undefined,
    callFunction: (opts) => {
      calls.push({ name: opts.name, data: opts.data });
      Promise.resolve()
        .then(() => handler(opts.name, opts.data))
        .then((result) => opts.success?.({ result }))
        .catch((err: unknown) => opts.fail?.({ errMsg: err instanceof Error ? err.message : String(err) }));
    },
  };
  return { cloud, calls };
}

function wxWith(cloud: WxCloudApi | undefined): WxApi {
  return cloud ? { cloud } : {};
}

function testSave(): SaveData {
  return createDefaultSave(
    { uid: 'openid-me', nickname: '测试玩家', avatarUrl: '', isGuest: false, createdAt: 1 },
    '2026-10-05',
    '2026-W40',
    1000,
  );
}

describe('WechatCloudService', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('未配置环境时初始化失败，各能力返回安全默认值', async () => {
    const fake = createFakeCloud(() => ({ ok: true }));
    const service = new WechatCloudService({ wx: wxWith(fake.cloud), log: silentLog });
    await service.init('');
    expect(service.initialized).toBe(false);
    await expect(service.login()).resolves.toBeNull();
    await expect(service.uploadSave(testSave())).resolves.toEqual({ ok: false });
    await expect(service.downloadSave()).resolves.toBeNull();
    await expect(service.submitScore({ score: 1, distance: 1, mode: 'classic', nickname: '', avatarUrl: '' }))
      .resolves.toEqual({ ok: false });
    await expect(service.getLeaderboard({ board: 'global', top: 10 })).resolves.toEqual({ list: [], offline: true });
  });

  it('login 成功映射档案，返回异常时降级 null', async () => {
    const fake = createFakeCloud((name) => {
      if (name === 'login') return { ok: true, uid: 'openid-1', nickname: '酷跑玩家', avatarUrl: 'https://a', bestScore: 42 };
      return { ok: false, code: 'X' };
    });
    const service = new WechatCloudService({ wx: wxWith(fake.cloud), log: silentLog });
    await service.init('env-test');
    await expect(service.login()).resolves.toEqual({
      uid: 'openid-1',
      nickname: '酷跑玩家',
      avatarUrl: 'https://a',
      bestScore: 42,
    });

    const bad = createFakeCloud(() => ({ ok: false, code: 'DB_ERROR' }));
    const badService = new WechatCloudService({ wx: wxWith(bad.cloud), log: silentLog });
    await badService.init('env-test');
    await expect(badService.login()).resolves.toBeNull();
  });

  it('云存档上传/下载与 STALE_SAVE 处理', async () => {
    const fake = createFakeCloud((name, data) => {
      if (name !== 'syncSave') return { ok: false };
      if (data?.action === 'download') {
        return { ok: true, save: testSave(), version: 1, updatedAt: 999, serverUpdatedAt: 999 };
      }
      return { ok: true, serverUpdatedAt: data?.updatedAt };
    });
    const service = new WechatCloudService({ wx: wxWith(fake.cloud), log: silentLog });
    await service.init('env-test');
    const save = testSave();
    await expect(service.uploadSave(save)).resolves.toEqual({ ok: true, serverUpdatedAt: save.updatedAt });
    const downloaded = await service.downloadSave();
    expect(downloaded?.version).toBe(1);

    const stale = createFakeCloud(() => ({ ok: false, code: 'STALE_SAVE', serverUpdatedAt: 12345 }));
    const staleService = new WechatCloudService({ wx: wxWith(stale.cloud), log: silentLog });
    await staleService.init('env-test');
    await expect(staleService.uploadSave(save)).resolves.toEqual({ ok: false, serverUpdatedAt: 12345 });
  });

  it('submitScore 正常返回与云端拒绝', async () => {
    const fake = createFakeCloud((name) => {
      if (name === 'submitScore') return { ok: true, bestScore: 999, rank: 3 };
      return { ok: false };
    });
    const service = new WechatCloudService({ wx: wxWith(fake.cloud), log: silentLog });
    await service.init('env-test');
    await expect(service.submitScore({ score: 999, distance: 10, mode: 'classic', nickname: 'a', avatarUrl: '' }))
      .resolves.toEqual({ ok: true, bestScore: 999, rank: 3 });

    const rejected = createFakeCloud(() => ({ ok: false, code: 'INVALID_SCORE', message: 'bad' }));
    const rejectedService = new WechatCloudService({ wx: wxWith(rejected.cloud), log: silentLog });
    await rejectedService.init('env-test');
    await expect(rejectedService.submitScore({ score: -1, distance: 0, mode: 'classic', nickname: '', avatarUrl: '' }))
      .resolves.toEqual({ ok: false });
  });

  it('getLeaderboard 规范化名次与 me；friends 降级请求 global', async () => {
    const fake = createFakeCloud(() => ({
      ok: true,
      list: [
        { uid: 'u1', nickname: 'A', avatarUrl: '', score: 100, rank: 1 },
        { uid: 'u2', nickname: 'B', avatarUrl: '', score: 80 },
        'not-a-record',
      ],
      me: { uid: 'me', nickname: '我', avatarUrl: '', score: 50 },
    }));
    const service = new WechatCloudService({ wx: wxWith(fake.cloud), log: silentLog });
    await service.init('env-test');

    const result = await service.getLeaderboard({ board: 'global', top: 10 });
    expect(result.offline).toBeUndefined();
    expect(result.list).toHaveLength(2);
    expect(result.list[1]).toMatchObject({ uid: 'u2', rank: 2, score: 80 });
    expect(result.me).toMatchObject({ uid: 'me', rank: 3, isMe: true });

    await service.getLeaderboard({ board: 'friends', top: 10 });
    expect(fake.calls[fake.calls.length - 1]?.data).toMatchObject({ board: 'global' });
  });

  it('返回空/超时/异常时返回离线安全默认值', async () => {
    const empty = createFakeCloud(() => ({ ok: true, list: null }));
    const emptyService = new WechatCloudService({ wx: wxWith(empty.cloud), log: silentLog });
    await emptyService.init('env-test');
    await expect(emptyService.getLeaderboard({ board: 'global', top: 10 })).resolves.toEqual({ list: [], offline: true });

    vi.useFakeTimers();
    const hang = createFakeCloud(() => new Promise(() => undefined));
    const hangService = new WechatCloudService({ wx: wxWith(hang.cloud), timeoutMs: 1000, log: silentLog });
    await hangService.init('env-test');
    const pending = hangService.uploadSave(testSave());
    await vi.advanceTimersByTimeAsync(1100);
    await expect(pending).resolves.toEqual({ ok: false });
  });
});
