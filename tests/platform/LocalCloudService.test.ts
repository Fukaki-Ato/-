import { describe, expect, it } from 'vitest';
import { MemoryStorage } from '../../assets/scripts/core/framework/Storage';
import { createDefaultSave } from '../../assets/scripts/core/framework/SaveRepository';
import { CLOUD_BEST_KEY, CLOUD_SAVE_KEY, LocalCloudService } from '../../assets/scripts/core/platform/LocalCloudService';
import { silentLog } from '../helpers';

const PROFILE = { uid: 'guest_test0001', nickname: '酷跑玩家', avatarUrl: '', isGuest: true, createdAt: 0 };

function payload(score: number) {
  return { score, distance: 900, mode: 'classic', nickname: '酷跑玩家', avatarUrl: '' };
}

describe('LocalCloudService', () => {
  it('云存档上传/下载往返', async () => {
    const storage = new MemoryStorage();
    const cloud = new LocalCloudService({ storage, log: silentLog, now: () => 999 });
    const save = createDefaultSave(PROFILE, '2026-10-04', '2026-W40', 1);

    await expect(cloud.uploadSave(save)).resolves.toEqual({ ok: true, serverUpdatedAt: 999 });
    expect(storage.get(CLOUD_SAVE_KEY)).not.toBeNull();
    const downloaded = await cloud.downloadSave();
    expect(downloaded?.profile.uid).toBe(PROFILE.uid);
    expect(downloaded?.version).toBe(save.version);
  });

  it('无云存档或数据损坏时下载返回 null', async () => {
    const storage = new MemoryStorage();
    const cloud = new LocalCloudService({ storage, log: silentLog });
    expect(await cloud.downloadSave()).toBeNull();

    storage.set(CLOUD_SAVE_KEY, '{broken');
    expect(await cloud.downloadSave()).toBeNull();
  });

  it('submitScore 记录本地最佳并返回 rank 1', async () => {
    const storage = new MemoryStorage();
    const cloud = new LocalCloudService({ storage, log: silentLog });

    await expect(cloud.submitScore(payload(3000))).resolves.toEqual({ ok: true, bestScore: 3000, rank: 1 });
    await expect(cloud.submitScore(payload(1200))).resolves.toEqual({ ok: true, bestScore: 3000, rank: 1 });
    await expect(cloud.submitScore(payload(5000))).resolves.toEqual({ ok: true, bestScore: 5000, rank: 1 });

    const record = JSON.parse(storage.get(CLOUD_BEST_KEY) as string) as { score: number };
    expect(record.score).toBe(5000);
  });

  it('排行榜稳定输出 10 条且含我，提交高分后我升至第 1', async () => {
    const storage = new MemoryStorage();
    const cloud = new LocalCloudService({
      storage,
      log: silentLog,
      getIdentity: () => ({ uid: 'guest_test0001', nickname: '酷跑玩家', avatarUrl: '' }),
    });

    const before = await cloud.getLeaderboard({ board: 'global', top: 10 });
    expect(before.offline).toBe(true);
    expect(before.list).toHaveLength(10);
    expect(before.list.some((entry) => entry.isMe)).toBe(true);
    expect(before.me?.rank).toBe(10);

    const again = await cloud.getLeaderboard({ board: 'global', top: 10 });
    expect(again.list).toEqual(before.list);

    await cloud.submitScore(payload(5000));
    const after = await cloud.getLeaderboard({ board: 'global', top: 10 });
    expect(after.me?.rank).toBe(1);
    expect(after.list[0].isMe).toBe(true);
    expect(after.list[0].score).toBe(5000);

    const top3 = await cloud.getLeaderboard({ board: 'friends', top: 3 });
    expect(top3.list).toHaveLength(3);
    expect(top3.me?.rank).toBe(1);
  });
});
