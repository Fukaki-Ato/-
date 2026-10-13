import test from 'node:test';
import assert from 'node:assert/strict';
import { PageSessions, PAGE_COOKIE, opaqueCookie } from '../server/pageSessions.mjs';

function cookiePair(setCookie) {
  assert.equal(typeof setCookie, 'string');
  const pair = setCookie.split(';', 1)[0];
  assert.equal(Boolean(opaqueCookie(pair, PAGE_COOKIE)), true, 'issuance has one opaque cookie pair');
  return pair;
}

function authorized(sessions, header, pageId) {
  return Boolean(sessions.authorize(header, pageId));
}

test('page credentials are cryptorandom opaque HttpOnly cookies scoped to the game path', () => {
  const sessions = new PageSessions();
  const first = sessions.issue();
  const second = sessions.issue();
  const firstCookie = cookiePair(first.cookie);
  const secondCookie = cookiePair(second.cookie);
  const token = opaqueCookie(firstCookie, PAGE_COOKIE);

  assert.equal(PAGE_COOKIE, 'tr_rank_session');
  assert.equal(token.length === 43, true);
  assert.equal(Buffer.from(token, 'base64url').length === 32, true);
  assert.equal(firstCookie.startsWith(PAGE_COOKIE + '='), true);
  assert.equal(first.cookie.includes('; Path=/thunder-run/;'), true);
  assert.equal(/; *HttpOnly(?:;|$)/i.test(first.cookie), true);
  assert.equal(/; *SameSite=Lax(?:;|$)/i.test(first.cookie), true);
  assert.equal(/; *Secure(?:;|$)/i.test(first.cookie), false);
  assert.equal(firstCookie === secondCookie, false, 'independent browser sessions receive distinct tokens');
  assert.equal(first.pageId === second.pageId, false, 'independent documents receive distinct capabilities');

  const secure = new PageSessions({ secure: true }).issue();
  assert.equal(/; *Secure(?:;|$)/i.test(secure.cookie), true);
});

test('same-browser documents have distinct page capabilities and tickets do not cross-match', () => {
  const sessions = new PageSessions();
  const docA = sessions.issue();
  const cookie = cookiePair(docA.cookie);
  const docB = sessions.issue(cookie);
  const authA = sessions.authorize(cookie, docA.pageId);
  const authB = sessions.authorize(cookie, docB.pageId);

  assert.equal(cookiePair(docB.cookie) === cookie, true, 'a normal second document reuses its browser cookie');
  assert.equal(docA.pageId === docB.pageId, false);
  assert.equal(Boolean(authA), true);
  assert.equal(Boolean(authB), true);
  assert.equal(Boolean(sessions.matches(cookie, docA.pageId, authA)), true);
  assert.equal(Boolean(sessions.matches(cookie, docB.pageId, authA)), false);
  assert.equal(Boolean(sessions.matches(cookie, docA.pageId, authB)), false);
  assert.equal(Boolean(sessions.matches(cookie, docB.pageId, authB)), true);
});

test('authorization requires a valid matching cookie and an issued per-document page id', () => {
  const sessions = new PageSessions();
  const doc = sessions.issue();
  const cookie = cookiePair(doc.cookie);
  const otherBrowser = cookiePair(sessions.issue().cookie);

  assert.equal(authorized(sessions, undefined, doc.pageId), false);
  assert.equal(authorized(sessions, '', doc.pageId), false);
  assert.equal(authorized(sessions, cookie, undefined), false);
  assert.equal(authorized(sessions, cookie, null), false);
  assert.equal(authorized(sessions, cookie, 123), false);
  assert.equal(authorized(sessions, cookie, 'not-a-page-id'), false);
  assert.equal(authorized(sessions, cookie, 'A'.repeat(43)), false, 'a well-shaped but forged page id is not eligible');
  assert.equal(authorized(sessions, otherBrowser, doc.pageId), false, 'a copied document capability needs its original browser cookie');

  assert.equal(opaqueCookie(undefined, PAGE_COOKIE), null);
  assert.equal(opaqueCookie('other=value', PAGE_COOKIE), null);
  assert.equal(opaqueCookie(PAGE_COOKIE + '=malformed', PAGE_COOKIE), null);
  assert.equal(opaqueCookie(cookie + '; ' + cookie, PAGE_COOKIE) === null, true, 'duplicate cookie names fail closed');
  assert.equal(opaqueCookie('x'.repeat(8193), PAGE_COOKIE), null, 'oversized cookie headers fail closed');
  assert.equal(authorized(sessions, cookie + '; ' + cookie, doc.pageId), false);
  assert.equal(authorized(sessions, PAGE_COOKIE + '=broken', doc.pageId), false);
});

