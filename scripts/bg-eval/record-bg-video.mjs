#!/usr/bin/env node
/**
 * BG3 代理视频录制（主会话接管完成）：用 canvas 2D 复刻「云带 + 海浪带」循环动画并录制为 webm。
 *
 * 用法：
 *   node scripts/bg-eval/record-bg-video.mjs
 *
 * 产物：
 *   temp/bg-eval/bg-test.webm   540×1170、30fps、8 秒、静音、无缝循环
 *
 * 说明：
 * - 条带参数与 `assets/scripts/ui/panels/ParallaxLayers.ts` 的 DEFAULT_PARALLAX_CROPS 同一口径（已校准）。
 * - 为保证金循环无缝，代理片用「正弦往复漂移」而不是匀速滚动（sin 在 t=0 与 t=8s 完全一致）；
 *   视差模式是匀速单向滚动；正式视频由美术按首尾帧对齐制作。
 * - 实现：脚本内迷你静态服务（避免 file:// 污染画布）+ headless Edge + CDP；
 *   下载落盘用 Browser.setDownloadBehavior（失败回退 Page.setDownloadBehavior，再回退文件轮询）。
 */
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SOURCE_REL = 'assets/resources/images/bg/main.png';
const SOURCE_ABS = join(root, SOURCE_REL);
const OUT_DIR = join(root, 'temp', 'bg-eval');
const OUT_FILE = join(OUT_DIR, 'bg-test.webm');
const PORT = Number(process.env.BG3_RECORD_PORT ?? 8932);
const CDP_PORT = Number(process.env.BG3_RECORD_CDP ?? 9232);
const EDGE = process.env.BG3_EDGE ?? [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find((p) => existsSync(p));

const VIDEO_W = 540;
const VIDEO_H = 1170;
const FPS = 30;
const DURATION = 8;
const SCALE = VIDEO_W / 750;
const SKY = '#4ec3f7';
const SAND = '#f5d07a';

/** 与 ParallaxLayers.DEFAULT_PARALLAX_CROPS 同口径（y 自顶部向下；screenY 相对屏幕中心、向上为正）。 */
const BANDS = [
  { key: 'cloud', x: 0.27, y: 0.29, w: 0.31, h: 0.24, screenHeight: 350, screenY: 313, amp: 30, phase: 0 },
  { key: 'wave', x: 0.0, y: 0.687, w: 0.19, h: 0.105, screenHeight: 380, screenY: -482, amp: 50, phase: Math.PI / 2 },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
}

async function connectWs(url) {
  const ws = new WebSocket(url);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  return ws;
}

function startServer() {
  const page = '<!doctype html><html><head><meta charset="utf-8"><title>BG3 record</title></head><body></body></html>';
  const server = createServer((req, res) => {
    const pathname = new URL(req.url, `http://127.0.0.1:${PORT}`).pathname;
    if (pathname === '/' || pathname === '/index.html') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(page);
      return;
    }
    if (pathname === '/main.png') {
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'no-store');
      res.end(readFileSync(SOURCE_ABS));
      return;
    }
    res.statusCode = 404;
    res.end('not found');
  });
  return new Promise((resolvePromise, rejectPromise) => {
    server.once('error', rejectPromise);
    server.listen(PORT, '127.0.0.1', () => resolvePromise(server));
  });
}

async function waitForStableFile(file, timeoutMs) {
  const t0 = Date.now();
  let lastSize = -1;
  let stableSince = 0;
  while (Date.now() - t0 < timeoutMs) {
    if (existsSync(file)) {
      const size = statSync(file).size;
      if (size > 0 && size === lastSize) {
        if (Date.now() - stableSince > 800) return size;
      } else {
        lastSize = size;
        stableSince = Date.now();
      }
    }
    await sleep(400);
  }
  return existsSync(file) ? statSync(file).size : -1;
}

