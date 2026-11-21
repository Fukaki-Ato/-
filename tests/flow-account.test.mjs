import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createGameFlow, COINS_KEY, CHAR_KEY } from '../packages/game/dist/flow/mainFlow.js';
import { createFlowProgress } from '../packages/game/dist/flow/progress.js';
import { loadContent } from '../tools/replay/runner.mjs';
import { contentForAccount, createWxGameViews } from '../apps/wx/build/gameViews.js';
import { isCharacterLocked } from '../packages/game/dist/core/sim/character.js';
import { UiHost } from '../packages/framework/dist/ui/host.js';
import { Button, Label, defaultUiConfig, findBox } from '../packages/framework/dist/ui/index.js';
import { mountLeaderboardPage } from '../packages/game/dist/ui/leaderboardView.js';
import { loadTestFontSet } from './ui-helpers.mjs';
import * as THREE from 'three';

function fixture() {
  const listeners = new Set(), storage = new Map(), scenes = [], shown = {};
  let profile = { wallet: { coin: 12, diamond: 1 }, inventory: { characters: ['char_volt'], items: {} },
    preferences: { characterId: 'char_volt', themeId: 'theme_seaside_day' }, stats: { bestScore: 100 } };
  const account = { read: () => profile, subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); } };
  const content = loadContent();
  const adapter = {
    version: 2, env: 'wx', now: () => 0, onInput: () => () => {},
    canvas: { mainCanvas: () => ({}), windowSize: () => ({ width: 390, height: 844, dpr: 2 }), onResize: () => () => {} },
    storage: { get: key => storage.get(key) ?? null, set: (key, value) => storage.set(key, value), remove: key => storage.delete(key) },
    fetchJson: async key => content[key],
  };
  const views = {
    renderBoot: () => ({ setStatus() {} }), renderStart() {}, renderShop() {}, renderSettings() {}, toast() {},
    renderSelect(content, actions, character, entry, extras) { Object.assign(shown, { actions, character, extras }); },
    mountHud: () => ({ update() {}, dispose() {} }),
    renderResult(summary, best, actions) { shown.result = { summary, best, actions }; },
  };
  const createScene = (host, adapter, sim, content, callbacks) => { scenes.push({ sim, callbacks }); return { dispose() {} }; };
  return { account, content, adapter, storage, scenes, views, createScene, shown, listeners,
    update(next) { profile = { ...profile, ...next }; for (const fn of listeners) fn(); } };
}

test('云钱包不与本机币合并，未拥有角色不能出战，结算只能等待云端快照入账', async () => {
  const f = fixture();
  f.storage.set(COINS_KEY, '9999'); f.storage.set(CHAR_KEY, 'char_niu');
  const flow = createGameFlow({ adapter: f.adapter, views: f.views, createScene: f.createScene,
    configResolve: name => name, account: f.account });
  await flow.boot();
  assert.equal(f.shown.character, 'char_volt');
  assert.deepEqual(f.shown.extras, { coins: 12, diamonds: 1 });
  assert.equal(f.shown.actions.onChooseCharacter('char_niu'), false);
  f.shown.actions.onStartRun('char_niu'); assert.equal(flow.machine.current(), 'select');
  f.shown.actions.onStartRun('char_volt'); assert.equal(flow.machine.current(), 'run');
  f.scenes[0].callbacks.onEnd({ ...f.scenes[0].sim.summary(), score: 500, coins: 20 });
  assert.equal(flow.machine.current(), 'result');
  assert.equal(f.storage.get(COINS_KEY), '9999', 'cloud-enabled results never credit local currency');
  assert.equal(f.account.read().wallet.coin, 12);
  f.shown.result.actions.onSelect();
  f.update({ wallet: { coin: 32, diamond: 1 } });
  assert.deepEqual(f.shown.extras, { coins: 32, diamonds: 1 }, 'late server settlement refreshes the visible lobby');
  flow.dispose(); assert.equal(f.listeners.size, 0);
});

test('UI拥有标记不改变原配置/规则数据；本地开发仍有原金币语义', () => {
  const f = fixture(), original = JSON.stringify(f.content);
  const viewContent = contentForAccount(f.content, f.account);
  assert.ok(isCharacterLocked(viewContent.characters.items.find(c => c.id === 'char_niu')));
  assert.ok(!isCharacterLocked(viewContent.characters.items.find(c => c.id === 'char_volt')));
  assert.equal(JSON.stringify(f.content), original);
  const local = createFlowProgress(f.adapter.storage);
  f.adapter.storage.set('thunderrun:b\u2026st', '75');
  assert.equal(local.bestScore(), 75);
  local.recordLocal({ score: 100, coins: 8 });
  assert.equal(local.bestScore(), 100); assert.equal(local.wallet().coins, 8);
});

