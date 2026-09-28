/**
 * 空场景主流程（@tr/game，S3 任务 3）——apps/wx 在 UI（S4/S5）落地前的最小接线：
 * 探测 adapter v2 → 渲染 packages/render 的三色道+地平线空场景 → 暴露 __trRun 风格探针。
 * 两端同源：apps/web 也可 ?scene=empty 走这里验证同一路径。
 */
import type { PlatformAdapter } from '@tr/framework/platform/platformAdapter.js';
import { createEmptyScene } from '@tr/game/render/emptyScene.js';
import type { EmptySceneHandle } from '@tr/game/render/emptyScene.js';

export interface EmptyMain {
  adapter: PlatformAdapter;
  scene: EmptySceneHandle;
  stats(): { env: string; fps: number; width: number; height: number; dpr: number };
  dispose(): void;
}

export function bootEmptyMain(adapter: PlatformAdapter): EmptyMain {
  if (adapter.version !== 2) {
    throw new Error(`需要 PlatformAdapter v2（S10 D10），实得 version=${String((adapter as { version?: unknown }).version)}`);
  }
  const scene = createEmptyScene(adapter);
  const size = adapter.canvas.windowSize();
  console.log('[tr] adapter v2 ready', { env: adapter.env, ...size });
  return {
    adapter,
    scene,
    stats() {
      const s = adapter.canvas.windowSize();
      return { env: adapter.env, fps: Math.round(scene.fps()), width: s.width, height: s.height, dpr: s.dpr };
    },
    dispose: () => scene.dispose(),
  };
}
