import type * as THREE from 'three';
import { createGameFlow, type GameFlow } from '@tr/game/flow/mainFlow.js';
import { createRunnerScene } from '@tr/game/render/runnerScene.js';
import { createWxGameViews } from './gameViews.js';
import { createWxFrameLoop } from './frameLoop.js';
import { createWxUiShell } from './uiShell.js';
import { subpackageAssetPath } from './platform/subpackage.js';
import type { WxRuntime } from './platform/runtime.js';

type Runtime = Pick<WxRuntime, 'adapter' | 'resources' | 'loadAssets' | 'bindInput' | 'connectCloud' | 'createModelLoader' | 'uiInsets'>;

/** 小游戏完整主流程：先加载资源分包，再在共享 renderer 上绘制游戏与自绘 UI。 */
export async function bootWxGame(runtime: Runtime, renderer?: THREE.WebGLRenderer) {
  await runtime.loadAssets();
  const configResolve = (name: string): string => subpackageAssetPath('config', `${name}.json`);
  const gameJson = await runtime.resources.loadJson(configResolve('game'));
  const cloud = await runtime.connectCloud(await runtime.resources.loadJson('cloud.config.json'));
  const adapter = { ...runtime.adapter, fetchJson: (path: string) =>
    path === configResolve('game') ? Promise.resolve(gameJson) : runtime.resources.loadJson(path) };
  const loop = createWxFrameLoop(adapter);
  let shell: Awaited<ReturnType<typeof createWxUiShell>>;
  try {
    shell = await createWxUiShell({ ...adapter, ...loop.ui }, runtime.resources, gameJson, renderer, runtime.uiInsets);
  } catch (error) { loop.dispose(); throw error; }
  let flow: GameFlow;
  const views = createWxGameViews(shell.host, { portraits: shell.portraits },
    cloud ?? undefined, cloud?.welfare, () => flow.finishRun(), cloud?.commerce);
  flow = createGameFlow({
    adapter: { ...adapter, ...loop.game }, views, configResolve,
    account: cloud ?? undefined, leaderboard: cloud?.leaderboard,
    createScene: (surface, platform, sim, content, callbacks, options) =>
      createRunnerScene(surface, platform, sim, content, callbacks, {
        ...options, renderer: shell.renderer, createModelLoader: runtime.createModelLoader,
      }),
  });
  // 业务手势先注册：触发“开始”的 touchend 不会同时变成新跑局的技能输入。
  const unbind = runtime.bindInput(input => shell.pushInput(input));
  const dispose = (): void => {
    unbind(); flow.dispose(); views.dispose(); shell.dispose(); loop.dispose();
  };
  shell.host.start();
  try {
    await flow.boot();
    if (flow.machine.current() !== 'select') throw new Error('游戏配置加载失败，请重新加载资源后重试。');
  }
  catch (error) { dispose(); throw error; }
  console.log('[tr-wx] game flow ready', flow.machine.current());
  return { flow, host: shell.host, cloud, dispose };
}