test('云出战/主题快照同步到下一局，仓库→商店返回仍回仓库', async () => {
  const f = fixture(); let inventoryActions, shopActions, usedTheme;
  f.views.renderInventory = actions => { inventoryActions = actions; };
  f.views.renderShop = (content, actions) => { shopActions = actions; };
  const flow = createGameFlow({ adapter: f.adapter, views: f.views, configResolve: name => name, account: f.account,
    createScene: (host, adapter, sim, content, callbacks, options) => {
      usedTheme = options.themeId; return f.createScene(host, adapter, sim, content, callbacks);
    } });
  await flow.boot(); f.shown.actions.onInventory(); assert.equal(flow.machine.current(), 'inventory');
  f.update({ inventory: { characters: ['char_volt', 'char_ama'], items: {} },
    preferences: { characterId: 'char_ama', themeId: 'theme_rain_konbini' } });
  assert.equal(flow.machine.current(), 'inventory', 'server update does not close the current page');
  inventoryActions.onShop(); assert.equal(flow.machine.current(), 'shop');
  shopActions.onBack(); assert.equal(flow.machine.current(), 'inventory');
  inventoryActions.onBack(); assert.equal(flow.machine.current(), 'select');
  assert.equal(f.shown.character, 'char_ama');
  f.shown.actions.onStartRun('char_ama');
  assert.equal(f.scenes[0].sim.loadout.charId, 'char_ama'); assert.equal(usedTheme, 'theme_rain_konbini');
  flow.dispose();
});

test('自绘排行榜可展开前50名、保留个人纪录，刷新失败保留旧数据，离开后忽略迟到响应', async () => {
  const f = fixture();
  const renderer = { autoClear: true, render() {} };
  const host = new UiHost({ adapter: f.adapter, inputMode: 'raw', fonts: loadTestFontSet('assets/fonts/noto'), config: defaultUiConfig,
    overlayHost: { renderer, width: 390, height: 844, dpr: 2 } });
  const entries = Array.from({ length: 50 }, (_, i) => ({ rank: i + 1, playerName: `跑者${i}`, distance: 100 - i, score: 1000, charId: 'char_volt' }));
  const data = { entries, personal: { ...entries[0], rank: 51, playerName: '自己' }, playerName: '自己' };
  let response = Promise.resolve(data), calls = 0;
  const dispose = mountLeaderboardPage(host, { list() { calls++; return response; } }, () => {});
  const flush = async () => { await new Promise(setImmediate); host.overlay.tick(0); };
  const texts = () => {
    const values = []; host.overlay.current.root.visit(w => { if (w instanceof Label) values.push(w.getText()); }); return values;
  };
  const click = label => {
    let button; host.overlay.current.root.visit(w => { if (w.label?.getText?.() === label) button = w; });
    assert.ok(button); const { rect } = findBox(host.overlay.tree, button.id);
    const p = { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2, t: 1 };
    host.pushInput({ type: 'down', ...p }); host.pushInput({ type: 'up', ...p });
  };
  await flush();
  assert.equal(texts().filter(text => /^\d+\. 跑者/.test(text)).length, 4);
  assert.ok(texts().some(text => text.includes('个人最佳：51. 自己')));
  click('查看完整50名排行'); await flush();
  assert.equal(texts().filter(text => /^\d+\. 跑者/.test(text)).length, 50); assert.equal(calls, 1);
  response = Promise.reject(new Error('network')); response.catch(() => {});
  click('刷新'); await flush(); assert.ok(texts().includes('加载失败，请重试'));
  assert.equal(texts().filter(text => /^\d+\. 跑者/.test(text)).length, 50);
  let resolve; response = new Promise(done => { resolve = done; });
  click('刷新'); dispose(); host.clear(); resolve(data); await new Promise(setImmediate);
  assert.equal(host.overlay.current, null); host.dispose();
});

test('WX结算尚在上传时不能离页，失败后留在原页可重试并明确提示放弃风险', () => {
  const f = fixture();
  const host = new UiHost({ adapter: f.adapter, inputMode: 'raw', fonts: loadTestFontSet('assets/fonts/noto'), config: defaultUiConfig,
    overlayHost: { renderer: { autoClear: true, render() {} }, width: 390, height: 844, dpr: 2 } });
  const views = createWxGameViews(host, {});
  let leave = 0, again = 0, retries = 0, notify;
  const ranking = { pending: true, message: '金币前距离成绩校验中…', subscribe(callback) {
    notify = message => { this.message = message; callback(message); }; notify(this.message); return () => { notify = null; };
  } };
  views.renderResult({ score: 20, coins: 2, distance: 2, nearMiss: 0, hits: 1, casts: 0, ranking }, 0,
    { onSelect() { leave++; }, onRetry() { again++; } });
  const click = label => {
    host.overlay.tick(0);
    let button; host.overlay.current.root.visit(w => { if (w.label?.getText?.() === label) button = w; });
    assert.ok(button, `mounted action: ${label}`);
    host.overlay.current.root.visit(w => {
      if (!w.physics) return;
      const viewport = findBox(host.overlay.tree, w.id), target = viewport && findBox(viewport, button.id);
      if (target && (target.rect.y < viewport.rect.y || target.rect.y + target.rect.h > viewport.rect.y + viewport.rect.h)) {
        w.physics.snapTo(w.physics.offset + target.rect.y - viewport.rect.y - 4);
        host.overlay.current.invalidate(); host.overlay.tick(0);
      }
    });
    const { rect } = findBox(host.overlay.tree, button.id);
    const p = { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2, t: 1 };
    host.pushInput({ type: 'down', ...p }); host.pushInput({ type: 'up', ...p });
  };
  click('返回大厅'); click('再跑一次'); assert.equal(leave, 0); assert.equal(again, 0);
  ranking.pending = false; ranking.retry = () => {
    retries++; ranking.pending = true; ranking.retry = undefined; notify('金币前距离成绩校验中…');
  };
  notify('上传失败，请重试；离开将放弃本局奖励');
  click('重试上传'); assert.equal(retries, 1);
  click('返回大厅'); assert.equal(leave, 0);
  ranking.pending = false; notify('金币前距离成绩已入全服榜');
  click('返回大厅'); assert.equal(leave, 1);
  views.dispose(); host.dispose();
});

