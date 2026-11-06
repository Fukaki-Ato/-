/**
 * wx 任务 API（M5-3）：MissionApiCore 的 wx 装配——wx.request 传输 + storage 队列 + cookie jar。
 * 小游戏请求不自动管理 cookie：从响应 Set-Cookie 收集会话键值对持久化到 storage，后续请求回传
 * Cookie 头（HttpOnly 语义由原生层保证；jar 只存会话键值，不含其它路径的敏感头）。
 */
import type { SyncStorage } from '@tr/framework/platform/platformAdapter.js';
import { MissionApiCore, type MissionQueueStorage, type MissionTransport } from '@tr/game/flow/missionApiCore.js';
import type { WxLike } from './wxTypes.js';

const COOKIE_JAR_KEY = 'thunderrun:mission-cookie';
const REQUEST_TIMEOUT_MS = 15000;

type CookieJar = Record<string, string>;

function loadJar(storage: SyncStorage): CookieJar {
  try {
    const raw: unknown = JSON.parse(storage.get(COOKIE_JAR_KEY) ?? '{}');
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as CookieJar : {};
  } catch { return {}; }
}

function saveJar(storage: SyncStorage, jar: CookieJar): void {
  storage.set(COOKIE_JAR_KEY, JSON.stringify(jar));
}

/** 从响应头收集 Set-Cookie（不同基础库可能是单串或数组），合并进 jar */
function absorbSetCookie(jar: CookieJar, header: Record<string, unknown> | undefined): void {
  if (!header) return;
  const raw = header['Set-Cookie'] ?? header['set-cookie'];
  const list = Array.isArray(raw) ? raw.map(String) : typeof raw === 'string' ? [raw] : [];
  for (const line of list) {
    const pair = line.split(';', 1)[0] ?? '';
    const eq = pair.indexOf('=');
    if (eq <= 0) continue;
    jar[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
  }
}

function cookieHeader(jar: CookieJar): string {
  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
}

function wxRequest(wx: WxLike, url: string, method: 'GET' | 'POST', header: Record<string, string>, data?: unknown):
  Promise<{ statusCode: number; data: unknown; header: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    wx.request({
      url, method, header, data, dataType: 'json', timeout: REQUEST_TIMEOUT_MS,
      success: res => resolve({ statusCode: res.statusCode, data: res.data, header: res.header ?? {} }),
      fail: err => reject(new Error(`wx.request 失败: ${err.errMsg}`)),
    });
  });
}

export function createWxMissionApi(wx: WxLike, storage: SyncStorage): MissionApiCore {
  const jar = loadJar(storage);
  const transport: MissionTransport = {
    async request(path, method, body) {
      const header: Record<string, string> = {};
      const cookie = cookieHeader(jar);
      if (cookie) header.Cookie = cookie;
      if (body !== undefined) header['Content-Type'] = 'application/json';
      const res = await wxRequest(wx, `/api/missions${path}`, method, header, body);
      absorbSetCookie(jar, res.header);
      saveJar(storage, jar);
      return { status: res.statusCode, data: res.data };
    },
  };
  const queueStorage: MissionQueueStorage = {
    get: key => storage.get(key),
    set: (key, value) => storage.set(key, value),
  };
  return new MissionApiCore(transport, queueStorage);
}
