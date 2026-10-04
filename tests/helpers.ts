import type { ILogger } from '../assets/scripts/core/contracts';

export interface LogCall {
  level: 'debug' | 'info' | 'warn' | 'error';
  msg: string;
  args: unknown[];
}

export interface FakeLogger extends ILogger {
  calls: LogCall[];
}

export function createFakeLogger(): FakeLogger {
  const calls: LogCall[] = [];
  const push = (level: LogCall['level']) => (msg: string, ...args: unknown[]) => {
    calls.push({ level, msg, args });
  };
  return { calls, debug: push('debug'), info: push('info'), warn: push('warn'), error: push('error') };
}

export const silentLog: ILogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};
