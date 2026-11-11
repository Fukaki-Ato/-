import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { createRequire } from 'node:module';
import { capture } from '/root/.config/opencode/skills/cloud-delivery/scripts/capture-core.mjs';

const directory = '/tmp/opencode/thunder-run-B03-verify-20261111';
const web = '/tmp/opencode/thunder-run-site-optimization-20261111/apps/web/dist';
const after = process.argv.includes('--after');
const phase = after ? 'after' : 'before';
const runtimeDir = '/root/.config/opencode/extensions/cloud-capture-runtime';
const { chromium } = createRequire(import.meta.url)(runtimeDir + '/node_modules/playwright-core');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.mp3': 'audio/mpeg' };
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
  if (pathname.startsWith('/api/missions')) {
    const now = Date.now();
    const empty = { periodId: 'B03-fixture', resetsAt: now + 3600000, missions: [] };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(pathname.endsWith('/session') ? { ok: true }
      : { serverTime: now, rewardLedgerId: 'B03-ui-fixture', wallet: {}, daily: empty, weekly: empty }));
    return;
  }
  if (!pathname.startsWith('/thunder-run/')) { res.writeHead(404); res.end(); return; }
  const file = resolve(web, decodeURIComponent(pathname.slice('/thunder-run/'.length)) || 'index.html');
  if (!file.startsWith(web + sep)) { res.writeHead(404); res.end(); return; }
  try { const bytes = await readFile(file); res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream' }); res.end(bytes); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const errors = [];
try {
  const result = await capture({ url: `http://127.0.0.1:${server.address().port}/thunder-run/`,
    output: `${directory}/profile-${phase}.png`, width: 320, height: 568, timeoutMs: 60000,
    allowNoSandbox: process.argv.includes('--allow-no-sandbox') }, { runtimeDir, executablePath: runtimeDir + '/chromium',
    launchPersistentContext: async (profile, options) => {
      const context = await chromium.launchPersistentContext(profile, { ...options, hasTouch: true, isMobile: true, args: ['--enable-unsafe-swiftshader'] });
      const createPage = context.newPage.bind(context);
      context.newPage = async () => {
        const page = await createPage(); page.setDefaultTimeout(20000);
        page.on('pageerror', error => errors.push(error.message));
        await page.addInitScript(() => {
          localStorage.setItem('thunderrun:player-id', '1234567890'); localStorage.setItem('thunderrun:player-name', '小跑者');
          localStorage.setItem('thunderrun:player-renames', '1'); localStorage.setItem('thunderrun:diamonds-total', '60');
          localStorage.setItem('thunderrun:best', '12345');
        });
        const screenshot = page.screenshot.bind(page);
        page.screenshot = async options => {
          try {
            await page.locator('.mobile-lobby').waitFor({ state: 'visible' });
            await page.evaluate(() => document.fonts.ready);
            await page.locator('.lobby-settings').click();
            await page.getByRole('button', { name: '打开玩家档案', exact: true }).click();
            const panel = page.locator('.profile-panel'); await panel.waitFor({ state: 'visible' });
            const metrics = await panel.evaluate(element => {
              const first = element.getBoundingClientRect(); element.scrollTop = element.scrollHeight;
              return { viewportHeight: innerHeight, panelBottom: first.bottom, panelHeight: first.height,
                scrollHeight: element.scrollHeight, clientHeight: element.clientHeight, actualScrollTop: element.scrollTop,
                lastRowBottom: element.querySelector('.profile-inventory-row:last-child').getBoundingClientRect().bottom,
                horizontalOverflow: document.documentElement.scrollWidth > innerWidth };
            });
            if (!after) {
              assert.ok(metrics.panelBottom > metrics.viewportHeight);
              assert.equal(metrics.actualScrollTop, 0);
            } else {
              assert.ok(metrics.actualScrollTop > 0, 'the inventory must actually be reachable by scrolling');
              assert.ok(metrics.panelBottom <= metrics.viewportHeight);
              assert.ok(metrics.lastRowBottom <= metrics.panelBottom);
              assert.equal(metrics.horizontalOverflow, false);
              await writeFile(`${directory}/profile-after-inventory.png`, await screenshot({ type: 'png', animations: 'disabled' }), { flag: 'wx', mode: 0o600 });
              await panel.evaluate(element => { element.scrollTop = 0; });
              assert.equal(await page.locator('.profile-id').textContent(), '本机档案 ID：1234567890');
              assert.match(await page.locator('.profile-scope').textContent(), /浏览器.*榜单/);
              await page.getByRole('button', { name: '闪电少年', exact: true }).click();
              metrics.walletVersion = await page.evaluate(() => JSON.parse(localStorage.getItem('thunderrun:reward-wallet-v1')).version);
              assert.equal(metrics.walletVersion, 2);
              await page.getByRole('button', { name: '关闭档案', exact: true }).focus();
              await page.keyboard.press('Shift+Tab');
              assert.ok(await page.evaluate(() => {
                const rect = document.activeElement.getBoundingClientRect(); return rect.top >= 0 && rect.bottom <= innerHeight;
              }), 'wrapped keyboard focus must scroll into the visible dialog');
              await page.keyboard.press('Tab');
              assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), '关闭档案');
            }
            assert.deepEqual(errors, []);
            await writeFile(`${directory}/profile-${phase}-metrics.json`, JSON.stringify({ phase, scope: 'candidate production bundle; fresh profile; synthetic empty mission API', metrics, errors }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
            return screenshot(options);
          } catch (error) { console.error(error.stack); throw error; }
        };
        return page;
      };
      return context;
    } });
  await writeFile(`${directory}/capture-${phase}.json`, JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify(result));
} finally { server.closeAllConnections(); await new Promise(done => server.close(done)); }
