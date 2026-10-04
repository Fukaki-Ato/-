import { afterEach, describe, expect, it, vi } from 'vitest';
import { MockAdService } from '../../assets/scripts/core/platform/MockAdService';

afterEach(() => {
  vi.useRealTimers();
});

describe('MockAdService', () => {
  it('isReady 恒 true，preload 为空实现', () => {
    const ad = new MockAdService();
    expect(ad.isReady('shop.free.gold')).toBe(true);
    expect(() => ad.preload('shop.free.gold')).not.toThrow();
  });

  it('默认 800ms 延迟后返回 completed=true', async () => {
    vi.useFakeTimers();
    const ad = new MockAdService();
    let settled = false;
    const promise = ad.show('welfare.daily').then((result) => {
      settled = true;
      return result;
    });

    await vi.advanceTimersByTimeAsync(799);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(promise).resolves.toEqual({ completed: true });
  });

  it('构造与运行时均可配置结果', async () => {
    const ad = new MockAdService({ completed: false, delayMs: 0 });
    await expect(ad.show('run.revive')).resolves.toEqual({ completed: false });
    ad.setCompleted(true);
    await expect(ad.show('run.revive')).resolves.toEqual({ completed: true });
  });

  it('delayMs=0 时立即返回，不依赖定时器', async () => {
    vi.useFakeTimers();
    const ad = new MockAdService({ delayMs: 0 });
    await expect(ad.show('settlement.double')).resolves.toEqual({ completed: true });
  });
});
