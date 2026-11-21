import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const { createProfileHandler, initialContent, playerIdFor, newProfile } = require('../cloudfunctions/thunder-api/profile.cjs');
const { COLLECTION, createCloudBaseStore } = require('../cloudfunctions/thunder-api/cloudbase-store.cjs');
const readJson = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const content = initialContent(readJson('../config/characters.json'), readJson('../config/themes.json'));
const trusted = { APPID: 'wx-approved', OPENID: 'trusted-player-openid' };
const timestamp = '2026-11-06T10:00:00.000Z';

// Optimistic transaction contract: snapshots, staged writes, conflict retry,
// commit-before-resolution. This is deliberately not a claim of cloud testing.
function transactionFixture(failAt) {
  const rows = new Map(), versions = new Map();
  const stats = { transactions: 0, writes: 0, conflicts: 0 };
  const fail = step => { if (step === failAt) throw new Error('private database / credential detail'); };
  const cloud = {
    database(options) {
      assert.deepEqual(options, { throwOnNotFound: false });
      return {
        async runTransaction(callback) {
          for (let attempt = 0; attempt < 4; attempt++) {
            stats.transactions++;
            fail('start');
            const snapshot = structuredClone(rows), readVersions = new Map(), staged = new Map();
            const result = await callback({
              collection(name) {
                assert.equal(name, COLLECTION);
                return {
                  doc(id) {
                    return {
                      async get() {
                        fail('get');
                        readVersions.set(id, versions.get(id) ?? 0);
                        return { data: snapshot.get(id) ?? null };
                      },
                      async set(options) {
                        fail('set');
                        assert.deepEqual(Object.keys(options), ['data']);
                        staged.set(id, structuredClone(options.data));
                      },
                    };
                  },
                };
              },
            });
            fail('commit');
            if ([...readVersions].some(([id, version]) => version !== (versions.get(id) ?? 0))) {
              stats.conflicts++;
              continue;
            }
            for (const [id, row] of staged) {
              rows.set(id, row);
              versions.set(id, (versions.get(id) ?? 0) + 1);
              stats.writes++;
            }
            return structuredClone(result);
          }
          throw new Error('transaction conflict exhausted');
        },
      };
    },
  };
  return { cloud, rows, stats, store: createCloudBaseStore(cloud) };
}

function handler(fixture, options = {}) {
  return createProfileHandler({
    getWXContext: () => trusted, getAppId: () => trusted.APPID,
    store: fixture.store, content, now: () => timestamp, ...options,
  });
}

test('missing server AppID / trusted identity / wrong AppID fail before storage', async () => {
  const fixture = transactionFixture();
  const cases = [
    [{ getAppId: () => undefined }, 'SERVER_NOT_CONFIGURED'],
    [{ getAppId: () => '  ' }, 'SERVER_NOT_CONFIGURED'],
    [{ getWXContext: () => undefined }, 'UNAUTHENTICATED'],
    [{ getWXContext: () => ({ APPID: trusted.APPID }) }, 'UNAUTHENTICATED'],
    [{ getWXContext: () => ({ OPENID: trusted.OPENID }) }, 'UNAUTHENTICATED'],
    [{ getWXContext: () => ({ ...trusted, OPENID: ' ' }) }, 'UNAUTHENTICATED'],
    [{ getWXContext: () => { throw new Error('missing context'); } }, 'UNAUTHENTICATED'],
    [{ getWXContext: () => ({ ...trusted, APPID: 'wx-other' }) }, 'APP_NOT_ALLOWED'],
  ];
  for (const [options, code] of cases) {
    const response = await handler(fixture, options)({ action: 'profile.get', ...trusted });
    assert.equal(response.ok, false);
    assert.equal(response.error.code, code);
    assert.deepEqual(Object.keys(response.error).sort(), ['code', 'message']);
  }
  assert.equal(fixture.stats.transactions, 0);
});

test('initial profile uses server content and zero wallet; self-reported data is ignored', async () => {
  const fixture = transactionFixture();
  const result = await handler(fixture)({
    action: 'profile.get', APPID: 'wx-forged', OPENID: 'forged', openid: 'forged',
    wallet: { coin: 9999, diamond: 9999 }, characterId: 'char_rina',
  });
  assert.deepEqual(result, { ok: true, profile: {
    schemaVersion: 1, revision: 0, playerId: playerIdFor(trusted.APPID, trusted.OPENID),
    wallet: { coin: 0, diamond: 0 }, inventory: { characters: content.characterIds, items: {} },
    preferences: { characterId: content.characterId, themeId: content.themeId },
    createdAt: timestamp, updatedAt: timestamp,
  } });
  assert.equal(fixture.rows.size, 1);
  assert.equal(fixture.stats.writes, 1);
  assert.ok(!JSON.stringify(result).includes(trusted.OPENID));
  assert.ok(!JSON.stringify([...fixture.rows.values()]).includes(trusted.OPENID));
});

