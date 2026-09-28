/**
 * ui 技术段配置测试（S4）：resolveUiConfig 解析/兜底 + core validateUiParams 范围校验，
 * 并锚定 config/game.json params.ui 与 defaultUiConfig 同源（改动必须双侧同步）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveUiConfig, defaultUiConfig } from '../packages/framework/dist/ui/index.js';
import { validateUiParams, validateFile } from '../packages/game/dist/core/config/configValidator.js';
import { readJson } from './ui-helpers.mjs';

const game = readJson('config/game.json');
const uiParams = game.params.ui;

test('game.json 技术段 ui 节齐备且过校验', () => {
  assert.ok(uiParams && typeof uiParams === 'object');
  assert.deepEqual(validateUiParams(uiParams), []);
  assert.deepEqual(validateFile('game', game), []);
});

test('resolveUiConfig：无配置 → 全默认；game.json → 与文件一致', () => {
  assert.deepEqual(resolveUiConfig(undefined), defaultUiConfig);
  assert.deepEqual(resolveUiConfig({}), defaultUiConfig);
  const c = resolveUiConfig(game.params);
  assert.deepEqual(c.scroll, uiParams.scroll);
  assert.equal(c.press.slopPx, uiParams.press.slopPx);
  assert.equal(c.doubleTap.windowMs, uiParams.doubleTap.windowMs);
  assert.equal(c.text.fontSizePx, uiParams.text.fontSizePx);
});

test('resolveUiConfig：非法值（字符串/NaN/缺字段）逐项回退默认', () => {
  const c = resolveUiConfig({ ui: { scroll: { frictionPerS: 'x', minVelocityPxS: NaN }, press: { slopPx: null } } });
  assert.equal(c.scroll.frictionPerS, defaultUiConfig.scroll.frictionPerS);
  assert.equal(c.scroll.minVelocityPxS, defaultUiConfig.scroll.minVelocityPxS);
  assert.equal(c.scroll.flingMaxPxS, defaultUiConfig.scroll.flingMaxPxS);
  assert.equal(c.press.slopPx, defaultUiConfig.press.slopPx);
  assert.equal(c.press.tapMaxMs, defaultUiConfig.press.tapMaxMs);
});

test('resolveUiConfig：合法覆盖生效', () => {
  const c = resolveUiConfig({ ui: { scroll: { frictionPerS: 6 }, doubleTap: { windowMs: 300 } } });
  assert.equal(c.scroll.frictionPerS, 6);
  assert.equal(c.doubleTap.windowMs, 300);
});

test('validateUiParams：越界/类型错/段类型错必须抓到', () => {
  assert.ok(validateUiParams({ scroll: { frictionPerS: -1 } }).some(e => e.includes('frictionPerS')));
  assert.ok(validateUiParams({ scroll: { overscrollResist: 2 } }).some(e => e.includes('overscrollResist')));
  assert.ok(validateUiParams({ press: { slopPx: '8' } }).some(e => e.includes('slopPx')));
  assert.ok(validateUiParams({ text: { fontSizePx: 2 } }).some(e => e.includes('fontSizePx')));
  assert.ok(validateUiParams({ scroll: 5 }).some(e => e.includes('scroll')));
  assert.ok(validateUiParams('nope').length > 0);
  assert.deepEqual(validateUiParams({}), []);
  assert.deepEqual(validateUiParams(undefined), []);
});

test('validateFile 集成：破坏 params.ui 会让 game.json 校验失败', () => {
  const broken = JSON.parse(JSON.stringify(game));
  broken.params.ui.scroll.bounceStiffness = -5;
  assert.ok(validateFile('game', broken).some(e => e.includes('bounceStiffness')));
});
