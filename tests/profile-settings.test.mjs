import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeDom, importWebModule } from './dom-fixture.mjs';
import { createRewardWalletStore, REWARD_WALLET_KEY } from '@tr/game/flow/missionRewardWallet.js';

const { createMobileSettings } = await importWebModule('../apps/web/src/mobilePanels.ts');
const { openProfileOverlay } = await importWebModule('../apps/web/src/profileOverlay.ts');

function setup(t, initial = []) {
  const dom = fakeDom(t);
  const values = new Map(initial);
  const balanceChanges = [];
  const storage = { get: key => values.get(key) ?? null, set: (key, value) => values.set(key, value), remove: key => values.delete(key) };
  let backs = 0;
  const dispose = createMobileSettings(dom.content, {
    onBack: () => { backs++; }, onSelectTheme: () => true, onSetVolume: () => true,
  }, 'theme_seaside_day', undefined, () => openProfileOverlay(dom.content, storage, left => balanceChanges.push(left)));
  const settings = dom.byClass(dom.body, 'mobile-settings')[0];
  const entry = dom.byClass(settings, 'settings-profile')[0];
  return { ...dom, settings, entry, dispose, values, balanceChanges, backs: () => backs,
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

test('档案按最高得分显示旧存档，不能把分数标成米', t => {
  const run = { score: 12345, distance: 678 };
  const f = setup(t, [['thunderrun:best', String(run.score)]]);
  f.entry.click();
  assert.equal(f.find('profile-best').textContent, '最高得分：12345 分');
  assert.doesNotMatch(f.find('profile-best').textContent, /米|678/);
  assert.equal(f.values.get('thunderrun:best'), '12345', '显示修正不迁移或重写已有分数');
  f.dispose();
});

test('收费改名立即同步提示、背包和回调余额，重复改名也不会遗留旧库存', t => {
  const f = setup(t, [['thunderrun:player-renames', '1'], ['thunderrun:diamonds-total', '60']]);
  f.entry.click();
  const diamond = () => f.byClass(f.body, 'profile-inventory-row').find(row => row.children[0].textContent === '钻石').children[1].textContent;
  const rename = () => f.byClass(f.body, 'profile-name-pick').find(button => button.textContent !== f.find('profile-name').textContent).click();
  assert.equal(diamond(), '60');
  rename();
  assert.equal(diamond(), '40');
  assert.match(f.find('profile-hint').textContent, /余额 40/);
  rename();
  assert.equal(diamond(), '20');
  assert.match(f.find('profile-hint').textContent, /余额 20/);
  assert.deepEqual(f.balanceChanges, [40, 20]);
  assert.equal(f.byClass(f.body, 'profile-inventory').length, 1);
  f.dispose();
});

test('钻石不足时姓名、背包和余额回调都不显示改名成功', t => {
  const f = setup(t, [['thunderrun:player-renames', '1'], ['thunderrun:diamonds-total', '10']]);
  f.entry.click();
  const name = f.find('profile-name').textContent;
  f.byClass(f.body, 'profile-name-pick').find(button => button.textContent !== name).click();
  assert.equal(f.find('profile-name').textContent, name);
  assert.match(f.find('profile-hint').textContent, /钻石不足/);
  assert.equal(f.byClass(f.body, 'profile-inventory-row').find(row => row.children[0].textContent === '钻石').children[1].textContent, '10');
  assert.equal(f.values.get('thunderrun:diamonds-total'), '10');
  assert.deepEqual(f.balanceChanges, []);
  f.dispose();
});

test('档案 Tab 首尾循环且背景 inert，关闭后恢复原状态及入口焦点', t => {
  const f = setup(t);
  const other = document.createElement('div'); other.inert = true; f.body.append(other);
  const previousInert = f.settings.inert;
  f.entry.focus(); f.entry.click();
  const profile = f.find('tr-profile-overlay');
  const buttons = profile.querySelectorAll('button:not([disabled])');
  const first = buttons[0], last = buttons.at(-1);
  assert.equal(f.settings.inert, true);
  const initial = f.key('Tab'); profile.dispatchEvent(initial);
  assert.equal(initial.defaultPrevented, true);
  assert.equal(document.activeElement, first);
  const backwards = Object.assign(f.key('Tab'), { shiftKey: true }); profile.dispatchEvent(backwards);
  assert.equal(document.activeElement, last);
  assert.equal(backwards.defaultPrevented, true);
  const forwards = f.key('Tab'); profile.dispatchEvent(forwards);
  assert.equal(document.activeElement, first);
  assert.equal(forwards.defaultPrevented, true);
  first.click();
  assert.equal(f.settings.inert, previousInert);
  assert.equal(other.inert, true, '不能解除已有的背景隔离状态');
  assert.equal(document.activeElement, f.entry);
  f.dispose();
});

test('实际钱包保存失败时档案保留名字与余额，修复后同一候选可以重试', t => {
  const f = fakeDom(t);
  const values = new Map([['thunderrun:player-id', '1234567890'], ['thunderrun:player-name', '小跑者'],
    ['thunderrun:player-renames', '1'], ['thunderrun:diamonds-total', '60']]);
  let failure = true;
  const storage = { get: key => values.get(key) ?? null, remove: key => values.delete(key), set(key, value) {
    if (failure && key === REWARD_WALLET_KEY) return;
    values.set(key, value);
  } };
  const wallet = createRewardWalletStore(storage);
  const dispose = openProfileOverlay(f.content, wallet);
  const node = name => f.byClass(f.body, name)[0];
  const candidate = f.byClass(f.body, 'profile-name-pick').find(button => button.textContent === '闪电少年');
  candidate.click();
  assert.match(node('profile-hint').textContent, /改名未完成.*保存失败/);
  assert.equal(node('profile-name').textContent, '小跑者');
  assert.equal(wallet.get('thunderrun:diamonds-total'), '60');
  assert.equal(wallet.get('thunderrun:player-renames'), '1');
  failure = false; candidate.click();
  assert.equal(node('profile-name').textContent, '闪电少年');
  assert.equal(wallet.get('thunderrun:diamonds-total'), '40');
  assert.match(node('profile-hint').textContent, /余额 40/);
  dispose();
});

test('档案明确本机身份、存储边界及独立榜单游客名，不伪装成统一账号', t => {
  const f = setup(t, [['thunderrun:player-id', '1234567890']]);
  f.entry.click();
  assert.equal(f.find('profile-id').textContent, '本机档案 ID：1234567890');
  assert.match(f.find('profile-scope').textContent, /当前浏览器.*清除网站数据.*本机余额/);
  assert.match(f.find('profile-scope').textContent, /改名不影响榜单游客名/);
  assert.match(f.find('profile-scope').textContent, /旧页面.*刷新.*不要清除存档/);
  f.dispose();
});
