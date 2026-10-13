import { createHash, randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';

export const PAGE_COOKIE = 'tr_rank_session';
export const PAGE_META = 'tr-rank-page';
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const digest = value => createHash('sha256').update(value).digest('hex');
export function opaqueCookie(header, name) {
  if (typeof header !== 'string' || header.length > 8192) return null;
  const values = header.split(';').map(v => v.trim()).filter(v => v.startsWith(name + '='));
  if (values.length !== 1) return null;
  const token = values[0].slice(name.length + 1);
  return TOKEN.test(token) ? token : null;
}

/** Server-observed eligibility only, not remote attestation of arbitrary client code. */
export class PageSessions {
  constructor({ secure = false, now = () => performance.now(), ttlMs = 6 * 60 * 60 * 1000,
    maxSessions = 5000, maxPages = 20000 } = {}) {
    this.secure = secure; this.now = now; this.ttlMs = ttlMs;
    this.maxSessions = maxSessions; this.maxPages = maxPages;
    this.sessions = new Map(); this.pages = new Map();
  }
  cookie(token) {
    return `${PAGE_COOKIE}=${token}; Path=/thunder-run/; Max-Age=${Math.floor(this.ttlMs / 1000)}; HttpOnly; SameSite=Lax${this.secure ? '; Secure' : ''}`;
  }
  cleanup() {
    const now = this.now();
    for (const [key, session] of this.sessions) if (session.expiresAt <= now) this.sessions.delete(key);
    for (const [key, page] of this.pages) if (page.expiresAt <= now || !this.sessions.has(page.sessionHash)) this.pages.delete(key);
  }
  revoke(header) {
    const token = opaqueCookie(header, PAGE_COOKIE);
    const session = token && this.sessions.get(digest(token));
    if (session) session.revoked = true;
  }
  issue(header) {
    this.cleanup();
    if (this.pages.size >= this.maxPages) return null;
    let token = opaqueCookie(header, PAGE_COOKIE);
    let session = token && this.sessions.get(digest(token));
    if (!session || session.revoked) {
      if (this.sessions.size >= this.maxSessions) return null;
      token = randomBytes(32).toString('base64url');
      session = { hash: digest(token), revoked: false, expiresAt: this.now() + this.ttlMs };
      this.sessions.set(session.hash, session);
    }
    session.expiresAt = this.now() + this.ttlMs;
    const pageId = randomBytes(32).toString('base64url');
    const page = { hash: digest(pageId), sessionHash: session.hash, expiresAt: session.expiresAt };
    this.pages.set(page.hash, page);
    return { pageId, cookie: this.cookie(token) };
  }
  authorize(header, pageId) {
    this.cleanup();
    const token = opaqueCookie(header, PAGE_COOKIE);
    if (!token || typeof pageId !== 'string' || !TOKEN.test(pageId)) return null;
    const session = this.sessions.get(digest(token)), page = this.pages.get(digest(pageId));
    if (!session || session.revoked || !page || page.sessionHash !== session.hash) return null;
    return { sessionHash: session.hash, pageHash: page.hash, pageId, token };
  }
  renew(auth) {
    const verified = this.authorize(`${PAGE_COOKIE}=${auth.token}`, auth.pageId);
    if (!verified || verified.sessionHash !== auth.sessionHash || verified.pageHash !== auth.pageHash) return null;
    const session = this.sessions.get(auth.sessionHash), page = this.pages.get(auth.pageHash);
    if (!session || session.revoked || !page) return null;
    session.expiresAt = this.now() + this.ttlMs; page.expiresAt = session.expiresAt;
    return this.cookie(auth.token);
  }
  matches(header, pageId, bound) {
    const auth = this.authorize(header, pageId);
    return auth && auth.sessionHash === bound.sessionHash && auth.pageHash === bound.pageHash;
  }
}
