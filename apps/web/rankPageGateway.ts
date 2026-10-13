import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin, ResolvedConfig } from 'vite';
import { debugQueryFlags } from '@tr/game/core/debugMode.js';

/** Vite owns its HTML/HMR; only the backend signs eligibility for the actual incoming document request. */
export function rankPageGateway(): Plugin {
  let config: ResolvedConfig;
  const isEntry = (path: string): boolean => [config.base, `${config.base}index.html`, '/', '/index.html'].includes(path);
  const cookiePath = (value: string): string => value.replace('Path=/thunder-run/', `Path=${config.base}`);
  const guard = (render: (url: string) => Promise<string>, preview: boolean) => async (
    req: IncomingMessage, res: ServerResponse, next: () => void,
  ): Promise<void> => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (!['GET', 'HEAD'].includes(req.method ?? '') || !isEntry(url.pathname)) { next(); return; }
    const proxy = (preview ? config.preview.proxy : config.server.proxy)?.['/thunder-run/api/']
      ?? config.server.proxy?.['/api/'];
    const target = process.env.TR_LEADERBOARD_GATE_URL ?? (typeof proxy === 'object' ? proxy.target : proxy) ?? 'http://127.0.0.1:8788';
    let gateway: URL;
    try { gateway = new URL(String(target)); }
    catch { res.statusCode = 503; res.end('Invalid local eligibility gateway'); return; }
    if (gateway.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(gateway.hostname)
      || gateway.username || gateway.password) { res.statusCode = 503; res.end('Invalid local eligibility gateway'); return; }
    gateway.pathname = '/thunder-run/'; gateway.search = url.search;
    const allowDebug = !preview || config.env.VITE_TR_ALLOW_DEBUG === '1';
    let pageId = '', denied = false;
    try {
      const cookie = (req.headers.cookie ?? '').split(';').filter(c => c.trim().startsWith('tr_rank_session=')).join(';');
      const response = await fetch(gateway, { method: 'HEAD', headers: { Cookie: cookie,
        ...(typeof req.headers.referer === 'string' ? { Referer: req.headers.referer } : {}) }, signal: AbortSignal.timeout(1500) });
      const cookies = response.headers.getSetCookie().map(cookiePath);
      if (cookies.length) res.setHeader('Set-Cookie', cookies);
      const candidate = response.headers.get('x-tr-rank-page') ?? '';
      if (response.ok && /^[A-Za-z0-9_-]{43}$/.test(candidate)) pageId = candidate;
      denied = response.status === 403;
    } catch { /* Local development can remain playable offline, but has no signed ranking credential. */ }
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Security-Policy', "frame-ancestors 'none'");
    res.setHeader('X-Frame-Options', 'DENY');
    if (!allowDebug && (denied || debugQueryFlags(url.search).qa)) { res.statusCode = 403; res.end('Official preview does not provide debug mode'); return; }
    try {
      let html = await render(req.url ?? '/');
      if (pageId) html = html.replace('</head>', `<meta name="tr-rank-page" content="${pageId}"></head>`);
      res.statusCode = 200; res.end(req.method === 'HEAD' ? undefined : html);
    } catch { res.statusCode = 503; res.end('Page unavailable'); }
  };
  return {
    name: 'tr-ranking-page-gateway',
    configResolved(value) { config = value; },
    configureServer(server) {
      server.middlewares.use((req, res, next) => { void guard(async url => server.transformIndexHtml(url,
        await readFile(resolve(config.root, 'index.html'), 'utf8')), false)(req, res, next); });
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => { void guard(async () => readFile(resolve(config.root, config.build.outDir, 'index.html'), 'utf8'), true)(req, res, next); });
    },
  };
}
