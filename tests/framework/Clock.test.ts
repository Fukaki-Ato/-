import { describe, expect, it } from 'vitest';
import { Clock } from '../../assets/scripts/core/framework/Clock';

const at = (year: number, month: number, day: number, hour = 0, minute = 0) =>
  new Date(year, month - 1, day, hour, minute).getTime();

describe('Clock', () => {
  it('now 使用注入的时间源', () => {
    const clock = new Clock({ now: () => 123 });
    expect(clock.now()).toBe(123);
  });

  it('dateString 输出本地时区 YYYY-MM-DD 并补零', () => {
    const clock = new Clock({ now: () => at(2026, 1, 5, 8, 3) });
    expect(clock.dateString()).toBe('2026-01-05');
    expect(clock.dateString(at(2026, 12, 31, 23, 59))).toBe('2026-12-31');
  });

  it('gameDay 在 resetHour=0 的午夜边界切换', () => {
    const clock = new Clock({ now: () => 0 });
    expect(clock.resetHour).toBe(0);
    expect(clock.gameDay(at(2026, 10, 4, 23, 59))).toBe('2026-10-04');
    expect(clock.gameDay(at(2026, 10, 5, 0, 0))).toBe('2026-10-05');
  });

  it('gameDay 在 resetHour=5 的重置点切换', () => {
    const clock = new Clock({ now: () => 0, resetHour: 5 });
    expect(clock.resetHour).toBe(5);
    expect(clock.gameDay(at(2026, 10, 5, 4, 59))).toBe('2026-10-04');
    expect(clock.gameDay(at(2026, 10, 5, 5, 0))).toBe('2026-10-05');
  });

  it('weekKey：周一到周日同 key，跨周不同', () => {
    const clock = new Clock({ now: () => at(2026, 9, 28, 12) });
    const monday = clock.weekKey(at(2026, 9, 28, 0, 1));
    const sunday = clock.weekKey(at(2026, 10, 4, 23, 59));
    expect(monday).toBe(sunday);
    expect(monday).toBe('2026-W40');
    expect(clock.weekKey(at(2026, 10, 5, 0, 1))).toBe('2026-W41');
    expect(monday).toMatch(/^\d{4}-W\d{2}$/);
  });

  it('weekKey：跨年周仍保持稳定', () => {
    const clock = new Clock({ now: () => 0 });
    // 2026-12-28（周一）与 2027-01-03（周日）同属一周。
    expect(clock.weekKey(at(2026, 12, 28, 12))).toBe(clock.weekKey(at(2027, 1, 3, 12)));
  });
});