test('WX facade passes real portrait references and config abilities to shop/owned inventory/roles, with config theme swatches',async()=>{
  const f=fixture(),texture=new THREE.Texture();
  const image=readFileSync('assets/ui/portraits/char_volt.png');
  const portrait={texture,texSize:{w:image.readUInt32BE(16),h:image.readUInt32BE(20)},insets:{top:0,bottom:0,left:0,right:0}};
  const snapshot={profile:f.account.read(),catalogVersion:'facade-test',offers:[{id:'volt',category:'character',title:'牢大',description:'',
    price:{coin:10},priceText:'10金币',grants:[{item:'char_volt',name:'牢大',amount:1}],remaining:1,owned:true,canPurchase:false,unavailableReason:null}],
    characters:[{id:'char_volt',name:'牢大',rarity:'R',tagline:'最便宜的伙伴，最稳的发挥',owned:true,equipped:true}],items:[],
    themes:[{id:'theme_seaside_day',name:'白日海景',selected:true}]};
  const service={load:async()=>snapshot};
  const host=new UiHost({adapter:f.adapter,inputMode:'raw',fonts:loadTestFontSet('assets/fonts/noto'),config:defaultUiConfig,
    overlayHost:{renderer:{autoClear:true,render(){}},width:390,height:760,dpr:1}});
  const views=createWxGameViews(host,{portraits:{char_volt:portrait}},f.account,undefined,undefined,service);
  const flush=async()=>{await new Promise(setImmediate);host.overlay.tick(0);};
  const assertPortraitAndAbility=()=>{
    const labels=[];let art=0;host.overlay.current.root.visit(w=>{if(w instanceof Label)labels.push(w.getText());if(w.opts?.background===portrait)art++;});
    assert.ok(art>0,'supplied portrait reaches actual WX page');assert.ok(labels.includes('技能：雷霆冲刺'));
  };
  try{
    views.renderSelect(f.content,{onStartRun(){},onChooseCharacter:()=>true,onBack(){}},'char_volt',null,{coins:12,diamonds:1});
    views.renderInventory({onBack(){}});await flush();assertPortraitAndAbility();
    views.renderShop(f.content,{onBack(){}});await flush();assertPortraitAndAbility();
    views.renderCharacterSelectPage(f.content,{onBack(){},onSelect(){},onStartRun(){},onShop(){}},'char_volt',null);
    await flush();assertPortraitAndAbility();
    views.renderSettings(f.content,{onBack(){},onSelectTheme:()=>true},'theme_seaside_day');await flush();
    const swatches=new Set();host.overlay.current.root.visit(w=>{if(w.opts?.backgroundColor)swatches.add(w.opts.backgroundColor);});
    const theme=f.content.themes.items[0];for(const color of [theme.sky.baseColor,theme.fog.color,theme.groundColor])assert.ok(swatches.has(color));
  }finally{views.dispose();host.dispose();texture.dispose();}
});

test('WX ready-skill HUD teaches the actual touch gesture rather than desktop keyboard input',()=>{
  const f=fixture(),host=new UiHost({adapter:f.adapter,inputMode:'raw',fonts:loadTestFontSet('assets/fonts/noto'),config:defaultUiConfig,
    overlayHost:{renderer:{autoClear:true,render(){}},width:320,height:620,dpr:1}});
  const views=createWxGameViews(host,{}),hud=views.mountHud();
  try{
    hud.update({score:100,coins:5,distance:12,hits:0,lives:1,buffs:[],
      skill:{label:'雷霆冲刺',cd:0,ready:true,charge:null}});
    const text=[];host.overlay.current.root.visit(w=>{if(w instanceof Label)text.push(w.getText());});
    assert.ok(text.some(s=>s.includes('就绪（双击屏幕）')));assert.ok(!text.some(s=>s.includes('/ E')));
  }finally{hud.dispose();views.dispose();host.dispose();}
});
