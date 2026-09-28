/**
 * 配置校验器测试（对应 docs/08 §1「配置」层）
 * 验证点：真实配置全绿；人为破坏（重复 id / 坏引用 / 缺 versions）必须被抓到。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateFile, validateRefs } from '../packages/game/dist/core/config/configValidator.js';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const NAMES = ['game', 'characters', 'skills', 'items', 'obstacles', 'themes', 'events', 'economy'];
const load = name => JSON.parse(readFileSync(join(root, 'config', `${name}.json`), 'utf8'));
const schema = JSON.parse(readFileSync(join(root, 'schema', 'config.schema.json'), 'utf8'));

test('真实配置逐文件校验全绿', () => {
  for (const n of NAMES) assert.deepEqual(validateFile(n, load(n)), [], `${n}.json 应无错误`);
});

test('真实配置跨文件引用检查全绿', () => {
  const content = Object.fromEntries(NAMES.map(n => [n, load(n)]));
  assert.deepEqual(validateRefs(content), []);
});

test('数组不能冒充配置或技术段对象', () => {
  assert.ok(validateFile('game', []).some(e => e.includes('不是 JSON 对象')));
  assert.ok(validateFile('game', { configVersion: '1', params: [] }).some(e => e.includes('params 对象')));
  assert.ok(validateFile('game', { configVersion: '1', params: { ui: [] } }).some(e => e.includes('ui: 应为对象')));
});

test('能抓到：重复 id / 错误前缀 / 缺失 versions', () => {
  const skills = load('skills');
  skills.items.push(JSON.parse(JSON.stringify(skills.items[0])));           // 重复 id
  skills.items.push({ id: 'wrong_prefix', name: { 'zh-CN': 'x' }, versions: [{}] });
  skills.items[1].versions = [];                                            // 缺 versions 记录
  const errors = validateFile('skills', skills);
  assert.ok(errors.some(e => e.includes('重复')));
  assert.ok(errors.some(e => e.includes('前缀')));
  assert.ok(errors.some(e => e.includes('versions')));
});

test('能抓到：坏引用（技能/角色/奖池/模板）', () => {
  const chars = load('characters');
  chars.items.find(c => c.id === 'char_volt').skillRef = 'skill_not_exist';
  const econ = load('economy');
  econ.params.shards[0].grants = 'char_ghost';
  const obs = load('obstacles');
  obs.patterns[0].cells[0].obsRef = 'obs_ghost';
  const content = {
    game: load('game'), themes: load('themes'), events: load('events'),
    characters: chars, skills: load('skills'), items: load('items'),
    obstacles: obs, economy: econ,
  };
  const errors = [...validateFile('obstacles', obs), ...validateRefs(content)];
  assert.ok(errors.some(e => e.includes('obs_ghost')));
  assert.ok(errors.some(e => e.includes('skill_not_exist')));
  assert.ok(errors.some(e => e.includes('char_ghost')));
});

test('能抓到：配置引用了引擎未注册的效果原语（docs/09 T2.2 的反静默闸门）', () => {
  const items = load('items');
  items.items.find(i => i.id === 'item_magnet').effects[0].primitive = 'teleport';
  const content = {
    game: load('game'), themes: load('themes'), events: load('events'),
    characters: load('characters'), skills: load('skills'), items,
    obstacles: load('obstacles'), economy: load('economy'),
  };
  const errors = validateRefs(content);
  assert.ok(errors.some(e => e.includes('teleport') && e.includes('未在 core/effects 注册')), errors.join('\n'));
});

test('game.json 的 runner 参数都已在仓库 schema 中声明', () => {
  const declared = new Set(Object.keys(schema.game.properties.params.properties.runner.properties));
  for (const key of Object.keys(load('game').params.runner)) {
    assert.ok(declared.has(key), `runner.${key} 未写进 schema/config.schema.json`);
  }
});
