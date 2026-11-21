#!/usr/bin/env node
// Offline observation only: bundle package SOURCE, mount real shared UI, export real draw calls.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { build } from 'esbuild';
import { mountUiState } from './ui_states.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const { values: args } = parseArgs({ options: {
  page: { type: 'string', default: 'lobby' }, out: { type: 'string' },
  width: { type: 'string', default: '390' }, height: { type: 'string', default: '760' },
  scroll: { type: 'boolean', default: false }, character: { type: 'string' },
  fixture: { type: 'string' }, help: { type: 'boolean' },
  'font-dir': { type: 'string', default: 'assets/fonts/noto' },
} });
if (args.help || !args.out) {
  console.log('node tools/art/ui_snapshot.mjs --page PAGE --out NEW.json [--width 320 --height 620] [--scroll] [--character char_ama] [--fixture sample.json] [--font-dir PATH]\nPAGE: boot/lobby/result-pending/result-failed/leaderboard/roles/shop/inventory/settings; tasks-/handbook- ready/loading/load-failed/claiming/claimed/failed/missing; tasks-weekly; hud-ready/hud-cooldown/hud-charge/hud-buffs');
  process.exit(args.help ? 0 : 1);
}
const width = Number(args.width), height = Number(args.height);
if (![width, height].every(v => Number.isInteger(v) && v > 0 && v <= 4096)) throw Error('Invalid viewport');
const extraState=/^(tasks|handbook)-(ready|loading|load-failed|claiming|claimed|failed|missing)$/.test(args.page) || args.page==='tasks-weekly'
  || /^hud-(ready|cooldown|charge|buffs)$/.test(args.page);
if (!extraState && !['boot','lobby', 'result-pending', 'result-failed', 'leaderboard', 'roles', 'shop', 'inventory', 'settings'].includes(args.page)) throw Error('Unknown page');
const entry = `export * as THREE from 'three';
export * from './packages/framework/src/ui/index.ts';
export * from './packages/framework/src/ui/host.ts';
export * from './packages/game/src/ui/coastalLobby.ts';
export * from './packages/game/src/ui/coastalResult.ts';
export * from './packages/game/src/ui/leaderboardView.ts';
export * from './packages/game/src/ui/commerceView.ts';
export * from './packages/game/src/ui/bootView.ts';
export * from './packages/game/src/ui/welfareView.ts';
export * from './apps/wx/src/gameViews.ts';
export * from './packages/game/src/core/sim/character.ts';`;
const { outputFiles } = await build({ stdin: { contents: entry, resolveDir: root },
  alias: { '@tr/framework': `${root}/packages/framework/src`, '@tr/game': `${root}/packages/game/src` },
  bundle: true, platform: 'node', format: 'esm', write: false,
});
const ui = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
const { THREE } = ui;
const json = path => JSON.parse(readFileSync(resolve(root, path), 'utf8'));
const content = Object.fromEntries(['game', 'characters', 'skills', 'items', 'obstacles', 'economy', 'themes', 'events']
  .map(name => [name, json(`config/${name}.json`)]));
