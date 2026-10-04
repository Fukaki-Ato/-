import { describe, expect, it } from 'vitest';
import { EventBus } from '../../assets/scripts/core/framework/EventBus';
import { createFakeLogger } from '../helpers';

const toast = (text: string) => ({ text });

describe('EventBus', () => {
  it('on/emit 按注册顺序收到载荷', () => {
    const bus = new EventBus();
    const seen: string[] = [];
    bus.on('toast', (payload) => seen.push(`a:${payload.text}`));
    bus.on('toast', (payload) => seen.push(`b:${payload.text}`));
    bus.emit('toast', toast('hello'));
    expect(seen).toEqual(['a:hello', 'b:hello']);
  });

  it('off 精确移除指定回调，其余回调保留', () => {
    const bus = new EventBus();
    const seen: string[] = [];
    const cbA = () => seen.push('a');
    const cbB = () => seen.push('b');
    bus.on('toast', cbA);
    bus.on('toast', cbB);
    bus.off('toast', cbA);
    bus.emit('toast', toast('x'));
    expect(seen).toEqual(['b']);
  });

  it('off 不传回调时清空该事件全部监听', () => {
    const bus = new EventBus();
    const seen: string[] = [];
    bus.on('toast', () => seen.push('a'));
    bus.on('toast', () => seen.push('b'));
    bus.off('toast');
    bus.emit('toast', toast('x'));
    expect(seen).toEqual([]);
  });

  it('once 只触发一次（即使同一回调再次 emit）', () => {
    const bus = new EventBus();
    let count = 0;
    bus.once('toast', () => {
      count += 1;
    });
    bus.emit('toast', toast('1'));
    bus.emit('toast', toast('2'));
    expect(count).toBe(1);
  });

  it('offTarget 清除指定 target 在各事件下的监听', () => {
    const bus = new EventBus();
    const target = {};
    const seen: string[] = [];
    bus.on('toast', () => seen.push('toast'), target);
    bus.on('currency.changed', () => seen.push('currency'), target);
    bus.on('toast', () => seen.push('keep'));
    bus.offTarget(target);
    bus.emit('toast', toast('x'));
    bus.emit('currency.changed', { gold: 0, diamond: 0, deltaGold: 0, deltaDiamond: 0, reason: 'test' });
    expect(seen).toEqual(['keep']);
  });

  it('单个回调抛错不阻断后续回调并写 error 日志', () => {
    const logger = createFakeLogger();
    const bus = new EventBus(logger);
    const seen: string[] = [];
    bus.on('toast', () => {
      seen.push('bad');
      throw new Error('boom');
    });
    bus.on('toast', () => seen.push('good'));
    expect(() => bus.emit('toast', toast('x'))).not.toThrow();
    expect(seen).toEqual(['bad', 'good']);
    expect(logger.calls).toHaveLength(1);
    expect(logger.calls[0].level).toBe('error');
  });

  it('emit 过程中增删监听不影响本次派发', () => {
    const bus = new EventBus();
    const seen: string[] = [];
    const cbB = () => seen.push('b');
    bus.on('toast', () => {
      seen.push('a');
      bus.off('toast', cbB);
      bus.once('toast', () => seen.push('late'));
    });
    bus.on('toast', cbB);

    bus.emit('toast', toast('1'));
    expect(seen).toEqual(['a', 'b']);

    bus.emit('toast', toast('2'));
    expect(seen).toEqual(['a', 'b', 'a', 'late']);
  });
});
