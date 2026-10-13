import { createServer } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { DEFAULT_LIMITS } from './limits.mjs';
import { ApiError } from './errors.mjs';
import { loadMissionContent } from './content.mjs';
import { MissionService } from './mission-service.mjs';
import { MissionStore } from './store.mjs';
import { fileURLToPath } from 'node:url';
import { isIP } from 'node:net';

const COOKIE_NAME = 'tr_mission_session';
const jsonType = /^application\/json(?:\s*;|$)/i;

function configuredOrigin(value) {
  if (!value) return null;
  let url;
  try { url = new URL(value); } catch { throw new Error('PUBLIC_ORIGIN must be a valid HTTP(S) origin'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('PUBLIC_ORIGIN must contain only an HTTP(S) origin');
  }
  return url.origin;
}

function isSameOrigin(request, configured) {
  const origin = request.headers.origin;
  const requestHost = request.headers.host;
  if (typeof origin !== 'string' || typeof requestHost !== 'string') return false;
  let parsed;
  try { parsed = new URL(origin); } catch { return false; }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || origin !== parsed.origin) return false;
  if (configured) return parsed.origin === configured;
  try {
    const requested = new URL(parsed.protocol + '//' + requestHost);
    return !requested.username && !requested.password && requested.pathname === '/' && !requested.search && !requested.hash && requested.host === parsed.host;
  } catch { return false; }
}

function readCookie(request) {
  const header = request.headers.cookie;
  if (typeof header !== 'string') return null;
  for (const pair of header.split(';')) {
    const trimmed = pair.trim();
    const split = trimmed.indexOf('=');
    if (split > 0 && trimmed.slice(0, split) === COOKIE_NAME) {
      const value = trimmed.slice(split + 1);
      return /^[a-f0-9]{64}$/.test(value) ? value : null;
    }
  }
  return null;
}

function parseObject(text, allowEmpty) {
  if (!text && allowEmpty) return {};
  if (!text) throw new ApiError(400, '请求正文不能为空');
  let body;
  try { body = JSON.parse(text); } catch { throw new ApiError(400, '请求正文不是有效 JSON'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ApiError(400, '请求正文必须是 JSON 对象');
  return body;
}

function readJson(request, maxBytes, allowEmpty = false) {
  const contentEncoding = request.headers['content-encoding'];
  if (contentEncoding && contentEncoding !== 'identity') throw new ApiError(415, '不支持压缩请求正文');
  const contentType = request.headers['content-type'];
  const declared = request.headers['content-length'];
  if (declared !== undefined && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) {
    request.resume();
    throw new ApiError(Number(declared) > maxBytes ? 413 : 400, '请求正文格式无效或超过大小限制');
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    request.on('data', chunk => {
      size += chunk.length;
      if (size > maxBytes) tooLarge = true;
      else if (!tooLarge) chunks.push(chunk);
    });
    request.on('end', () => {
      if (tooLarge) { reject(new ApiError(413, '请求正文超过大小限制')); return; }
      if (size > 0 && (typeof contentType !== 'string' || !jsonType.test(contentType))) {
        reject(new ApiError(415, '请求必须使用 application/json'));
        return;
      }
      try { resolve(parseObject(Buffer.concat(chunks).toString('utf8'), allowEmpty)); }
      catch (error) { reject(error); }
    });
    request.on('error', reject);
  });
}

function assertKeys(body, allowed) {
  if (Object.keys(body).some(key => !allowed.includes(key))) throw new ApiError(400, '请求包含不支持的字段');
}

function sendJson(response, status, value, extraHeaders = {}) {
  if (response.headersSent) return;
  const body = JSON.stringify(value);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders,
  });
  response.end(body);
}

class RateLimiter {
  constructor(limits, now) { this.limits = limits; this.now = now; this.buckets = new Map(); }
  allow(key, maximum) {
    const now = this.now();
    const windowMs = this.limits.rateWindowMs;
    let bucket = this.buckets.get(key);
    if (!bucket || now - bucket.startedAt >= windowMs || now < bucket.startedAt) {
      bucket = { startedAt: now, count: 0 };
      this.buckets.set(key, bucket);
    }
    if (bucket.count >= maximum) return false;
    bucket.count++;
    if (this.buckets.size > 10000) {
      for (const [id, entry] of this.buckets) if (now - entry.startedAt >= windowMs) this.buckets.delete(id);
    }
    return true;
  }
}

