import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryStorage, createSafeStorage } from '../../assets/scripts/core/framework/Storage';

function fakeWebStorage(data: Map<string, string>) {
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('MemoryStorage', () => {
  it('读写删基本行为', () => {
    const storage = new MemoryStorage();
    expect(storage.get('k')).toBeNull();
    storage.set('k', 'v');
    expect(storage.get('k')).toBe('v');
    storage.remove('k');
    expect(storage.get('k')).toBeNull();
  });
});

describe('createSafeStorage', () => {
  it('无宿主 API 时降级为内存存储', () => {
    const storage = createSafeStorage();
    storage.set('a', '1');
    expect(storage.get('a')).toBe('1');
    storage.remove('a');
    expect(storage.get('a')).toBeNull();
  });

  it('优先使用 wx 存储', () => {
    const data = new Map<string, string>();
    vi.stubGlobal('wx', {
      getStorageSync: (key: string) => data.get(key) ?? '',
      setStorageSync: (key: string, value: string) => {
        data.set(key, value);
      },
      removeStorageSync: (key: string) => {
        data.delete(key);
      },
    });
    const web = new Map<string, string>([['a', 'web']]);
    vi.stubGlobal('localStorage', fakeWebStorage(web));

    const storage = createSafeStorage();
    expect(storage.get('a')).toBeNull();
    storage.set('a', '1');
    expect(data.get('a')).toBe('1');
    expect(storage.get('a')).toBe('1');
    storage.remove('a');
    expect(data.has('a')).toBe(false);
  });

  it('wx API 不完整时降级到 localStorage', () => {
    vi.stubGlobal('wx', { getStorageSync: () => 'x' });
    const data = new Map<string, string>();
    vi.stubGlobal('localStorage', fakeWebStorage(data));

    const storage = createSafeStorage();
    storage.set('a', '1');
    expect(data.get('a')).toBe('1');
    expect(storage.get('a')).toBe('1');
  });

  it('wx 与 localStorage 都不可用时降级为内存存储', () => {
    vi.stubGlobal('wx', { getStorageSync: () => 'x' });
    const storage = createSafeStorage();
    storage.set('a', '1');
    expect(storage.get('a')).toBe('1');
  });
});
