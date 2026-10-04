import type { ILogger } from '../contracts';

const PREFIX = '[LTKP]';

type LogMethod = (...args: unknown[]) => void;

export interface LogSink {
  debug: LogMethod;
  info: LogMethod;
  warn: LogMethod;
  error: LogMethod;
}

export interface LoggerOptions {
  /** 是否输出 debug 日志，默认关闭；Boot 阶段按 app.json 的 debug 字段打开。 */
  enabled?: boolean;
  /** 日志落点，默认 console；测试可注入假实现。 */
  sink?: LogSink;
}

const noopSink: LogSink = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

function defaultSink(): LogSink {
  const sink = (globalThis as unknown as { console?: LogSink }).console;
  return sink ?? noopSink;
}

export class Logger implements ILogger {
  private on: boolean;
  private readonly sink: LogSink;

  constructor(opts: LoggerOptions = {}) {
    this.on = opts.enabled ?? false;
    this.sink = opts.sink ?? defaultSink();
  }

  get enabled(): boolean {
    return this.on;
  }

  setEnabled(enabled: boolean): void {
    this.on = enabled;
  }

  debug(msg: string, ...args: unknown[]): void {
    if (!this.on) return;
    this.sink.debug(`${PREFIX} ${msg}`, ...args);
  }

  info(msg: string, ...args: unknown[]): void {
    this.sink.info(`${PREFIX} ${msg}`, ...args);
  }

  warn(msg: string, ...args: unknown[]): void {
    this.sink.warn(`${PREFIX} ${msg}`, ...args);
  }

  error(msg: string, ...args: unknown[]): void {
    this.sink.error(`${PREFIX} ${msg}`, ...args);
  }
}
