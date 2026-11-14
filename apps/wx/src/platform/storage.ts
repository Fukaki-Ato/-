/**
 * 同步存储 wx 实现（S10 §4 §3 / D11）。
 * wx.getStorageSync 无记录返回 ''，与「存过空串」不可区分 → 存储值统一包 {"v": value}：
 * get 时解包；默认容错模式在无记录或SDK读取异常时返回 null。交易缓存可选 strict 模式。
 */
import type { SyncStorage } from '@tr/framework/platform/platformAdapter.js';
import type { WxLike } from './wxTypes.js';

/** 普通缓存失败不阻断跑局；交易恢复记录必须显式暴露读写失败。 */
export function createWxStorage(wx: WxLike, options: { strict?: boolean } = {}): SyncStorage {
  return {
    get(key) {
      let raw: unknown;
      try {
        raw = wx.getStorageSync(key);
      } catch (error) {
        if (options.strict) throw error;
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
      } catch (error) { if (options.strict) throw error; }
    },
    remove(key) {
      try {
        wx.removeStorageSync(key);
      } catch (error) { if (options.strict) throw error; }
    },
  };
}
