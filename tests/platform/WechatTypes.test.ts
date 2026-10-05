import { describe, expect, it } from 'vitest';
import { getGlobalWx } from '../../assets/scripts/ui/platform/wechat/WechatTypes';

/**
 * 回归背景（S11 终验收发现）：
 * 曾因 `const x = wx` 先求值再判断，导致浏览器/编辑器等非微信环境启动即抛
 * `ReferenceError: wx is not defined`。本用例保证裸调用安全。
 */
describe('getGlobalWx', () => {
  it('非微信环境（无 wx 全局）返回 null 且不抛异常', () => {
    expect(getGlobalWx()).toBeNull();
  });

  it('存在 wx 全局时返回同一对象', () => {
    const fake = { getStorageSync: (key: string) => key };
    (globalThis as unknown as { wx?: unknown }).wx = fake;
    try {
      expect(getGlobalWx()).toBe(fake);
    } finally {
      delete (globalThis as unknown as { wx?: unknown }).wx;
    }
  });
});
