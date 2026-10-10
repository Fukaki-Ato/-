/**
 * 玩家档案数据层单测（纯逻辑，无 UI）：ID 生成与稳定性、脏存档回退、改名规则（免费→扣钻→不足拒绝）。
 * 面板交互在 tests/pages.test.mjs（headless 控件树）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PLAYER_ID_KEY, PLAYER_NAME_KEY, PLAYER_AVATAR_KEY, PLAYER_RENAMES_KEY,
  DEFAULT_NAME, DEFAULT_PROFILE_PARAMS, DEFAULT_NAME_CANDIDATES, MAX_NAME_CANDIDATES,
  profileParamsFrom, generatePlayerId, loadProfile, saveProfile, withAvatar, tryRename,
} from '../packages/game/dist/core/profile/playerProfile.js';
import { readJson } from './ui-helpers.mjs';

const P = DEFAULT_PROFILE_PARAMS;

function mem(init = {}) {
  const m = new Map(Object.entries(init));
  return {
    m,
    get: k => (m.has(k) ? m.get(k) : null),
    set: (k, v) => m.set(k, v),
    remove: k => m.delete(k),
  };
}

// ---------------- ID ----------------

test('generatePlayerId：指定位数、首位非 0、同种子可复现', () => {
  const a = generatePlayerId('seed-a', 10);
  assert.match(a, /^[1-9]\d{9}$/, `10 位且首位非 0，实得 ${a}`);
  assert.equal(generatePlayerId('seed-a', 10), a, '同种子必须复现（测试注入固定串用）');
  assert.notEqual(generatePlayerId('seed-b', 10), a, '不同种子应给出不同 ID');
  assert.match(generatePlayerId('x', 4), /^[1-9]\d{3}$/, '4 位下限同样成立');
});

test('loadProfile：首次生成即落盘，之后跨会话读回同一个 ID', () => {
  const s = mem();
  const first = loadProfile(s, P, 111);
  assert.equal(s.m.get(PLAYER_ID_KEY), first.id, '生成后立刻持久化');
  const again = loadProfile(s, P, 999); // 熵换了也不能重发号
  assert.equal(again.id, first.id, 'ID 一旦生成就固定不变');
});

test('loadProfile：脏 ID（位数不足/首位 0/含字母）重新发号，好值不再动', () => {
  for (const bad of ['12345', '0123456789', 'abc', '123456789a', '']) {
    const s = mem({ [PLAYER_ID_KEY]: bad });
    const id = loadProfile(s, P, 7).id;
    assert.match(id, /^[1-9]\d{9}$/, `脏值 ${JSON.stringify(bad)} 应被重发号，实得 ${id}`);
  }
  const keep = mem({ [PLAYER_ID_KEY]: '9876543210' });
  assert.equal(loadProfile(keep, P, 7).id, '9876543210', '合法 ID 原样读回');
});

test('loadProfile：名字/头像/改名次数的脏值逐项回退', () => {
  const p = loadProfile(mem({
    [PLAYER_NAME_KEY]: '', [PLAYER_AVATAR_KEY]: '-3', [PLAYER_RENAMES_KEY]: 'x',
  }), P, 5);
  assert.equal(p.name, DEFAULT_NAME, '空名回退默认名');
  assert.equal(p.avatar, 0, '负头像序号回退 0');
  assert.equal(p.renames, 0, '非数字次数回退 0');
  const saved = mem();
  saveProfile(saved, { id: '1234567890', name: '闪电少年', avatar: 3, renames: 1 });
  assert.deepEqual(loadProfile(saved, P, 9), { id: '1234567890', name: '闪电少年', avatar: 3, renames: 1 }, '存得进也读得出');
});

// ---------------- 头像 ----------------

test('withAvatar：越界与同号返回原对象（调用方据此判断要不要刷新）', () => {
  const p = { id: '1', name: 'a', avatar: 2, renames: 0 };
  assert.equal(withAvatar(p, 2, 14), p, '同号不动');
  assert.equal(withAvatar(p, -1, 14), p, '负序号忽略');
  assert.equal(withAvatar(p, 14, 14), p, '越界序号忽略');
  assert.equal(withAvatar(p, 1.5, 14), p, '非整数序号忽略');
  assert.deepEqual(withAvatar(p, 5, 14), { ...p, avatar: 5 }, '合法序号生成新档案');
});

// ---------------- 改名 ----------------

test('tryRename：第一次免费，第二次起扣钻石，余额同步回写', () => {
  const free = tryRename({ id: '1', name: '小跑者', avatar: 0, renames: 0 }, P, '闪电少年', 50);
  assert.equal(free.ok, true);
  assert.equal(free.cost, 0, '免费次数内不扣钱');
  assert.equal(free.diamondsLeft, 50);
  assert.equal(free.profile.renames, 1);

  const paid = tryRename({ ...free.profile }, P, '椰子骑士', 50);
  assert.equal(paid.cost, P.renameCostDiamonds, '用完免费次数按 config 定价');
  assert.equal(paid.diamondsLeft, 50 - P.renameCostDiamonds);
  assert.equal(paid.profile.name, '椰子骑士');
});

test('tryRename：钱不够直接失败，且不扣费、不计数', () => {
  const prof = { id: '1', name: '小跑者', avatar: 0, renames: P.freeRenames };
  const r = tryRename(prof, P, '闪电少年', P.renameCostDiamonds - 1);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'need-diamonds');
  assert.equal(r.diamonds, P.renameCostDiamonds - 1, '失败回显余额，不改数值');
});

test('tryRename：非法名（空/纯空格/超长）与同名分别拒绝', () => {
  const prof = { id: '1', name: '小跑者', avatar: 0, renames: 0 };
  for (const bad of ['', '   ', '一'.repeat(P.nameMaxChars + 1)]) {
    const r = tryRename(prof, P, bad, 999);
    assert.equal(r.ok, false, `${JSON.stringify(bad)} 应非法`);
    assert.equal(r.reason, 'invalid', '合法性排在钱之前，不能被「钻石不足」顶掉');
  }
  assert.equal(tryRename(prof, P, ' 小跑者 ', 999).reason, 'same', '先去空格再比同名');
  assert.equal(tryRename(prof, P, '闪电少年', 999).ok, true, '候选名两端空格不影响入选');
});

// ---------------- 配置解析 ----------------

test('profileParamsFrom：脏值逐项回退默认，不把 NaN 带进 UI', () => {
  assert.deepEqual(profileParamsFrom(undefined), DEFAULT_PROFILE_PARAMS, '整段缺失回退默认');
  const p = profileParamsFrom({ idDigits: 'abc', nameMaxChars: 0, freeRenames: -3, panelHeightPct: 999, slideDurationMs: null });
  assert.equal(p.idDigits, P.idDigits);
  assert.equal(p.nameMaxChars, P.nameMaxChars, '越界数值回退');
  assert.equal(p.freeRenames, P.freeRenames);
  assert.equal(p.panelHeightPct, P.panelHeightPct, '面板高度超 100% 回退');
  assert.equal(p.slideDurationMs, P.slideDurationMs, 'null 不能当成「配了 0」');
  assert.equal(profileParamsFrom({ renameCostDiamonds: '30' }).renameCostDiamonds, 30, '数字字符串容忍');
  assert.equal(profileParamsFrom({ renameCostDiamonds: '' }).renameCostDiamonds, P.renameCostDiamonds, '空串算缺失');
});

test('profileParamsFrom：昵称名单去空/去重/剔超长并限流，坏名单回退内置', () => {
  const p = profileParamsFrom({ nameCandidates: ['小跑者', ' 小跑者 ', '', 42, '海'.repeat(20), '闪电少年'] });
  assert.deepEqual(p.nameCandidates, ['小跑者', '42', '闪电少年'], '脏项剔除但合法项保序（42 是合法短名）');
  assert.deepEqual(profileParamsFrom({ nameCandidates: '不是数组' }).nameCandidates, DEFAULT_NAME_CANDIDATES);
  assert.deepEqual(profileParamsFrom({ nameCandidates: [] }).nameCandidates, DEFAULT_NAME_CANDIDATES);
  const capped = profileParamsFrom({ nameCandidates: Array.from({ length: 20 }, (_, i) => `名${i}`) });
  assert.equal(capped.nameCandidates.length, MAX_NAME_CANDIDATES, `名单最多 ${MAX_NAME_CANDIDATES} 个（面板两行放得下）`);
  assert.deepEqual(profileParamsFrom({ nameMaxChars: 2 }).nameCandidates, [], '字数上限压过内置名时宁可没有候选');
});

test('config/game.json params.profile 与解析结果一致（改配置要过这一关）', () => {
  const raw = readJson('config/game.json').params.profile;
  const p = profileParamsFrom(raw);
  assert.equal(p.idDigits, raw.idDigits);
  assert.equal(p.renameCostDiamonds, raw.renameCostDiamonds);
  assert.equal(p.panelHeightPct, raw.panelHeightPct);
  assert.deepEqual(p.nameCandidates, raw.nameCandidates, 'config 名单不该被清洗掉任何一项');
  for (const n of p.nameCandidates) {
    assert.ok(n.length <= p.nameMaxChars, `候选名「${n}」超过 ${p.nameMaxChars} 字上限`);
  }
});
