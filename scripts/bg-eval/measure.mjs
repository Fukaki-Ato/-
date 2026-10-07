#!/usr/bin/env node
/**
 * BG5 对比测量脚本：headless Edge + CDP，对主界面动态背景 ?bg=static|parallax|video 做相对开销采样。
 *
 * 用法：
 *   node scripts/bg-eval/measure.mjs --serve "F:\\OpenCode Projects\\雷霆酷跑\\build\\web-desktop"
 *   node scripts/bg-eval/measure.mjs --url http://127.0.0.1:8934/ --no-serve --modes static
 *
 * 参数（CLI 优先，可回退同名环境变量）：
 *   --url <url>       页面地址，默认 http://127.0.0.1:8934/（BG_EVAL_URL）
 *   --serve <dir>     内置静态服务根目录，默认 build/web-desktop（BG_EVAL_SERVE）；相对路径按当前工作目录解析
 *   --no-serve        关闭内置静态服务（BG_EVAL_NO_SERVE=1）
 *   --modes <list>    逗号分隔模式列表，默认 static,parallax,video（BG_EVAL_MODES）
 *   --out <dir>       输出目录，默认 temp/bg-eval（BG_EVAL_OUT）
 *   --timeout <sec>   单模式总超时秒数，默认 90（BG_EVAL_TIMEOUT）
 *
 * 输出：
 *   <out>/measure-report.json      每模式一条测量结果（每完成一个模式即落盘）
 *   <out>/shots/<mode>.png         每模式主界面截图
 *
 * 说明：
 *   - 每个模式独立 headless Edge 进程与临时 profile；模式失败不中断整体，记录错误继续。
 *   - 统计面板（3.8.8）实际为离屏 canvas + 纹理节点，不是 DOM 文本；脚本优先扫 DOM，
 *     否则读取 cc.profiler 计数器（即面板显示值的来源），再用 GFX 设备计数兜底；
 *     字段缺失一律记 null，并保留 stats.text / counters / device 原始数据便于排查。
 */
import { spawn, spawnSync } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { extname, join, normalize, relative, resolve, sep } from 'node:path';

const args = process.argv.slice(2);
const hasFlag = (flag) => args.includes(flag);
const argValue = (name) => {
  const index = args.indexOf(name);
  if (index < 0) return null;
  const value = args[index + 1];
  return value && !value.startsWith('--') ? value : null;
};

const url = argValue('--url') ?? process.env.BG_EVAL_URL ?? 'http://127.0.0.1:8934/';
const noServe = hasFlag('--no-serve') || process.env.BG_EVAL_NO_SERVE === '1';
const serveDirArg = argValue('--serve') ?? process.env.BG_EVAL_SERVE ?? 'build/web-desktop';
const modes = (argValue('--modes') ?? process.env.BG_EVAL_MODES ?? 'static,parallax,video')
  .split(',').map((item) => item.trim()).filter(Boolean);
const outDir = resolve(argValue('--out') ?? process.env.BG_EVAL_OUT ?? 'temp/bg-eval');
const timeoutArg = Number(argValue('--timeout') ?? process.env.BG_EVAL_TIMEOUT ?? 90);
const modeTimeoutMs = (Number.isFinite(timeoutArg) ? Math.max(10, timeoutArg) : 90) * 1000;

const EDGE = [
  process.env.BG_EVAL_EDGE,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean).find((candidate) => existsSync(candidate));

const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
const log = (...parts) => console.log('[bg-eval]', ...parts);
const msg = (error) => (error && error.message ? error.message : String(error));
const round2 = (value) => (value === null || value === undefined || !Number.isFinite(Number(value)) ? null : Math.round(Number(value) * 100) / 100);
const fmt = (value, digits) => (value === null || value === undefined || !Number.isFinite(Number(value)) ? 'n/a' : Number(value).toFixed(digits));
const safeName = (name) => name.replace(/[^A-Za-z0-9._-]+/g, '_');
const relPath = (file) => {
  const rel = relative(process.cwd(), file).split(sep).join('/');
  return rel && !rel.startsWith('..') ? rel : file.split(sep).join('/');
};

