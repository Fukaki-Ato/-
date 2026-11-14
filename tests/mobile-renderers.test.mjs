import test from 'node:test';
import assert from 'node:assert/strict';
import { createOverlayViews } from '../packages/game/dist/ui/overlayViews.js';

function fixture() {
  const mounted = [];
  const host = { makeView: () => ({}), mount: (view, options) => mounted.push({ view, options }) };
  const disposals = [];
  const calls = [];
  const renderer = name => (...args) => { calls.push({ name, args }); return () => disposals.push(name); };
  let hudDisposed = false;
  const hud = { update() {}, dispose() { if (!hudDisposed) { disposals.push('hud'); hudDisposed = true; } } };
  const views = createOverlayViews({
    host,
    lobbyRenderer: renderer('lobby'), selectRenderer: renderer('characters'), shopRenderer: renderer('shop'),
    settingsRenderer: renderer('settings'), achievementsRenderer: renderer('achievements'),
    resultRenderer: renderer('result'), hudRenderer: () => hud,
  });
  return { views, mounted, calls, disposals, hud };
}

test('mobile renderers receive flow data and dispose all pages across the play loop', () => {
  const { views, mounted, calls, disposals, hud } = fixture();
  const content = {}, actions = {}, extras = { coins: 123, diamonds: 4 };
  views.renderSelect(content, actions, 'char_volt', 'guest', extras);
  assert.deepEqual(calls[0], { name: 'lobby', args: [content, actions, 'char_volt', extras] });
  views.renderCharacterSelectPage(content, actions, 'char_volt', 'guest');
  views.renderShop(content, actions);
  views.renderSettings(content, actions, 'theme_coast', { music: 0.7, sfx: 1 });
  assert.deepEqual(calls.at(-1).args, [content, actions, 'theme_coast', { music: 0.7, sfx: 1 }]);
  assert.equal(views.mountHud(), hud);
  hud.dispose();
  const summary = { score: 9876, distance: 543, coins: 12 };
  views.renderResult(summary, 1000, actions);
  assert.deepEqual(calls.at(-1).args, [summary, 1000, actions]);
  views.renderSelect(content, actions, 'char_volt', 'guest', extras);
  views.dispose(); views.dispose();
  assert.deepEqual(disposals, ['lobby', 'characters', 'shop', 'settings', 'hud', 'result', 'lobby']);
  assert.ok(mounted.every(entry => entry.options?.transparent === true));
});

test('mobile page renderer is cleaned up when leaving a menu for a different menu', () => {
  const { views, disposals } = fixture();
  views.renderSettings({}, {}, null);
  views.renderShop({}, {});
  views.renderResult({}, 0, {});
  views.dispose();
  assert.deepEqual(disposals, ['settings', 'shop', 'result']);
});

test('achievements renderer receives the merged page view and is disposed on page switch', () => {
  const { views, mounted, calls, disposals } = fixture();
  const content = {}, page = { sections: [], rows: [], offline: true, offlineMessage: 'x', claimedCount: 0, total: 0 };
  const actions = { onBack() {}, onClaim: () => ({ ok: false, message: '' }) };
  views.renderAchievements(content, page, actions);
  assert.deepEqual(calls.at(-1), { name: 'achievements', args: [content, page, actions] }, '场景层合并后的整页数据透传');
  views.renderAchievements(content, page, actions); // 领取/快照到达后的整页重绘：旧面板先收口
  assert.deepEqual(disposals, ['achievements']);
  views.dispose();
  assert.deepEqual(disposals, ['achievements', 'achievements']);
  assert.ok(mounted.every(entry => entry.options?.transparent === true));
});
