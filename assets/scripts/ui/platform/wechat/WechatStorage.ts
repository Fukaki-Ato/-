import type { ILogger, IStorage } from '../../../core/contracts';
import type { WxApi } from './WechatTypes';

/**
 * `IStorage` 的微信实现：`wx.getStorageSync/setStorageSync/removeStorageSync`。
 * 读写异常一律吞掉并返回安全值（读取 null、写入忽略），不阻塞游戏流程。
 */
export class WechatStorage implements IStorage {
  private readonly wx: WxApi;
  private readonly log?: ILogger;

  constructor(wx: WxApi, log?: ILogger) {
    this.wx = wx;
    this.log = log;
  }

  get(key: string): string | null {
    try {
      const value = this.wx.getStorageSync?.(key);
      if (typeof value === 'string') return value === '' ? null : value;
      if (value === undefined || value === null) return null;
      return String(value);
    } catch (err) {
      this.log?.warn(`wx 存储读取失败：${key}`, err);
      return null;
    }
  }

  set(key: string, value: string): void {
    try {
      this.wx.setStorageSync?.(key, value);
    } catch (err) {
      this.log?.warn(`wx 存储写入失败：${key}`, err);
    }
  }

  remove(key: string): void {
    try {
      this.wx.removeStorageSync?.(key);
    } catch (err) {
      this.log?.warn(`wx 存储删除失败：${key}`, err);
    }
  }
}