function deadlineRace(promise, deadline, label) {
  const remainMs = deadline - Date.now();
  if (remainMs <= 0) return Promise.reject(new Error(`${label} 超时`));
  let timer = null;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} 超时`)), remainMs);
  });
  return Promise.race([promise, timeout]).finally(() => { if (timer) clearTimeout(timer); });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.bin': 'application/octet-stream',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
  '.plist': 'application/xml',
};

function startStaticServer(root, host, port) {
  const rootLower = root.toLowerCase();
  const server = createServer((req, res) => {
    try {
      const requestUrl = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
      let pathname = decodeURIComponent(requestUrl.pathname);
      if (pathname.endsWith('/')) pathname += 'index.html';
      const file = normalize(join(root, pathname));
      const fileLower = file.toLowerCase();
      if (fileLower !== rootLower && !fileLower.startsWith(rootLower + sep)) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('403');
        return;
      }
      let info = null;
      try { info = statSync(file); } catch { info = null; }
      if (!info || !info.isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('404');
        return;
      }
      const headers = {
        'Content-Type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
        'Cache-Control': 'no-store',
        'Accept-Ranges': 'bytes',
      };
      const rangeMatch = req.headers.range ? /^bytes=(\d*)-(\d*)$/.exec(req.headers.range.trim()) : null;
      if (rangeMatch) {
        let start = rangeMatch[1] ? Number(rangeMatch[1]) : 0;
        let end = rangeMatch[2] ? Number(rangeMatch[2]) : info.size - 1;
        if (!rangeMatch[1] && rangeMatch[2]) {
          start = Math.max(0, info.size - Number(rangeMatch[2]));
          end = info.size - 1;
        }
        if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= info.size) {
          res.writeHead(416, { ...headers, 'Content-Range': `bytes */${info.size}` });
          res.end();
          return;
        }
        end = Math.min(end, info.size - 1);
        res.writeHead(206, { ...headers, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${info.size}` });
        if (req.method === 'HEAD') { res.end(); return; }
        createReadStream(file, { start, end }).pipe(res);
        return;
      }
      res.writeHead(200, { ...headers, 'Content-Length': info.size });
      if (req.method === 'HEAD') { res.end(); return; }
      createReadStream(file).pipe(res);
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end(`500 ${msg(error)}`);
    }
  });
  return new Promise((resolvePromise, reject) => {
    server.on('error', (error) => reject(new Error(`静态服务监听 ${host}:${port} 失败：${error.message}`)));
    server.listen(port, host, () => resolvePromise(server));
  });
}

function freeTcpPort() {
  return new Promise((resolvePromise, reject) => {
    const probe = createNetServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const port = probe.address().port;
      probe.close(() => resolvePromise(port));
    });
  });
}

class CdpClient {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 0;
    this.pending = new Map();
    this.events = [];
    ws.addEventListener('message', (event) => {
      const payload = JSON.parse(event.data);
      if (payload.id && this.pending.has(payload.id)) {
        const { resolve: resolvePromise, reject } = this.pending.get(payload.id);
        this.pending.delete(payload.id);
        if (payload.error) reject(new Error(JSON.stringify(payload.error)));
        else resolvePromise(payload.result);
      } else if (payload.method) {
        if (this.events.length < 3000) this.events.push(payload);
      }
    });
    ws.addEventListener('close', () => {
      for (const { reject } of this.pending.values()) reject(new Error('CDP 连接已关闭'));
      this.pending.clear();
    });
  }

  send(method, params = {}) {
    if (this.ws.readyState !== 1) return Promise.reject(new Error('CDP 未连接'));
    const id = ++this.nextId;
    return new Promise((resolvePromise, reject) => {
      this.pending.set(id, { resolve: resolvePromise, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    try { this.ws.close(); } catch { /* ignore */ }
  }
}

const EDGE_FLAGS_BASE = [
  '--headless=new',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-extensions',
  '--enable-unsafe-swiftshader',
  '--use-angle=swiftshader',
  '--hide-scrollbars',
  '--window-size=800,1400',
  '--autoplay-policy=no-user-gesture-required',
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows',
  '--enable-precise-memory-info',
];

let activeEdge = null;

function launchEdge(port, profileDir) {
  return spawn(
    EDGE,
    [...EDGE_FLAGS_BASE, `--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`, 'about:blank'],
    { stdio: 'ignore' },
  );
}

function killEdge(child) {
  if (!child || child.exitCode !== null) return;
  try { spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', timeout: 15000 }); } catch { /* ignore */ }
  try { child.kill('SIGKILL'); } catch { /* ignore */ }
}

process.on('exit', () => killEdge(activeEdge));

async function listPageTarget(port, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await response.json();
      const page = targets.find((target) => target.type === 'page');
      if (page) return page;
    } catch { /* retry */ }
    await sleep(300);
  }
  throw new Error('CDP target 未就绪（Edge 启动失败？）');
}

async function evaluate(cdp, expression, deadline, label) {
  const result = await deadlineRace(
    cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }),
    deadline,
    label,
  );
  if (result.exceptionDetails) {
    throw new Error(`${label} 页面异常：${JSON.stringify(result.exceptionDetails).slice(0, 500)}`);
  }
  return result.result.value;
}

