import type { AdPlacement, AdResult, IAdService, ILogger } from '../../../core/contracts';
import { MockAdService, type MockAdOptions } from '../../../core/platform/MockAdService';
import type { WxApi, WxErrorInfo, WxRewardedVideoAd } from './WechatTypes';

/**
 * `IAdService` 的微信激励视频实现（docs/05 §5）。
 *
 * - 每个 placement 一个广告实例并缓存；`show()` 包装为 Promise（onClose.isEnded 决定 completed）；
 * - `adUnits[placement]` 为空串/缺省时走模拟实现（MockAdService），保证未配置广告位时流程可测；
 * - onError 触发预加载重试；加载/展示失败统一返回 `{ completed: false }`，不向 UI 抛异常。
 */

export interface WechatAdOptions {
  wx: WxApi | null;
  /** placement → 广告位 ID；空串表示未配置（走 fallback）。 */
  adUnits?: Partial<Record<AdPlacement, string>>;
  log?: ILogger;
  /** 未配置广告位时的模拟实现，默认 `new MockAdService()`。 */
  fallback?: IAdService;
  fallbackOptions?: MockAdOptions;
}

interface AdSlot {
  placement: AdPlacement;
  unitId: string;
  ad: WxRewardedVideoAd | null;
  loaded: boolean;
  loadPromise: Promise<boolean> | null;
  pending: Promise<AdResult> | null;
  resolveClose: ((completed: boolean) => void) | null;
}

export class WechatAdService implements IAdService {
  private readonly wx: WxApi | null;
  private readonly adUnits: Partial<Record<AdPlacement, string>>;
  private readonly log?: ILogger;
  private readonly fallback: IAdService;
  private readonly slots = new Map<AdPlacement, AdSlot>();

  constructor(opts: WechatAdOptions) {
    this.wx = opts.wx;
    this.adUnits = opts.adUnits ?? {};
    this.log = opts.log;
    this.fallback = opts.fallback ?? new MockAdService(opts.fallbackOptions);
  }

  isReady(placement: AdPlacement): boolean {
    if (!this.hasUnit(placement)) return this.fallback.isReady(placement);
    return this.slots.get(placement)?.loaded === true;
  }

  preload(placement: AdPlacement): void {
    if (!this.hasUnit(placement)) {
      this.fallback.preload(placement);
      return;
    }
    const slot = this.ensureSlot(placement);
    if (slot) void this.load(slot);
  }

  show(placement: AdPlacement): Promise<AdResult> {
    if (!this.hasUnit(placement)) return this.fallback.show(placement);
    const slot = this.ensureSlot(placement);
    if (!slot) return Promise.resolve({ completed: false });
    if (slot.pending) return slot.pending;
    const pending = this.run(slot);
    slot.pending = pending;
    void pending.finally(() => {
      if (slot.pending === pending) slot.pending = null;
    });
    return pending;
  }

  private hasUnit(placement: AdPlacement): boolean {
    return (this.adUnits[placement] ?? '').trim().length > 0;
  }

  private ensureSlot(placement: AdPlacement): AdSlot | null {
    const existing = this.slots.get(placement);
    if (existing) return existing;
    const unitId = (this.adUnits[placement] ?? '').trim();
    if (!unitId) return null;
    const api = this.wx;
    if (!api?.createRewardedVideoAd) {
      this.log?.error(`微信广告 API 不可用，无法创建广告位：${placement}`);
      return null;
    }
    const slot: AdSlot = {
      placement,
      unitId,
      ad: null,
      loaded: false,
      loadPromise: null,
      pending: null,
      resolveClose: null,
    };
    try {
      const ad = api.createRewardedVideoAd({ adUnitId: unitId });
      ad.onClose((res) => this.handleClose(slot, res));
      ad.onError((err) => this.handleError(slot, err));
      slot.ad = ad;
    } catch (err) {
      this.log?.error(`创建激励视频广告失败：${placement}`, err);
      return null;
    }
    this.slots.set(placement, slot);
    return slot;
  }

  private handleClose(slot: AdSlot, res: { isEnded?: boolean; errMsg?: string } | undefined): void {
    slot.loaded = false;
    if (res?.isEnded === undefined) {
      this.log?.warn(`广告关闭事件缺少 isEnded，按未完成处理：${slot.placement}`);
    }
    const resolve = slot.resolveClose;
    slot.resolveClose = null;
    resolve?.(res?.isEnded === true);
  }

  private handleError(slot: AdSlot, err: WxErrorInfo): void {
    this.log?.warn(`激励视频广告错误（${slot.placement}）`, err);
    slot.loaded = false;
    slot.loadPromise = null;
    const resolve = slot.resolveClose;
    slot.resolveClose = null;
    resolve?.(false);
    // 预加载重试：失败后立刻尝试重新 load，下次 show 命中缓存。
    void this.load(slot);
  }

  private load(slot: AdSlot): Promise<boolean> {
    if (slot.loaded) return Promise.resolve(true);
    if (slot.loadPromise) return slot.loadPromise;
    const ad = slot.ad;
    if (!ad) return Promise.resolve(false);
    const promise = ad.load().then(
      () => {
        slot.loaded = true;
        slot.loadPromise = null;
        return true;
      },
      (err: unknown) => {
        this.log?.warn(`广告加载失败（${slot.placement}）`, err);
        slot.loaded = false;
        slot.loadPromise = null;
        return false;
      },
    );
    slot.loadPromise = promise;
    return promise;
  }

  private async run(slot: AdSlot): Promise<AdResult> {
    if (!slot.loaded) {
      const loaded = await this.load(slot);
      if (!loaded) return { completed: false };
    }
    const completed = await new Promise<boolean>((resolve) => {
      slot.resolveClose = resolve;
      void this.play(slot).catch(() => {
        const pendingResolve = slot.resolveClose;
        slot.resolveClose = null;
        pendingResolve?.(false);
      });
    });
    return { completed };
  }

  /** 展示广告；首次 show 失败时重载一次再试，仍失败则抛错由 run 兜底为未完成。 */
  private async play(slot: AdSlot): Promise<void> {
    const ad = slot.ad;
    if (!ad) throw new Error('广告实例不可用');
    try {
      await ad.show();
    } catch (err) {
      this.log?.warn(`广告首次展示失败，重载后重试：${slot.placement}`, err);
      slot.loaded = false;
      slot.loadPromise = null;
      const loaded = await this.load(slot);
      if (!loaded) throw new Error('广告加载失败');
      await ad.show();
    }
  }
}
