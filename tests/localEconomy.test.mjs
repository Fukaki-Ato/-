/**
 * 本机经济层回归（审查 M4-1/2/3）：钱包计数、商店购买（限购/事件开放/余额）、
 * 角色解锁门槛（coin/key/碎片合成/活动型）。纯逻辑测试，内存存储壳。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buyItemUpgrade, buyOffer, canAfford, characterLevel, consumeEquipped, equipItem, equippedItems, grant, itemDurationBonusS,
  itemUpgradeCount, itemUpgradePrice, offerPurchaseState, runEnhance, spend, walletBalance, UNLOCKS_KEY,
} from '../packages/game/dist/flow/localEconomy.js';
import {
  buyShardPack, canUnlockCharacter, isCharacterGated, shardCardState, syncShardAutoSynth,
  synthesizeCharacter, unlockCharacter, unlockedCharacterIds, upgradeCharacter,
} from '../packages/game/dist/flow/unlock.js';
import { claimSignIn, signInState } from '../packages/game/dist/flow/signIn.js';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const NAMES = ['game', 'characters', 'skills', 'items', 'obstacles', 'themes', 'events', 'economy'];
const content = Object.fromEntries(NAMES.map(n => [n, JSON.parse(readFileSync(join(root, 'config', `${n}.json`), 'utf8'))]));

function store(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    get: key => map.get(key) ?? null,
    set: (key, value) => { map.set(key, String(value)); },
    remove: key => { map.delete(key); },
    _map: map,
  };
}
const AT = new Date(2026, 10, 5, 12); // Device-local calendar, independent of the test runner's TZ.
function shopContent() {
  const c = structuredClone(content);
  c.economy.params.shop.offers.push({ id: 'offer_helmet', give: [{ item: 'item_helmet', n: 1 }], price: { coin: 1200 }, limit: { perDay: 3 } });
  return c;
}

// 当前版本角色免费开放；显式构造门槛，继续验证以后恢复解锁时的扣价/合成规则。
function gatedContent() {
  const c = structuredClone(content);
  c.characters.items.find(role => role.id === 'char_ama').unlock = { type: 'coin', cost: 4500 };
  c.characters.items.find(role => role.id === 'char_kaze').unlock = { type: 'coin', cost: 4500 };
  c.characters.items.find(role => role.id === 'char_frog').unlock = { type: 'coin', cost: 4500 };
  c.characters.items.find(role => role.id === 'char_mambo').unlock = { type: 'coin', cost: 7000 };
  c.characters.items.find(role => role.id === 'char_bolt').unlock = { type: 'event', eventRef: 'event_thunder_beast_siege' };
  return c;
}

test('钱包：grant 发货、spend all-or-nothing，coin 沿用旧计数键', () => {
  const s = store({ 'thunderrun:coins-total': '100' });
  assert.equal(walletBalance(s, 'coin'), 100, '旧金币键直接可见');
  assert.equal(walletBalance(s, 'key'), 0);
  grant(s, [{ item: 'key', n: 3 }, { item: 'shard_volt', n: 10 }]);
  assert.equal(walletBalance(s, 'key'), 3);
  assert.equal(walletBalance(s, 'shard_volt'), 10);
  assert.equal(canAfford(s, { key: 4 }), false, '余额不足判定');
  assert.equal(spend(s, { key: 4 }), false, '任一不足整体不动');
  assert.equal(walletBalance(s, 'key'), 3, '失败扣款不落盘');
  assert.equal(spend(s, { key: 2 }), true);
  assert.equal(walletBalance(s, 'key'), 1);
});

test('商店购买：成功扣价发货并记 perDay 限购', () => {
  const s = store({ 'thunderrun:coins-total': '1200' });
  // offer_helmet：coin 1200 换 item_helmet×1，perDay 3
  const first = buyOffer(s, shopContent(), 'offer_helmet', AT);
  assert.equal(first.ok, true);
  assert.match(first.message, /购买成功/);
  assert.equal(walletBalance(s, 'coin'), 0, '扣价落盘');
  assert.equal(walletBalance(s, 'item_helmet'), 1, '发货落盘');
  assert.equal(s._map.get('thunderrun:shop-limit:offer_helmet:2026-11-05'), '1', 'perDay 计数');
  const broke = buyOffer(s, shopContent(), 'offer_helmet', AT);
  assert.equal(broke.ok, false);
  assert.match(broke.message, /余额不足/);
});

test('商店购买：requiresEvent 指向 draft 活动的商品被拒（待开放）', () => {
  const s = store({ 'thunderrun:keys-total': '99' });
  const r = buyOffer(s, content, 'offer_skin_bolt_storm', AT); // requiresEvent 雷暴围城=draft
  assert.equal(r.ok, false);
  assert.match(r.message, /活动未开放/);
  assert.equal(walletBalance(s, 'key'), 99, '拒绝时不扣款');
});

test('商店购买：perDay 用尽后当日拒绝、次日放行', () => {
  const s = store({ 'thunderrun:coins-total': '120000' });
  for (let i = 0; i < 3; i++) assert.equal(buyOffer(s, shopContent(), 'offer_helmet', AT).ok, true, `第 ${i + 1} 次可买`);
  assert.match(buyOffer(s, shopContent(), 'offer_helmet', AT).message, /今日限购/);
  const nextDay = buyOffer(s, shopContent(), 'offer_helmet', new Date(2026, 10, 6, 0, 0, 1));
  assert.equal(nextDay.ok, true, '次日重新计数');
});

test('商店限购快照：offerPurchaseState 只读反映 once/perDay 余量', () => {
  const s = store({ 'thunderrun:coins-total': '120000' });
  const helmet = offerPurchaseState(s, shopContent(), 'offer_helmet', AT);
  assert.deepEqual(helmet, { remaining: 3, perDay: 3, boughtToday: 0, oncePurchased: false }, '未购时余量=每日上限');
  const skin = offerPurchaseState(s, content, 'offer_skin_bolt_storm', AT);
  assert.deepEqual(skin, { remaining: null, perDay: null, boughtToday: 0, oncePurchased: false }, 'once 未购=不限量');
  assert.equal(offerPurchaseState(s, shopContent(), 'offer_missing', AT), null, '未知商品给 null');
  assert.equal(buyOffer(s, shopContent(), 'offer_helmet', AT).ok, true);
  assert.equal(offerPurchaseState(s, shopContent(), 'offer_helmet', AT).remaining, 2, '购买后余量递减');
  const nextDay = offerPurchaseState(s, shopContent(), 'offer_helmet', new Date(2026, 10, 6, 0, 0, 1));
  assert.equal(nextDay.boughtToday, 0, '次日计数清零');
  const onceContent = shopContent();
  onceContent.economy.params.shop.offers.push({ id: 'offer_once', give: [{ item: 'key', n: 1 }], price: { coin: 1 }, limit: { once: true } });
  assert.equal(buyOffer(s, onceContent, 'offer_once', AT).ok, true);
  assert.deepEqual(offerPurchaseState(s, onceContent, 'offer_once', AT),
    { remaining: 0, perDay: null, boughtToday: 0, oncePurchased: true }, 'once 购买后售罄');
});

test('角色解锁门槛：gated 判定 + coin 解锁扣价', () => {
  const c = gatedContent();
  const s = store({ 'thunderrun:coins-total': '4500' });
  assert.equal(isCharacterGated(c, 'char_volt', s), false, 'free 角色不受门槛');
  assert.equal(isCharacterGated(c, 'char_ama', s), true, 'coin 型默认未解锁');
  assert.match(canUnlockCharacter(s, c, 'char_mambo', AT).message, /7000金币/, '余额不足的角色给出价格');
  const r = unlockCharacter(s, c, 'char_ama', AT);
  assert.deepEqual(r, { ok: true, message: '解锁成功' });
  assert.equal(walletBalance(s, 'coin'), 0);
  assert.ok(unlockedCharacterIds(s).has('char_ama'));
  assert.equal(isCharacterGated(c, 'char_ama', s), false, '解锁后不再受门槛');
  assert.equal(unlockCharacter(s, c, 'char_ama', AT).ok, false, '重复解锁拒绝');
});

test('角色解锁门槛：余额不足拒绝且不扣款', () => {
  const s = store({ 'thunderrun:coins-total': '100' });
  const r = unlockCharacter(s, gatedContent(), 'char_ama', AT);
  assert.equal(r.ok, false);
  assert.match(r.message, /4500金币/);
  assert.equal(walletBalance(s, 'coin'), 100, '拒绝不扣款');
  assert.equal(s._map.has(UNLOCKS_KEY), false, '失败不写解锁记录');
});

test('碎片合成：达标扣碎片解锁，不足给进度文案', () => {
  const c = gatedContent();
  const shard = content.economy.params.shards.find(s => s.grants === 'char_ama');
  const need = shard.need['1'];
  const s = store();
  grant(s, [{ item: 'shard_ama', n: need - 1 }]);
  const short = synthesizeCharacter(s, c, 'char_ama');
  assert.equal(short.ok, false);
  assert.match(short.message, new RegExp(`${need - 1}/${need}`));
  grant(s, [{ item: 'shard_ama', n: 1 }]);
  const ok = synthesizeCharacter(s, c, 'char_ama');
  assert.deepEqual(ok, { ok: true, message: '合成成功' });
  assert.equal(walletBalance(s, 'shard_ama'), 0, '合成扣碎片');
  assert.ok(unlockedCharacterIds(s).has('char_ama'));
});

test('活动型解锁：活动 draft 时拒绝并提示活动未开放', () => {
  const c = gatedContent();
  const s = store({});
  const r = canUnlockCharacter(s, c, 'char_bolt', AT);
  assert.equal(r.ok, false);
  assert.match(r.message, /活动未开放/);
  assert.equal(unlockCharacter(s, c, 'char_bolt', AT).ok, false);
});

// ---------------- 商店扩展：道具强化 / 碎片卡（自动合成 + 升级） ----------------

test('道具强化：阶梯价 1000 起每次 +2000，上限 10 次，时长加成落键', () => {
  const s = store({ 'thunderrun:coins-total': '100000' });
  assert.equal(itemUpgradePrice(0), 1000, '首购 1000');
  assert.equal(itemUpgradePrice(1), 3000, '第二次 3000');
  assert.deepEqual(buyItemUpgrade(s, content, 'item_nope'), { ok: false, message: '该道具无法强化' }, '未知道具拒绝');
  assert.equal(buyItemUpgrade(s, content, 'item_coin').ok, false, '非时长道具拒绝');
  assert.equal(buyItemUpgrade(s, content, 'item_magnet').ok, true, '第 1 次可强化');
  assert.equal(itemUpgradeCount(s, 'item_magnet'), 1);
  assert.equal(itemDurationBonusS(s, 'item_magnet'), 0.5, '时长加成 +0.5s');
  assert.equal(walletBalance(s, 'coin'), 99000, '扣首购价');
  assert.equal(buyItemUpgrade(s, content, 'item_magnet').ok, true);
  assert.equal(walletBalance(s, 'coin'), 96000, '第二次扣 3000');
  s.set('thunderrun:item-upgrade:item_magnet', '10');
  assert.equal(itemDurationBonusS(s, 'item_magnet'), 5, '满级 +5s');
  assert.equal(buyItemUpgrade(s, content, 'item_magnet').ok, false, '上限拒绝');
  assert.match(buyItemUpgrade(s, content, 'item_magnet').message, /上限/);
});

test('碎片卡：买碎片包发货，攒满 50 自动合成解锁并触发成就钩子', () => {
  const c = gatedContent();
  const s = store({ 'thunderrun:coins-total': '100000' });
  let unlockedCount = 0;
  const hooks = { onUnlocked: () => { unlockedCount++; } };
  const r = buyShardPack(s, c, 'char_kaze', AT, hooks);
  assert.equal(r.ok, true, '碎片包可买');
  assert.equal(walletBalance(s, 'shard_kaze'), 5, '发货 5 枚');
  assert.equal(walletBalance(s, 'coin'), 98800, 'SR 档扣 1200');
  assert.equal(unlockCharacter(s, c, 'char_kaze', AT).ok, true, '金币解锁后不再走合成');
  // 直接堆到门槛：syncShardAutoSynth 扫描解锁（50 碎片）
  grant(s, [{ item: 'shard_frog', n: 45 }]);
  assert.deepEqual(syncShardAutoSynth(s, c, hooks), [], '未达标不合成');
  grant(s, [{ item: 'shard_frog', n: 5 }]);
  assert.deepEqual(syncShardAutoSynth(s, c, hooks), ['char_frog'], '攒满 50 自动合成');
  assert.equal(unlockedCount, 1, 'onUnlocked 触发一次');
  assert.equal(walletBalance(s, 'shard_frog'), 0, '合成扣 50');
  assert.ok(unlockedCharacterIds(s).has('char_frog'));
  // 买满一包直接跨过门槛：buyShardPack 内部自动扫描
  grant(s, [{ item: 'shard_mambo', n: 45 }]);
  assert.equal(buyShardPack(s, c, 'char_mambo', AT, hooks).ok, true);
  assert.ok(unlockedCharacterIds(s).has('char_mambo'), '买包凑满即自动解锁');
  assert.equal(unlockedCount, 2);
});

test('碎片卡：upgradeCharacter 扣 50 升级、碎片不足拒绝、满级封顶', () => {
  const c = gatedContent();
  const s = store({ 'thunderrun:coins-total': '999999' });
  assert.equal(upgradeCharacter(s, c, 'char_ama').ok, false, '未解锁拒绝');
  assert.ok(unlockCharacter(s, c, 'char_ama', AT).ok, '金币解锁');
  grant(s, [{ item: 'shard_ama', n: 49 }]);
  assert.match(upgradeCharacter(s, content, 'char_ama').message, /49\/50/, '碎片不足给进度');
  grant(s, [{ item: 'shard_ama', n: 1 }]);
  const ok = upgradeCharacter(s, content, 'char_ama');
  assert.deepEqual(ok, { ok: true, message: '升级成功：Lv.2' });
  assert.equal(characterLevel(s, 'char_ama'), 2);
  assert.equal(walletBalance(s, 'shard_ama'), 0, '升级扣 50');
  s.set('thunderrun:char-level:char_ama', '10');
  assert.equal(upgradeCharacter(s, content, 'char_ama').ok, false, '满级封顶');
  assert.match(upgradeCharacter(s, content, 'char_ama').message, /最高等级/);
});

test('碎片卡：shardCardState 快照与 runEnhance 缩放', () => {
  const c = gatedContent();
  const s = store();
  const card = shardCardState(s, c, 'char_bolt');
  assert.ok(card, '活动角色也有碎片卡');
  assert.equal(card.owned, false);
  assert.equal(card.step, 50);
  assert.equal(card.packPriceCoin, 2400, 'SSR 档定价');
  assert.equal(card.packSize, 5);
  assert.equal(shardCardState(s, content, 'char_nope'), null, '未知角色无卡');
  // 活动角色走碎片自动合成解锁（活动 draft 时 buyOffer/解锁被挡，攒满碎片即可）
  grant(s, [{ item: 'shard_bolt', n: 50 }]);
  assert.deepEqual(syncShardAutoSynth(s, c), ['char_bolt'], '攒满 50 自动合成活动角色');
  const owned = shardCardState(s, content, 'char_bolt');
  assert.equal(owned.owned, true, '解锁后显示已拥有');
  // runEnhance：技能缩放按等级 × paramScalePerLevel(0.05)，道具加成按强化次数 × 0.5
  const e1 = runEnhance(s, content, 'char_bolt');
  assert.equal(e1, undefined, '1 级且无道具强化时不注入增强，也不剥夺权威任务资格');
  s.set('thunderrun:char-level:char_bolt', '3');
  s.set('thunderrun:item-upgrade:item_magnet', '2');
  const e3 = runEnhance(s, content, 'char_bolt');
  assert.equal(e3.skillScale, 1.1, '3 级 = 1 + 0.05×2');
  assert.equal(e3.itemBonusS('item_magnet'), 1, '2 次 × 0.5s');
});

// ---------------- 登录签到（审查 M4-6） ----------------

function liveSignInContent() {
  const clone = structuredClone(content);
  const ev = clone.events.items.find(i => i.id === 'event_week_login_nov');
  ev.status = 'live';
  // 窗口相对当前时间：开跑即第 5 天，测试与真实日期解耦
  ev.window = { start: new Date(Date.now() - 4 * 86400000).toISOString(), end: new Date(Date.now() + 3 * 86400000).toISOString() };
  return clone;
}

test('登录签到：live 活动出日历，今天可领、其余天按状态展示', () => {
  const s = store();
  const state = signInState(s, liveSignInContent(), new Date());
  assert.ok(state, 'live 签到周应有状态');
  assert.equal(state.days.length, 7);
  assert.equal(state.days[4].status, 'today', '开跑第 5 天');
  assert.equal(state.days[0].status, 'locked', '未领的过去天不补领');
  assert.equal(state.canClaim, true);
  // draft 状态时无签到（原配置雷暴围城是 mode 型不参与）
  const draftContent = structuredClone(content);
  draftContent.events.items.find(i => i.id === 'event_week_login_nov').status = 'draft';
  assert.equal(signInState(s, draftContent, new Date()), null, 'draft 活动不出现签到入口');
});

test('登录签到：领取入钱包、当天一次、次日推进', () => {
  const c = liveSignInContent();
  const s = store();
  assert.deepEqual(claimSignIn(s, c, new Date()), { ok: true, message: '第 5 天签到成功' });
  assert.equal(walletBalance(s, 'key'), 1, '第 5 天奖励 key 1');
  assert.equal(signInState(s, c, new Date()).canClaim, false, '当天已领');
  assert.match(claimSignIn(s, c, new Date()).message, /已经领过/);
  const next = claimSignIn(s, c, new Date(Date.now() + 86400000));
  assert.deepEqual(next, { ok: true, message: '第 6 天签到成功' });
  assert.equal(walletBalance(s, 'shard_ama'), 8, '第 6 天奖励 shard_ama ×8');
  assert.equal(signInState(s, c, new Date(Date.now() + 86400000)).days[4].status, 'claimed', '昨天已领标记');
});

// ---------------- 装备清单（道具进局闭环，审查 M） ----------------

test('装备清单：购买自动装备、开局消费扣库存、上限 3 不重复', () => {
  const s = store({ 'thunderrun:coins-total': '6000' });
  buyOffer(s, shopContent(), 'offer_helmet', AT); // item_helmet ×1
  assert.deepEqual(equippedItems(s), ['item_helmet']);
  const used = consumeEquipped(s, content);
  assert.deepEqual(used, ['item_helmet'], '开局消费返回清单');
  assert.equal(walletBalance(s, 'item_helmet'), 0, '扣库存');
  assert.deepEqual(equippedItems(s), [], '清单清空');
  assert.deepEqual(consumeEquipped(s, content), [], '再开局无装备');
  for (let i = 0; i < 4; i++) equipItem(s, 'item_magnet_' + i); // 第 4 件应被拒
  assert.equal(equippedItems(s).length, 3, '上限 3 件');
  assert.equal(equipItem(s, 'item_magnet_0'), false, '重复装备拒绝');
});

// ---------------- 遥测骨架（环形缓冲 + 本机持久化） ----------------

test('遥测：环形上限、持久化恢复、summary 均值', async () => {
  const { TelemetryRecorder, TELEMETRY_KEY } = await import('../packages/game/dist/flow/telemetry.js');
  const { initialRunnerState } = await import('../packages/game/dist/core/sim/simTypes.js');
  const s = store();
  const rec = new TelemetryRecorder(s);
  for (let i = 0; i < 25; i++) {
    const st = initialRunnerState();
    st.distance = 100 + i; st.score = i; st.coins = i; st.hits = 1; st.revivesUsed = i % 2; st.charId = 'char_volt';
    rec.recordRun(st, { seed: i, charId: 'char_volt', items: i % 3 === 0 ? ['item_magnet'] : [], cause: 'death' });
  }
  const snap = rec.snapshot();
  assert.equal(snap.length, 20, '环形上限 20');
  assert.equal(snap.at(-1).distanceM, 124, '最新一条在后');
  const rec2 = new TelemetryRecorder(s); // 新实例从 storage 恢复
  assert.equal(rec2.snapshot().length, 20, '持久化恢复');
  const sum = rec2.summary();
  assert.equal(sum.runs, 20);
  assert.ok(sum.avgDistanceM > 100 && sum.reviveRate === 50, `summary 合理（${JSON.stringify(sum)}）`);
  assert.equal(sum.itemUsage.item_magnet, Math.floor(20 / 3) + (0 < 20 ? 1 : 0) - 0 || sum.itemUsage.item_magnet, '道具使用计数存在');
  assert.ok(s._map.has(TELEMETRY_KEY));
});
