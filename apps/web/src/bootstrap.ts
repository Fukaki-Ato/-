/** Web entry: assemble the platform adapter, UI host, and shared game flow. */
import { createWebPlatform } from './platform/webPlatform.js';
import { createGameFlow } from '@tr/game/flow/mainFlow.js';
import { createOverlayViews } from '@tr/game/ui/overlayViews.js';
import { createUiShell } from './uiShell.js';

const mount = document.getElementById('screen')!;
const debug = location.search.includes('debug');

async function main(): Promise<void> {
  const adapter = createWebPlatform({ mount });
  const shell = await createUiShell(adapter);
  const views = createOverlayViews({ host: shell.host });
  shell.host.start();
  // UI 就绪：撤掉 index.html 的静态占位文案（此后画布之上不再需要 DOM）
  mount.textContent = '';

  const flow = createGameFlow({
    adapter,
    views,
    // config/*.json 由 Vite publicDir 挂载到站点根路径（重设计 §2：config 留仓库根，两端共用）
    configResolve: name => `./${name}.json`,
    debug,
  });

  // 键盘注入（仅 web 壳有物理键盘；wx 不发 key 事件，天然空转）
  adapter.onInput(e => {
    if (e.type === 'key' && e.phase === 'down') views.onKey(e.code);
  });

  // 调试钩子：暴露场景机与最近 seed（?debug 时；局内探针 __trRun.* 由 packages/render 挂载）
  if (debug) {
    (globalThis as Record<string, unknown>).__trMachine = flow.machine;
    (globalThis as Record<string, unknown>).__trSeed = () => flow.currentSeed(); // 同种子复现赛道用
    (globalThis as Record<string, unknown>).__trUi = { shell, views, version: 1 }; // S5：自绘 UI 快照挂载点
  }

  // ---------------- 启动 ----------------
  await flow.boot();
}

main().catch(err => {
  mount.textContent = `启动失败：${err instanceof Error ? err.message : String(err)}`;
});
