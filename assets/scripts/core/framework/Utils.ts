export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** 截断为整数；非有限值按 0 处理。 */
export function toInt(value: number): number {
  return Number.isFinite(value) ? Math.trunc(value) : 0;
}

/** ≥1 万显示 "x.x万"，≥1 亿显示 "x.x亿"，其余原样输出。 */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '0';
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs >= 100_000_000) return `${sign}${(abs / 100_000_000).toFixed(1)}亿`;
  if (abs >= 10_000) return `${sign}${(abs / 10_000).toFixed(1)}万`;
  return String(value);
}

/** JSON 解析失败或输入为空时返回 null，绝不抛出。 */
export function safeJsonParse<T>(text: string | null | undefined): T | null {
  if (text === null || text === undefined || text === '') return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

declare const setTimeout: (handler: () => void, timeout?: number) => unknown;

/** 等待若干毫秒；ms ≤ 0 时立即 resolve（不创建定时器）。 */
export function delay(ms: number): Promise<void> {
  if (!(ms > 0)) return Promise.resolve();
  return new Promise<void>((resolve) => {
    setTimeout(() => resolve(), ms);
  });
}