export function createMissionHttpServer(options = {}) {
  const now = options.now ?? Date.now;
  const limits = { ...DEFAULT_LIMITS, ...(options.limits ?? {}) };
  const publicOrigin = configuredOrigin(options.publicOrigin ?? process.env.PUBLIC_ORIGIN);
  const trustedProxy = options.trustedProxy ?? process.env.TRUSTED_PROXY_IP;
  if (trustedProxy && !isIP(trustedProxy)) throw new Error('TRUSTED_PROXY_IP must be one exact proxy IP address');
  const store = new MissionStore(options.dbPath ?? process.env.MISSIONS_DB_PATH ?? fileURLToPath(new URL('../data/missions.sqlite', import.meta.url)));
  const service = new MissionService({ store, content: options.content ?? loadMissionContent(), now, limits, minRunSeconds: options.minRunSeconds });
  const limiter = new RateLimiter(limits, now);

  function authenticate(request) {
    const token = readCookie(request);
    if (!token) throw new ApiError(401, '游客会话无效，请重新创建会话');
    const userId = createHash('sha256').update(token).digest('hex');
    if (!store.hasUser(userId)) throw new ApiError(401, '游客会话无效，请重新创建会话');
    if (!limiter.allow(`user:${userId}`, limits.userRequestsPerMinute)) throw new ApiError(429, '请求过于频繁，请稍后重试');
    return userId;
  }

  const server = createServer(async (request, response) => {
    try {
      const peer = (request.socket.remoteAddress ?? 'unknown').replace(/^::ffff:/, '');
      const realIp = request.headers['x-real-ip'];
      const address = trustedProxy === peer && typeof realIp === 'string' && isIP(realIp) ? realIp : peer;
      if (!limiter.allow(`ip:${address}`, limits.ipRequestsPerMinute)) throw new ApiError(429, '请求过于频繁，请稍后重试');
      const url = new URL(request.url ?? '/', 'http://mission.local');
      const pathname = url.pathname;
      if (request.method === 'POST' && !isSameOrigin(request, publicOrigin)) throw new ApiError(403, '请求来源不匹配');

      if (pathname === '/api/missions/session') {
        if (request.method !== 'POST') { response.setHeader('Allow', 'POST'); throw new ApiError(405, '该接口只接受 POST'); }
        const body = await readJson(request, limits.bodyBytes, true);
        assertKeys(body, []);
        const token = readCookie(request);
        const existingId = token ? createHash('sha256').update(token).digest('hex') : '';
        if (token && store.hasUser(existingId)) { sendJson(response, 200, { ok: true }); return; }
        const newToken = randomBytes(32).toString('hex');
        store.createUser(createHash('sha256').update(newToken).digest('hex'), now());
        const secure = publicOrigin?.startsWith('https:') || request.socket.encrypted === true || request.headers.origin?.startsWith('https://');
        const cookie = `${COOKIE_NAME}=${newToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${limits.sessionCookieMaxAgeSeconds}${secure ? '; Secure' : ''}`;
        sendJson(response, 201, { ok: true }, { 'Set-Cookie': cookie });
        return;
      }

      if (pathname === '/api/missions' && request.method === 'GET') {
        const userId = authenticate(request);
        sendJson(response, 200, service.snapshot(userId));
        return;
      }
      if (pathname === '/api/missions/runs' && request.method === 'POST') {
        const userId = authenticate(request);
        const body = await readJson(request, limits.bodyBytes);
        assertKeys(body, ['seed', 'charId']);
        sendJson(response, 201, service.startRun(userId, body));
        return;
      }
      const finishMatch = pathname.match(/^\/api\/missions\/runs\/([0-9a-f-]{36})\/finish$/i);
      if (finishMatch && request.method === 'POST') {
        const userId = authenticate(request);
        const body = await readJson(request, limits.bodyBytes);
        assertKeys(body, ['frames', 'actions']);
        sendJson(response, 200, await service.finishRun(userId, finishMatch[1], body));
        return;
      }
      if (pathname === '/api/missions/claim' && request.method === 'POST') {
        const userId = authenticate(request);
        const body = await readJson(request, limits.bodyBytes);
        assertKeys(body, ['period', 'periodId', 'missionId']);
        sendJson(response, 200, service.claim(userId, body));
        return;
      }
      if (pathname.startsWith('/api/missions/')) throw new ApiError(404, '找不到该任务接口');
      throw new ApiError(404, '找不到该接口');
    } catch (error) {
      if (error instanceof ApiError) { sendJson(response, error.status, { error: error.message }); return; }
      console.error('mission server request failed:', error);
      sendJson(response, 500, { error: '服务器暂时无法处理请求' });
    }
  });

  return {
    server, store, service,
    async close() {
      if (server.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      store.close();
    },
  };
}
