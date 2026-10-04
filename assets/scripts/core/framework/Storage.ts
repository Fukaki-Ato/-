import type { ILogger, IStorage } from '../contracts';

type WxStorageLike = {
  getStorageSync(key: string): unknown;
  setStorageSync(key: string, value: unknown): void;
  removeStorageSync(key: string): void;
};

type WebStorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

// 宿主全局只做 typeof 探测；探测代码全部封装在本文件内。
declare const wx: WxStorageLike | undefined;
declare const localStorage: WebStorageLike | undefined;

const PROBE_KEY = 'ltkp.storage.probe';

export class MemoryStorage implements IStorage {
  private readonly map = new Map<string, string>();

  get(key: string): string | null {
    const value = this.map.get(key);
    return value === undefined ? null : value;
  }

  set(key: string, value: string): void {
    this.map.set(key, value);
  }

  remove(key: string): void {
    this.map.delete(key);
  }
}

function probe(storage: IStorage): boolean {
  try {
    storage.set(PROBE_KEY, '1');
    const value = storage.get(PROBE_KEY);
    storage.remove(PROBE_KEY);
    return value === '1';
  } catch {
    return false;
  }
}

function wrapWx(log?: ILogger): IStorage | null {
  if (typeof wx === 'undefined') return null;
  const api = wx;
  if (!api) return null;
  if (
    typeof api.getStorageSync !== 'function'
    || typeof api.setStorageSync !== 'function'
    || typeof api.removeStorageSync !== 'function'
  ) {
    return null;
  }
  const storage: IStorage = {
    get(key) {
      try {
        const value = api.getStorageSync(key);
        if (typeof value === 'string') return value === '' ? null : value;
        if (value === undefined || value === null) return null;
        return String(value);
      } catch (err) {
        log?.warn(`wx 存储读取失败：${key}`, err);
        return null;
      }
    },
    set(key, value) {
      try {
        api.setStorageSync(key, value);
      } catch (err) {
        log?.warn(`wx 存储写入失败：${key}`, err);
      }
    },
    remove(key) {
      try {
        api.removeStorageSync(key);
      } catch (err) {
        log?.warn(`wx 存储删除失败：${key}`, err);
      }
    },
  };
  return probe(storage) ? storage : null;
}

function wrapWeb(log?: ILogger): IStorage | null {
  if (typeof localStorage === 'undefined') return null;
  const api = localStorage;
  if (!api) return null;
  if (
    typeof api.getItem !== 'function'
    || typeof api.setItem !== 'function'
    || typeof api.removeItem !== 'function'
  ) {
    return null;
  }
  const storage: IStorage = {
    get(key) {
      try {
        return api.getItem(key);
      } catch (err) {
        log?.warn(`localStorage 读取失败：${key}`, err);
        return null;
      }
    },
    set(key, value) {
      try {
        api.setItem(key, value);
      } catch (err) {
        log?.warn(`localStorage 写入失败：${key}`, err);
      }
    },
    remove(key) {
      try {
        api.removeItem(key);
      } catch (err) {
        log?.warn(`localStorage 删除失败：${key}`, err);
      }
    },
  };
  return probe(storage) ? storage : null;
}

/** 按 wx → localStorage → 内存顺序探测可用存储，失败自动降级。 */
export function createSafeStorage(log?: ILogger): IStorage {
  return wrapWx(log) ?? wrapWeb(log) ?? new MemoryStorage();
}
