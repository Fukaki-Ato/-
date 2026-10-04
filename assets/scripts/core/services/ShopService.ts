import {
  FailReason,
  type GoodsId,
  type IConfigService,
  type ICurrencyService,
  type IRewardService,
  type IShopService,
  type PurchaseResult,
  type ServiceDeps,
  type ShopGoodsConfig,
  type ShopGoodsView,
  type ShopTab,
} from '../contracts';

/** 商店：列表视图（限购/可购状态）、购买、广告领取、支付发货与跨天刷新。 */
export class ShopService implements IShopService {
  private readonly deps: ServiceDeps;
  private readonly config: IConfigService;
  private readonly currency: ICurrencyService;
  private readonly reward: IRewardService;

  constructor(
    deps: ServiceDeps,
    config: IConfigService,
    currency: ICurrencyService,
    reward: IRewardService,
  ) {
    this.deps = deps;
    this.config = config;
    this.currency = currency;
    this.reward = reward;
  }

  list(tab: ShopTab): ShopGoodsView[] {
    this.refreshIfNeeded();
    return this.config.goodsByTab(tab).map((goods) => this.viewOf(goods));
  }

  buy(id: GoodsId): PurchaseResult {
    this.refreshIfNeeded();
    const goods = this.config.goods(id);
    if (!goods) return { ok: false, reason: FailReason.NotFound };
    const limit = this.effectiveLimit(goods);
    if (limit !== null && this.usedCount(goods) >= limit) return { ok: false, reason: FailReason.LimitReached };

    if (goods.price === null) {
      if (goods.viaAd) return { ok: true, needAd: true };
      // 免费非广告商品：直接发放并计入限购。
      return this.deliver(goods, `shop.free.${id}`, this.deps.save.shop.dailyBought, goods.dailyLimit !== undefined);
    }
    if (goods.price.currency === 'CNY') {
      if (!goods.productId) {
        this.deps.log.warn(`CNY 商品缺少 productId：${id}`);
        return { ok: false, reason: FailReason.Unsupported };
      }
      return { ok: true, needPay: { productId: goods.productId, priceFen: goods.price.amount } };
    }

    const spent = this.currency.spend({ [goods.price.currency]: goods.price.amount }, `shop.buy.${id}`);
    if (!spent.ok) return { ok: false, reason: spent.reason };
    return this.deliver(goods, `shop.buy.${id}`, this.deps.save.shop.dailyBought, true);
  }

  claimAd(id: GoodsId): PurchaseResult {
    this.refreshIfNeeded();
    const goods = this.config.goods(id);
    if (!goods) return { ok: false, reason: FailReason.NotFound };
    if (!goods.viaAd) return { ok: false, reason: FailReason.Unsupported };
    const limit = goods.dailyLimit ?? 1;
    if (this.usedCount(goods) >= limit) return { ok: false, reason: FailReason.LimitReached };
    return this.deliver(goods, `shop.ad.${id}`, this.deps.save.shop.adClaimed, true);
  }

  claimPay(id: GoodsId): PurchaseResult {
    this.refreshIfNeeded();
    const goods = this.config.goods(id);
    if (!goods) return { ok: false, reason: FailReason.NotFound };
    if (!goods.price || goods.price.currency !== 'CNY') return { ok: false, reason: FailReason.Unsupported };
    const limited = goods.dailyLimit !== undefined;
    if (limited && this.usedCount(goods) >= goods.dailyLimit!) return { ok: false, reason: FailReason.LimitReached };
    return this.deliver(goods, `shop.pay.${id}`, this.deps.save.shop.dailyBought, limited);
  }

  refreshIfNeeded(): void {
    const today = this.deps.clock.gameDay();
    if (this.deps.save.shop.dailyRefreshDate === today) return;
    this.deps.save.shop.dailyBought = {};
    this.deps.save.shop.adClaimed = {};
    this.deps.save.shop.dailyRefreshDate = today;
    this.afterChange();
  }

  private viewOf(goods: ShopGoodsConfig): ShopGoodsView {
    const remainingDaily = this.remainingOf(goods);
    const limit = this.effectiveLimit(goods);
    const soldOut = limit !== null && this.usedCount(goods) >= limit;
    const affordable = this.affordableOf(goods);
    let lockReason: string | undefined;
    if (soldOut) lockReason = FailReason.SoldOut;
    else if (!affordable) lockReason = FailReason.Insufficient;
    return {
      config: goods,
      remainingDaily,
      soldOut,
      affordable,
      needAd: goods.viaAd === true,
      lockReason,
    };
  }

  private remainingOf(goods: ShopGoodsConfig): number | null {
    if (goods.dailyLimit === undefined) return null;
    return Math.max(0, goods.dailyLimit - this.usedCount(goods));
  }

  private affordableOf(goods: ShopGoodsConfig): boolean {
    if (goods.price === null) return true;
    if (goods.price.currency === 'CNY') return true;
    return this.currency.canAfford({ [goods.price.currency]: goods.price.amount });
  }

  /** 有效限购：无 dailyLimit 的广告商品视为每日 1 次；普通商品无限购返回 null。 */
  private effectiveLimit(goods: ShopGoodsConfig): number | null {
    if (goods.dailyLimit !== undefined) return goods.dailyLimit;
    return goods.viaAd ? 1 : null;
  }

  private usedCount(goods: ShopGoodsConfig): number {
    const record = goods.viaAd ? this.deps.save.shop.adClaimed : this.deps.save.shop.dailyBought;
    const used = record[goods.id];
    return typeof used === 'number' && Number.isFinite(used) && used > 0 ? used : 0;
  }

  private deliver(
    goods: ShopGoodsConfig,
    source: string,
    record: Record<GoodsId, number>,
    countDaily: boolean,
  ): PurchaseResult {
    this.reward.grant(goods.gain, source);
    if (countDaily) record[goods.id] = (record[goods.id] ?? 0) + 1;
    this.afterChange();
    return { ok: true, reward: goods.gain };
  }

  private afterChange(): void {
    this.deps.events.emit('shop.changed', {});
    this.deps.markDirty();
  }
}
