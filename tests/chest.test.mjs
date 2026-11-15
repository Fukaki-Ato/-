/**
 * 宝箱开启回归：三档配置约束（钥匙 1/2/3、产出 1/2/3 件、碎片≤10、钻石≤5、档位收益单调）、
 * 钥匙不足零副作用、按档连抽入账、保底 pity 计数、碎片攒满自动合成闭环。
 * 随机源全部注入（queue 式 next()），结果确定可复现。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openChest, chestCards, rewardText } from '../packages/game/dist/flow/chest.js';
import { UNLOCKS_KEY, walletBalance } from '../packages/game/dist/flow/localEconomy.js';
import { mulberry32, hashSeed } from '../packages/game/dist/core/rng.js';

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

const economy = content.economy.params;
const chestTables = economy.lootTables.filter(t => String(t.id).startsWith('loot_chest_'));

/** 计算「注入 next() 返回何值才能抽中 ref」：weightedBy 的 roll = next()*total 落在该条目权重区间中点 */
function pickValue(entries, ref) {
  const total = entries.reduce((s, e) => s + Math.max(0, e.weight), 0);
  let acc = 0;
  for (const e of entries) {
    if (e.ref === ref) return (acc + Math.max(0, e.weight) / 2) / total;
    acc += Math.max(0, e.weight);
  }
  throw new Error(`ref 不在奖池: ${ref}`);
}

test('三档宝箱配置约束：钥匙 1/2/3、产出 1/2/3、碎片≤10、钻石≤5、档位收益单调', () => {
  assert.equal(chestTables.length, 3, '铜/银/金三张表');
  const tiers = chestTables.map(t => ({
    id: t.id, cost: t.cost.key, draws: t.draws,
    maxShard: Math.max(...t.entries.filter(e => e.ref.startsWith('shard_')).map(e => Number(e.ref.split(':')[1] ?? 1))),
    maxDiamond: Math.max(0, ...t.entries.filter(e => e.ref.startsWith('diamond')).map(e => Number(e.ref.split(':')[1] ?? 1))),
    maxCoin: Math.max(...t.entries.filter(e => e.ref.startsWith('coin')).map(e => Number(e.ref.split(':')[1] ?? 0))),
    srPlusShare: t.entries.filter(e => e.rarity === 'sr' || e.rarity === 'ssr').reduce((s, e) => s + e.weight, 0)
      / t.entries.reduce((s, e) => s + e.weight, 0),
  }));
  assert.deepEqual(tiers.map(t => t.cost), [1, 2, 3], '钥匙扣价 1/2/3');
  assert.deepEqual(tiers.map(t => t.draws), [1, 2, 3], '产出件数 1/2/3');
  for (const t of tiers) {
    assert.ok(t.maxShard >= 1 && t.maxShard <= 10, `${t.id} 碎片 ≤10，实得 ${t.maxShard}`);
    assert.ok(t.maxDiamond >= 1 && t.maxDiamond <= 5, `${t.id} 钻石 ≤5，实得 ${t.maxDiamond}`);
  }
  assert.ok(tiers[0].maxCoin < tiers[1].maxCoin && tiers[1].maxCoin < tiers[2].maxCoin, '能量币上限随档位递增');
  assert.ok(tiers[0].srPlusShare < tiers[1].srPlusShare && tiers[1].srPlusShare < tiers[2].srPlusShare,
    `sr+ 权重占比随档位递增：${tiers.map(t => t.srPlusShare.toFixed(3)).join(' < ')}`);
});

test('chestCards 快照：档位名/扣价/件数/保底，配置顺序铜→银→金', () => {
  const cards = chestCards(content);
  assert.deepEqual(cards.map(c => c.name), ['铜宝箱', '银宝箱', '金宝箱']);
  assert.deepEqual(cards.map(c => c.costKeys), [1, 2, 3]);
  assert.deepEqual(cards.map(c => c.draws), [1, 2, 3]);
  assert.deepEqual(cards.map(c => c.pityEveryN), [8, 6, 5]);
});