async function waitExpr(cdp, expression, timeoutMs, deadline, label) {
  const localDeadline = Math.min(deadline, Date.now() + timeoutMs);
  while (Date.now() < localDeadline) {
    try {
      const value = await evaluate(cdp, expression, localDeadline, label);
      if (value) return value;
    } catch { /* 页面忙或暂不可用，继续轮询 */ }
    await sleep(300);
  }
  return null;
}

const HELPER_SCRIPT = `
window.__smoke = {
  scene() { return window.cc && cc.director ? cc.director.getScene() : null; },
  walk(visit) {
    const s = this.scene();
    if (!s) return;
    (function rec(n) { if (!n.activeInHierarchy) return; visit(n); for (const c of n.children) rec(c); })(s);
  },
  labels() {
    const out = [];
    this.walk((n) => { const l = n.getComponent(cc.Label); if (l && l.string) out.push(l.string); });
    return out;
  },
  findLabel(text) {
    let found = null;
    this.walk((n) => { if (found) return; const l = n.getComponent(cc.Label); if (l && l.string === text) found = n; });
    return found;
  },
  findButtonOf(text) {
    let p = this.findLabel(text);
    while (p && !p.getComponent(cc.Button)) p = p.parent;
    return p || null;
  },
  click(text) {
    const btn = this.findButtonOf(text);
    if (!btn) return 'no-button:' + text;
    btn.emit(cc.Button.EventType.CLICK);
    return 'ok';
  },
  findNode(name) {
    let found = null;
    this.walk((n) => { if (!found && n.name === name) found = n; });
    return found;
  },
  has(text) { return !!this.findLabel(text); },
};
'ready';
`;

const STATS_READ_SCRIPT = `(() => {
  const out = { source: 'none', text: null, counters: null, device: null, profilerInited: null, domFound: false, notes: [] };
  let p = null;
  try { p = window.cc && cc.profiler ? cc.profiler : null; } catch (e) { out.notes.push('profiler: ' + e); }
  out.profilerInited = p ? p._inited === true : null;
  try {
    const stats = p ? (p.stats || p._profilerStats || null) : null;
    if (stats) {
      const lines = [];
      const counters = {};
      for (const key in stats) {
        const entry = stats[key] || {};
        let human = null;
        try { human = entry.counter && typeof entry.counter.human === 'function' ? entry.counter.human() : null; } catch (e) { /* ignore */ }
        counters[key] = human;
        lines.push(String(entry.desc || key) + ': ' + (human === null ? 'n/a' : human));
      }
      out.counters = counters;
      out.text = lines.join('\\n');
      out.source = 'profiler-counters';
    } else {
      out.notes.push('cc.profiler.stats 不可用');
    }
  } catch (e) { out.notes.push('counters: ' + e); }
  try {
    const dev = p && p._device ? p._device : (cc.director && cc.director.root && cc.director.root.device ? cc.director.root.device : null);
    if (dev) {
      out.device = {
        numDrawCalls: dev.numDrawCalls,
        numTris: dev.numTris,
        numInstances: dev.numInstances,
        textureBytes: dev.memoryStatus ? dev.memoryStatus.textureSize : null,
        bufferBytes: dev.memoryStatus ? dev.memoryStatus.bufferSize : null,
      };
    }
  } catch (e) { out.notes.push('device: ' + e); }
  try {
    const nodes = document.querySelectorAll('div,canvas,span,section');
    for (const el of nodes) {
      const text = el.innerText || el.textContent || '';
      if (text.indexOf('Draw call') >= 0 && (text.indexOf('Framerate') >= 0 || text.indexOf('Frame time') >= 0)) {
        out.domText = text;
        out.domFound = true;
        if (!out.text || out.text.indexOf('Draw call') < 0) {
          out.text = text;
          out.source = 'dom';
        }
        break;
      }
    }
  } catch (e) { out.notes.push('dom: ' + e); }
  return out;
})()`;

