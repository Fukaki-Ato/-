/** Web entry: assemble the platform adapter, UI host, and shared game flow. */
import { createWebPlatform } from './platform/webPlatform.js';
import { createGameFlow } from '@tr/game/flow/mainFlow.js';
import { createOverlayViews } from '@tr/game/ui/overlayViews.js';
import { createUiShell } from './uiShell.js';
import '../style.css';
import { createCharacterSelectOverlay } from './characterSelectOverlay.js';
import { createShopOverlay } from './shopOverlay.js';
import { createTestPanel } from './testPanel.js';

const mount = document.getElementById('screen')!;
const debug = location.search.includes('debug');
/** 测试模式：?debug 或 ?test 都开（左侧技能开关面板 + 局内 __trTest API） */
const testMode = debug || location.search.includes('test');

async function main(): Promise<void> {
  const adapter = createWebPlatform({ mount });
  const shell = await createUiShell(adapter);
  const views = createOverlayViews({
    host: shell.host, badges: shell.badges, backdrop: shell.backdrop,
    onLobbyVisible: v => shell.setBackgroundVisible(v), // 背景视频只在大厅解码
    selectRenderer: (content, actions, currentCharId, entry) =>
      createCharacterSelectOverlay(content, actions, currentCharId, entry, shell.fonts),
    shopRenderer: (content, actions) => createShopOverlay(content, actions, shell.fonts),
  });
  shell.host.start();
  // UI 就绪：撤掉 index.html 的静态占位文案；角色选择页与商店按需挂载 Web DOM overlay
  mount.textContent = '';

  const flow = createGameFlow({
    adapter,
    views,
    // config/*.json 由 Vite publicDir 挂载在部署 base 下（本地 dev 为 /，测试站为 /thunder-run/）
    configResolve: name => `${import.meta.env.BASE_URL}${name}.json`,
    debug,
    test: testMode,
  });

  // 测试模式面板（?debug/?test）：左侧技能开关，数据面为 __trTest（mainFlow 在 run 局挂载）
  const testPanel = createTestPanel();
  if (testMode) (globalThis as Record<string, unknown>).__trTestPanel = testPanel; // 调试期可手动 dispose
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
