import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PAGE_META } from './pageSessions.mjs';

export function isGameEntry(url) {
  return url.pathname === '/thunder-run/' || url.pathname === '/thunder-run/index.html';
}
export function debugReferral(header, debugFlags, allowedOrigins) {
  if (typeof header !== 'string' || header.length > 16384) return false;
  try { const url = new URL(header); return allowedOrigins.has(url.origin) && isGameEntry(url) && debugFlags(url.search).qa; } catch { return false; }
}

export async function servePage(req, res, url, { sessions, debugFlags, allowDebug, webRoot, allowedOrigins }) {
  if (!isGameEntry(url) || !['GET', 'HEAD'].includes(req.method)) return false;
  const debug = debugFlags(url.search).qa;
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "frame-ancestors 'none'");
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  if (debug || debugReferral(req.headers.referer, debugFlags, allowedOrigins)) sessions.revoke(req.headers.cookie);
  if (debug && !allowDebug) {
    res.statusCode = 403;
    res.end(req.method === 'HEAD' ? undefined : '<!doctype html><meta charset="utf-8"><title>调试入口已关闭</title><p>正式站不提供调试模式，请使用本机或独立测试站。</p>');
    return true;
  }
  let html;
  if (req.method === 'GET') {
    try { html = await readFile(resolve(webRoot, 'index.html'), 'utf8'); }
    catch { res.statusCode = 503; res.end('<!doctype html><title>Unavailable</title>Page unavailable'); return true; }
  }
  const credential = !debug && sessions.issue(req.headers.cookie);
  if (credential) {
    res.setHeader('Set-Cookie', credential.cookie);
    if (req.method === 'HEAD') res.setHeader('X-TR-Rank-Page', credential.pageId);
    else html = html.replace('</head>', `<meta name="${PAGE_META}" content="${credential.pageId}"></head>`);
  }
  res.statusCode = 200;
  res.end(req.method === 'HEAD' ? undefined : html);
  return true;
}
