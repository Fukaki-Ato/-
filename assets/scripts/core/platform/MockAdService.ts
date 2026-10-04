import type { AdPlacement, AdResult, IAdService } from '../contracts';
import { delay } from '../framework/Utils';

export interface MockAdOptions {
  /** 模拟的观看结果，默认 true（完整观看）。 */
  completed?: boolean;
  /** 模拟播放耗时毫秒，默认 800；测试传 0 可立即返回。 */
  delayMs?: number;
}

export class MockAdService implements IAdService {
  private completed: boolean;
  private delayMs: number;

  constructor(opts: MockAdOptions = {}) {
    this.completed = opts.completed ?? true;
    this.delayMs = Math.max(0, opts.delayMs ?? 800);
  }

  setCompleted(completed: boolean): void {
    this.completed = completed;
  }

  setDelayMs(delayMs: number): void {
    this.delayMs = Math.max(0, delayMs);
  }

  isReady(_placement: AdPlacement): boolean {
    return true;
  }

  preload(_placement: AdPlacement): void {
    // Mock 广告无需预加载
  }

  async show(_placement: AdPlacement): Promise<AdResult> {
    await delay(this.delayMs);
    return { completed: this.completed };
  }
}