const pngImage = path => {
  const bytes = readFileSync(resolve(root, path));
  if (bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw Error(`Not PNG: ${path}`);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), snapshotPath: resolve(root, path),
    sha256: createHash('sha256').update(bytes).digest('hex') };
};
const fonts = await ui.loadFontSet({ loadJson: async path => json(path), loadImage: async path => pngImage(path) }, args['font-dir']);
const portraits = {};
for (const file of readdirSync(resolve(root, 'assets/ui/portraits')).filter(v => v.endsWith('.png'))) {
  const image = pngImage(`assets/ui/portraits/${file}`), texture = new THREE.Texture(image);
  texture.flipY = false; texture.colorSpace = THREE.NoColorSpace; texture.needsUpdate = true;
  portraits[file.slice(0, -4)] = { texture, texSize: { w: image.width, h: image.height },
    insets: { top: 0, right: 0, bottom: 0, left: 0 } };
}
const roster = ui.playableCharacters(content);
const charId = args.character ?? roster.find(c => c.locked !== true && c.status !== 'locked')?.id;
if (!roster.some(c => c.id === charId)) throw Error(`Unknown character: ${charId}`);
const nameOf = value => typeof value === 'string' ? value : value?.['zh-CN'];
const fixture = args.fixture ? JSON.parse(readFileSync(resolve(args.fixture), 'utf8')) : {};
const noop = () => {};
const host = new ui.UiHost({
  adapter: { canvas: { onResize: () => noop }, onInput: () => noop, now: () => 0 },
  fonts, config: ui.resolveUiConfig(content.game.params), inputMode: 'raw',
  overlayHost: { renderer: { autoClear: true, render() {} }, width, height, dpr: 1 },
});
let disposePage = noop, stateInput=[], stateCalls=[];
if (extraState) {
  const state=await mountUiState(ui,host,content,fixture,args.page);disposePage=state.dispose;stateInput=state.input;stateCalls=state.calls;
} else if (args.page === 'boot') {
  const page=ui.buildBootPage(host);host.mount(page.view);page.handle.setStatus('离线样例：正在检查跑道配置',false);
} else if (args.page === 'lobby') {
  host.mount(ui.buildCoastalLobby(host, { content, currentCharId: charId, portraits,
    extras: { coins: 7351, diamonds: 49, ...fixture.wallet }, actions: {
      onStartRun: noop, onChooseCharacter: () => true, onBack: noop, onCharacterSelect: noop,
      onShop: noop, onInventory: noop, onTasks: noop, onHandbook: noop, onLeaderboard: noop, onSettings: noop,
    } }).view);
} else if (args.page.startsWith('result-')) {
  const pending = args.page === 'result-pending';
  host.mount(ui.buildCoastalResult(host, { portraits, best: 1000,
    summary: { score: 1200, distance: 432.9, coins: 17, nearMiss: 4, hits: 2, casts: 3, charId,
      beforeFirstCoin: { distance: 123.45, score: 789, stoppedByCoin: true },
      charName: nameOf(roster.find(c => c.id === charId).name), ...fixture.summary,
      ranking: { pending, message: pending ? '离线样例：云端确认中，奖励未确认' : '离线样例：上传失败，请重试',
        subscribe: () => noop, ...(pending ? {} : { retry: noop }) } },
    actions: { onSelect: noop, onRetry: noop, onLeaderboard: noop } }).view);
} else if (args.page === 'leaderboard') {
  const entries = roster.map((c, i) => ({ rank: i + 1, playerName: `样例跑者${i + 1}`,
    distance: 890.5 - i * 57.25, score: 3500 - i * 100, charId: c.id }));
  disposePage = ui.mountLeaderboardPage(host, {
    list: async () => fixture.leaderboard ?? { entries, personal: entries.at(-1), playerName: '离线样例' },
  }, noop, { portraits, content });
} else {
  // Optional fixture is the exact CommerceSnapshot protocol. No network or transaction is invoked.
  const sample = fixture.commerce ?? {
    catalogVersion: 'offline-sample', profile: { schemaVersion: 1, revision: 0, playerId: `p_${'a'.repeat(64)}`,
      wallet: { coin: 7351, diamond: 49 }, preferences: { characterId: charId, themeId: 'theme_seaside_day' },
      inventory: { characters: roster.map(c=>c.id), items: { key: 3 } },
      createdAt: '2026-11-06T00:00:00.000Z', updatedAt: '2026-11-06T00:00:00.000Z' },
    characters: roster.map(c => ({ id: c.id, name: nameOf(c.name), tagline: nameOf(c.tagline), rarity: c.rarity ?? 'sample',
      owned: !c.locked && c.status !== 'locked', equipped: c.id === charId })),
    offers: roster.map(c => ({ id: `sample_${c.id}`, category: 'character', title: nameOf(c.name),
      description: '离线样例报价，仅观察布局', price: { coin: 800 }, priceText: '800 金币',
      grants: [{ item: c.id, amount: 1, name: nameOf(c.name) }], remaining: 1, owned: false,
      canPurchase: true, unavailableReason: null })), items: [{id:'key',name:'钥匙',amount:3}],
    themes: content.themes.items.filter(theme=>theme.status!=='retired').map(theme=>({id:theme.id,
      name:nameOf(theme.name),selected:theme.id==='theme_seaside_day'})),
  };
  disposePage = ui.mountCommercePage(host, { load: async () => sample }, args.page === 'roles' ? 'characters' : args.page,
    { onBack: noop, onShop: noop, onStartRun: noop }, { portraits, content });
}
// Flush page-local async sample loading, then the actual layout/paint loop.
await Promise.resolve(); await Promise.resolve();
for (let i = 0; i < 8; i++) host.overlay.tick(0);
const scrolls = [];
host.overlay.current.root.visit(w => { if (w instanceof ui.ScrollView) scrolls.push(w); });
const input = [...stateInput];
if (args.scroll) {
  const scroll = scrolls.find(s => s.physics.maxOffset > 0);
  if (!scroll) throw Error('No scrollable content in this page/viewport');
  const r = ui.findBox(host.overlay.tree, scroll.id).rect;
  const x = r.x + r.w / 2, y = r.y + r.h * .8;
  // One synthetic raw-pointer drag exactly to the bottom; no direct physics/layout mutation.
  const endY = y - scroll.physics.maxOffset;
  input.push({ type: 'down', x, y, t: 1 }, { type: 'move', x, y: endY, t: 1.5 }, { type: 'up', x, y: endY, t: 1.6 });
  for (const event of input) host.pushInput(event);
  for (let i = 0; i < 180; i++) host.overlay.tick(1 / 60);
  if (scroll.physics.offset <= 0) throw Error('UiInput drag did not scroll');
}
const { scene, camera } = host.overlay;
scene.updateMatrixWorld(true); camera.updateMatrixWorld(true);
const textures = [], textureIds = new Map();
function textureRef(t) {
  if (textureIds.has(t)) return { texture: textureIds.get(t) };
  const id = textures.length; textureIds.set(t, id);
  const image = t.image;
  const entry = { id, width: image.width, height: image.height, flipY: t.flipY, colorSpace: t.colorSpace,
    minFilter: t.minFilter, magFilter: t.magFilter, wrapS: t.wrapS, wrapT: t.wrapT,
    generateMipmaps: t.generateMipmaps, premultiplyAlpha: t.premultiplyAlpha };
  if (t.isDataTexture) {
    if (!(image.data instanceof Uint8Array) || t.format !== THREE.RGBAFormat) throw Error('Only RGBA8 DataTexture supported');
    entry.rgba = Buffer.from(image.data).toString('base64');
  } else {
    if (!image.snapshotPath) throw Error('Texture has no local source');
    entry.path = image.snapshotPath; entry.sha256 = image.sha256;
  }
  textures.push(entry); return { texture: id };
}
function uniform(v) {
  if (v?.isTexture) return textureRef(v);
  if (v === null || typeof v === 'number' || typeof v === 'boolean') return v;
  if (Array.isArray(v)) return v.map(uniform);
  if (ArrayBuffer.isView(v)) return Array.from(v);
  if (typeof v?.toArray === 'function') return v.toArray();
  throw Error(`Unsupported uniform: ${v?.constructor?.name}`);
}
const draws = [];
function visit(object, groupOrder = 0) {
  if (!object.visible) return;
  if (object.isGroup) groupOrder = object.renderOrder;
  if (object.isMesh) {
    const g = object.geometry, total = g.index?.count ?? g.getAttribute('position')?.count ?? 0;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    const groups = Array.isArray(object.material) ? g.groups : [{ start: 0, count: total, materialIndex: 0 }];
    for (const group of groups) {
      const m = materials[group.materialIndex];
      if (!m?.visible) continue;
      const start = Math.max(group.start, g.drawRange.start), end = Math.min(total, group.start + group.count, g.drawRange.start + g.drawRange.count);
      if (end <= start) continue;
      if (!m.isShaderMaterial || m.blending !== THREE.NormalBlending) throw Error(`Unsupported material: ${m.type}/${m.blending}`);
      // Compact ONLY indexed vertices actually used by drawRange (TextMesh capacity is not content).
      const used = [], remap = new Map(), indices = [];
      for (let i = start; i < end; i++) {
        const old = g.index ? g.index.getX(i) : i;
        if (!remap.has(old)) { remap.set(old, used.length); used.push(old); }
        indices.push(remap.get(old));
      }
      const attributes = Object.fromEntries(Object.entries(g.attributes).map(([name, attr]) => [name, {
        itemSize: attr.itemSize, values: used.flatMap(i => Array.from({ length: attr.itemSize }, (_, n) => attr.getComponent(i, n))),
      }]));
      const point = new THREE.Vector3().setFromMatrixPosition(object.matrixWorld)
        .applyMatrix4(camera.matrixWorldInverse).applyMatrix4(camera.projectionMatrix);
      draws.push({ id: object.id, materialId: m.id, groupOrder, renderOrder: object.renderOrder, z: point.z,
        originalDrawRange: { start, count: end - start }, attributes, indices, matrixWorld: object.matrixWorld.toArray(),
        vertexShader: m.vertexShader, fragmentShader: m.fragmentShader, defines: m.defines,
        uniforms: Object.fromEntries(Object.entries(m.uniforms).map(([key, item]) => [key, uniform(item.value)])),
        transparent: m.transparent, depthTest: m.depthTest, depthWrite: m.depthWrite, side: m.side,
        premultipliedAlpha: m.premultipliedAlpha,
      });
    }
  }
  for (const child of object.children) visit(child, groupOrder);
}
visit(scene);
// Three's painter sorting: opaque first, then transparent far-to-near (UI uses renderOrder).
draws.sort((a, b) => Number(a.transparent) - Number(b.transparent) || a.groupOrder - b.groupOrder || a.renderOrder - b.renderOrder ||
  (a.transparent ? b.z - a.z : a.materialId - b.materialId || a.z - b.z) || a.id - b.id);
