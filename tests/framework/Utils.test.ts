import { describe, expect, it } from 'vitest';
import { clamp, formatNumber, safeJsonParse, toInt } from '../../assets/scripts/core/framework/Utils';

describe('Utils', () => {
  it('clamp 限制区间', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
  });

  it('toInt 截断并对非有限值返回 0', () => {
    expect(toInt(3.9)).toBe(3);
    expect(toInt(-3.9)).toBe(-3);
    expect(toInt(Number.NaN)).toBe(0);
    expect(toInt(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it('formatNumber 按 万/亿 分级且保留一位小数', () => {
    expect(formatNumber(0)).toBe('0');
    expect(formatNumber(9999)).toBe('9999');
    expect(formatNumber(10000)).toBe('1.0万');
    expect(formatNumber(12345)).toBe('1.2万');
    expect(formatNumber(9999999)).toBe('1000.0万');
    expect(formatNumber(100000000)).toBe('1.0亿');
    expect(formatNumber(123456789)).toBe('1.2亿');
    expect(formatNumber(-12345)).toBe('-1.2万');
    expect(formatNumber(Number.NaN)).toBe('0');
  });

  it('safeJsonParse 解析失败或空输入返回 null', () => {
    expect(safeJsonParse<{ a: number }>('{"a":1}')).toEqual({ a: 1 });
    expect(safeJsonParse('{oops')).toBeNull();
    expect(safeJsonParse(null)).toBeNull();
    expect(safeJsonParse(undefined)).toBeNull();
    expect(safeJsonParse('')).toBeNull();
  });
});
