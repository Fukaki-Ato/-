import { describe, expect, it, vi } from 'vitest';
import { MockAdService } from '../../assets/scripts/core/platform/MockAdService';
import { WechatAdService } from '../../assets/scripts/ui/platform/wechat/WechatAdService';
import type { WxApi, WxRewardedVideoAd } from '../../assets/scripts/ui/platform/wechat/WechatTypes';
import { silentLog } from '../helpers';

interface FakeAd {
  ad: WxRewardedVideoAd;
  calls: { load: number; show: number };
  close(res: { isEnded?: boolean } | undefined): void;
  error(err: { errMsg?: string }): void;
}

function createFakeAd(failures: { load?: number; show?: number } = {}): FakeAd {
  const calls = { load: 0, show: 0 };
  let closeCb: ((res: { isEnded?: boolean } | undefined) => void) | null = null;
  let errorCb: ((err: { errMsg?: string }) => void) | null = null;
  const ad: WxRewardedVideoAd = {
    load: async () => {
      calls.load += 1;
      if (failures.load && calls.load <= failures.load) throw new Error('load fail');
    },
    show: async () => {
      calls.show += 1;
      if (failures.show && calls.show <= failures.show) throw new Error('show fail');
    },
    onClose: (cb) => {
      closeCb = cb;
    },
    onError: (cb) => {
      errorCb = cb;
    },
  };
  return {
    ad,
    calls,
    close: (res) => closeCb?.(res),
    error: (err) => errorCb?.(err),
  };
}

function createFakeWx(fake: FakeAd | null): WxApi {
  return {
    createRewardedVideoAd: fake ? () => fake.ad : undefined,
  };
}

describe('WechatAdService', () => {
  it('未配置广告位时走模拟实现', async () => {
    const service = new WechatAdService({
      wx: createFakeWx(null),
      adUnits: {},
      log: silentLog,
      fallback: new MockAdService({ completed: false, delayMs: 0 }),
    });
    expect(service.isReady('settlement.double')).toBe(true);
    await expect(service.show('settlement.double')).resolves.toEqual({ completed: false });
  });

  it('完整观看：onClose.isEnded=true → completed=true', async () => {
    const fake = createFakeAd();
    const service = new WechatAdService({
      wx: createFakeWx(fake),
      adUnits: { 'settlement.double': 'adunit-test-1' },
      log: silentLog,
    });
    expect(service.isReady('settlement.double')).toBe(false);
    service.preload('settlement.double');
    const pending = service.show('settlement.double');
    await vi.waitFor(() => expect(fake.calls.show).toBe(1));
    fake.close({ isEnded: true });
    await expect(pending).resolves.toEqual({ completed: true });
  });

  it('提前关闭：onClose.isEnded=false → completed=false', async () => {
    const fake = createFakeAd();
    const service = new WechatAdService({
      wx: createFakeWx(fake),
      adUnits: { 'shop.free.gold': 'adunit-test-2' },
      log: silentLog,
    });
    const pending = service.show('shop.free.gold');
    await vi.waitFor(() => expect(fake.calls.show).toBe(1));
    fake.close({ isEnded: false });
    await expect(pending).resolves.toEqual({ completed: false });
  });

  it('缺少 isEnded 按未完成处理', async () => {
    const fake = createFakeAd();
    const service = new WechatAdService({
      wx: createFakeWx(fake),
      adUnits: { 'welfare.daily': 'adunit-test-3' },
      log: silentLog,
    });
    const pending = service.show('welfare.daily');
    await vi.waitFor(() => expect(fake.calls.show).toBe(1));
    fake.close({});
    await expect(pending).resolves.toEqual({ completed: false });
  });

  it('加载失败返回未完成，不抛异常', async () => {
    const fake = createFakeAd({ load: 1 });
    const service = new WechatAdService({
      wx: createFakeWx(fake),
      adUnits: { 'run.revive': 'adunit-test-4' },
      log: silentLog,
    });
    await expect(service.show('run.revive')).resolves.toEqual({ completed: false });
  });

  it('首次 show 失败会重载并重试一次', async () => {
    const fake = createFakeAd({ show: 1 });
    const service = new WechatAdService({
      wx: createFakeWx(fake),
      adUnits: { 'settlement.double': 'adunit-test-5' },
      log: silentLog,
    });
    const pending = service.show('settlement.double');
    await vi.waitFor(() => expect(fake.calls.show).toBe(2));
    fake.close({ isEnded: true });
    await expect(pending).resolves.toEqual({ completed: true });
  });

  it('播放中 onError → completed=false 并触发预加载重试', async () => {
    const fake = createFakeAd();
    const service = new WechatAdService({
      wx: createFakeWx(fake),
      adUnits: { 'shop.free.gold': 'adunit-test-6' },
      log: silentLog,
    });
    const pending = service.show('shop.free.gold');
    await vi.waitFor(() => expect(fake.calls.show).toBe(1));
    fake.error({ errMsg: 'unit error' });
    await expect(pending).resolves.toEqual({ completed: false });
    await vi.waitFor(() => expect(fake.calls.load).toBeGreaterThanOrEqual(2));
  });

  it('广告 API 缺失时真实广告位返回未完成（不降级模拟）', async () => {
    const service = new WechatAdService({
      wx: { cloud: undefined },
      adUnits: { 'settlement.double': 'adunit-test-7' },
      log: silentLog,
      fallback: new MockAdService({ completed: true, delayMs: 0 }),
    });
    await expect(service.show('settlement.double')).resolves.toEqual({ completed: false });
  });
});
