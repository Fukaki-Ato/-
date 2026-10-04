import type { DateString, IClock } from '../contracts';

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

export interface ClockOptions {
  /** 时间源，默认 Date.now；测试可注入固定时间。 */
  now?: () => number;
  /** 每日重置小时（0–23），默认 0；gameDay 为该时刻切日。 */
  resetHour?: number;
}

export class Clock implements IClock {
  readonly resetHour: number;
  private readonly nowFn: () => number;

  constructor(opts: ClockOptions = {}) {
    this.nowFn = opts.now ?? (() => Date.now());
    this.resetHour = opts.resetHour ?? 0;
  }

  now(): number {
    return this.nowFn();
  }

  /** 本地时区日期字符串 YYYY-MM-DD。 */
  dateString(at: number = this.now()): DateString {
    const date = new Date(at);
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');
    return `${date.getFullYear()}-${month}-${day}`;
  }

  /** 游戏日：时间戳回退 resetHour 小时后取日期。 */
  gameDay(at: number = this.now()): DateString {
    return this.dateString(at - this.resetHour * HOUR_MS);
  }

  /** 周键：以周一为一周起点，格式 YYYY-Www（周不足两位补零）。 */
  weekKey(at: number = this.now()): string {
    const monday = mondayOf(new Date(at));
    const year = monday.getFullYear();
    const firstMonday = mondayOf(new Date(year, 0, 1));
    const week = Math.round((utcDay(monday) - utcDay(firstMonday)) / 7) + 1;
    return `${year}-W${`${week}`.padStart(2, '0')}`;
  }
}

function mondayOf(date: Date): Date {
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const weekday = (monday.getDay() + 6) % 7;
  monday.setDate(monday.getDate() - weekday);
  return monday;
}

// 仅用年月日构造 UTC 时间戳，避免夏令时造成毫秒偏差。
function utcDay(date: Date): number {
  return Math.round(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS);
}
