import type { GameplayLaunchOptions, GameplayResult, IGameplayLauncher } from '../contracts';
import { delay } from '../framework/Utils';

export interface MockGameplayOptions {
  /** 模拟一局的耗时毫秒，默认 2500；测试传 0 可立即返回。 */
  delayMs?: number;
  /** 随机源，默认 Math.random；每次 launch 取一个掷点派生全部指标。 */
  random?: () => number;
}

export class MockGameplayLauncher implements IGameplayLauncher {
  readonly isMock = true;

  private readonly delayMs: number;
  private readonly random: () => number;

  constructor(opts: MockGameplayOptions = {}) {
    this.delayMs = Math.max(0, opts.delayMs ?? 2500);
    this.random = opts.random ?? Math.random;
  }

  async preload(): Promise<void> {
    // Mock 玩法无需预加载
  }

  async launch(opts: GameplayLaunchOptions): Promise<GameplayResult> {
    await delay(this.delayMs);
    const r = Math.min(0.999999, Math.max(0, this.random()));
    return {
      mode: opts.mode,
      score: 300 + Math.floor(r * 2700),
      distance: 200 + Math.floor(r * 1000),
      coins: 20 + Math.floor(r * 280),
      diamonds: r < 0.5 ? 0 : 1 + Math.floor(r * 2),
      durationMs: 60000 + Math.floor(r * 60000),
      revivedCount: 0,
    };
  }
}
