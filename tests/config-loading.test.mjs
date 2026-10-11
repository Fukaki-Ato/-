import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadAllConfig } from '../packages/game/dist/core/config/configLoader.js';
import { CONTENT_NAMES } from '../packages/game/dist/core/config/configTypes.js';
import { preloadStartupConfig } from '../apps/web/build/startupConfig.js';

const config = name => JSON.parse(readFileSync(new URL(`../config/${name}.json`, import.meta.url), 'utf8'));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const turn = () => new Promise(resolve => setImmediate(resolve));

test('all config requests start before any completes; report order stays deterministic', async () => {
  const pending = new Map();
  const writes = [];
  const reportPromise = loadAllConfig({
    fetchJson(name) {
      const request = deferred();
      pending.set(name, request);
      return request.promise;
    },
    cacheGet: () => null,
    cacheSet: key => writes.push(key),
  }, name => name);
  assert.deepEqual([...pending.keys()], [...CONTENT_NAMES]);
  for (const name of [...CONTENT_NAMES].reverse()) pending.get(name).resolve(config(name));
  const report = await reportPromise;
  assert.equal(report.ok, true, report.errors.join('\n'));
  assert.deepEqual(Object.keys(report.content), [...CONTENT_NAMES]);
  assert.deepEqual(Object.keys(report.sources), [...CONTENT_NAMES]);
  assert.ok(Object.values(report.sources).every(source => source === 'network'));
  assert.deepEqual(writes, [...CONTENT_NAMES].reverse().map(name => `thunderrun:config:${name}`));
});

test('successful config is validated and cached while another request is still pending', async () => {
  const slow = deferred();
  const writes = new Map();
  const lastName = CONTENT_NAMES.at(-1);
  let finished = false;
  const reportPromise = loadAllConfig({
    fetchJson: name => name === lastName ? slow.promise : Promise.resolve(config(name)),
    cacheGet: () => null,
    cacheSet: (key, value) => writes.set(key, JSON.parse(value)),
  }, name => name).then(report => { finished = true; return report; });
  await turn();
  assert.equal(finished, false);
  assert.equal(writes.size, CONTENT_NAMES.length - 1, 'slow request must not delay successful cache writes');
  for (const name of CONTENT_NAMES.slice(0, -1)) {
    assert.deepEqual(writes.get(`thunderrun:config:${name}`), config(name));
  }
  slow.resolve(config(lastName));
  const report = await reportPromise;
  assert.equal(report.ok, true, report.errors.join('\n'));
  assert.deepEqual(Object.keys(report.content), [...CONTENT_NAMES]);
  assert.equal(writes.size, CONTENT_NAMES.length);
});

test('parallel loading retains per-file network/cache fallback and rejects malformed data', async () => {
  const cached = new Map(CONTENT_NAMES.map(name => [`thunderrun:config:${name}`, JSON.stringify(config(name))]));
  const writes = [];
  const report = await loadAllConfig({
    async fetchJson(name) {
      if (name === 'game') return config(name);
      if (name === 'characters') return {}; // 网络坏数据不能被缓存掩盖
      throw new Error('offline');
    },
    cacheGet: key => cached.get(key) ?? null,
    cacheSet: key => writes.push(key),
  }, name => name);
  assert.equal(report.ok, false);
  assert.equal(report.sources.game, 'network');
  assert.equal(report.sources.characters, 'failed');
  for (const name of CONTENT_NAMES.filter(name => !['game', 'characters'].includes(name))) {
    assert.equal(report.sources[name], 'cache');
  }
  assert.deepEqual(writes, ['thunderrun:config:game']);
  assert.ok(report.errors.length > 0);
});

test('offline errors remain in config order, including corrupt/missing cache', async () => {
  const pending = new Map();
  const reportPromise = loadAllConfig({
    fetchJson(name) { const request = deferred(); pending.set(name, request); return request.promise; },
    cacheGet: key => key.endsWith(':game') ? 'broken json' : null,
    cacheSet: () => assert.fail('invalid data must not be cached'),
  }, name => name);
  for (const name of [...CONTENT_NAMES].reverse()) pending.get(name).reject(new Error('offline'));
  const report = await reportPromise;
  assert.equal(report.ok, false);
  assert.deepEqual(report.errors, CONTENT_NAMES.map(name => `${name}: 网络与缓存均不可用`));
});

test('startup prefetch overlaps UI work and shares game.json until cleared', async () => {
  const calls = [];
  const pending = new Map();
  const resolve = name => `/thunder-run/${name}.json`;
  const startup = preloadStartupConfig(url => {
    calls.push(url);
    const request = deferred(); pending.set(url, request);
    return request.promise;
  }, resolve);
  const uiGame = startup.fetchJson(resolve('game'));
  await turn();
  assert.deepEqual(calls, CONTENT_NAMES.map(resolve));
  assert.strictEqual(startup.fetchJson(resolve('game')), uiGame);
  for (const name of CONTENT_NAMES) pending.get(resolve(name)).resolve(config(name));
  await uiGame;
  const report = await loadAllConfig({ fetchJson: startup.fetchJson, cacheGet: () => null, cacheSet() {} }, resolve);
  assert.equal(report.ok, true, report.errors.join('\n'));
  assert.equal(calls.length, CONTENT_NAMES.length, 'UI and flow use one request per config');
  startup.clear();
  const fresh = startup.fetchJson(resolve('game'));
  await turn();
  pending.get(resolve('game')).resolve(config('game'));
  await fresh;
  assert.equal(calls.length, CONTENT_NAMES.length + 1, 'no stale in-memory config after boot');
});

test('failed speculative requests are handled and remain available for offline fallback', async () => {
  const startup = preloadStartupConfig(() => { throw new Error('offline'); }, name => name);
  await turn(); // 未正式消费的 rejection 也不能冒出 unhandledRejection
  const report = await loadAllConfig({
    fetchJson: startup.fetchJson,
    cacheGet: key => JSON.stringify(config(key.replace('thunderrun:config:', ''))),
    cacheSet() {},
  }, name => name);
  assert.equal(report.ok, true, report.errors.join('\n'));
  assert.ok(Object.values(report.sources).every(source => source === 'cache'));
  startup.clear();
});