async function main() {
  if (!existsSync(SOURCE_ABS)) throw new Error(`源图不存在：${SOURCE_ABS}`);
  if (!EDGE) throw new Error('未找到 Edge，可用 BG3_EDGE 环境变量指定 msedge.exe 路径');

  mkdirSync(OUT_DIR, { recursive: true });
  rmSync(OUT_FILE, { force: true });

  const server = await startServer();
  const profile = join(tmpdir(), `bg3-record-edge-${process.pid}`);
  rmSync(profile, { recursive: true, force: true });

  const edge = spawn(
    EDGE,
    [
      '--headless=new',
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--hide-scrollbars',
      '--window-size=800,1400',
      '--autoplay-policy=no-user-gesture-required',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
  const cleanup = () => {
    try { spawnSync('taskkill', ['/PID', String(edge.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* ignore */ }
    try { server.close(); } catch { /* ignore */ }
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
  };
  process.on('exit', cleanup);

  let target = null;
  for (let i = 0; i < 60 && !target; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page') ?? null;
    } catch { /* retry */ }
    if (!target) await sleep(500);
  }
  if (!target) throw new Error('CDP page target 未就绪');

  const cdp = new CDP(await connectWs(target.webSocketDebuggerUrl));
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  try {
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: OUT_DIR, eventsEnabled: true });
    console.log('[record] Browser.setDownloadBehavior OK');
  } catch (err) {
    console.log('[record] Browser.setDownloadBehavior 失败，回退 Page.setDownloadBehavior：' + String(err).slice(0, 120));
    await cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: OUT_DIR });
  }

  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
  await sleep(600);

  const evaluate = async (expression) => {
    const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error('eval exception: ' + JSON.stringify(r.exceptionDetails).slice(0, 600));
    return r.result.value;
  };

  const pageScript = `(function () {
    const VIDEO_W = ${VIDEO_W}, VIDEO_H = ${VIDEO_H}, FPS = ${FPS}, DURATION = ${DURATION}, SCALE = ${SCALE};
    const SKY = ${JSON.stringify(SKY)}, SAND = ${JSON.stringify(SAND)};
    const BANDS = ${JSON.stringify(BANDS)};
    window.__rec = {
      done: null,
      start() {
        if (this.done) return this.done;
        this.done = new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => {
            try {
              const canvas = document.createElement('canvas');
              canvas.width = VIDEO_W; canvas.height = VIDEO_H;
              document.body.appendChild(canvas);
              const ctx = canvas.getContext('2d');

              const parts = BANDS.map((b) => {
                const sx = Math.round(b.x * img.naturalWidth);
                const sy = Math.round(b.y * img.naturalHeight);
                const sw = Math.max(1, Math.round(b.w * img.naturalWidth));
                const sh = Math.max(1, Math.round(b.h * img.naturalHeight));
                const c = document.createElement('canvas');
                c.width = sw; c.height = sh;
                c.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
                const drawH = b.screenHeight * SCALE;
                const drawW = drawH * (sw / sh);
                const cy = (1624 - (812 + b.screenY)) * SCALE;
                return { cv: c, w: drawW, h: drawH, cy: cy, amp: b.amp * SCALE, phase: b.phase };
              });

              const drawBlock = (p, x) => ctx.drawImage(p.cv, x, p.cy - p.h / 2, p.w, p.h);

              const render = (t) => {
                ctx.fillStyle = SKY; ctx.fillRect(0, 0, VIDEO_W, VIDEO_H);
                ctx.fillStyle = SAND; ctx.fillRect(0, Math.round(VIDEO_H * 0.9), VIDEO_W, VIDEO_H);
                for (const p of parts) {
                  const off = p.amp * Math.sin((2 * Math.PI * t) / DURATION + p.phase);
                  const period = 2 * p.w;
                  const wrapped = ((off % period) + period) % period;
                  for (let k = -2; ; k += 1) {
                    const x = wrapped + k * p.w;
                    if (x > VIDEO_W) break;
                    if (k % 2 === 0) drawBlock(p, x);
                    else {
                      ctx.save();
                      ctx.translate(x + p.w, p.cy - p.h / 2);
                      ctx.scale(-1, 1);
                      ctx.drawImage(p.cv, 0, 0, p.w, p.h);
                      ctx.restore();
                    }
                  }
                }
              };

              const types = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
              const mime = types.find((x) => window.MediaRecorder && MediaRecorder.isTypeSupported(x)) || '';
              const stream = canvas.captureStream(FPS);
              const rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 4000000 } : undefined);
              const chunks = [];
              rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
              rec.onstop = () => {
                try {
                  const blob = new Blob(chunks, { type: mime || 'video/webm' });
                  const a = document.createElement('a');
                  a.href = URL.createObjectURL(blob);
                  a.download = 'bg-test.webm';
                  document.body.appendChild(a);
                  a.click();
                  resolve({ mime: mime || 'default', bytes: blob.size });
                } catch (e) { reject(e); }
              };
              rec.onerror = (e) => reject(new Error('MediaRecorder error: ' + (e.error ? e.error.name : 'unknown')));

              const t0 = performance.now();
              render(0);
              rec.start(500);
              const tick = (now) => {
                const t = (now - t0) / 1000;
                if (t >= DURATION) { rec.stop(); return; }
                render(t);
                requestAnimationFrame(tick);
              };
              requestAnimationFrame(tick);
            } catch (e) { reject(e); }
          };
          img.onerror = () => reject(new Error('main.png 加载失败'));
          img.src = '/main.png';
        });
        return this.done;
      },
    };
    true;
  })()`;
  await evaluate(pageScript);
  console.log(`[record] 开始录制（${VIDEO_W}x${VIDEO_H} @${FPS}fps，${DURATION}s，静态服务 :${PORT}）`);
  const result = await evaluate('window.__rec.start()');
  console.log(`[record] 页面侧完成：mime=${result.mime} blob=${(result.bytes / 1024).toFixed(0)}KB，等待落盘…`);

  const bytes = await waitForStableFile(OUT_FILE, 30000);
  if (bytes <= 0) throw new Error(`未收到下载产物：${OUT_FILE}`);
  console.log(`[record] OK -> ${OUT_FILE} (${(bytes / 1024 / 1024).toFixed(2)} MB)`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[record] FAILED ' + (err && err.stack ? err.stack : err));
    process.exit(2);
  });
