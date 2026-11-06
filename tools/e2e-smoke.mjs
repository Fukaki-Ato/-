/**
 * E2E 浏览器冒烟测试（审查后的质量盲区补齐：此前渲染/主链路全靠人工）。
 * 流程：vite preview（需先 npm run build:web）→ 无头 chromium（SwiftShader 软 WebGL）走主链路：
 *   页面加载 → 大厅 DOM → 商店 overlay → 选角 overlay → 开始酷跑 → HUD/局内 canvas 出帧。
 * 全程硬超时防护（无头 GL 下 page.evaluate 可能永久卡死，任何等待都带 timeout）。
 * 用法：npm run test:e2e；CI 可选步骤（浏览器二进制：npx playwright install chromium 一次性准备）。
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const PORT = 8791;
const BASE = `http://127.0.0.1:${PORT}/`;
const WATCHDOG_MS = 150_000;
const fatalErrors = [];

const watchdog = setTimeout(() => {
  console.error('E2E 冒烟失败: 全局看门狗超时（150s）');
  process.exit(3);
}, WATCHDOG_MS);
watchdog.unref();

function step(name, task) {
  const promise = typeof task === 'function' ? task() : task; // 兼容直接 Promise 与任务函数两种传参
  return promise.then(
    () => { console.log(`  ✔ ${name}`); },
    error => { throw new Error(`${name} 失败: ${error?.stack?.slice(0, 300) ?? error}`); },
  );
}

const preview = spawn(process.execPath,
  [join(root, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(PORT), '--strictPort'],
  { cwd: join(root, 'apps/web'), stdio: 'ignore' });

let browser;
try {
  const { chromium } = await import('playwright');
  browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
  console.log('  ✔ chromium 启动');
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(15_000);
  page.on('pageerror', error => fatalErrors.push(`pageerror: ${error.message}`));
  page.on('console', message => { if (message.type() === 'error') fatalErrors.push(`console: ${message.text()}`); });

  await step('加载首页', page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 20_000 }));
  await step('大厅渲染（DOM lobby）', page.locator('.mobile-lobby').waitFor({ state: 'visible', timeout: 25_000 }));
  await step('WebGL 上下文就绪', page.evaluate(() => new Promise((resolve, reject) => {
    const started = Date.now();
    const probe = () => {
      const canvas = document.querySelector('canvas');
      if (canvas && (canvas.getContext('webgl2') || canvas.getContext('webgl'))) { resolve(true); return; }
      if (Date.now() - started > 12_000) { reject(new Error('canvas/WebGL 未就绪')); return; }
      setTimeout(probe, 250);
    };
    probe();
  })));
  await step('打开商店 overlay', async () => {
    await page.locator('.lobby-currency').first().click();
    await page.locator('.tr-shop-overlay').waitFor({ state: 'visible', timeout: 8_000 });
    await page.locator('.shop-close-button, .page-back').first().click();
    await page.locator('.tr-shop-overlay').waitFor({ state: 'hidden', timeout: 8_000 });
  });
  await step('打开选角页', async () => {
    await page.locator('.lobby-runner').click();
    await page.locator('.tr-character-select').waitFor({ state: 'visible', timeout: 8_000 });
    await page.locator('.select-back-button').click();
    await page.locator('.tr-character-select').waitFor({ state: 'hidden', timeout: 8_000 });
  });
  await step('开始酷跑：局内 canvas 持续出帧', async () => {
    await page.locator('.lobby-runner').click();
    await page.locator('.tr-character-select').waitFor({ state: 'visible', timeout: 8_000 });
    await page.locator('.select-start-button').click();
    const canvas = page.locator('canvas').first();
    await canvas.waitFor({ state: 'visible', timeout: 20_000 });
    const a = await canvas.screenshot({ timeout: 8_000 });
    await page.waitForTimeout(600);
    const b = await canvas.screenshot({ timeout: 8_000 });
    if (a.equals(b)) throw new Error('canvas 帧无变化（渲染冻结？）');
  });
  await page.screenshot({ path: join(root, 'tools/e2e-last-run.png'), timeout: 8_000 });
  console.log('  ✔ 截图留档 tools/e2e-last-run.png');

  const serious = fatalErrors.filter(text =>
    !text.includes('favicon') && !text.includes('video') && !text.includes('Video')
    // 网络层资源加载失败（后端未启动时的 /api/ 502、媒体 404）由应用自行降级处理；
    // 真正的脚本错误走 pageerror 通道，不计入这条过滤
    && !text.includes('Failed to load resource'));
  if (serious.length) {
    console.error('  ✗ 页面致命错误:\n' + serious.slice(0, 8).map(text => `    - ${text}`).join('\n'));
    process.exitCode = 1;
  } else {
    console.log('E2E 冒烟通过 ✓');
  }
} catch (error) {
  console.error(`E2E 冒烟失败: ${error.message}`);
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  preview.kill();
  clearTimeout(watchdog);
}
