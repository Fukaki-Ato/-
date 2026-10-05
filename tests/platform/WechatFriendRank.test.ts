import { describe, expect, it } from 'vitest';
import { WechatFriendRank } from '../../assets/scripts/ui/platform/wechat/WechatFriendRank';
import type { WxApi } from '../../assets/scripts/ui/platform/wechat/WechatTypes';
import { silentLog } from '../helpers';

describe('WechatFriendRank', () => {
  it('开放数据域可用时发送 render/hide 消息', () => {
    const messages: unknown[] = [];
    const wx: WxApi = {
      getOpenDataContext: () => ({ postMessage: (message) => messages.push(message) }),
    };
    const bridge = new WechatFriendRank(wx, silentLog);
    expect(bridge.render({ top: 20, title: '好友榜' })).toBe(true);
    expect(bridge.hide()).toBe(true);
    expect(messages).toEqual([
      { type: 'render', top: 20, title: '好友榜' },
      { type: 'hide' },
    ]);
  });

  it('非微信/未配置开放数据域时安全降级', () => {
    const bridge = new WechatFriendRank({}, silentLog);
    expect(bridge.render()).toBe(false);
    expect(bridge.hide()).toBe(false);
    expect(new WechatFriendRank(null, silentLog).render()).toBe(false);
  });
});
