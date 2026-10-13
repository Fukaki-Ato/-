import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const gameDebug = await import(new URL('../packages/game/dist/core/debugMode.js', import.meta.url));
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const debugPolicyPath = fileURLToPath(new URL('../apps/web/src/debugPolicy.ts', import.meta.url));
const bootstrapPath = fileURLToPath(new URL('../apps/web/src/bootstrap.ts', import.meta.url));
const uiDemoPath = fileURLToPath(new URL('../apps/web/src/uiDemo.ts', import.meta.url));
const productionDefines = {
  'import.meta.env.DEV': 'false',
  'import.meta.env.VITE_TR_ALLOW_DEBUG': '"0"',
  'import.meta.env.BASE_URL': '"/"',
};

async function importBundledEntry(entryPoint, plugins = [], defines = productionDefines) {
  const result = await build({
    absWorkingDir: ROOT,
    entryPoints: [entryPoint],
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
    define: defines,
    plugins,
  });
  const source = result.outputFiles[0].text;
  return import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
}

const debugPolicy = await importBundledEntry(debugPolicyPath);

function globalsWith(values) {
  const originals = new Map();
  for (const [key, value] of Object.entries(values)) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  return () => {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  };
}

test('shared query parser enables debug/test by decoded key presence, including false and repeated values', () => {
  const flags = gameDebug.debugQueryFlags('?%44eBuG=false&debug=0&%74EsT=off&TEST=');
  assert.deepEqual(flags, { debug: true, test: true, qa: true });

  const onlyTest = gameDebug.debugQueryFlags('?TeSt=false');
  assert.deepEqual(onlyTest, { debug: false, test: true, qa: true });
});

test('animation and ui=demo query parameters classify QA without matching ordinary values', () => {
  assert.deepEqual(gameDebug.debugQueryFlags('?ANIM=anything'), { debug: false, test: false, qa: true });
  assert.deepEqual(gameDebug.debugQueryFlags('?%55i=DeMo'), { debug: false, test: false, qa: true });
  assert.deepEqual(gameDebug.debugQueryFlags('?ui=not-demo'), { debug: false, test: false, qa: false });
  assert.deepEqual(gameDebug.debugQueryFlags('?feature=debugger&description=testing&other=debug-test'), {
    debug: false, test: false, qa: false,
  });
});

test('production debug policy denies URL-only QA and exposes no runtime URL parameters', () => {
  assert.equal(debugPolicy.DEBUG_TOOLS_ENABLED, false);
  const search = '?debug=false&TEST=1&anim=jump&UI=demo&keep=debug';
  assert.deepEqual(debugPolicy.runtimeDebugFlags(search), { debug: false, test: false, qa: false });
  assert.equal(debugPolicy.runtimeDebugParams(search), undefined);
});

test('a private QA production build must explicitly opt in to debug tools', async () => {
  const qa = await importBundledEntry(debugPolicyPath, [], { ...productionDefines,
    'import.meta.env.VITE_TR_ALLOW_DEBUG': '"1"' });
  assert.equal(qa.DEBUG_TOOLS_ENABLED, true);
  assert.deepEqual(qa.runtimeDebugFlags('?test=0'), { debug: false, test: true, qa: true });
});

test('local opt-in uses the shared parser and canonicalizes only QA parameter keys', () => {
  const search = '?%44eBuG=false&debug=0&%74EsT=off&ANIM=jump&Ui=DeMo&ChAr=volt&mode=debug-test';
  const parsed = gameDebug.debugQueryFlags(search);
  assert.deepEqual(debugPolicy.runtimeDebugFlags(search, true), parsed);
  assert.deepEqual(parsed, { debug: true, test: true, qa: true });

  const params = debugPolicy.runtimeDebugParams(search, true);
  assert.equal(params instanceof URLSearchParams, true);
  assert.deepEqual(params.getAll('debug'), ['false', '0']);
  assert.deepEqual(params.getAll('test'), ['off']);
  assert.deepEqual(params.getAll('anim'), ['jump']);
  assert.deepEqual(params.getAll('ui'), ['DeMo']);
  assert.equal(params.get('ChAr'), 'volt', 'unrelated key casing is preserved');
  assert.equal(params.get('mode'), 'debug-test', 'ordinary parameters and values are preserved');
  assert.equal(params.has('DeBuG'), false);
});

function bootstrapMocks() {
  const signatures = {
    './platform/webPlatform.js': ['createWebPlatform'],
    '@tr/game/flow/mainFlow.js': ['createGameFlow'],
    '@tr/game/ui/overlayViews.js': ['createOverlayViews'],
    './uiShell.js': ['createUiShell'],
    './characterSelectOverlay.js': ['createCharacterSelectOverlay'],
    './shopOverlay.js': ['createShopOverlay'],
    './runAssets.js': ['injectObstaclePosters', 'injectPickupTiles'],
    './startupConfig.js': ['preloadStartupConfig'],
    './missionIntegration.js': ['createMissionIntegration'],
    './mobileLobby.js': ['createMobileLobby'],
    './mobilePanels.js': ['createMobileSettings', 'createMobileResult'],
    './mobileHud.js': ['createMobileHud'],
    './mobileLeaderboard.js': ['createMobileLeaderboard'],
    './leaderboardClient.js': ['createLeaderboardClient'],
    './testPanel.js': ['createTestPanel'],
  };
  return {
    name: 'bootstrap-test-mocks',
    setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => {
        if (!args.importer) return undefined;
        if (args.path === './debugPolicy.js' && args.importer === bootstrapPath) return { path: debugPolicyPath };
        if (args.path === '@tr/game/core/debugMode.js') return undefined;
        if (args.path.endsWith('.css')) return { path: args.path, namespace: 'empty-css' };
        return { path: args.path, namespace: 'bootstrap-mock' };
      });
      builder.onLoad({ filter: /.*/, namespace: 'empty-css' }, () => ({ contents: '', loader: 'js' }));
      builder.onLoad({ filter: /.*/, namespace: 'bootstrap-mock' }, args => {
        const names = signatures[args.path];
        if (!names) throw new Error('Unexpected bootstrap import: ' + args.path);
        return {
          contents: names.map(name => 'export const ' + name + ' = (...args) => globalThis.__bootstrapProbe.' + name + '(...args);').join('\n'),
          loader: 'js',
        };
      });
    },
  };
}

