import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createMissionHttpServer } from '../../../../apps/server/src/http.mjs';
import { createLeaderboardServer } from '../../../../server/index.mjs';
import { loadMissionContent } from '../../../../apps/server/src/content.mjs';
import { capture } from '/root/.config/opencode/skills/cloud-delivery/scripts/capture-core.mjs';

const directory = process.env.TR_B05_EVIDENCE_DIR;
if (!directory) throw new Error('Set TR_B05_EVIDENCE_DIR to a fresh private output directory');
const web = fileURLToPath(new URL('../../../../apps/web/dist', import.meta.url));
const runtimeDir = '/root/.config/opencode/extensions/cloud-capture-runtime';
const { chromium } = createRequire(import.meta.url)(runtimeDir + '/node_modules/playwright-core');
const types = { '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
  '.webp': 'image/webp', '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.mp3': 'audio/mpeg' };
let publicContent = loadMissionContent(), mission, ranking, missionPort, rankingPort, phase = 'matched-A';
const receipts = [], errors = [];
const front = createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
  const entry = pathname === '/thunder-run/' || pathname === '/thunder-run/index.html';
  const port = pathname.startsWith('/api/missions') ? missionPort : entry || pathname.startsWith('/thunder-run/api/') ? rankingPort : null;
  if (port !== null) {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    const requestPhase = phase;
    const upstream = request({ host: '127.0.0.1', port, path: req.url, method: req.method,
      headers: { ...req.headers, 'x-real-ip': '127.0.0.1' } }, response => {
      response.on('end', () => {
        let data = {}; try { data = body ? JSON.parse(body) : {}; } catch {}
        receipts.push({ phase: requestPhase, method: req.method,
          path: pathname.replace(/\/runs\/[0-9a-f-]{36}\/finish/i, '/runs/:id/finish'), status: response.statusCode,
          ...(data.clientRulesId ? { clientRulesId: data.clientRulesId } : {}), ...(data.rulesId ? { rulesId: data.rulesId } : {}) });
      });
      res.writeHead(response.statusCode, response.headers); response.pipe(res);
    });
    upstream.on('error', error => { errors.push(`local proxy: ${error.code}`); res.writeHead(502); res.end(); });
    req.pipe(upstream); return;
  }
  if (!pathname.startsWith('/thunder-run/')) { res.writeHead(404); res.end(); return; }
  const relative = decodeURIComponent(pathname.slice('/thunder-run/'.length));
  const config = /^([a-z]+)\.json$/.exec(relative)?.[1];
  if (config && Object.hasOwn(publicContent, config)) {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(publicContent[config])); return;
  }
  const file = resolve(web, relative);
  if (!file.startsWith(web + sep)) { res.writeHead(404); res.end(); return; }
  try {
    const bytes = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(bytes);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(done => front.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${front.address().port}`;
async function startBackends(content) {
  mission = createMissionHttpServer({ dbPath: directory + '/browser-missions.sqlite', publicOrigin: origin,
    trustedProxy: '127.0.0.1', content: structuredClone(content), trustedReplayRuntimeHashes: [] });
  await new Promise(done => mission.server.listen(0, '127.0.0.1', done)); missionPort = mission.server.address().port;
  ranking = await createLeaderboardServer({ dbPath: directory + '/browser-ranking.sqlite', origins: [origin],
    content: structuredClone(content), webRoot: web, secureCookie: false, allowDebugPages: false, workerCount: 1, maxQueue: 2 });
  await ranking.listen(0, '127.0.0.1'); rankingPort = ranking.server.address().port;
}
const checks = [];
async function inspect(page, screenshot) {
  const response = path => page.waitForResponse(value => new URL(value.url()).pathname === path && value.request().method() === 'POST');
  const begin = async () => {
    const ranked = response('/thunder-run/api/runs'), tasked = response('/api/missions/runs');
    await page.locator('.lobby-start').click();
    const result = await Promise.all([ranked, tasked]);
    await page.locator('.mobile-hud').waitFor({ state: 'visible' });
    return result.map(value => value.status());
  };
  await page.locator('.mobile-lobby').waitFor({ state: 'visible' });
  await page.evaluate(() => document.fonts.ready);
  assert.deepEqual(await begin(), [201, 201]);
  await page.waitForFunction(() => parseInt(document.querySelector('.hud-distance')?.textContent ?? '0') > 0, undefined, { timeout: 45000 });
  checks.push({ phase, result: 'pass', rankingStart: 201, missionStart: 201 });
  const finished = page.waitForResponse(value => /\/api\/missions\/runs\/[^/]+\/finish$/.test(new URL(value.url()).pathname));
  const cancelled = response('/thunder-run/api/runs/cancel');
  const lobbySync = page.waitForResponse(value => new URL(value.url()).pathname === '/api/missions' && value.request().method() === 'GET');
  await page.keyboard.press('Escape');
  assert.equal((await finished).status(), 200); await cancelled; await lobbySync;
  await page.locator('.mobile-lobby').waitFor({ state: 'visible' });
  const before = mission.store.db.prepare('SELECT COUNT(*) AS n FROM runs').get().n;

  // Model a new immutable publication with changed public configuration and freshly started backends.
  phase = 'stale-page-A-on-B';
  await mission.close(); mission = null; await ranking.close(); ranking = null;
  publicContent = structuredClone(publicContent); publicContent.game.params.score.perMeter++;
  await startBackends(publicContent);
  assert.deepEqual(await begin(), [409, 409]);
  assert.equal(mission.store.db.prepare('SELECT COUNT(*) AS n FROM runs').get().n, before);
  await page.keyboard.press('Escape');
  await page.locator('.mobile-lobby').waitFor({ state: 'visible' });
  await page.getByRole('button', { name: '任务', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.mission-status')?.textContent.includes('刷新页面'));
  const feedback = await page.locator('.mission-status').textContent();
  assert.match(feedback, /游戏规则已更新.*刷新页面/);
  await writeFile(`${directory}/refresh-required.png`, await screenshot({ type: 'png', animations: 'disabled' }), { flag: 'wx', mode: 0o600 });
  checks.push({ phase, result: 'pass', rankingStart: 409, missionStart: 409, newMissionTickets: 0, feedback });

  phase = 'refreshed-B'; await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('.mobile-lobby').waitFor({ state: 'visible' });
  assert.deepEqual(await begin(), [201, 201]);
  assert.equal(mission.store.db.prepare('SELECT COUNT(*) AS n FROM runs').get().n, before + 1);
  checks.push({ phase, result: 'pass', rankingStart: 201, missionStart: 201 });
  assert.deepEqual(errors, []);
  await writeFile(`${directory}/browser-results.json`, JSON.stringify({ scope: 'candidate production bundle, real isolated mission/ranking backends, fresh profile; controlled publication config B; no production writes', checks, receipts, errors }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
}
try {
  await startBackends(publicContent);
  const result = await capture({ url: origin + '/thunder-run/', output: `${directory}/matched-after-refresh.png`,
    width: 390, height: 844, timeoutMs: 60000, allowNoSandbox: process.argv.includes('--allow-no-sandbox') }, {
    runtimeDir, executablePath: runtimeDir + '/chromium', launchPersistentContext: async (profile, options) => {
      const context = await chromium.launchPersistentContext(profile, { ...options, hasTouch: true, isMobile: true, args: ['--enable-unsafe-swiftshader'] });
      const createPage = context.newPage.bind(context);
      context.newPage = async () => {
        const page = await createPage(); page.setDefaultTimeout(25000);
        page.on('pageerror', error => errors.push(error.message));
        const screenshot = page.screenshot.bind(page);
        page.screenshot = async options => { try { await inspect(page, screenshot); } catch (error) { console.error(error.stack); throw error; } return screenshot(options); };
        return page;
      };
      return context;
    } });
  await writeFile(`${directory}/capture-result.json`, JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ ...result, checks }));
} finally {
  if (mission) await mission.close(); if (ranking) await ranking.close();
  front.closeAllConnections(); await new Promise(done => front.close(done));
}