test('debug revocation invalidates every old document capability and fresh issuance cannot rescue old tickets', () => {
  const sessions = new PageSessions();
  const docA = sessions.issue();
  const oldCookie = cookiePair(docA.cookie);
  const docB = sessions.issue(oldCookie);
  const boundA = sessions.authorize(oldCookie, docA.pageId);
  const boundB = sessions.authorize(oldCookie, docB.pageId);

  sessions.revoke(oldCookie);
  assert.equal(authorized(sessions, oldCookie, docA.pageId), false);
  assert.equal(authorized(sessions, oldCookie, docB.pageId), false);
  assert.equal(Boolean(sessions.matches(oldCookie, docA.pageId, boundA)), false);
  assert.equal(Boolean(sessions.matches(oldCookie, docB.pageId, boundB)), false);

  const fresh = sessions.issue(oldCookie);
  const freshCookie = cookiePair(fresh.cookie);
  assert.equal(freshCookie === oldCookie, false, 'revoked identity is replaced, not reused');
  assert.equal(fresh.pageId === docA.pageId || fresh.pageId === docB.pageId, false);
  assert.equal(authorized(sessions, freshCookie, fresh.pageId), true);
  assert.equal(authorized(sessions, oldCookie, docA.pageId), false);
  assert.equal(authorized(sessions, freshCookie, docA.pageId), false, 'an old ticket is not rebound to the fresh cookie');
  assert.equal(Boolean(sessions.matches(freshCookie, fresh.pageId, boundA)), false);
});

test('an injected clock expires sessions and pages, while renewal extends both cookie and page eligibility', () => {
  let now = 0;
  const ttlMs = 10_000;
  const sessions = new PageSessions({ now: () => now, ttlMs });
  const docA = sessions.issue();
  const originalCookie = cookiePair(docA.cookie);
  const docB = sessions.issue(originalCookie);
  const authA = sessions.authorize(originalCookie, docA.pageId);
  assert.equal(Boolean(authA), true);

  now = 5_000;
  const renewedSetCookie = sessions.renew(authA);
  assert.equal(typeof renewedSetCookie, 'string');
  const renewedCookie = cookiePair(renewedSetCookie);
  assert.equal(renewedCookie === originalCookie, true, 'renewal extends the existing browser cookie');
  assert.equal(/; *Max-Age=10(?:;|$)/i.test(renewedSetCookie), true);
  assert.equal(/; *HttpOnly(?:;|$)/i.test(renewedSetCookie), true);

  now = ttlMs + 1;
  assert.equal(authorized(sessions, renewedCookie, docA.pageId), true, 'renewed page and session outlive their original expiry');
  assert.equal(authorized(sessions, renewedCookie, docB.pageId), false, 'renewing one page does not extend another page capability');
  now = 15_000 - 1;
  assert.equal(authorized(sessions, renewedCookie, docA.pageId), true);
  now = 15_000;
  assert.equal(authorized(sessions, renewedCookie, docA.pageId), false, 'the renewed page expires at its new deadline');
  assert.equal(sessions.sessions.size, 0);
  assert.equal(sessions.pages.size, 0);
  assert.equal(sessions.renew(authA), null, 'renewal cannot resurrect expired eligibility');

  let expiryNow = 0;
  const expiring = new PageSessions({ now: () => expiryNow, ttlMs });
  const unrenewed = expiring.issue();
  const unrenewedCookie = cookiePair(unrenewed.cookie);
  expiryNow = ttlMs;
  assert.equal(authorized(expiring, unrenewedCookie, unrenewed.pageId), false, 'an unrenewed session expires at the TTL boundary');
  assert.equal(expiring.sessions.size, 0);
  assert.equal(expiring.pages.size, 0);
});

test('session and page capacity limits fail closed and keep maps bounded', () => {
  let now = 0;
  const ttlMs = 100;
  const pageLimited = new PageSessions({ now: () => now, ttlMs, maxSessions: 3, maxPages: 2 });
  const browserDocA = pageLimited.issue();
  const browserCookie = cookiePair(browserDocA.cookie);
  assert.equal(pageLimited.issue(browserCookie) !== null, true);
  for (let i = 0; i < 50; i++) assert.equal(pageLimited.issue(browserCookie), null);
  assert.equal(pageLimited.pages.size, 2);
  assert.equal(pageLimited.sessions.size, 1);

  const sessionLimited = new PageSessions({ now: () => now, ttlMs, maxSessions: 2, maxPages: 10 });
  assert.equal(sessionLimited.issue() !== null, true);
  assert.equal(sessionLimited.issue() !== null, true);
  for (let i = 0; i < 50; i++) assert.equal(sessionLimited.issue(), null);
  assert.equal(sessionLimited.sessions.size, 2);
  assert.equal(sessionLimited.pages.size, 2);

  now = ttlMs;
  const afterExpiry = sessionLimited.issue();
  assert.equal(afterExpiry !== null, true, 'expired records are cleaned before new capacity is allocated');
  assert.equal(sessionLimited.sessions.size, 1);
  assert.equal(sessionLimited.pages.size, 1);
});

test('a server restart resets eligibility for all previously issued page credentials', () => {
  const oldServer = new PageSessions();
  const oldDoc = oldServer.issue();
  const oldCookie = cookiePair(oldDoc.cookie);
  assert.equal(authorized(oldServer, oldCookie, oldDoc.pageId), true);

  const restartedServer = new PageSessions();
  assert.equal(authorized(restartedServer, oldCookie, oldDoc.pageId), false);
  const fresh = restartedServer.issue(oldCookie);
  const freshCookie = cookiePair(fresh.cookie);
  assert.equal(freshCookie === oldCookie, false);
  assert.equal(authorized(restartedServer, oldCookie, oldDoc.pageId), false);
  assert.equal(authorized(restartedServer, freshCookie, oldDoc.pageId), false);
  assert.equal(authorized(restartedServer, freshCookie, fresh.pageId), true);
});
