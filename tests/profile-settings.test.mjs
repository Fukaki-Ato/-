import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeDom, importWebModule } from './dom-fixture.mjs';

const { createMobileSettings } = await importWebModule('../apps/web/src/mobilePanels.ts');
const { openProfileOverlay } = await importWebModule('../apps/web/src/profileOverlay.ts');

function setup(t) {
  const dom = fakeDom(t);
  const values = new Map();
  const storage = { get: key => values.get(key) ?? null, set: (key, value) => values.set(key, value), remove: key => values.delete(key) };
  let backs = 0;
  const dispose = createMobileSettings(dom.content, {
    onBack: () => { backs++; }, onSelectTheme: () => true, onSetVolume: () => true,
  }, 'theme_seaside_day', undefined, () => openProfileOverlay(dom.content, storage));
  const settings = dom.byClass(dom.body, 'mobile-settings')[0];
  const entry = dom.byClass(settings, 'settings-profile')[0];
  return { ...dom, settings, entry, dispose, backs: () => backs,
    find: name => dom.byClass(dom.body, name)[0] };
}

test('设置页提供玩家档案，关闭或 Escape 返回设置并恢复入口焦点', t => {
  const f = setup(t);
  assert.equal(f.entry.getAttribute('aria-label'), '打开玩家档案');
  assert.equal(f.settings.children[0].children[1], f.entry, '档案入口在设置标题下方');
  f.entry.focus(); f.entry.click();
  let profile = f.find('tr-profile-overlay');
  assert.equal(profile.getAttribute('aria-label'), '玩家档案');
  assert.equal(document.activeElement, profile);
  f.find('profile-close').click();
  assert.equal(f.find('tr-profile-overlay'), undefined);
  assert.equal(document.activeElement, f.entry);
  assert.equal(f.backs(), 0);

  f.entry.click(); profile = f.find('tr-profile-overlay');
  let escapeConsumed = false;
  profile.addEventListener('keydown', event => { escapeConsumed = event.cancelBubble; });
  profile.dispatchEvent(f.key('Escape'));
  assert.equal(escapeConsumed, true, '弹层 Esc 不得再传给平台全局快捷键');
  assert.equal(f.find('tr-profile-overlay'), undefined);
  assert.equal(document.activeElement, f.entry);
  assert.equal(f.backs(), 0, '关闭档案不能同时退出设置');
  f.settings.dispatchEvent(f.key('Escape'));
  assert.equal(f.backs(), 1);
  f.dispose();
});

test('迁移入口保留改名和头像存档，离开设置会清理仍打开的档案', t => {
  const f = setup(t);
  f.entry.focus(); f.entry.click();
  const oldName = f.find('profile-name').textContent;
  const candidate = f.byClass(f.body, 'profile-name-pick').find(button => button.textContent !== oldName);
  candidate.click();
  f.byClass(f.body, 'profile-avatar-pick')[1].click();
  const name = f.find('profile-name').textContent;
  const avatar = f.find('profile-avatar-big').src;
  assert.equal(name, candidate.textContent);
  f.find('profile-close').click();
  f.entry.click();
  assert.equal(f.find('profile-name').textContent, name);
  assert.equal(f.find('profile-avatar-big').src, avatar);
  f.dispose();
  assert.equal(f.find('mobile-settings'), undefined);
  assert.equal(f.find('tr-profile-overlay'), undefined);
});