const labels = [], missingGlyphs = new Set();
host.overlay.current.root.visit(w => {
  if (!(w instanceof ui.Label)) return;
  const box = ui.findBox(host.overlay.tree, w.id);
  if (!box) return;
  const text = w.getText(); labels.push({ text, rect: box.rect });
  for (const char of text) if (!/\s/u.test(char) && !fonts.lookup(char.codePointAt(0))) missingGlyphs.add(char);
});
const snapshot = {
  metadata: { mode: 'offline/sample', page: args.page, viewport: { width, height, dpr: 1, safeAreaAlreadyDeducted: true },
    source: 'package TS source, real UiHost/layout/paint; sample data, no cloud verification',
    renderer: 'pending offline software OpenGL capture, not WX/devtools/device acceptance', character: charId, fontDirectory:args['font-dir'],
    input, offlineServiceCalls:stateCalls, missingGlyphs: [...missingGlyphs], scroll: scrolls.map(s => ({ id: s.id, offset: s.physics.offset,
      maxOffset: s.physics.maxOffset, rect: ui.findBox(host.overlay.tree, s.id)?.rect })) },
  camera: { projectionMatrix: camera.projectionMatrix.toArray(), viewMatrix: camera.matrixWorldInverse.toArray() },
  background: scene.background ? scene.background.clone().convertLinearToSRGB().toArray() : [0, 0, 0, 0],
  labels, textures, draws,
};
writeFileSync(resolve(args.out), JSON.stringify(snapshot), { flag: 'wx' });
console.log(JSON.stringify({ out: resolve(args.out), mode: 'offline/sample', draws: draws.length, textures: textures.length,
  missingGlyphs: [...missingGlyphs], scroll: snapshot.metadata.scroll }));
disposePage(); host.dispose();