test('production bootstrap strips URL QA extras and does not construct the test panel when disabled', async () => {
  const mount = { textContent: 'loading' };
  const capture = {
    panelCreations: 0,
    storageWrites: [],
    createWebPlatform() {
      return {
        fetchJson: async () => ({}),
        extras: { marker: 'preserved', urlParams: new URLSearchParams('?debug=true&test=1') },
        storage: { set: (...args) => this.storageWrites.push(args) },
      };
    },
    preloadStartupConfig(fetchJson) { return { fetchJson, clear() {} }; },
    createMissionIntegration(qa) {
      this.missionQa = qa;
      this.trackMissions = () => () => undefined;
      return { lobbyRenderer: this.createMobileLobby, trackRun: this.trackMissions };
    },
    async createUiShell(adapter) {
      this.adapter = adapter;
      return { host: { start() {} }, badges: {}, backdrop: {}, setBackgroundVisible() {}, fonts: {} };
    },
    createOverlayViews() { return {}; },
    createCharacterSelectOverlay() {},
    createShopOverlay() {},
    injectObstaclePosters: async () => {},
    injectPickupTiles: async () => {},
    createMobileLobby() {},
    createMobileSettings() {},
    createMobileResult() {},
    createMobileHud() {},
    createMobileLeaderboard() {},
    createLeaderboardClient() { return { ranked: true }; },
    createTestPanel() { this.panelCreations++; return { dispose() {} }; },
    createGameFlow(options) {
      this.flowOptions = options;
      return { boot: async () => {}, machine: {}, currentSeed: () => 1 };
    },
  };
  const restore = globalsWith({
    document: { getElementById: () => mount },
    location: { search: '?debug=false&TEST=1&anim=idle&ui=demo&keep=debug&char=char_bolt' },
    __bootstrapProbe: capture,
  });
  const previousPanel = Object.getOwnPropertyDescriptor(globalThis, '__trTestPanel');
  delete globalThis.__trTestPanel;
  try {
    await importBundledEntry(bootstrapPath, [bootstrapMocks()]);
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(capture.adapter.extras.marker, 'preserved');
    assert.equal(capture.adapter.extras.urlParams, undefined, 'untrusted URL params are removed from the web extras adapter');
    assert.deepEqual(capture.flowOptions.debug, false);
    assert.deepEqual(capture.flowOptions.test, false);
    assert.equal(Boolean(capture.flowOptions.leaderboard), true, 'QA query keys do not disable production leaderboard wiring');
    assert.equal(capture.missionQa, false);
    assert.equal(capture.flowOptions.trackRun, capture.trackMissions, 'normal mission tracking survives the merge');
    assert.equal(capture.panelCreations, 0);
    assert.equal(capture.storageWrites.length, 0, 'production ignores the QA character preset');
    assert.equal(Object.hasOwn(globalThis, '__trTestPanel'), false);
    assert.equal(mount.textContent, '', 'bootstrap completed without a startup error');
  } finally {
    restore();
    if (previousPanel) Object.defineProperty(globalThis, '__trTestPanel', previousPanel);
    else delete globalThis.__trTestPanel;
  }
});

function uiDemoMocks() {
  return {
    name: 'ui-demo-test-mocks',
    setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => {
        if (!args.importer) return undefined;
        if (args.path === './debugPolicy.js' && args.importer === uiDemoPath) return { path: debugPolicyPath };
        if (args.path === '@tr/game/core/debugMode.js') return undefined;
        return { path: args.path, namespace: 'ui-demo-mock' };
      });
      builder.onLoad({ filter: /.*/, namespace: 'ui-demo-mock' }, args => {
        if (args.path === 'three') return { contents: 'export class WebGLRenderer {}', loader: 'js' };
        if (args.path === '@tr/framework/ui/index.js') return {
          contents: 'export const createOverlay = () => ({}); export const defaultThemeColors = {}; export const loadFontSet = async () => ({}); export const resolveUiConfig = () => ({}); export class UiView {}',
          loader: 'js',
        };
        if (args.path === './uiDemoView.js') return { contents: 'export const buildDemoView = () => ({});', loader: 'js' };
        throw new Error('Unexpected UI demo import: ' + args.path);
      });
    },
  };
}

test('production uiDemo entry remains inert even when ui=demo is present', async () => {
  let created = 0;
  let appended = 0;
  const restore = globalsWith({
    location: { search: '?ui=demo' },
    document: {
      createElement() { created++; return {}; },
      body: { appendChild() { appended++; } },
    },
  });
  try {
    await importBundledEntry(uiDemoPath, [uiDemoMocks()]);
    assert.equal(created, 0);
    assert.equal(appended, 0);
    assert.equal(Object.hasOwn(globalThis, '__trUiDemo'), false);
  } finally {
    restore();
  }
});
