/**
 * WxExtras 的 wx 侧实现（S10 §4 §WxExtras 行）。
 * 现状（S3）：readJson/readBinary 走 network.ts 真实装（S6 分包/CDN 时接构建产物路径）；
 * login/share/cloud 为**占位**（S8/S9 实装），但保证「不崩、可在 devtools 走完流程」：
 * - login：调 wx.login 拿 code（观察链路），openid 暂用本机持久化的游客串（S9 换 code2session）；
 * - share：透传 wx.shareAppMessage（真机生效）；结算页带分口令的编排留 S9；
 * - cloud：save/loadProgress 落 storage 兜底；callFunction/submitScore reject 'unsupported'（S9 接云开发）；
 * - showRewardAd / requestSubscribeMessage：IAP/订阅消息按 S10 仅预留，不实装（成员缺省）。
 */
import type { CloudBridge, SyncStorage, WxExtras, WxIdentity } from '@tr/framework/platform/platformAdapter.js';
import { wxReadBinary, wxReadJson } from './network.js';
import type { WxLike } from './wxTypes.js';

const OPENID_KEY = 'thunderrun:wx…penid';
const PROGRESS_PREFIX = 'thunderrun:progress:';

function loginForCode(wx: WxLike): Promise<string> {
  return new Promise((resolve, reject) => {
    wx.login({ success: res => resolve(res.code), fail: err => reject(new Error(`wx.login 失败: ${err.errMsg}`)) });
  });
}

export function createWxExtras(wx: WxLike, storage: SyncStorage): WxExtras {
  const unsupported = (name: string) => new Error(`unsupported (S9 接云开发): ${name}`);

  const cloud: CloudBridge = {
    callFunction: async name => { throw unsupported(`callFunction ${name}`); },
    saveProgress: async (key, data) => { storage.set(PROGRESS_PREFIX + key, JSON.stringify(data ?? null)); },
    loadProgress: async key => {
      const raw = storage.get(PROGRESS_PREFIX + key);
      if (raw === null) return null;
      try { return JSON.parse(raw); } catch { return null; }
    },
    submitScore: async () => { throw unsupported('submitScore'); },
  };

  return {
    // 占位：真 code 先取到（验证 wx.login 链路可用），openid 用本机持久游客串顶替，S9 换云函数 code2session。
    async login(): Promise<WxIdentity> {
      let code = '';
      try { code = await loginForCode(wx); } catch (e) { console.warn('[platform-wx] login 占位降级:', (e as Error).message); }
      let id = storage.get(OPENID_KEY);
      if (!id) {
        id = 'wx-guest-' + (code ? code.slice(0, 6) : Math.random().toString(36).slice(2, 8));
        storage.set(OPENID_KEY, id);
      }
      return { openid: id, isGuest: true };
    },
    share(opts) {
      try {
        wx.shareAppMessage({ title: opts.title, query: opts.query, imageUrl: opts.imageUrl });
      } catch (e) {
        console.warn('[platform-wx] share 失败:', (e as Error).message);
      }
    },
    cloud,
    readJson: path => wxReadJson(wx, path),
    readBinary: path => wxReadBinary(wx, path),
  };
}
