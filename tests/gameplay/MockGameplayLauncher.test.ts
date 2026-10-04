import { afterEach, describe, expect, it, vi } from 'vitest';
import { MockGameplayLauncher } from '../../assets/scripts/core/gameplay/MockGameplayLauncher';

const OPTS = { mode: 'classic', characterId: 'runner_default' };

afterEach(() => {
  vi.useRealTimers();
});

describe('MockGameplayLauncher', () => {
  it('isMock=true 且 preload 立即完成', async () => {
    const launcher = new MockGameplayLauncher({ delayMs: 0, random: () => 0 });
    expect(launcher.isMock).toBe(true);
    await expect(launcher.preload()).resolves.toBeUndefined();
  });

  it('random=0 时取各指标下界', async () => {
    const launcher = new MockGameplayLauncher({ delayMs: 0, random: () => 0 });
    await expect(launcher.launch(OPTS)).resolves.toEqual({
      mode: 'classic',
      score: 300,
      distance: 200,
      coins: 20,
      diamonds: 0,
      durationMs: 60000,
      revivedCount: 0,
    });
  });

  it('random=0.5 时按公式生成确定结果', async () => {
    const launcher = new MockGameplayLauncher({ delayMs: 0, random: () => 0.5 });
    await expect(launcher.launch(OPTS)).resolves.toEqual({
      mode: 'classic',
      score: 1650,
      distance: 700,
      coins: 160,
      diamonds: 2,
      durationMs: 90000,
      revivedCount: 0,
    });
  });

  it('延迟由构造配置控制，delayMs=0 时立即返回', async () => {
    vi.useFakeTimers();
    const launcher = new MockGameplayLauncher({ random: () => 0.5 });
    let settled = false;
    const promise = launcher.launch(OPTS).then((result) => {
      settled = true;
      return result;
    });

    await vi.advanceTimersByTimeAsync(2499);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(promise).resolves.toMatchObject({ score: 1650 });

    vi.useRealTimers();
    const instant = new MockGameplayLauncher({ delayMs: 0, random: () => 0.5 });
    const started = Date.now();
    await instant.launch(OPTS);
    expect(Date.now() - started).toBeLessThan(100);
  });

  it('多次随机结果均为非负整数且在约定区间内', async () => {
    const launcher = new MockGameplayLauncher({ delayMs: 0 });
    for (let i = 0; i < 50; i += 1) {
      const result = await launcher.launch(OPTS);
      expect(Number.isInteger(result.score)).toBe(true);
      expect(result.score).toBeGreaterThanOrEqual(300);
      expect(result.score).toBeLessThanOrEqual(3000);
      expect(result.distance).toBeGreaterThanOrEqual(200);
      expect(result.distance).toBeLessThanOrEqual(1200);
      expect(result.coins).toBeGreaterThanOrEqual(20);
      expect(result.coins).toBeLessThanOrEqual(300);
      expect(result.diamonds).toBeGreaterThanOrEqual(0);
      expect(result.diamonds).toBeLessThanOrEqual(2);
      expect(result.durationMs).toBeGreaterThanOrEqual(60000);
      expect(result.durationMs).toBeLessThanOrEqual(120000);
      expect(result.revivedCount).toBe(0);
      expect(result.mode).toBe('classic');
    }
  });
});