test('starter content excludes skins, paid characters and non-live entries', () => {
  const chars = { items: [
    { id: 'skin_free', kind: 'skin', status: 'live', unlock: { type: 'free' } },
    { id: 'char_draft', status: 'draft', unlock: { type: 'free' } },
    { id: 'char_retired', status: 'retired', unlock: { type: 'free' } },
    { id: 'char_paid', status: 'live', unlock: { type: 'coin' } },
    { id: 'char_free', status: 'live', unlock: { type: 'free' } },
    { id: 'char_free2', status: 'live', unlock: { type: 'free' } },
  ] };
  assert.deepEqual(initialContent(chars, { items: [
    { id: 'theme_draft', status: 'draft' }, { id: 'theme_live', status: 'live' },
  ] }), { characterIds: ['char_free', 'char_free2'], characterId: 'char_free', themeId: 'theme_live' });
  assert.throws(() => initialContent({ items: [] }, { items: [] }));
});

test('repeat reads preserve authoritative wallet, inventory, preferences and timestamps', async () => {
  const fixture = transactionFixture(), get = handler(fixture);
  const first = await get({ action: 'profile.get' });
  const row = fixture.rows.get(first.profile.playerId);
  row.wallet = { coin: 75, diamond: 4 };
  row.inventory.characters.push('char_ama');
  row.inventory.items.ticket = 3;
  row.preferences.characterId = 'char_ama';
  row.updatedAt = '2026-11-06T11:00:00.000Z';
  row._id = first.profile.playerId;
  row.openid = 'must-not-be-returned';
  const result = await handler(fixture, { now: () => { throw new Error('must not initialize'); } })({ action: 'profile.get' });
  assert.equal(result.ok, true);
  assert.deepEqual(result.profile.wallet, row.wallet);
  assert.deepEqual(result.profile.inventory, row.inventory);
  assert.deepEqual(result.profile.preferences, row.preferences);
  assert.equal(result.profile.createdAt, timestamp);
  assert.equal(result.profile.updatedAt, row.updatedAt);
  assert.equal(result.profile.openid, undefined);
  assert.equal(result.profile._id, undefined);
  assert.equal(fixture.stats.writes, 1);
});

function legacyProfile() {
  const profile = newProfile(playerIdFor(trusted.APPID, trusted.OPENID),
    { ...content, characterIds: ['char_volt', 'char_ama', 'char_historical_paid'] }, '2026-10-01T00:00:00.000Z');
  profile.revision = 7;
  profile.wallet = { coin: 725, diamond: 14 };
  profile.inventory.items = { key: 6, shard_ama: 60, ticket: 3 };
  profile.preferences = { characterId: 'char_ama', themeId: 'theme_rain_konbini' };
  profile.commerce = { once: { old_purchase: true }, daily: { periodId: '2026-11-06', counts: { old_offer: 2 } } };
  profile.welfare = { handbook: { claimed: { hb_first_run: true } } };
  return profile;
}

test('legacy profile reads atomically add all configured free roles once and preserve purchased history', async () => {
  const fixture = transactionFixture(), before = legacyProfile();
  fixture.rows.set(before.playerId, structuredClone(before));
  const result = await handler(fixture)({ action: 'profile.get' });
  assert.equal(result.ok, true);
  assert.equal(content.characterIds.length, 10);
  const characters = [...before.inventory.characters,
    ...content.characterIds.filter(id => !before.inventory.characters.includes(id))];
  const expected = { ...before, revision: 8, updatedAt: timestamp,
    inventory: { ...before.inventory, characters } };
  assert.deepEqual(fixture.rows.get(before.playerId), expected);
  assert.deepEqual(result.profile.inventory, expected.inventory);
  assert.deepEqual(result.profile.preferences, before.preferences);
  assert.deepEqual(result.profile.wallet, before.wallet);
  assert.deepEqual((await handler(fixture)({ action: 'profile.get' })).profile, result.profile);
  assert.equal(fixture.stats.writes, 1);
});

test('concurrent legacy upgrades preserve balances and commit the free roster only once', async () => {
  const fixture = transactionFixture(), before = legacyProfile();
  fixture.rows.set(before.playerId, structuredClone(before));
  const results = await Promise.all(Array.from({ length: 8 }, () => handler(fixture)({ action: 'profile.get' })));
  assert.ok(results.every(result => result.ok));
  for (const result of results) assert.deepEqual(result, results[0]);
  assert.equal(fixture.stats.writes, 1); assert.ok(fixture.stats.conflicts > 0);
  assert.equal(fixture.rows.get(before.playerId).revision, 8);
  assert.deepEqual(fixture.rows.get(before.playerId).wallet, before.wallet);
  assert.deepEqual(fixture.rows.get(before.playerId).inventory.items, before.inventory.items);
});

for (const failure of ['set', 'commit']) {
  test(`legacy roster ${failure} failure does not return a migration that was not persisted`, async () => {
    const fixture = transactionFixture(failure), before = legacyProfile();
    fixture.rows.set(before.playerId, structuredClone(before));
    const result = await handler(fixture)({ action: 'profile.get' });
    assert.equal(result.ok, false); assert.equal(result.error.code, 'PROFILE_UNAVAILABLE');
    assert.deepEqual(fixture.rows.get(before.playerId), before);
  });
}

