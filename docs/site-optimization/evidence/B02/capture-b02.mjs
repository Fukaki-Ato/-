import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { createRequire } from 'node:module';
import { capture } from '/root/.config/opencode/skills/cloud-delivery/scripts/capture-core.mjs';

const directory = '/tmp/opencode/thunder-run-B02-verify-20261111';
const web = '/tmp/opencode/thunder-run-site-optimization-20261111/apps/web/dist';
const runtimeDir = '/root/.config/opencode/extensions/cloud-capture-runtime';
const { chromium } = createRequire(import.meta.url)(runtimeDir + '/node_modules/playwright-core');
const fixture = { period: '2026-11-11', claimed: false, coin: 400, resetDelay: 120000, loads: 0, claims: 0 };
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
let decision, started;
const checks = [];
const errors = [];
const snapshot = () => {
  const now = Date.now();
  return { serverTime: now, rewardLedgerId: 'B01-isolated-ui-fixture', wallet: { coin: fixture.coin },
    daily: { periodId: fixture.period, resetsAt: now + fixture.resetDelay, missions: [
      { id: 'runs', title: '完成酷跑', metric: 'runs', progress: 1, target: 1, reward: { coin: 10 }, claimed: fixture.claimed },
    ] }, weekly: { periodId: '2026-11-09', resetsAt: now + 600000, missions: [] } };
};
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.webp': 'image/webp', '.png': 'image/png', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4' };
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
  if (pathname.startsWith('/api/missions')) {
    const send = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (pathname.endsWith('/session')) { send(200, { ok: true }); return; }
    if (pathname.endsWith('/claim')) {
      fixture.claims++; started.resolve();
      const ok = await decision.promise;
      if (!ok) { send(409, { error: '周期已更新' }); return; }
      fixture.claimed = true; fixture.coin += 10; send(200, snapshot()); return;
    }
    fixture.loads++; send(200, snapshot()); return;
  }
  if (!pathname.startsWith('/thunder-run/')) { res.writeHead(404); res.end(); return; }
  const relative = pathname.slice('/thunder-run/'.length) || 'index.html';
  const file = resolve(web, decodeURIComponent(relative));
  if (!file.startsWith(web + sep)) { res.writeHead(404); res.end(); return; }
  try {
    const bytes = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(bytes);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const url = `http://127.0.0.1:${server.address().port}/thunder-run/`;

async function inspect(page, screenshot) {
  const save = async name => writeFile(`${directory}/${name}.png`, await screenshot({ type: 'png', animations: 'disabled' }), { flag: 'wx', mode: 0o600 });
  const active = () => page.evaluate(() => ({ name: document.activeElement.getAttribute('aria-label'), className: document.activeElement.className, id: document.activeElement.id }));
  const startClaim = async () => {
    decision = deferred(); started = deferred();
    const claim = page.locator('.mission-claim');
    await claim.focus(); await claim.press('Enter'); await started.promise;
    assert.match((await active()).className, /mission-card/);
  };
  await page.locator('.mobile-lobby').waitFor({ state: 'visible' });
  await page.evaluate(() => document.fonts.ready);
  await page.locator('.lobby-settings').click();
  const entry = page.getByRole('button', { name: '打开玩家档案', exact: true });
  await entry.focus(); await entry.press('Enter');
  await page.locator('.tr-profile-overlay').waitFor({ state: 'visible' });
  assert.equal(await page.locator('.profile-best').textContent(), '最高得分：12345 分');
  const diamonds = page.locator('.profile-inventory-row').filter({ hasText: '钻石' }).locator('strong');
  assert.equal(await diamonds.textContent(), '60');
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'thunderrun:reward-wallet-v1' && window.__b02FailStorage) throw new DOMException('synthetic quota', 'QuotaExceededError');
      return original.call(this, key, value);
    };
    window.__b02FailStorage = true;
  });
  const profileBefore = await page.evaluate(() => localStorage.getItem('thunderrun:reward-wallet-v1'));
  await page.getByRole('button', { name: '闪电少年', exact: true }).click();
  assert.match(await page.locator('.profile-hint').textContent(), /改名未完成.*保存失败/);
  assert.equal(await page.locator('.profile-name').textContent(), '小跑者');
  assert.equal(await diamonds.textContent(), '60');
  assert.equal(await page.evaluate(() => localStorage.getItem('thunderrun:reward-wallet-v1')), profileBefore);
  await save('profile-storage-failure');
  await page.evaluate(() => { window.__b02FailStorage = false; });
  await page.getByRole('button', { name: '闪电少年', exact: true }).focus();
  await page.keyboard.press('Enter');
  assert.equal(await diamonds.textContent(), '40');
  assert.match(await page.locator('.profile-hint').textContent(), /余额 40/);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('thunderrun:reward-wallet-v1')).values['thunderrun:diamonds-total']), '40');
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('thunderrun:reward-wallet-v1')).local['thunderrun:player-renames']), '2');
  checks.push({ task: 'VAL-03', result: 'pass', storageFailure: 'native adapter swallows synthetic quota; canonical readback detects it', failedRenameUnchanged: true, retryDiamondBalance: 40, retryRenames: 2 });
  checks.push({ task: 'UX-01/02', result: 'pass', score: 12345, diamondsBefore: 60, diamondsAfter: 40 });
  await save('profile-390');
  const close = page.getByRole('button', { name: '关闭档案', exact: true });
  await close.focus(); await page.keyboard.press('Shift+Tab');
  assert.equal((await active()).className, 'profile-name-pick');
  assert.equal(await page.evaluate(() => document.activeElement.textContent), '钻石收藏家');
  await page.keyboard.press('Tab');
  assert.equal((await active()).name, '关闭档案');
  assert.equal(await page.locator('.mobile-settings').evaluate(element => element.inert), true);
  await page.locator('.mobile-settings input').last().focus();
  assert.equal((await active()).name, '关闭档案', 'inert background must reject focus');
  await page.setViewportSize({ width: 320, height: 568 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await save('profile-320');
  await page.keyboard.press('Escape');
  await page.locator('.tr-profile-overlay').waitFor({ state: 'detached' });
  assert.equal((await active()).name, '打开玩家档案');
  assert.equal(await page.locator('.mobile-settings').evaluate(element => element.inert), false);
  checks.push({ task: 'UX-03', result: 'pass', keys: ['Shift+Tab', 'Tab', 'Escape'], backgroundFocusBlocked: true, returnFocus: '打开玩家档案', viewports: ['390x844', '320x568'] });
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '商店', exact: true }).click();
  const buy = page.locator('.shop-product-card[data-listing-id="offer_refill_coin"] .shop-product-action');
  const purchaseBefore = await page.evaluate(() => localStorage.getItem('thunderrun:reward-wallet-v1'));
  await page.evaluate(() => { window.__b02FailStorage = true; });
  await buy.click();
  assert.match(await buy.textContent(), /购买未完成.*保存失败/);
  assert.equal(await page.evaluate(() => localStorage.getItem('thunderrun:reward-wallet-v1')), purchaseBefore);
  await save('shop-storage-failure');
  await page.evaluate(() => { window.__b02FailStorage = false; });
  await page.clock.fastForward(1300);
  await buy.click();
  assert.equal(await buy.textContent(), '购买成功，已存入背包');
  await page.clock.fastForward(1300);
  assert.equal(await page.locator('.shop-wallet').textContent(), '余额：金币 1900 · 钥匙 0 · 钻石 40');
  const purchased = await page.evaluate(() => JSON.parse(localStorage.getItem('thunderrun:reward-wallet-v1')));
  assert.equal(purchased.values['thunderrun:keys-total'], '0');
  assert.deepEqual(Object.entries(purchased.local).filter(([key]) => key.startsWith('thunderrun:shop-limit:offer_refill_coin:')).map(([, count]) => count), ['1']);
  checks.push({ task: 'VAL-02', result: 'pass', failedPurchaseUnchanged: true, retry: { coin: 1900, key: 0, diamond: 40, dailyLimit: 1 }, fixtureApi: true });
  await save('shop-purchase-success');
  await page.locator('.shop-close-button').click();
  await page.getByRole('button', { name: '任务', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.mission-claim')?.disabled === false);
  await startClaim(); decision.resolve(true);
  await page.waitForFunction(() => document.querySelector('.mission-status')?.textContent.includes('领取成功'));
  assert.match((await active()).className, /mission-card/);
  assert.equal(await page.locator('.mission-claim').isDisabled(), true);
  await save('mission-claim-success');

  fixture.claimed = false;
  await page.locator('.mission-refresh').click();
  await page.waitForFunction(() => document.querySelector('.mission-claim')?.disabled === false);
  await startClaim();
  await page.keyboard.press('Tab');
  assert.match((await active()).className, /mission-refresh/);
  decision.resolve(false);
  await page.waitForFunction(() => document.querySelector('.mission-status')?.textContent.includes('领取失败'));
  assert.match((await active()).className, /mission-refresh/, 'a late result must not steal deliberately moved focus');
  checks.push({ task: 'UX-04', result: 'pass', successFocus: 'mission-card', movedFocusRetained: 'mission-refresh', fixtureApi: true });

  fixture.resetDelay = 1000;
  await page.locator('.mission-refresh').click();
  await page.waitForFunction(() => document.querySelector('.mission-claim')?.disabled === false);
  await startClaim();
  const before = fixture.loads;
  await page.clock.fastForward(2100);
  assert.equal(fixture.loads, before, 'expiry must not overlap an unfinished claim');
  fixture.period = '2026-11-12'; fixture.resetDelay = 120000;
  decision.resolve(false);
  await page.waitForFunction(() => document.querySelector('.mission-status')?.textContent.includes('已同步最新任务'));
  assert.equal(fixture.loads, before + 1);
  assert.equal((await active()).id, 'mission-tab-daily');
  assert.match(await page.locator('.mission-status').textContent(), /领取失败.*已同步最新任务/);
  checks.push({ task: 'UX-05', result: 'pass', fixtureApi: true, controlledBrowserClock: true, reloadsAfterBusyExpiry: 1, newPeriodFocus: 'mission-tab-daily' });
  const completed = await page.evaluate(() => JSON.parse(localStorage.getItem('thunderrun:reward-wallet-v1')));
  assert.equal(completed.values['thunderrun:coins-total'], '1910');
  assert.equal(completed.local['thunderrun:player-name'], '闪电少年');
  checks.push({ task: 'VAL-04', result: 'pass', originalImportRetained: true, newRewardDelta: 10, coinAfterSpendingAndNewReward: 1910, localRenamePreserved: true });
  await save('mission-cycle');
  assert.deepEqual(errors, []);
  await writeFile(`${directory}/browser-results.json`, JSON.stringify({ scope: 'candidate production bundle; isolated synthetic mission API; fresh local profile; no production writes', checks, errors }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
}
try {
  const result = await capture({ url, output: `${directory}/final.png`, width: 390, height: 844, timeoutMs: 60000,
    allowNoSandbox: process.argv.includes('--allow-no-sandbox') }, { runtimeDir, executablePath: runtimeDir + '/chromium',
    launchPersistentContext: async (profile, options) => {
      const context = await chromium.launchPersistentContext(profile, { ...options, hasTouch: true, isMobile: true, args: ['--enable-unsafe-swiftshader'] });
      const createPage = context.newPage.bind(context);
      context.newPage = async () => {
        const page = await createPage(); page.setDefaultTimeout(20000);
        page.on('pageerror', error => errors.push(error.message));
        await page.clock.install();
        await page.addInitScript(() => {
          localStorage.setItem('thunderrun:best', '12345'); localStorage.setItem('thunderrun:diamonds-total', '60');
          localStorage.setItem('thunderrun:player-renames', '1'); localStorage.setItem('thunderrun:player-name', '小跑者');
          localStorage.setItem('thunderrun:keys-total', '1');
        });
        const screenshot = page.screenshot.bind(page);
        page.screenshot = async options => { try { await inspect(page, screenshot); } catch (error) { console.error(error.stack); throw error; } return screenshot(options); };
        return page;
      };
      return context;
    } });
  await writeFile(`${directory}/capture-result.json`, JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ ...result, checks }));
} finally {
  server.closeAllConnections(); await new Promise(done => server.close(done));
}
