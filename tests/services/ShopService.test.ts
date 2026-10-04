import { describe, expect, it } from 'vitest';
import { FailReason } from '../../assets/scripts/core/contracts';
import { at, createEconomy, seedSave } from './fixtures';

describe('ShopService', () => {
  it('四页签列表与视图字段（限购/售罄/可购/广告/锁定原因）', async () => {
    const { ctx, shop } = await createEconomy();

    const gold = shop.list('gold');
    expect(gold.map((view) => view.config.id)).toEqual(['ad_gold', 'gold_pack']);
    const ad = gold[0];
    expect(ad.needAd).toBe(true);
    expect(ad.remainingDaily).toBe(2);
    expect(ad.soldOut).toBe(false);
    expect(ad.affordable).toBe(true);
    expect(ad.lockReason).toBeUndefined();

    const pack = gold[1];
    expect(pack.remainingDaily).toBeNull();
    expect(pack.needAd).toBe(false);
    expect(pack.affordable).toBe(false);
    expect(pack.lockReason).toBe(FailReason.Insufficient);

    const diamond = shop.list('diamond');
    expect(diamond.map((view) => view.config.id)).toEqual(['cny_diamond', 'cny_limited']);
    expect(diamond.every((view) => view.affordable)).toBe(true);
    expect(diamond[1].remainingDaily).toBe(1);

    const props = shop.list('props');
    expect(props.map((view) => view.config.id)).toEqual(['limited_prop', 'ad_prop']);
    expect(props[1].needAd).toBe(true);
    expect(props[1].remainingDaily).toBeNull();

    expect(shop.list('special').map((view) => view.config.id)).toEqual(['special_bundle']);

    seedSave(ctx.save, 100, 0);
    expect(shop.list('props')[0].affordable).toBe(true);
  });

  it('普通购买：扣费 + 到账 + 限购计数 + shop.changed', async () => {
    const { ctx, shop } = await createEconomy();
    seedSave(ctx.save, 0, 100);
    const shopEvents: unknown[] = [];
    ctx.events.on('shop.changed', (payload) => shopEvents.push(payload));
    const currencyEvents: Array<{ deltaDiamond: number; reason: string }> = [];
    ctx.events.on('currency.changed', (payload) => currencyEvents.push(payload));

    const result = shop.buy('gold_pack');

    expect(result).toEqual({ ok: true, reward: { gold: 1000 } });
    expect(ctx.save.currency).toEqual({ gold: 1000, diamond: 90 });
    expect(ctx.save.shop.dailyBought.gold_pack).toBe(1);
    expect(shopEvents).toHaveLength(1);
    expect(currencyEvents).toEqual([
      expect.objectContaining({ deltaDiamond: -10, deltaGold: 0, reason: 'shop.buy.gold_pack' }),
      expect.objectContaining({ deltaGold: 1000, deltaDiamond: 0, reason: 'shop.buy.gold_pack' }),
    ]);
  });

  it('余额不足返回 insufficient 且零变更', async () => {
    const { ctx, shop } = await createEconomy();
    const shopEvents: unknown[] = [];
    ctx.events.on('shop.changed', (payload) => shopEvents.push(payload));

    expect(shop.buy('gold_pack')).toEqual({ ok: false, reason: FailReason.Insufficient });
    expect(ctx.save.currency).toEqual({ gold: 0, diamond: 0 });
    expect(ctx.save.shop.dailyBought).toEqual({});
    expect(shopEvents).toHaveLength(0);
  });

  it('每日限购：达到上限返回 limit，视图售罄', async () => {
    const { ctx, shop, inventory } = await createEconomy();
    seedSave(ctx.save, 1000, 0);

    expect(shop.buy('limited_prop')).toEqual({
      ok: true,
      reward: { items: [{ id: 'magnet', count: 1 }] },
    });
    expect(ctx.save.currency.gold).toBe(900);
    expect(inventory.count('magnet')).toBe(1);
    expect(shop.buy('limited_prop')).toEqual({ ok: false, reason: FailReason.LimitReached });

    const view = shop.list('props').find((item) => item.config.id === 'limited_prop');
    expect(view?.remainingDaily).toBe(0);
    expect(view?.soldOut).toBe(true);
    expect(view?.lockReason).toBe(FailReason.SoldOut);
  });

  it('多次限购商品可购买至上限', async () => {
    const { ctx, shop, inventory } = await createEconomy();
    seedSave(ctx.save, 0, 100);

    expect(shop.buy('special_bundle').ok).toBe(true);
    expect(ctx.save.currency).toEqual({ gold: 500, diamond: 55 });
    expect(shop.buy('special_bundle').ok).toBe(true);
    expect(ctx.save.currency).toEqual({ gold: 1000, diamond: 10 });
    expect(inventory.count('magnet')).toBe(4);
    expect(shop.buy('special_bundle')).toEqual({ ok: false, reason: FailReason.LimitReached });
  });

  it('CNY 商品：buy 返回 needPay 不扣费，claimPay 发货且可重复（无限购）', async () => {
    const { ctx, shop } = await createEconomy();

    const result = shop.buy('cny_diamond');
    expect(result).toEqual({ ok: true, needPay: { productId: 'test.diamond.60', priceFen: 600 } });
    expect(ctx.save.currency.diamond).toBe(0);
    expect(ctx.save.shop.dailyBought.cny_diamond).toBeUndefined();

    expect(shop.claimPay('cny_diamond')).toEqual({ ok: true, reward: { diamond: 60 } });
    expect(ctx.save.currency.diamond).toBe(60);
    expect(shop.claimPay('cny_diamond').ok).toBe(true);
    expect(ctx.save.currency.diamond).toBe(120);
  });

  it('CNY 限购商品：claimPay 与 buy 均受限', async () => {
    const { ctx, shop } = await createEconomy();
    expect(shop.claimPay('cny_limited')).toEqual({ ok: true, reward: { diamond: 10 } });
    expect(ctx.save.shop.dailyBought.cny_limited).toBe(1);
    expect(shop.claimPay('cny_limited')).toEqual({ ok: false, reason: FailReason.LimitReached });
    expect(shop.buy('cny_limited')).toEqual({ ok: false, reason: FailReason.LimitReached });
  });

  it('claimAd/claimPay 类型不符或商品不存在返回 unsupported/not_found', async () => {
    const { shop } = await createEconomy();
    expect(shop.claimAd('gold_pack')).toEqual({ ok: false, reason: FailReason.Unsupported });
    expect(shop.claimPay('gold_pack')).toEqual({ ok: false, reason: FailReason.Unsupported });
    expect(shop.buy('ghost')).toEqual({ ok: false, reason: FailReason.NotFound });
    expect(shop.claimAd('ghost')).toEqual({ ok: false, reason: FailReason.NotFound });
    expect(shop.claimPay('ghost')).toEqual({ ok: false, reason: FailReason.NotFound });
  });

  it('广告商品：buy 返回 needAd 不发奖，claimAd 到账，二次受限', async () => {
    const { ctx, shop } = await createEconomy();
    const shopEvents: unknown[] = [];
    ctx.events.on('shop.changed', (payload) => shopEvents.push(payload));

    expect(shop.buy('ad_gold')).toEqual({ ok: true, needAd: true });
    expect(ctx.save.currency.gold).toBe(0);
    expect(ctx.save.shop.adClaimed.ad_gold).toBeUndefined();

    expect(shop.claimAd('ad_gold')).toEqual({ ok: true, reward: { gold: 200 } });
    expect(ctx.save.currency.gold).toBe(200);
    expect(ctx.save.shop.adClaimed.ad_gold).toBe(1);
    expect(shop.claimAd('ad_gold').ok).toBe(true);
    expect(ctx.save.currency.gold).toBe(400);
    expect(shop.claimAd('ad_gold')).toEqual({ ok: false, reason: FailReason.LimitReached });
    expect(shop.buy('ad_gold')).toEqual({ ok: false, reason: FailReason.LimitReached });
    expect(shopEvents).toHaveLength(2);
  });

  it('无 dailyLimit 的广告商品按每日 1 次处理', async () => {
    const { ctx, shop, inventory } = await createEconomy();

    expect(shop.buy('ad_prop')).toEqual({ ok: true, needAd: true });
    expect(shop.claimAd('ad_prop')).toEqual({ ok: true, reward: { items: [{ id: 'revive', count: 1 }] } });
    expect(inventory.count('revive')).toBe(1);
    expect(shop.claimAd('ad_prop')).toEqual({ ok: false, reason: FailReason.LimitReached });

    const view = shop.list('props').find((item) => item.config.id === 'ad_prop');
    expect(view?.remainingDaily).toBeNull();
    expect(view?.soldOut).toBe(true);
    expect(view?.lockReason).toBe(FailReason.SoldOut);
    expect(ctx.save.shop.adClaimed.ad_prop).toBe(1);
  });

  it('跨天刷新：清空计数、更新日期、派发一次 shop.changed', async () => {
    const { ctx, shop } = await createEconomy();
    seedSave(ctx.save, 1000, 0);
    shop.buy('limited_prop');
    shop.claimAd('ad_gold');
    expect(ctx.save.shop.dailyBought.limited_prop).toBe(1);
    expect(ctx.save.shop.adClaimed.ad_gold).toBe(1);
    expect(ctx.save.shop.dailyRefreshDate).toBe('2026-10-04');

    let changed = 0;
    ctx.events.on('shop.changed', () => { changed += 1; });
    ctx.setNow(at(2026, 10, 5));
    shop.refreshIfNeeded();

    expect(ctx.save.shop.dailyRefreshDate).toBe('2026-10-05');
    expect(ctx.save.shop.dailyBought).toEqual({});
    expect(ctx.save.shop.adClaimed).toEqual({});
    expect(changed).toBe(1);

    shop.refreshIfNeeded();
    expect(changed).toBe(1);

    expect(shop.buy('limited_prop').ok).toBe(true);
    ctx.setNow(at(2026, 10, 6));
    shop.list('gold');
    expect(ctx.save.shop.dailyRefreshDate).toBe('2026-10-06');
  });
});