test('钥匙不足：失败文案且零副作用（存储快照逐字节不变）', () => {
  const s = store({ 'thunderrun:loot-pity:loot_chest_gold': '2' });
  const before = JSON.stringify([...s._map.entries()].sort());
  const r = openChest(s, content, 'loot_chest_gold');
  assert.equal(r.ok, false);
  assert.match(r.message, /钥匙不足/);
  assert.equal(r.rewards.length, 0);
  assert.equal(JSON.stringify([...s._map.entries()].sort()), before, '失败不落盘');
});

test('铜箱：扣 1 钥匙、开出 1 件并入账（注入随机固定抽中条目）', () => {
  const table = chestTables.find(t => t.id === 'loot_chest_bronze');
  const v = pickValue(table.entries, 'shard_ama:2');
  const s = store({ 'thunderrun:keys-total': '3' });
  const r = openChest(s, content, 'loot_chest_bronze', () => v);
  assert.equal(r.ok, true);
  assert.equal(r.rewards.length, 1);
  assert.deepEqual({ item: r.rewards[0].item, count: r.rewards[0].count }, { item: 'shard_ama', count: 2 });
  assert.equal(walletBalance(s, 'key'), 2, '扣 1 把钥匙');
  assert.equal(walletBalance(s, 'shard_ama'), 2, '碎片入账');
  assert.match(r.message, /阿玛.*碎片×2/, '文案带角色名（zh-CN）');
});

test('银箱 2 件、金箱 3 件：抽数随档位，钥匙相应扣 2/3', () => {
  const gold = chestTables.find(t => t.id === 'loot_chest_gold');
  const s = store({ 'thunderrun:keys-total': '6' });
  // 连抽 3 次：每次都固定抽 coin:1200（第一档 common，权重区间起点最靠前）
  const v = pickValue(gold.entries, 'coin:1200');
  const r = openChest(s, content, 'loot_chest_gold', () => v);
  assert.equal(r.ok, true);
  assert.equal(r.rewards.length, 3);
  assert.equal(walletBalance(s, 'key'), 3, '扣 3 把钥匙');
  assert.equal(walletBalance(s, 'coin'), 3600, '3 × 1200 能量币入账');

  const silver = chestTables.find(t => t.id === 'loot_chest_silver');
  const v2 = pickValue(silver.entries, 'coin:500');
  const r2 = openChest(s, content, 'loot_chest_silver', () => v2);
  assert.equal(r2.rewards.length, 2);
  assert.equal(walletBalance(s, 'key'), 1, '扣 2 把钥匙');
});

test('保底 pity：距上次 sr+ 满 everyN 次时本次必出 sr+ 并清零；未触发则计数 +1', () => {
  const table = chestTables.find(t => t.id === 'loot_chest_bronze');
  const srPool = table.entries.filter(e => e.rarity === 'sr' || e.rarity === 'ssr');
  const v = pickValue(srPool, 'diamond:1');
  // 预置 7 次（everyN=8）：本次第 8 次 → 强制 sr+
  const s = store({ 'thunderrun:keys-total': '9', 'thunderrun:loot-pity:loot_chest_bronze': '7' });
  const r = openChest(s, content, 'loot_chest_bronze', () => v);
  assert.equal(r.ok, true);
  assert.equal(r.pityTriggered, true);
  assert.ok(r.rewards.some(x => x.rarity === 'sr' || x.rarity === 'ssr'), '首抽强制 sr+');
  assert.equal(r.rewards[0].rarity, 'sr', '首抽来自 sr+ 池');
  assert.equal(s.get('thunderrun:loot-pity:loot_chest_bronze'), '0', '触发后清零');
  assert.match(r.message, /保底触发/);

  // 未触发路径：普通抽取（coin:200 common）无 sr+ → 计数 +1
  const v2 = pickValue(table.entries, 'coin:200');
  const r2 = openChest(s, content, 'loot_chest_bronze', () => v2);
  assert.equal(r2.pityTriggered, false);
  assert.equal(s.get('thunderrun:loot-pity:loot_chest_bronze'), '1', '无 sr+ 计数 +1');

  // 自然出 sr+ 也清零（钻石 ssr 条目 diamond:2）
  const v3 = pickValue(table.entries, 'diamond:2');
  openChest(s, content, 'loot_chest_bronze', () => v3);
  assert.equal(s.get('thunderrun:loot-pity:loot_chest_bronze'), '0', '自然 sr+ 同样清零');
});