test('identity hashing is deterministic, unambiguous and separates applications / players', () => {
  const id = playerIdFor('wx-app', 'player');
  assert.match(id, /^p_[a-f0-9]{64}$/);
  assert.equal(id, playerIdFor('wx-app', 'player'));
  assert.notEqual(id, playerIdFor('wx-other', 'player'));
  assert.notEqual(id, playerIdFor('wx-app', 'other'));
  assert.notEqual(playerIdFor('a', 'bc'), playerIdFor('ab', 'c'));
});

test('unsupported actions expose no generic save or economic write path', async () => {
  const fixture = transactionFixture();
  for (const event of [undefined, {}, { action: 'profile.set' }, { action: 'wallet.grant' }]) {
    assert.equal((await handler(fixture)(event)).error.code, 'INVALID_REQUEST');
  }
  assert.equal(fixture.stats.transactions, 0);
});

for (const step of ['start', 'get', 'set', 'commit']) {
  test(`transaction ${step} failure cannot return success or leak DB details`, async () => {
    const fixture = transactionFixture(step);
    const result = await handler(fixture)({ action: 'profile.get' });
    assert.deepEqual(result, { ok: false, error: {
      code: 'PROFILE_UNAVAILABLE', message: '档案暂时不可用，请稍后重试',
    } });
    assert.equal(fixture.rows.size, 0);
  });
}

test('concurrent initialization retries conflicting snapshots and creates exactly one profile', async () => {
  const fixture = transactionFixture(), get = handler(fixture);
  const responses = await Promise.all(Array.from({ length: 8 }, () => get({ action: 'profile.get' })));
  assert.ok(responses.every(response => response.ok));
  for (const response of responses) assert.deepEqual(response, responses[0]);
  assert.equal(fixture.rows.size, 1);
  assert.equal(fixture.stats.writes, 1);
  assert.ok(fixture.stats.conflicts > 0);
});

test('real entry reads SDK context on each call, not event or main context', async () => {
  const fixture = transactionFixture();
  let identity = trusted, contextReads = 0;
  const cloud = { ...fixture.cloud, DYNAMIC_CURRENT_ENV: Symbol('current-env'),
    init(options) { assert.equal(options.env, this.DYNAMIC_CURRENT_ENV); },
    getWXContext() { contextReads++; return identity; },
  };
  const exported = {};
  vm.runInNewContext(readFileSync(new URL('../cloudfunctions/thunder-api/index.js', import.meta.url), 'utf8'), {
    exports: exported, process: { env: { TR_APP_ID: trusted.APPID } },
    require(name) {
      if (name === 'wx-server-sdk') return cloud;
      if (name === './initial-content.json') return content;
      return require(`../cloudfunctions/thunder-api/${name}`);
    },
  });
  assert.equal((await exported.main({ action: 'profile.get', OPENID: 'forged' }, { OPENID: 'forged' })).ok, true);
  identity = { ...trusted, APPID: 'wx-other' };
  assert.equal((await exported.main({ action: 'profile.get', ...trusted }, trusted)).error.code, 'APP_NOT_ALLOWED');
  assert.equal(contextReads, 2);
});

const sdkPath = fileURLToPath(new URL('../cloudfunctions/thunder-api/node_modules/wx-server-sdk', import.meta.url));
test('installed wx-server-sdk 4.0.2 really supports the selected transaction API and absent doc config',
  { skip: !existsSync(sdkPath) && 'Run npm ci --prefix cloudfunctions/thunder-api --workspaces=false first' }, async () => {
    const sdk = require(sdkPath);
    assert.equal(require(`${sdkPath}/package.json`).version, '4.0.2');
    const cloud = sdk.createNewInstance({ env: 'local-contract-only' });
    const db = cloud.database({ throwOnNotFound: false });
    let persisted = null;
    // Replace only the underlying transport boundary; keep actual SDK
    // Transaction / DocumentReference wrappers, normalization and set options.
    db._db.runTransaction = async callback => callback({ collection(name) {
      assert.equal(name, COLLECTION);
      return { doc() { return {
        async get() { return { data: persisted }; },
        async set(data) { persisted = structuredClone(data); return { upsertedId: 'created' }; },
      }; } };
    } });
    const store = createCloudBaseStore({ database(options) {
      assert.deepEqual(options, { throwOnNotFound: false }); return db;
    } });
    const profile = newProfile('local-id', content, timestamp);
    profile.wallet.coin = 17;
    assert.deepEqual(await store.getOrCreate('local-id', () => profile), profile);
    assert.deepEqual(persisted, profile);
    assert.equal(Object.hasOwn(persisted, '_doc'), false);
    assert.deepEqual(await store.getOrCreate('local-id', () => assert.fail('must not reset')), profile);
  });
