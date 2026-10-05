import { describe, expect, it } from 'vitest';
import { readWechatExtras } from '../../assets/scripts/ui/platform/wechat/WechatConfig';

describe('readWechatExtras', () => {
  it('空/非法输入返回安全默认值', () => {
    expect(readWechatExtras(undefined)).toEqual({
      cloudEnvId: '',
      adUnits: {},
      pay: { offerId: '', mode: 'goods', env: 0, currencyType: 'CNY', zoneId: '1', buyQuantity: 1 },
      share: { title: undefined, imageUrl: undefined, query: undefined },
      forceLocal: false,
    });
    expect(readWechatExtras('bad').forceLocal).toBe(false);
  });

  it('清洗并映射全部扩展字段', () => {
    const extras = readWechatExtras({
      cloudEnvId: ' env-123 ',
      adUnits: { 'settlement.double': ' ad-1 ', 'shop.free.gold': '', unknown: 'x' },
      pay: { offerId: ' offer-9 ', mode: 'game', env: 1, currencyType: 'CNY', zoneId: '2', buyQuantity: 3.9 },
      share: { title: ' 标题 ', imageUrl: ' img ', query: { from: 'share', bad: 1 } },
      forceLocal: true,
    });
    expect(extras.cloudEnvId).toBe('env-123');
    expect(extras.adUnits).toEqual({ 'settlement.double': 'ad-1' });
    expect(extras.pay).toEqual({ offerId: 'offer-9', mode: 'game', env: 1, currencyType: 'CNY', zoneId: '2', buyQuantity: 3 });
    expect(extras.share).toEqual({ title: '标题', imageUrl: 'img', query: { from: 'share' } });
    expect(extras.forceLocal).toBe(true);
  });

  it('mode 仅接受 game，其余回退 goods；buyQuantity 最小为 1', () => {
    const extras = readWechatExtras({ pay: { mode: 'hack', buyQuantity: -5 } });
    expect(extras.pay.mode).toBe('goods');
    expect(extras.pay.buyQuantity).toBe(1);
  });
});
