#!/usr/bin/env node
/**
 * BG3 切带分析：从主界面 mock 设计稿 assets/resources/images/bg/main.png 导出候选条带裁剪与推荐参数。
 *
 * 用法：
 *   node scripts/bg-eval/analyze-crops.mjs [--port 8931] [--cdp-port 9231]
 *
 * 产物（temp/bg-eval/，已被 .gitignore 忽略，只提交脚本与报告）：
 *   crops/region-*.png   候选条带裁剪（文件名含源图像素坐标）
 *   crops.json           推荐裁剪参数（ParallaxCropSpec 同口径：x/y/w/h 归一化、左上原点 y 向下）
 *   overlay.png          源图缩略 + 候选框示意
 *
 * 实现：脚本内迷你静态服务 + headless Edge + CDP；裁切在页面 canvas 内完成，
 * 避免 file:// 图片污染画布的问题（参考 temp/opencode/s11-smoke.js 的连接方式）。
 */
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const argValue = (name) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : null;
};

const SOURCE_REL = 'assets/resources/images/bg/main.png';
const SOURCE_ABS = join(root, SOURCE_REL);
const OUT_DIR = join(root, 'temp', 'bg-eval');
const CROPS_DIR = join(OUT_DIR, 'crops');
const PORT = Number(argValue('--port') ?? process.env.BG3_ANALYZE_PORT ?? 8931);
const CDP_PORT = Number(argValue('--cdp-port') ?? process.env.BG3_ANALYZE_CDP ?? 9231);
const EDGE = process.env.BG3_EDGE ?? [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find((p) => existsSync(p));

/** 候选区域（归一化，y 自顶部向下）。第二轮探测后做最终边界收敛。 */
const CANDIDATES = [
  { id: 'cloud-p1', x: 0.27, y: 0.29, w: 0.31, h: 0.24, note: '纯净版云带（淡云丝为主）：避开左上椰尖与海鸥群' },
  { id: 'cloud-p2', x: 0.18, y: 0.4, w: 0.39, h: 0.14, note: '团云版云带：含白色团云，下沿避开左下椰冠垂叶' },
  { id: 'wave-p', x: 0.0, y: 0.687, w: 0.19, h: 0.105, note: '最终海浪带：避开海鸥（上沿）与横幅椰叶（右沿）' },
  { id: 'wave-p-tight', x: 0.02, y: 0.69, w: 0.17, h: 0.1, note: '海浪带更收紧版（对照）' },
];

/** 推荐条带：第一轮试探值，视觉复核后更新；字段与 ParallaxLayers.ParallaxCropSpec 同口径。 */
const RECOMMENDED = [
  { x: 0.08, y: 0.26, w: 0.84, h: 0.18, screenHeight: 350, screenY: 313, speed: 8, mirror: true, note: '云带（第一轮试探，待复核）' },
  { x: 0.0, y: 0.635, w: 0.16, h: 0.13, screenHeight: 380, screenY: -482, speed: -14, mirror: true, note: '海浪带（第一轮试探，待复核）' },
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
  const page = '<!doctype html><html><head><meta charset="utf-8"><title>BG3 analyze</title></head><body></body></html>';
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

async function main() {
  if (!existsSync(SOURCE_ABS)) throw new Error(`源图不存在：${SOURCE_ABS}`);
  if (!EDGE) throw new Error('未找到 Edge，可用 BG3_EDGE 环境变量指定 msedge.exe 路径');

  mkdirSync(CROPS_DIR, { recursive: true });
  rmSync(CROPS_DIR, { recursive: true, force: true });
  mkdirSync(CROPS_DIR, { recursive: true });

  const server = await startServer();
  const profile = join(tmpdir(), `bg3-analyze-edge-${process.pid}`);
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
      '--window-size=1100,1700',
      '--enable-unsafe-swiftshader',
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
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
  const evaluate = async (expression) => {
    const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error('eval exception: ' + JSON.stringify(r.exceptionDetails).slice(0, 600));
    return r.result.value;
  };

  await evaluate(`
    window.__imgReady = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => { window.__srcImg = img; resolve([img.naturalWidth, img.naturalHeight]); };
      img.onerror = () => reject(new Error('main.png 加载失败'));
      img.src = '/main.png';
    });
    true;
  `);
  const [srcW, srcH] = await evaluate('window.__imgReady');
  console.log(`[analyze] source=${SOURCE_REL} size=${srcW}x${srcH}`);
  console.log(`[analyze] page=http://127.0.0.1:${PORT}/ cdp=${CDP_PORT}`);

  const saveDataUrl = (dataUrl, file) => {
    const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    const buf = Buffer.from(b64, 'base64');
    writeFileSync(file, buf);
    return buf.length;
  };

  const exported = [];
  for (const c of CANDIDATES) {
    const result = await evaluate(`(() => {
      const r = ${JSON.stringify(c)};
      const img = window.__srcImg;
      const sx = Math.max(0, Math.round(r.x * img.naturalWidth));
      const sy = Math.max(0, Math.round(r.y * img.naturalHeight));
      const sw = Math.min(img.naturalWidth - sx, Math.max(1, Math.round(r.w * img.naturalWidth)));
      const sh = Math.min(img.naturalHeight - sy, Math.max(1, Math.round(r.h * img.naturalHeight)));
      const canvas = document.createElement('canvas');
      canvas.width = sw; canvas.height = sh;
      canvas.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
      return { dataUrl: canvas.toDataURL('image/png'), sx, sy, sw, sh };
    })()`);
    const file = `region-${c.id}-x${result.sx}-y${result.sy}-w${result.sw}-h${result.sh}.png`;
    const bytes = saveDataUrl(result.dataUrl, join(CROPS_DIR, file));
    exported.push({ ...c, pixels: { x: result.sx, y: result.sy, w: result.sw, h: result.sh }, file: `crops/${file}`, bytes });
    console.log(`[analyze] crop ${c.id} -> crops/${file} (${result.sw}x${result.sh}, ${bytes} B)`);
  }

  const overlay = await evaluate(`(() => {
    const img = window.__srcImg;
    const scale = 0.5;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const rects = ${JSON.stringify(CANDIDATES.map((c) => ({ id: c.id, x: c.x, y: c.y, w: c.w, h: c.h })))};
    ctx.lineWidth = 2; ctx.font = '700 14px sans-serif';
    for (const r of rects) {
      const x = r.x * canvas.width, y = r.y * canvas.height, w = r.w * canvas.width, h = r.h * canvas.height;
      ctx.strokeStyle = '#ff2d55'; ctx.strokeRect(x, y, w, h);
      ctx.fillStyle = 'rgba(0,0,0,0.65)'; ctx.fillRect(x, Math.max(0, y - 18), ctx.measureText(r.id).width + 8, 18);
      ctx.fillStyle = '#fff'; ctx.fillText(r.id, x + 4, Math.max(12, y - 5));
    }
    return canvas.toDataURL('image/png');
  })()`);
  const overlayBytes = saveDataUrl(overlay, join(OUT_DIR, 'overlay.png'));
  console.log(`[analyze] overlay -> overlay.png (${overlayBytes} B)`);

  const cropsJson = {
    source: SOURCE_REL,
    sourceSize: [srcW, srcH],
    generatedAt: new Date().toISOString(),
    design: { width: 750, height: 1624, note: 'x/y/w/h 为源图归一化区域，y 自顶部向下；screenY 相对屏幕中心、向上为正；speed 正值向右（设计像素/秒）' },
    recommended: RECOMMENDED,
    candidates: exported,
  };
  writeFileSync(join(OUT_DIR, 'crops.json'), JSON.stringify(cropsJson, null, 2) + '\n');
  console.log(`[analyze] crops.json written: recommended=${RECOMMENDED.length} candidates=${exported.length}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[analyze] FAILED ' + (err && err.stack ? err.stack : err));
    process.exit(2);
  });
