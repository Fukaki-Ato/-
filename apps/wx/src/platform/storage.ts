/**
 * 同步存储 wx 实现（S10 §4 §3 / D11）。
 * wx.getStorageSync 无记录返回 ''，与「存过空串」不可区分 → 存储值统一包 {"v": value}：
 * get 时解包，raw 为空/非本格式/抛错一律视为无记录返回 null（单测锁定，tests/platform-wx.test.mjs）。
 */
import type { SyncStorage } from '@tr/framework/platform/platformAdapter.js';
import type { WxLike } from './wxTypes.js';

export function createWxStorage(wx: WxLike): SyncStorage {
  return {
    get(key) {
      let raw: unknown;
      try {
        raw = wx.getStorageSync(key);
      } catch {
        return null;
      }
      if (typeof raw !== 'string' || raw === '') return null; // 无记录归一化（D11）
      try {
        const parsed = JSON.parse(raw) as { v?: unknown };
        if (parsed && typeof parsed === 'object' && 'v' in parsed && typeof parsed.v === 'string') return parsed.v;
      } catch {
        /* 非本包写入的历史裸值：原样返回，避免静默丢数据 */
      }
      return raw;
    },
    set(key, value) {
      try {
        wx.setStorageSync(key, JSON.stringify({ v: value })); // 10MB 上限写失败静默（与 web 无痕模式同策略）
      } catch { /* ignore */ }
    },
    remove(key) {
      try {
        wx.removeStorageSync(key);
      } catch { /* ignore */ }
    },
  };
}