function fpsSampleScript(durationMs) {
  return `(() => new Promise((resolve) => {
  const DURATION = ${durationMs};
  const marks = [];
  const t0 = performance.now();
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    const frames = marks.length;
    const bucketCount = Math.max(1, Math.round(DURATION / 1000));
    const buckets = new Array(bucketCount).fill(0);
    let avg = null;
    let min = null;
    let maxFrameMs = null;
    let spanMs = null;
    if (frames >= 2) {
      const first = marks[0];
      const last = marks[frames - 1];
      spanMs = last - first;
      if (spanMs > 0) avg = (frames - 1) / (spanMs / 1000);
      maxFrameMs = 0;
      for (let i = 1; i < frames; i++) {
        const delta = marks[i] - marks[i - 1];
        if (delta > maxFrameMs) maxFrameMs = delta;
        const index = Math.min(bucketCount - 1, Math.floor((marks[i] - first) / 1000));
        if (index >= 0) buckets[index] += 1;
      }
      const fullBuckets = buckets.slice(0, Math.max(1, bucketCount - 1));
      min = Math.min.apply(null, fullBuckets);
      if (!Number.isFinite(min)) min = null;
    }
    resolve({ frames, spanMs, avg, min, maxFrameMs, buckets });
  };
  const tick = (now) => {
    marks.push(now);
    if (now - t0 >= DURATION || marks.length >= 200000) { finish(); return; }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}))()`;
}

