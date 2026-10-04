import type { GameEventMap, IEventBus, ILogger } from '../contracts';

type EventKey = keyof GameEventMap;

// 内部对监听器做类型擦除，公开 API 由 IEventBus 的泛型签名保证类型安全。
interface Listener {
  cb: (payload: any) => void;
  target?: unknown;
  once: boolean;
}

export class EventBus implements IEventBus {
  private readonly listeners = new Map<EventKey, Listener[]>();
  private readonly log?: ILogger;

  constructor(log?: ILogger) {
    this.log = log;
  }

  on<K extends EventKey>(event: K, cb: (payload: GameEventMap[K]) => void, target?: unknown): void {
    this.add(event, cb, target, false);
  }

  once<K extends EventKey>(event: K, cb: (payload: GameEventMap[K]) => void, target?: unknown): void {
    this.add(event, cb, target, true);
  }

  off<K extends EventKey>(event: K, cb?: (payload: GameEventMap[K]) => void, target?: unknown): void {
    const list = this.listeners.get(event);
    if (!list) return;
    const kept = list.filter((listener) => {
      const cbMatched = cb === undefined || listener.cb === cb;
      const targetMatched = target === undefined || listener.target === target;
      return !(cbMatched && targetMatched);
    });
    if (kept.length === 0) this.listeners.delete(event);
    else this.listeners.set(event, kept);
  }

  offTarget(target: unknown): void {
    for (const [event, list] of this.listeners) {
      const kept = list.filter((listener) => listener.target !== target);
      if (kept.length === 0) this.listeners.delete(event);
      else this.listeners.set(event, kept);
    }
  }

  emit<K extends EventKey>(event: K, payload: GameEventMap[K]): void {
    const list = this.listeners.get(event);
    if (!list || list.length === 0) return;
    // 遍历副本：回调中增删监听不影响本次派发。
    const snapshot = list.slice();
    for (const listener of snapshot) {
      if (listener.once) this.remove(event, listener);
      try {
        listener.cb(payload);
      } catch (err) {
        this.log?.error(`事件回调异常：${event}`, err);
      }
    }
  }

  private add(event: EventKey, cb: (payload: any) => void, target: unknown, once: boolean): void {
    const listener: Listener = { cb, target, once };
    const list = this.listeners.get(event);
    if (list) list.push(listener);
    else this.listeners.set(event, [listener]);
  }

  private remove(event: EventKey, listener: Listener): void {
    const list = this.listeners.get(event);
    if (!list) return;
    const index = list.indexOf(listener);
    if (index < 0) return;
    list.splice(index, 1);
    if (list.length === 0) this.listeners.delete(event);
  }
}
