import { describe, expect, it } from 'vitest';
import { Logger } from '../../assets/scripts/core/framework/Logger';

describe('Logger', () => {
  it('[LTKP] 前缀；debug 默认关闭，setEnabled 后开启', () => {
    const lines: string[] = [];
    const sink = {
      debug: (...args: unknown[]) => {
        lines.push(`debug:${String(args[0])}`);
      },
      info: (...args: unknown[]) => {
        lines.push(`info:${String(args[0])}`);
      },
      warn: (...args: unknown[]) => {
        lines.push(`warn:${String(args[0])}`);
      },
      error: (...args: unknown[]) => {
        lines.push(`error:${String(args[0])}`);
      },
    };
    const log = new Logger({ sink });
    expect(log.enabled).toBe(false);

    log.debug('hidden');
    log.info('shown');
    log.warn('warned');
    log.error('failed');
    expect(lines).toEqual(['info:[LTKP] shown', 'warn:[LTKP] warned', 'error:[LTKP] failed']);

    log.setEnabled(true);
    expect(log.enabled).toBe(true);
    log.debug('visible');
    expect(lines[3]).toBe('debug:[LTKP] visible');
  });

  it('附加参数透传给日志落点', () => {
    const calls: unknown[][] = [];
    const sink = {
      debug: (...args: unknown[]) => calls.push(args),
      info: (...args: unknown[]) => calls.push(args),
      warn: (...args: unknown[]) => calls.push(args),
      error: (...args: unknown[]) => calls.push(args),
    };
    const log = new Logger({ sink, enabled: true });
    log.info('值', 42);
    expect(calls).toEqual([['[LTKP] 值', 42]]);
  });
});