test('宝箱碎片攒满自动合成：48+2=50 → 解锁 char_ama 并回调 onUnlocked', () => {
  const table = chestTables.find(t => t.id === 'loot_chest_bronze');
  const v = pickValue(table.entries, 'shard_ama:2');
  const s = store({ 'thunderrun:keys-total': '3', 'thunderrun:shard:shard_ama': '48' });
  let unlocked = '';
  const r = openChest(s, content, 'loot_chest_bronze', () => v, { onUnlocked: id => { unlocked = id; } });
  assert.equal(r.ok, true);
  assert.equal(unlocked, 'char_ama', '自动合成回调');
  assert.deepEqual(JSON.parse(s.get(UNLOCKS_KEY)), ['char_ama']);
  assert.equal(walletBalance(s, 'shard_ama'), 0, '合成扣掉 50 碎片');
});

test('随机源缺省 = 独立 mulberry32 熵流：无注入也能开启（冒烟）', () => {
  const s = store({ 'thunderrun:keys-total': '3' });
  const r = openChest(s, content, 'loot_chest_bronze');
  assert.equal(r.ok, true);
  assert.equal(r.rewards.length, 1);
  assert.equal(walletBalance(s, 'key'), 2);
});

test('rewardText 口径：能量币/钻石/碎片（角色名）/未知 id', () => {
  const mk = (item, count, rarity) => ({ ref: `${item}:${count}`, item, count, rarity });
  assert.equal(rewardText(content, mk('coin', 300, 'common')), '能量币×300');
  assert.equal(rewardText(content, mk('diamond', 2, 'sr')), '钻石×2');
  assert.match(rewardText(content, mk('shard_ama', 2, 'rare')), /碎片×2/);
  assert.equal(rewardText(content, mk('item_mystery', 1, 'common')), 'item_mystery×1');
});

test('坏配置兜底：表不存在/缺钥匙价/空奖池 → ok=false 不崩', () => {
  const s = store({ 'thunderrun:keys-total': '9' });
  assert.equal(openChest(s, content, 'loot_chest_nothing').ok, false);
  const broken = structuredClone(content);
  broken.economy.params.lootTables.push({ id: 'loot_chest_broken', entries: [{ ref: 'coin:1', weight: 1 }] });
  assert.equal(openChest(s, broken, 'loot_chest_broken').ok, false);
  const empty = structuredClone(content);
  empty.economy.params.lootTables.push({ id: 'loot_chest_empty', cost: { key: 1 }, entries: [] });
  assert.equal(openChest(s, empty, 'loot_chest_empty').ok, false);
});

test('注入 mulberry32 固定 seed 全流程冒烟：100 连开无异常且余额守恒', () => {
  const s = store({ 'thunderrun:keys-total': '100' });
  const rng = mulberry32(hashSeed('chest-test'));
  let got = 0;
  for (let i = 0; i < 100; i++) {
    const r = openChest(s, content, 'loot_chest_bronze', rng);
    assert.equal(r.ok, true);
    got += r.rewards.reduce((sum, x) => sum + (x.item === 'coin' ? x.count : 0), 0);
  }
  assert.equal(walletBalance(s, 'key'), 0);
  assert.equal(walletBalance(s, 'coin'), got, '能量币入账 = 逐次奖励和');
  assert.equal(Number(s.get('thunderrun:loot-pity:loot_chest_bronze')) <= 8, true, '保底计数有界');
});
