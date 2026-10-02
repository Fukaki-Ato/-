/**
 * 本机会话（@tr/game）：记住玩家在开始页选的入口（微信登录 / 游客登录），并封装微信登录调用。
 * 微信登录只经注入的 PlatformAdapter.extras.login()：当前 wx 侧实现仍是游客占位（S9 接 code2session），
 * 本模块不做服务端鉴权。web 壳的 extras.login 是本地游客兜底，故仅 env === 'wx' 视为可用，
 * 避免把网页游客误标成「微信登录」。
 */
import type { PlatformAdapter, SyncStorage, WxIdentity } from '@tr/framework/platform/platformAdapter.js';

export type EntryMethod = 'wechat' | 'guest';

/** 入口方式存储键（仅本机记忆，账号级存档在 S9 接 extras.cloud） */
export const ENTRY_KEY = 'thunderrun:entry';

export function readEntry(storage: SyncStorage): EntryMethod | null {
  const v = storage.get(ENTRY_KEY);
  return v === 'wechat' || v === 'guest' ? v : null;
}

export function saveEntry(storage: SyncStorage, method: EntryMethod): void {
  storage.set(ENTRY_KEY, method);
}

/** 入口方式的展示文案（与开始页按钮同名） */
export function entryLabel(method: EntryMethod | null): string {
  return method === 'wechat' ? '微信登录' : method === 'guest' ? '游客登录' : '未选择';
}

/** 微信登录是否可用：wx 环境且注入了 extras.login */
export function wechatAvailable(adapter: Pick<PlatformAdapter, 'env' | 'extras'>): boolean {
  return adapter.env === 'wx' && typeof adapter.extras?.login === 'function';
}

/** 经注入的 extras.login() 登录；不可用或登录失败一律 reject（由调用方停留开始页并提示） */
export async function wechatLogin(adapter: Pick<PlatformAdapter, 'env' | 'extras'>): Promise<WxIdentity> {
  if (!wechatAvailable(adapter)) throw new Error('当前环境不支持微信登录');
  return adapter.extras!.login();
}
