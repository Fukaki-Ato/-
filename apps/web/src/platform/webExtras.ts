/**
 * WxExtras 的网页兜底实现（S10 契约 §4 映射表 extras 行 / D7）。
 * 目的：业务代码可无分支调用 adapter.extras，网页调试壳全流程不被 wx 能力缺失卡死。
 * 语义：login→本地游客、share→console、cloud 存档→localStorage 镜像（callFunction/submitScore
 * reject 'unsupported'）、readJson→fetchJson、readBinary→fetch().arrayBuffer()、
 * urlParams→location.search（?anim= 锁动作 / ?char= 锁角色的 QA 入口，wx 侧无此概念）。
 */
import type { CloudBridge, PlatformExtras, SyncStorage, WxIdentity } from '@tr/framework/platform/platformAdapter.js';

const OPENID_KEY = 'thunderrun:…penid';
const PROGRESS_PREFIX = 'thunderrun:progress:';

/** web 壳游客身份：本地生成测试 openid 并持久（与 wx 侧 S9 前的占位游客策略同构）。 */
async function webLogin(storage: SyncStorage): Promise<WxIdentity> {
  let id = storage.get(OPENID_KEY);
  if (!id) {
    id = 'web-guest-' + Math.random().toString(36).slice(2, 10);
    storage.set(OPENID_KEY, id);
  }
  return { openid: id, isGuest: true };
}

export function createWebExtras(deps: {
  storage: SyncStorage;
  fetchJson: (url: string) => Promise<unknown>;
}): PlatformExtras {
  const { storage } = deps;
  const unsupported = (name: string) => new Error(`unsupported (web 壳无 wx 云能力): ${name}`);

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
    login: () => webLogin(storage),
    share: opts => { console.log('[platform-web] share（web 壳仅记录）:', opts); },
    cloud,
    readJson: url => deps.fetchJson(url),
    async readBinary(path) {
      const res = await fetch(path, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${path}`);
      return res.arrayBuffer();
    },
    // QA 参数入口：render 层读 ?anim= 锁动作 clip；微信端无 location.search，这个字段缺省
    urlParams: new URLSearchParams(location.search),
    // showRewardAd / requestSubscribeMessage 不提供（S10 §4：web 侧缺省，S9.4 仅 wx 预留）
  };
}
