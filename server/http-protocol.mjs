/**
 * Leaderboard HTTP protocol helpers: error envelope, JSON body reader, cookie/session
 * formatting, client IP resolution, and the bounded rate limiter. Pure functions only —
 * no store, no routes; split out of index.mjs to keep every file under the 300-line cap.
 */
import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { performance } from 'node:perf_hooks';

export const API_PATH = '/thunder-run/api';
export const COOKIE_NAME = 'tr_lb';
export const COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;
export const MAX_BODY_BYTES = 2 * 1024 * 1024;
const ACTIONS = new Set(['jump', 'slide', 'laneL', 'laneR', 'skill']);

export class HttpError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

export function httpError(status, code) {
  return new HttpError(status, code);
}

export function parseBoundedInteger(value, fallback, min, max) {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return fallback;
  return parsed;
}

export function normalizeOrigins(values) {
  const list = typeof values === 'string' ? values.split(',') : values;
  if (!Array.isArray(list) || list.length === 0) throw new TypeError('At least one allowed origin is required');
  return new Set(list.map(value => {
    const url = new URL(String(value).trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
      || url.pathname !== '/' || url.search || url.hash) {
      throw new TypeError('Origins must be exact HTTP(S) origins without a path');
    }
    return url.origin;
  }));
}

export function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function serverTimeUs(monotonicMs = performance.now()) {
  return Math.round((performance.timeOrigin + monotonicMs) * 1000);
}

export function sendJson(res, status, body, cookie) {
  const serialized = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', Buffer.byteLength(serialized));
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (cookie) res.setHeader('Set-Cookie', cookie);
  res.end(serialized);
}

export function errorResponse(res, status, code) {
  sendJson(res, status, { error: { code } });
}

export function readCookie(header) {
  if (typeof header !== 'string' || header.length > 4096) return null;
  let found = null;
  for (const item of header.split(';')) {
    const split = item.indexOf('=');
    if (split < 0 || item.slice(0, split).trim() !== COOKIE_NAME) continue;
    if (found !== null) return null;
    found = item.slice(split + 1).trim();
  }
  return found && /^[A-Za-z0-9_-]{43}$/.test(found) ? found : null;
}

function isLoopback(address) {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

export function requestIp(req) {
  const remote = req.socket.remoteAddress || 'unknown';
  const candidate = req.headers['x-real-ip'];
  // The listener only binds to loopback; trust one nginx-overwritten address header only
  // when the TCP peer is the local reverse proxy. Never use X-Forwarded-For.
  if (isLoopback(remote) && typeof candidate === 'string' && candidate.length <= 64
    && !candidate.includes(',') && isIP(candidate) !== 0) {
    return candidate.toLowerCase();
  }
  return remote.toLowerCase();
}

export class BoundedRateLimiter {
  constructor(maxKeys = 4096) {
    this.maxKeys = maxKeys;
    this.entries = new Map();
  }

  allow(ip, bucket, max, windowMs, now = performance.now()) {
    const key = ip + '|' + bucket;
    let entry = this.entries.get(key);
    if (!entry || entry.until <= now) {
      entry = { count: 0, until: now + windowMs };
      this.entries.delete(key);
      this.entries.set(key, entry);
    } else {
      this.entries.delete(key);
      this.entries.set(key, entry);
    }
    entry.count++;
    if (this.entries.size > this.maxKeys) {
      for (const [oldKey, oldEntry] of this.entries) {
        if (oldEntry.until <= now || this.entries.size > this.maxKeys) this.entries.delete(oldKey);
        if (this.entries.size <= this.maxKeys) break;
      }
    }
    return entry.count <= max;
  }
}

export function readJson(req) {
  const contentType = req.headers['content-type'];
  if (typeof contentType !== 'string' || contentType.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
    return Promise.reject(httpError(415, 'json_required'));
  }
  const charset = /(?:^|;)\s*charset\s*=\s*([^;]+)/i.exec(contentType)?.[1]?.trim().replace(/^['"]|['"]$/g, '');
  if (charset && charset.toLowerCase() !== 'utf-8') return Promise.reject(httpError(415, 'json_required'));

  const contentLength = req.headers['content-length'];
  if (contentLength !== undefined) {
    if (typeof contentLength !== 'string' || !/^\d+$/.test(contentLength)) {
      req.resume();
      return Promise.reject(httpError(400, 'invalid_request'));
    }
    if (Number(contentLength) > MAX_BODY_BYTES) {
      req.resume();
      return Promise.reject(httpError(413, 'body_too_large'));
    }
  }

  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    const fail = error => {
      if (settled) return;
      settled = true;
      chunks.length = 0;
      reject(error);
    };
    req.on('data', chunk => {
      if (settled) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        fail(httpError(413, 'body_too_large'));
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      try {
        resolve(JSON.parse(Buffer.concat(chunks, size).toString('utf8')));
      } catch {
        reject(httpError(400, 'invalid_json'));
      }
    });
    req.on('aborted', () => fail(httpError(400, 'invalid_request')));
    req.on('error', () => fail(httpError(400, 'invalid_request')));
  });
}

export function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function exactKeys(value, keys, optional = []) {
  const actual = Object.keys(value);
  return keys.every(key => Object.hasOwn(value, key))
    && actual.every(key => keys.includes(key) || optional.includes(key));
}

export function validateSubmitBody(body, maxFrames, maxInputs) {
  if (!isObject(body) || !exactKeys(body, ['runId', 'frames', 'inputs', 'pageId'])) {
    throw httpError(400, 'invalid_request');
  }
  if (!Number.isInteger(body.frames) || body.frames < 1 || body.frames > maxFrames
    || !Array.isArray(body.inputs) || body.inputs.length > maxInputs) {
    throw httpError(400, 'invalid_replay');
  }
  const inputs = [];
  let previousFrame = -1;
  for (const input of body.inputs) {
    if (!isObject(input) || !exactKeys(input, ['frame', 'action'])
      || !Number.isInteger(input.frame) || input.frame < 0 || input.frame >= body.frames
      || input.frame < previousFrame || !ACTIONS.has(input.action)) {
      throw httpError(400, 'invalid_replay');
    }
    previousFrame = input.frame;
    inputs.push({ frame: input.frame, action: input.action });
  }
  return { frames: body.frames, inputs };
}

export function cookieHeader(token, secure) {
  const expiry = new Date(Date.now() + COOKIE_MAX_AGE_SECONDS * 1000).toUTCString();
  return COOKIE_NAME + '=' + token
    + '; Path=' + API_PATH
    + '; Max-Age=' + COOKIE_MAX_AGE_SECONDS
    + '; Expires=' + expiry
    + '; HttpOnly; SameSite=Lax'
    + (secure ? '; Secure' : '');
}
