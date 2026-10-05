import type { ILogger } from '../../../core/contracts';
import type { WxApi } from './WechatTypes';

/**
 * 主域 → 开放数据域通信桥（docs/05 §4.3）。
 *
 * 开放数据域入口见 `assets/openDataContext/index.js`：主域 postMessage 后，
 * 开放域通过 `wx.getFriendCloudStorage` 读取托管数据并把好友榜绘制到共享画布（sharedCanvas）。
 * 当前排行榜面板仍消费云端数据（好友榜降级为世界榜），本桥预留为后续共享画布 UI 接入点。
 */

export interface FriendRankRenderOptions {
  top?: number;
  title?: string;
}

export class WechatFriendRank {
  private readonly wx: WxApi | null;
  private readonly log?: ILogger;

  constructor(wx: WxApi | null, log?: ILogger) {
    this.wx = wx;
    this.log = log;
  }

  /** 请求开放数据域渲染好友榜；返回是否成功发出消息。 */
  render(opts: FriendRankRenderOptions = {}): boolean {
    return this.post({ type: 'render', top: opts.top ?? 50, title: opts.title ?? '好友排行榜' });
  }

  /** 隐藏开放数据域排行榜。 */
  hide(): boolean {
    return this.post({ type: 'hide' });
  }

  private post(message: Record<string, unknown>): boolean {
    try {
      const context = this.wx?.getOpenDataContext?.();
      if (!context || typeof context.postMessage !== 'function') {
        this.log?.debug('开放数据域不可用（非微信环境或未配置子域）');
        return false;
      }
      context.postMessage(message);
      return true;
    } catch (err) {
      this.log?.warn('开放数据域消息发送失败', err);
      return false;
    }
  }
}
