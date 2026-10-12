import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { existsSync, realpathSync } from 'node:fs';
import { LeaderboardStore } from './store.mjs';
import { ReplayPool } from './replay-pool.mjs';

export const API_PATH = '/thunder-run/api';
const COOKIE_NAME = 'tr_lb';
const COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_ACTIVE_CHALLENGES = 5000;
const MAX_CHALLENGES_PER_PLAYER = 5;
const RUN_TTL_MS = (1800 + 60) * 1000;
const UPLOAD_CLOCK_SLOP_MS = 2000;
const ACTIONS = new Set(['jump', 'slide', 'laneL', 'laneR', 'skill']);
const DEFAULT_ORIGINS = ['http://localhost:8767', 'http://127.0.0.1:8767'];

class HttpError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

function httpError(status, code) {
  return new HttpError(status, code);
}

function parseBoundedInteger(value, fallback, min, max) {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return fallback;
  return parsed;
}

function normalizeOrigins(values) {
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

function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function serverTimeUs(monotonicMs = performance.now()) {
  return Math.round((performance.timeOrigin + monotonicMs) * 1000);
}

function sendJson(res, status, body, cookie) {
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

function errorResponse(res, status, code) {
  sendJson(res, status, { error: { code } });
}

function readCookie(header) {
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

function requestIp(req) {
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

class BoundedRateLimiter {
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

function readJson(req) {
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

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, keys) {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

function validateSubmitBody(body, maxFrames, maxInputs) {
  if (!isObject(body) || !exactKeys(body, ['runId', 'frames', 'inputs'])) {
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

function cookieHeader(token, secure) {
  const expiry = new Date(Date.now() + COOKIE_MAX_AGE_SECONDS * 1000).toUTCString();
  return COOKIE_NAME + '=' + token
    + '; Path=' + API_PATH
    + '; Max-Age=' + COOKIE_MAX_AGE_SECONDS
    + '; Expires=' + expiry
    + '; HttpOnly; SameSite=Lax'
    + (secure ? '; Secure' : '');
}

export async function createLeaderboardServer(options = {}) {
  const [{ loadContent }, { playableCharacters, isCharacterLocked }, rules] = await Promise.all([
    import('../tools/replay/runner.mjs'),
    import('../packages/game/dist/core/sim/character.js'),
    import('../packages/game/dist/flow/leaderboard.js'),
  ]);
  const content = options.content ?? loadContent();
  const allowedOrigins = normalizeOrigins(options.origins
    ?? process.env.TR_LEADERBOARD_ORIGINS
    ?? DEFAULT_ORIGINS);
  const expectedRulesId = rules.leaderboardRulesId(content);
  const maxFrames = rules.MAX_RANKED_FRAMES;
  const maxInputs = rules.MAX_RANKED_INPUTS;
  const liveCharacters = new Set(playableCharacters(content)
    .filter(character => character.status === 'live' && !isCharacterLocked(character))
    .map(character => character.id));
  const store = new LeaderboardStore(options.dbPath
    ?? process.env.TR_LEADERBOARD_DB
    ?? resolve(process.cwd(), 'data/leaderboard.sqlite'));
  const workerPool = new ReplayPool({
    size: options.workerCount ?? parseBoundedInteger(process.env.TR_LEADERBOARD_WORKERS, 2, 1, 4),
    maxQueue: options.maxQueue ?? parseBoundedInteger(process.env.TR_LEADERBOARD_QUEUE, 8, 0, 64),
    timeoutMs: options.replayTimeoutMs ?? parseBoundedInteger(process.env.TR_LEADERBOARD_REPLAY_TIMEOUT_MS, 15_000, 250, 18_000),
    content,
  });
  const challenges = new Map();
  const limiter = new BoundedRateLimiter();
  const secureCookie = options.secureCookie
    ?? /^(1|true|yes)$/i.test(process.env.TR_LEADERBOARD_COOKIE_SECURE ?? '');

  function cleanupChallenges(now = performance.now()) {
    for (const [runId, challenge] of challenges) {
      if (challenge.expiresAt <= now) challenges.delete(runId);
    }
  }

  function ensureIdentity(req, res, ip) {
    const oldToken = readCookie(req.headers.cookie);
    if (oldToken) {
      const oldHash = sha256(oldToken);
      const playerName = store.getPlayer(oldHash);
      if (playerName) return { tokenHash: oldHash, playerName, setCookie: null };
    }
    if (!limiter.allow(ip, 'identity', 10, 60_000)) throw httpError(429, 'rate_limited');
    const token = randomBytes(32).toString('base64url');
    const tokenHash = sha256(token);
    const playerName = store.createPlayer(tokenHash);
    return { tokenHash, playerName, setCookie: cookieHeader(token, secureCookie) };
  }

  function existingIdentity(req) {
    const token = readCookie(req.headers.cookie);
    if (!token) throw httpError(404, 'challenge_unavailable');
    const tokenHash = sha256(token);
    const playerName = store.getPlayer(tokenHash);
    if (!playerName) throw httpError(404, 'challenge_unavailable');
    return { tokenHash, playerName, setCookie: null };
  }

  async function handle(req, res) {
    if (req.method !== 'POST' && (req.headers['transfer-encoding'] !== undefined
      || (req.headers['content-length'] !== undefined && req.headers['content-length'] !== '0'))) {
      throw httpError(400, 'invalid_request');
    }
    const url = new URL(req.url ?? '/', 'http://localhost');
    const pathname = url.pathname;
    if (pathname === API_PATH + '/health' && req.method === 'GET') {
      try {
        store.db.prepare('SELECT 1 AS ok').get();
        sendJson(res, 200, { ok: true });
      } catch {
        sendJson(res, 503, { error: { code: 'unavailable' } });
      }
      return;
    }

    const ip = requestIp(req);
    if (pathname === API_PATH + '/leaderboard' && req.method === 'GET') {
      if (!limiter.allow(ip, 'list', 60, 60_000)) throw httpError(429, 'rate_limited');
      const identity = ensureIdentity(req, res, ip);
      sendJson(res, 200, store.list(identity.tokenHash), identity.setCookie);
      return;
    }

    if (pathname === API_PATH + '/runs' && req.method === 'POST') {
      if (!allowedOrigins.has(req.headers.origin)) throw httpError(403, 'origin_denied');
      if (!limiter.allow(ip, 'begin', 15, 60_000)) throw httpError(429, 'rate_limited');
      const body = await readJson(req);
      if (!isObject(body) || !exactKeys(body, ['charId', 'rulesId'])
        || typeof body.charId !== 'string' || body.charId.length > 64
        || typeof body.rulesId !== 'string') {
        throw httpError(400, 'invalid_request');
      }
      if (body.rulesId !== expectedRulesId) throw httpError(409, 'rules_mismatch');
      if (!liveCharacters.has(body.charId)) throw httpError(400, 'invalid_character');
      cleanupChallenges();
      if (challenges.size >= MAX_ACTIVE_CHALLENGES) throw httpError(503, 'challenge_capacity');
      const identity = ensureIdentity(req, res, ip);
      let pending = 0;
      for (const challenge of challenges.values()) {
        if (challenge.tokenHash === identity.tokenHash) pending++;
      }
      if (pending >= MAX_CHALLENGES_PER_PLAYER) throw httpError(429, 'rate_limited');
      const runId = randomBytes(32).toString('base64url');
      const seed = randomBytes(4).readUInt32BE(0);
      const issuedAt = performance.now();
      challenges.set(runId, {
        tokenHash: identity.tokenHash,
        charId: body.charId,
        seed,
        rulesId: expectedRulesId,
        issuedAt,
        expiresAt: issuedAt + RUN_TTL_MS,
      });
      sendJson(res, 201, { runId, seed, rulesId: expectedRulesId }, identity.setCookie);
      return;
    }

    if (pathname === API_PATH + '/runs/submit' && req.method === 'POST') {
      if (!allowedOrigins.has(req.headers.origin)) throw httpError(403, 'origin_denied');
      if (!limiter.allow(ip, 'submit', 30, 60_000)) throw httpError(429, 'rate_limited');
      const body = await readJson(req);
      if (!isObject(body)) throw httpError(400, 'invalid_request');
      const identity = existingIdentity(req);
      if (typeof body.runId !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(body.runId)) {
        throw httpError(400, 'invalid_request');
      }
      cleanupChallenges();
      const challenge = challenges.get(body.runId);
      if (!challenge || challenge.tokenHash !== identity.tokenHash) throw httpError(404, 'challenge_unavailable');
      challenges.delete(body.runId); // A bound ticket is consumed on its first JSON submission attempt.

      const replay = validateSubmitBody(body, maxFrames, maxInputs);
      const requiredMs = replay.frames * (1000 / 60) - UPLOAD_CLOCK_SLOP_MS;
      if (performance.now() - challenge.issuedAt < requiredMs) {
        sendJson(res, 200, { accepted: false }, identity.setCookie);
        return;
      }
      let result;
      try {
        result = await workerPool.run({
          seed: challenge.seed,
          charId: challenge.charId,
          frames: replay.frames,
          inputs: replay.inputs,
        });
      } catch (error) {
        const code = ['replay_busy', 'replay_timeout', 'replay_worker_failed'].includes(error?.code)
          ? error.code : 'replay_unavailable';
        throw httpError(503, code);
      }
      if (result.accepted) {
        store.recordBest({
          tokenHash: identity.tokenHash,
          charId: challenge.charId,
          distance: result.distance,
          score: result.score,
          achievedAt: serverTimeUs(),
        });
      }
      sendJson(res, 200, { accepted: result.accepted === true }, identity.setCookie);
      return;
    }

    if (pathname === API_PATH + '/runs/cancel' && req.method === 'POST') {
      if (!allowedOrigins.has(req.headers.origin)) throw httpError(403, 'origin_denied');
      if (!limiter.allow(ip, 'cancel', 60, 60_000)) throw httpError(429, 'rate_limited');
      const body = await readJson(req);
      if (!isObject(body) || !exactKeys(body, ['runId'])
        || typeof body.runId !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(body.runId)) {
        throw httpError(400, 'invalid_request');
      }
      const identity = existingIdentity(req);
      const challenge = challenges.get(body.runId);
      if (challenge && challenge.tokenHash !== identity.tokenHash) throw httpError(404, 'challenge_unavailable');
      challenges.delete(body.runId);
      sendJson(res, 200, { cancelled: true });
      return;
    }

    if (pathname === API_PATH + '/leaderboard' || pathname === API_PATH + '/runs'
      || pathname === API_PATH + '/runs/submit' || pathname === API_PATH + '/runs/cancel') {
      throw httpError(405, 'method_not_allowed');
    }
    throw httpError(404, 'not_found');
  }

  const server = createServer((req, res) => {
    void handle(req, res).catch(error => {
      if (res.writableEnded || res.destroyed) return;
      if (!req.readableEnded && !req.destroyed) {
        res.setHeader('Connection', 'close');
        req.on('error', () => {});
        req.resume();
      }
      if (error instanceof HttpError) errorResponse(res, error.status, error.code);
      else errorResponse(res, 500, 'server_error');
    });
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 100;

  let closing = null;
  return {
    server,
    expectedRulesId,
    async listen(port = parseBoundedInteger(process.env.TR_LEADERBOARD_PORT, 8788, 0, 65535), host = '127.0.0.1') {
      if (host !== '127.0.0.1' && host !== '::1') throw new TypeError('Leaderboard API must bind to loopback');
      await new Promise((resolveListen, rejectListen) => {
        const onError = error => {
          server.off('listening', onListening);
          rejectListen(error);
        };
        const onListening = () => {
          server.off('error', onError);
          resolveListen(server.address());
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(port, host);
      });
      return server.address();
    },
    async close() {
      if (closing) return closing;
      closing = (async () => {
        if (server.listening) {
          await new Promise(resolveClose => server.close(resolveClose));
        }
        await workerPool.close();
        store.close();
      })();
      return closing;
    },
  };
}

async function main() {
  let service;
  try {
    service = await createLeaderboardServer();
    const address = await service.listen();
    console.log('Leaderboard API listening on http://127.0.0.1:' + address.port);
    const stop = async () => {
      await service.close();
      process.exit(0);
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  } catch (error) {
    await service?.close();
    throw error;
  }
}

if (process.argv[1] && existsSync(process.argv[1]) && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    console.error('Leaderboard API failed to start. Check configuration and built game files.');
    process.exitCode = 1;
  });
}