const FIELD_PATTERNS = {
  fps: /Framerate\s*\(?\s*FPS\s*\)?\s*[:：]?\s*([\d.]+)/i,
  textureMemMB: /GFX\s*Texture\s*Mem\s*\(?\s*M(?:B)?\s*\)?\s*[:：]?\s*([\d.]+)/i,
  bufferMemMB: /GFX\s*Buffer\s*Mem\s*\(?\s*M(?:B)?\s*\)?\s*[:：]?\s*([\d.]+)/i,
  drawCall: /Draw\s*calls?\s*[:：]?\s*([\d.,]+)/i,
  triangle: /Triangles?\s*[:：]?\s*([\d.,]+)/i,
  frameMs: /Frame\s*time\s*\(\s*ms\s*\)\s*[:：]?\s*([\d.]+)/i,
  instances: /Instance\s*Count\s*[:：]?\s*([\d.,]+)/i,
};

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(String(value).replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function parseFields(text) {
  const out = {};
  for (const [key, pattern] of Object.entries(FIELD_PATTERNS)) {
    const match = text ? pattern.exec(text) : null;
    out[key] = match ? toNumber(match[1]) : null;
  }
  return out;
}

const COUNTER_KEY_MAP = {
  fps: 'fps',
  draws: 'drawCall',
  tricount: 'triangle',
  textureMemory: 'textureMemMB',
  bufferMemory: 'bufferMemMB',
  frame: 'frameMs',
  instances: 'instances',
};

function summarizeStats(raw) {
  if (!raw) return null;
  const fields = parseFields(raw.text);
  const counters = raw.counters || {};
  for (const [counterKey, fieldKey] of Object.entries(COUNTER_KEY_MAP)) {
    if (fields[fieldKey] === null && counters[counterKey] !== null && counters[counterKey] !== undefined) {
      fields[fieldKey] = toNumber(counters[counterKey]);
    }
  }
  const device = raw.device || null;
  const derived = {
    textureMemMB: device && device.textureBytes !== null && device.textureBytes !== undefined ? round2(device.textureBytes / 1048576) : null,
    bufferMemMB: device && device.bufferBytes !== null && device.bufferBytes !== undefined ? round2(device.bufferBytes / 1048576) : null,
    drawCall: device && device.numDrawCalls !== null && device.numDrawCalls !== undefined ? device.numDrawCalls : null,
    triangle: device && device.numTris !== null && device.numTris !== undefined ? device.numTris : null,
    instances: device && device.numInstances !== null && device.numInstances !== undefined ? device.numInstances : null,
  };
  for (const [key, value] of Object.entries(derived)) {
    if (fields[key] === null || fields[key] === undefined) fields[key] = value;
  }
  const notes = Array.isArray(raw.notes) ? [...raw.notes] : [];
  if (raw.profilerInited !== true) {
    for (const key of ['textureMemMB', 'bufferMemMB', 'drawCall', 'triangle', 'instances']) {
      if (derived[key] !== null) fields[key] = derived[key];
    }
    notes.push('profiler 面板节点未初始化，textureMem/drawCall/triangle/instances 取自 GFX 设备计数兜底');
  }
  return {
    source: raw.source ?? 'none',
    profilerInited: raw.profilerInited ?? null,
    domFound: !!raw.domFound,
    counters,
    device,
    derived,
    notes,
    text: raw.text ? String(raw.text).slice(0, 4000) : null,
    fields,
  };
}

async function readProfilerStats(cdp, deadline) {
  const shown = await evaluate(cdp, `(() => {
    try {
      if (!window.cc || !cc.profiler) return 'no-profiler';
      cc.profiler.showStats();
      return 'ok';
    } catch (e) { return 'error:' + e; }
  })()`, deadline, 'show-stats');
  await sleep(600);
  const inited = await evaluate(cdp, `(() => {
    try {
      const p = window.cc && cc.profiler;
      if (p && p._inited !== true && typeof p.generateNode === 'function') { p.generateNode(); return 'forced'; }
      return p && p._inited === true ? 'inited' : 'uninited';
    } catch (e) { return 'error:' + e; }
  })()`, deadline, 'stats-node').catch((error) => `error:${msg(error)}`);
  await sleep(1200);
  const raw = await evaluate(cdp, STATS_READ_SCRIPT, deadline, 'read-stats');
  await evaluate(cdp, `(() => { try { cc.profiler.hideStats(); return true; } catch (e) { return false; } })()`, deadline, 'hide-stats').catch(() => null);
  return { shown, inited, raw };
}

function collectConsole(cdp) {
  const counts = { error: 0, warning: 0, exception: 0 };
  const samples = { errors: [], warnings: [] };
  for (const event of cdp.events) {
    if (event.method === 'Runtime.consoleAPICalled') {
      const type = event.params.type;
      const text = (event.params.args || [])
        .map((arg) => arg.value ?? arg.description ?? arg.type).join(' ').slice(0, 300);
      if (type === 'error') {
        counts.error += 1;
        if (samples.errors.length < 5) samples.errors.push(text);
      } else if (type === 'warning') {
        counts.warning += 1;
        if (samples.warnings.length < 5) samples.warnings.push(text);
      }
    } else if (event.method === 'Runtime.exceptionThrown') {
      counts.exception += 1;
      if (samples.errors.length < 5) {
        samples.errors.push('exception: ' + JSON.stringify(event.params.exceptionDetails).slice(0, 300));
      }
    } else if (event.method === 'Log.entryAdded') {
      const entry = event.params.entry || {};
      if (entry.source === 'console-api') continue;
      if (entry.level === 'error') {
        counts.error += 1;
        if (samples.errors.length < 5) samples.errors.push('[log] ' + String(entry.text).slice(0, 300));
      } else if (entry.level === 'warning') {
        counts.warning += 1;
        if (samples.warnings.length < 5) samples.warnings.push('[log] ' + String(entry.text).slice(0, 300));
      }
    }
  }
  return { counts, samples };
}

async function waitForMenu(cdp, deadline) {
  const startedAt = Date.now();
  while (Date.now() < deadline) {
    let labels = [];
    try {
      labels = await evaluate(cdp, 'window.__smoke.labels()', deadline, 'menu-labels') || [];
    } catch {
      await sleep(500);
      continue;
    }
    if (labels.includes('启动失败')) {
      return { ok: false, reason: 'error-panel', detail: labels.filter((text) => text.includes('失败')).join('|') };
    }
    let menuReady = false;
    try {
      menuReady = await evaluate(
        cdp,
        `!!window.__smoke.findNode('Panel_MainMenu') && !!window.__smoke.findNode('StartButton')`,
        deadline,
        'menu-ready',
      );
    } catch { /* 继续轮询 */ }
    if (menuReady) return { ok: true, waitedMs: Date.now() - startedAt };
    if (labels.includes('已阅读')) { await evaluate(cdp, `window.__smoke.click('已阅读')`, deadline, 'privacy').catch(() => null); await sleep(700); continue; }
    if (labels.includes('同意并继续')) { await evaluate(cdp, `window.__smoke.click('同意并继续')`, deadline, 'privacy').catch(() => null); await sleep(700); continue; }
    await sleep(800);
  }
  return { ok: false, reason: 'timeout', detail: '主界面就绪超时' };
}

async function measureMode(mode, options) {
  const startedAt = Date.now();
  const deadline = startedAt + options.timeoutMs;
  const modeUrl = withBgParam(options.url, mode);
  const shotFile = join(options.shotsDir, `${safeName(mode)}.png`);
  const profileDir = join(options.profileRoot, `profile-${safeName(mode)}`);
  const result = {
    mode,
    url: modeUrl,
    ok: false,
    durationMs: 0,
    fps: { avg: null, min: null, maxFrameMs: null, frames: null, buckets: null },
    textureMemMB: null,
    bufferMemMB: null,
    drawCall: null,
    triangle: null,
    frameMs: null,
    instances: null,
    jsHeapMB: null,
    jsHeap: null,
    consoleCounts: { error: 0, warning: 0, exception: 0 },
    consoleSamples: { errors: [], warnings: [] },
    screenshot: null,
    stats: null,
    steps: {},
    errors: [],
    warnings: [],
  };
  const remaining = () => deadline - Date.now();
  const need = (label) => {
    if (remaining() <= 0) throw new Error(`单模式超时（${options.timeoutMs / 1000}s）于 ${label}`);
  };
  let edge = null;
  let cdp = null;

  try {
    rmSync(profileDir, { recursive: true, force: true });
    mkdirSync(profileDir, { recursive: true });
    const port = await freeTcpPort();
    log(`[${mode}] 启动 headless Edge（CDP 端口 ${port}）`);
    edge = launchEdge(port, profileDir);
    activeEdge = edge;
    const target = await listPageTarget(port, Math.max(5000, Math.min(60000, remaining())));
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => reject(new Error('CDP WebSocket 连接超时')), Math.max(1000, Math.min(10000, remaining())));
      ws.addEventListener('open', () => { clearTimeout(timer); resolvePromise(); }, { once: true });
      ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('CDP WebSocket 连接错误')); }, { once: true });
    });
    cdp = new CdpClient(ws);
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    await cdp.send('Log.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 375, height: 812, deviceScaleFactor: 2, mobile: true, screenWidth: 375, screenHeight: 812,
    });
    const navStart = Date.now();
    await cdp.send('Page.navigate', { url: modeUrl });

    const engineOk = await waitExpr(cdp, `!!(window.cc && cc.game && cc.game._inited)`, 60000, deadline, 'engine');
    if (!engineOk) throw new Error('引擎初始化超时');
    result.steps.engineMs = Date.now() - navStart;
    log(`[${mode}] 引擎就绪（${(result.steps.engineMs / 1000).toFixed(1)}s）`);

    await evaluate(cdp, HELPER_SCRIPT, deadline, 'helper');
    const sceneOk = await waitExpr(
      cdp,
      `!!(window.__smoke && window.__smoke.scene() && window.__smoke.scene().name === 'Main')`,
      30000, deadline, 'scene',
    );
    if (!sceneOk) throw new Error('Main 场景加载超时');
    result.steps.sceneMs = Date.now() - navStart;

    const menu = await waitForMenu(cdp, deadline);
    if (!menu.ok) throw new Error(menu.reason === 'error-panel' ? `启动失败面板：${menu.detail}` : menu.detail);
    result.steps.menuMs = Date.now() - navStart;
    log(`[${mode}] 主界面就绪（隐私门禁已过，${(result.steps.menuMs / 1000).toFixed(1)}s）`);

    log(`[${mode}] 静置 3s`);
    need('settle');
    await sleep(3000);

    if (mode === 'video') {
      need('bg-video-check');
      const bgVideo = await evaluate(cdp, `(function () {
        var el = document.getElementById('bgVideo');
        if (!el) return { ok: false, reason: 'no-element' };
        return {
          ok: !el.error && el.style.display !== 'none' && el.readyState >= 2,
          display: el.style.display || '',
          readyState: el.readyState,
          errorCode: el.error ? el.error.code : null
        };
      })()`, deadline, 'bg-video-check');
      result.bgVideo = bgVideo;
      if (!bgVideo || !bgVideo.ok) {
        result.warnings.push(`bgVideo 未生效：${JSON.stringify(bgVideo)}`);
        log(`[${mode}] 警告：bgVideo 未生效 ${JSON.stringify(bgVideo)}`);
      } else {
        log(`[${mode}] bgVideo readyState=${bgVideo.readyState}`);
      }
    }

    log(`[${mode}] rAF 采样 8s`);
    need('fps-sample');
    const sample = await evaluate(cdp, fpsSampleScript(8000), deadline, 'fps-sample');
    if (!sample || sample.frames < 2 || sample.avg === null) {
      throw new Error(`FPS 采样失败：${JSON.stringify(sample)}`);
    }
    result.fps = {
      avg: round2(sample.avg),
      min: sample.min,
      maxFrameMs: round2(sample.maxFrameMs),
      frames: sample.frames,
      buckets: sample.buckets,
    };
    result.steps.sampleMs = Math.round(sample.spanMs ?? 0);
    log(`[${mode}] FPS avg=${result.fps.avg} min=${result.fps.min}（${sample.frames} 帧）`);

    const stats = await readProfilerStats(cdp, deadline);
    result.steps.statsShow = stats.shown;
    result.steps.statsNode = stats.inited;
    result.stats = summarizeStats(stats.raw);
    if (result.stats && result.stats.fields) {
      result.textureMemMB = result.stats.fields.textureMemMB ?? null;
      result.bufferMemMB = result.stats.fields.bufferMemMB ?? null;
      result.drawCall = result.stats.fields.drawCall ?? null;
      result.triangle = result.stats.fields.triangle ?? null;
      result.frameMs = result.stats.fields.frameMs ?? null;
      result.instances = result.stats.fields.instances ?? null;
    }
    for (const note of result.stats?.notes ?? []) result.warnings.push(`stats: ${note}`);
    log(`[${mode}] stats source=${result.stats?.source ?? 'none'} drawCall=${fmt(result.drawCall, 0)} textureMem=${fmt(result.textureMemMB, 2)}MB triangle=${fmt(result.triangle, 0)}`);

    const heap = await evaluate(cdp, `(() => {
      const m = performance.memory;
      return m ? { used: m.usedJSHeapSize, total: m.totalJSHeapSize, limit: m.jsHeapSizeLimit } : null;
    })()`, deadline, 'js-heap');
    if (heap && Number.isFinite(Number(heap.used))) {
      result.jsHeap = {
        usedMB: round2(heap.used / 1048576),
        totalMB: round2(heap.total / 1048576),
        limitMB: round2(heap.limit / 1048576),
      };
      result.jsHeapMB = result.jsHeap.usedMB;
    } else {
      result.warnings.push('performance.memory 不可用');
    }

    try {
      const shot = await deadlineRace(cdp.send('Page.captureScreenshot', { format: 'png' }), deadline, 'screenshot');
      writeFileSync(shotFile, Buffer.from(shot.data, 'base64'));
      result.screenshot = relPath(shotFile);
    } catch (error) {
      result.warnings.push(`截图失败：${msg(error)}`);
    }

    const consoleInfo = collectConsole(cdp);
    result.consoleCounts = consoleInfo.counts;
    result.consoleSamples = consoleInfo.samples;

    result.ok = true;
    log(`[${mode}] 完成，耗时 ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
  } catch (error) {
    result.ok = false;
    result.errors.push(msg(error));
    log(`[${mode}] 失败：${msg(error)}`);
    if (cdp) {
      try {
        const shot = await deadlineRace(cdp.send('Page.captureScreenshot', { format: 'png' }), Date.now() + 8000, 'shot-fallback');
        writeFileSync(shotFile, Buffer.from(shot.data, 'base64'));
        result.screenshot = relPath(shotFile);
      } catch (error2) {
        result.warnings.push(`失败态截图失败：${msg(error2)}`);
      }
      try {
        const statsRaw = await evaluate(cdp, STATS_READ_SCRIPT, Date.now() + 5000, 'read-stats-fallback');
        if (!result.stats) result.stats = summarizeStats(statsRaw);
      } catch { /* ignore */ }
      try {
        const consoleInfo = collectConsole(cdp);
        result.consoleCounts = consoleInfo.counts;
        result.consoleSamples = consoleInfo.samples;
      } catch { /* ignore */ }
    }
  } finally {
    result.durationMs = Date.now() - startedAt;
    if (cdp) cdp.close();
    killEdge(edge);
    activeEdge = null;
    await sleep(300);
  }
  return result;
}

function withBgParam(rawUrl, mode) {
  const parsed = new URL(rawUrl);
  parsed.searchParams.set('bg', mode);
  return parsed.toString();
}

function buildReport(data) {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    node: process.version,
    platform: process.platform,
    edge: EDGE,
    url: data.url,
    serveDir: data.serveRoot,
    modes: data.results,
  };
}

function writeReport(data) {
  const file = join(outDir, 'measure-report.json');
  writeFileSync(file, `${JSON.stringify(buildReport(data), null, 2)}\n`);
  return file;
}

function printTable(results) {
  const header = ['MODE', 'OK', 'FPS avg/min', 'TEXMEM MB', 'DRAW', 'TRI', 'HEAP MB', 'ERR/WARN', 'TIME s', 'SHOT'];
  const rows = results.map((result) => [
    result.mode,
    result.ok ? 'ok' : 'FAIL',
    `${fmt(result.fps?.avg, 1)}/${fmt(result.fps?.min, 1)}`,
    fmt(result.textureMemMB, 2),
    fmt(result.drawCall, 0),
    fmt(result.triangle, 0),
    fmt(result.jsHeapMB, 1),
    `${fmt(result.consoleCounts?.error, 0)}/${fmt(result.consoleCounts?.warning, 0)}`,
    (result.durationMs / 1000).toFixed(1),
    result.screenshot ? 'yes' : 'no',
  ]);
  const widths = header.map((title, index) => Math.max(title.length, ...rows.map((row) => row[index].length)));
  const line = (cells) => cells.map((cell, index) => cell.padEnd(widths[index])).join('  ');
  console.log('');
  console.log(line(header));
  console.log(widths.map((width) => '-'.repeat(width)).join('  '));
  for (const row of rows) console.log(line(row));
  console.log('');
}

(async () => {
  if (!EDGE) {
    console.error('[bg-eval] 未找到 Edge（msedge.exe），可用 BG_EVAL_EDGE 指定路径');
    process.exit(2);
  }
  if (!modes.length) {
    console.error('[bg-eval] --modes 为空');
    process.exit(2);
  }

  let serveRoot = null;
  if (!noServe) {
    serveRoot = resolve(serveDirArg);
    if (!existsSync(serveRoot) || !statSync(serveRoot).isDirectory()) {
      console.error(`[bg-eval] 静态服务目录不存在：${serveRoot}`);
      console.error('[bg-eval] 可用 --serve <dir> 指定（相对路径按当前工作目录解析）');
      process.exit(2);
    }
  }

  const parsedUrl = new URL(url);
  const host = parsedUrl.hostname === 'localhost' ? '127.0.0.1' : parsedUrl.hostname;
  const port = parsedUrl.port ? Number(parsedUrl.port) : (parsedUrl.protocol === 'https:' ? 443 : 80);

  let server = null;
  if (serveRoot) {
    log(`静态服务：${serveRoot} -> http://${host}:${port}/`);
    server = await startStaticServer(serveRoot, host, port).catch((error) => {
      console.error(`[bg-eval] ${error.message}`);
      console.error('[bg-eval] 端口被占用时可换 --url（端口随之变化）或先结束占用进程');
      process.exit(2);
    });
  }

  const shotsDir = join(outDir, 'shots');
  const profileRoot = join(outDir, 'profiles');
  mkdirSync(shotsDir, { recursive: true });
  mkdirSync(profileRoot, { recursive: true });

  log(`测量模式：${modes.join(', ')}（单模式超时 ${modeTimeoutMs / 1000}s）`);
  const results = [];
  for (const mode of modes) {
    const result = await measureMode(mode, { url, timeoutMs: modeTimeoutMs, shotsDir, profileRoot });
    results.push(result);
    writeReport({ url, serveRoot, results });
  }

  printTable(results);
  const reportFile = writeReport({ url, serveRoot, results });
  log(`报告：${relPath(reportFile)}`);
  log(`截图目录：${relPath(shotsDir)}`);

  if (server) server.close();
  const failed = results.filter((result) => !result.ok);
  log(`模式完成 ${results.length - failed.length}/${results.length}${failed.length ? `，失败：${failed.map((result) => result.mode).join(', ')}` : ''}`);
  process.exit(failed.length ? 1 : 0);
})().catch((error) => {
  console.error(`[bg-eval] 致命错误：${error && error.stack ? error.stack : error}`);
  process.exit(2);
});
