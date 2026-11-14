/**
 * 成就数据契约测试（achievements.json + schema + 校验器注册）
 * 验证点：真实配置全绿；stat 白名单三份拷贝（configTypes / schema enum）不漂移；
 * 人为破坏（旧命名 casts / run 标 local stat / 坏引用 / 零值奖励）必须被抓到。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateFile, validateRefs } from '../packages/game/dist/core/config/configValidator.js';
import { ACH_RUN_STATS, ACH_LOCAL_STATS, CONTENT_NAMES } from '../packages/game/dist/core/config/configTypes.js';
import { RUN_SUPPLIED, LOCAL_STATS } from '../apps/server/src/achievement-service.mjs';
import { loadMissionContent } from '../apps/server/src/content.mjs';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const NAMES = ['game', 'characters', 'skills', 'items', 'obstacles', 'themes', 'events', 'economy'];
const load = name => JSON.parse(readFileSync(join(root, 'config', `${name}.json`), 'utf8'));
const schema = JSON.parse(readFileSync(join(root, 'schema', 'config.schema.json'), 'utf8'));
const loadAll = () => Object.fromEntries([...NAMES, 'achievements'].map(n => [n, load(n)]));

test('真实 achievements.json 逐文件校验全绿', () => {
  assert.deepEqual(validateFile('achievements', load('achievements')), []);
});

test('真实配置（含 achievements）跨文件引用检查全绿', () => {
  assert.deepEqual(validateRefs(loadAll()), []);
});

test('旧调用方（8 文件 content、无 achievements 键）不因引用检查炸掉', () => {
  const content = Object.fromEntries(NAMES.map(n => [n, load(n)]));
  assert.deepEqual(validateRefs(content), []);
});

test('部署涟漪登记：CONTENT_NAMES 与服务端 CONFIG_NAMES 都收了 achievements', () => {
  assert.ok(CONTENT_NAMES.includes('achievements'));
  assert.ok(Object.keys(loadMissionContent()).includes('achievements'));
});

test('stat 白名单三份拷贝不漂移：schema enum ↔ 客户端双清单 ↔ 服务端 RUN_SUPPLIED/LOCAL_STATS', () => {
  const enumStats = schema.$defs.achievement.properties.stat.enum;
  assert.deepEqual([...enumStats].sort(), [...ACH_RUN_STATS, ...ACH_LOCAL_STATS].sort());
  // 服务端那份（纯清单漂移不红的服务级断言管不到）：增删任何 stat 必须三处同改
  assert.deepEqual([...RUN_SUPPLIED, ...LOCAL_STATS].sort(), [...ACH_RUN_STATS, ...ACH_LOCAL_STATS].sort());
});

test('能抓到：status 非法值（schema 可选字段，出现即须在枚举内）', () => {
  const file = load('achievements');
  file.items.find(i => i.id === 'ach_slides_100').status = 'archived';
  const errors = validateFile('achievements', file);
  assert.ok(errors.some(e => e.includes('status 应为')), errors.join('\n'));
});

test('能抓到：旧命名 casts（与任务指标 skillCasts 脱节的回归，启动即抛或恒 0 两种死法都堵死）', () => {
  const file = load('achievements');
  file.items.find(i => i.id === 'ach_skillcasts_50').stat = 'casts';
  const errors = validateFile('achievements', file);
  assert.ok(errors.some(e => e.includes('casts')), errors.join('\n'));
});

test('能抓到：local-only stat 误标 source=run（服务端恒 0 的死条目）', () => {
  const file = load('achievements');
  file.items.find(i => i.id === 'ach_chars_3').source = 'run';
  const errors = validateFile('achievements', file);
  assert.ok(errors.some(e => e.includes('服务端不可供给')), errors.join('\n'));
});

test('能抓到：itemOf 缺 statRef / 非 itemOf 带 statRef', () => {
  const file = load('achievements');
  delete file.items.find(i => i.id === 'ach_magnet_30').statRef;
  file.items.find(i => i.id === 'ach_slides_100').statRef = 'item_magnet';
  const errors = validateFile('achievements', file);
  assert.ok(errors.some(e => e.includes('stat=itemOf 缺少 statRef')), errors.join('\n'));
  assert.ok(errors.some(e => e.includes('仅 stat=itemOf 允许 statRef')), errors.join('\n'));
});

test('能抓到：statRef 道具不存在 / reward.shard 碎片不存在（validateRefs）', () => {
  const content = loadAll();
  content.achievements.items.find(i => i.id === 'ach_magnet_30').statRef = 'item_ghost';
  content.achievements.items.find(i => i.id === 'ach_shield_50').reward.shard = 'shard_ghost:10';
  const errors = validateRefs(content);
  assert.ok(errors.some(e => e.includes('statRef 道具不存在') && e.includes('item_ghost')), errors.join('\n'));
  assert.ok(errors.some(e => e.includes('奖励碎片不存在') && e.includes('shard_ghost')), errors.join('\n'));
});

test('能抓到：零值/负数奖励、坏 shard 串与未知奖励键（零值=可领取却发不出的死条目）', () => {
  const file = load('achievements');
  file.items.find(i => i.id === 'ach_slides_100').reward = { coin: 0 };
  file.items.find(i => i.id === 'ach_jumps_100').reward = { coin: -1 };
  file.items.find(i => i.id === 'ach_runs_10').reward = {};
  file.items.find(i => i.id === 'ach_runs_100').reward = { gem: 1 };
  file.items.find(i => i.id === 'ach_shield_50').reward = { shard: 'shard_volt:0' };
  file.items.find(i => i.id === 'ach_chars_3').reward = { shard: 'shard_volt:-3' };
  const errors = validateFile('achievements', file);
  assert.ok(errors.filter(e => e.includes('reward')).length >= 6, errors.join('\n'));
});

test('能抓到：target 非正整数 / tier 与 group 非法值', () => {
  const file = load('achievements');
  file.items.find(i => i.id === 'ach_slides_100').target = 0;
  file.items.find(i => i.id === 'ach_jumps_100').tier = 'diamond';
  file.items.find(i => i.id === 'ach_runs_10').group = 'misc';
  const errors = validateFile('achievements', file);
  assert.ok(errors.some(e => e.includes('target 应为正整数')), errors.join('\n'));
  assert.ok(errors.some(e => e.includes('tier 应为')), errors.join('\n'));
  assert.ok(errors.some(e => e.includes('group 应为')), errors.join('\n'));
});

test('能抓到：id 前缀（ach_）与重复 id——前缀必须注册，否则检查静默失效', () => {
  const file = load('achievements');
  file.items.push({ id: 'ach_dup', versions: [{}] });
  file.items.push({ id: 'ach_dup', versions: [{}] });
  file.items.push({ id: 'bad_prefix', versions: [{}] });
  const errors = validateFile('achievements', file);
  assert.ok(errors.filter(e => e.includes('id 重复')).length === 1, errors.join('\n'));
  assert.ok(errors.some(e => e.includes('id 前缀应为 ach_')), errors.join('\n'));
});
