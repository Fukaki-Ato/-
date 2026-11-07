/**
 * WX verification entry. It boots the shared empty scene and validates config from the asset subpackage.
 * The full game-flow and single-renderer UI integration are intentionally not enabled here yet.
 */
import { loadAllConfig } from '@tr/game/core/config/configLoader.js';
import type { LoadReport } from '@tr/game/core/config/configLoader.js';
import { createWxAdapter } from './platform/wxPlatform.js';
import { getWx } from './platform/wxTypes.js';
import { PKG_ASSETS, loadWxSubpackage, subpackageAssetPath } from './platform/subpackage.js';
import { bootEmptyMain } from '@tr/game/flow/emptyMain.js';

const adapter = createWxAdapter();
const main = bootEmptyMain(adapter);

let configReport: LoadReport | null = null;

/** 分包加载 → 分包内 config 校验链（不阻塞空场景渲染；失败只记日志不崩）。 */
async function loadAssets(): Promise<void> {
  const extras = adapter.extras;
  if (!extras) {
    console.warn('[tr-wx] adapter.extras 缺失（非 wx 运行时？），跳过分包装载链');
    return;
  }
  const cost = await loadWxSubpackage(getWx(), PKG_ASSETS, p => {
    if (p % 25 === 0) console.log(`[tr-wx] subpackage ${PKG_ASSETS} ${p}%`);
  });
  console.log(`[tr-wx] subpackage ${PKG_ASSETS} loaded in ${cost}ms`);
  const report = await loadAllConfig(
    {
      fetchJson: path => extras.readJson(path), // wx 侧：分包/包内文件走 readJson（S8 在此叠 CDN 优先源）
      cacheGet: k => adapter.storage.get(k),
      cacheSet: (k, v) => adapter.storage.set(k, v),
    },
    // 包内 config/game.json 撞微信保留名读不出（wx-runtime-findings #4）：构建期改名 gameplay.json，此处还原
    name => subpackageAssetPath('config', name === 'game' ? 'gameplay.json' : `${name}.json`),
  );
  configReport = report;
  console.log(`[tr-wx] config chain ${JSON.stringify({ ok: report.ok, sources: report.sources, errors: report.errors })}`);
}

loadAssets().catch(e => console.error('[tr-wx] 分包/config 装载失败:', (e as Error).message));

// 调试探针按运行环境门控（审查 W-2）：release 真机包不挂 __trWx、不打 boot log、
// 不跑 2s fps 轮询（污染性能面板录制）。探针基础库缺失时回落 develop，QA 永远可用。
const envVersion = (() => {
  try { return getWx().getAccountInfoSync?.().miniProgram?.envVersion ?? 'develop'; }
  catch { return 'develop'; }
})();
if (envVersion !== 'release') {
  // 开发者工具 Console 探针：__trWx.stats()（fps/尺寸）/ __trWx.configReport()（装载链结果，boot 前为 null）
  // / __trWx.loadAssets()（手动重跑装载链）/ __trWx.dispose()
  (globalThis as Record<string, unknown>).__trWx = { ...main, configReport: () => configReport, loadAssets };
  console.log(`[tr-wx] boot (env=${envVersion})`, JSON.stringify(main.stats()));

  // 每 2s 打一条 fps（性能面板录制 30s 时对照用；S16b 遥测合入后由正式通道接管）
  setInterval(() => console.log('[tr-wx] stats', JSON.stringify(main.stats())), 2000);
}
