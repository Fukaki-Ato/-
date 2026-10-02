/**
 * 音频导演测试：配置解析 + 场景事件 → AudioService 调用的映射（不涉及真实音频）。
 * 依赖编译产物：先 npm run build（或 npm run check 会先编译）。
 * 含真实 config/game.json 的 handoff 回归：run BGM → 死亡 BGM + 音效池 + 角色音效 → 离开结算停乐。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createAudioDirector, parseAudioConfig, pickFromPool, sanitizeAudioPath,
} from '../packages/game/dist/core/audio/audioDirector.js';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const realParams = JSON.parse(readFileSync(join(root, 'config', 'game.json'), 'utf8')).params;

function makeAdapter() {
  const calls = [];
  const audio = {
    playMusic: (url, opts) => calls.push(['playMusic', url, opts]),
    stopMusic: () => calls.push(['stopMusic']),
    playSfx: (url, opts) => calls.push(['playSfx', url, opts]),
    dispose: () => calls.push(['dispose']),
  };
  return { calls, adapter: { audio } };
}

const params = {
  audio: {
    volume: { music: 0.5, sfx: 0.8 },
    bgm: { run: 'assets/audio/bgm/run.mp3' },
    sfx: { death: 'assets/audio/sfx/death.mp3' },
  },
};

test('enterRun：播放循环 BGM，带配置音量', () => {
  const { calls, adapter } = makeAdapter();
  createAudioDirector(adapter, params).enterRun();
  assert.deepEqual(calls, [['playMusic', 'assets/audio/bgm/run.mp3', { loop: true, volume: 0.5 }]]);
});

test('旧版单路径 sfx.death：先停 BGM 再播一次性死亡音效；死亡后 exitRun 不再停乐，stopDeathMusic 收尾', () => {
  const { calls, adapter } = makeAdapter();
  const d = createAudioDirector(adapter, params);
  d.enterRun();
  d.onDeath();
  d.onDeath(); // 同局重复死亡回调：只响一次
  d.exitRun();
  d.stopDeathMusic();
  assert.deepEqual(calls, [
    ['playMusic', 'assets/audio/bgm/run.mp3', { loop: true, volume: 0.5 }],
    ['stopMusic'],
    ['playSfx', 'assets/audio/sfx/death.mp3', { volume: 0.8 }],
    ['stopMusic'],
  ]);
});

test('中途退出（未死亡）：exitRun 停 run BGM，stopDeathMusic 不重复停', () => {
  const { calls, adapter } = makeAdapter();
  const d = createAudioDirector(adapter, params);
  d.enterRun();
  d.exitRun();
  d.stopDeathMusic();
  assert.deepEqual(calls.map(c => c[0]), ['playMusic', 'stopMusic']);
});

test('dispose：释放宿主音频资源', () => {
  const { calls, adapter } = makeAdapter();
  createAudioDirector(adapter, params).dispose();
  assert.deepEqual(calls, [['dispose']]);
});

test('配置缺失/坏类型：不播任何声源、不抛错', () => {
  const bad = [
    {},
    { audio: {} },
    { audio: 'oops' },
    { audio: { bgm: { run: '' }, sfx: { death: 42 } } },
    { audio: { bgm: [], sfx: { death: [], start: {} }, characters: 'x' } },
    { audio: { sfx: { death: [null, 3, '', '   '] }, characters: { char_volt: { sfx: [1] }, x: null } } },
  ];
  for (const p of bad) {
    const { calls, adapter } = makeAdapter();
    const d = createAudioDirector(adapter, p);
    d.enterRun('char_volt');
    d.onCast();
    d.onPickup();
    d.onDeath();
    d.exitRun();
    d.stopDeathMusic();
    d.dispose();
    assert.equal(calls.filter(c => c[0] === 'playMusic' || c[0] === 'playSfx').length, 0, JSON.stringify(p));
  }
});

test('无 audio 能力的适配器（纯逻辑测试壳）：全部空操作，不抛错', () => {
  const d = createAudioDirector({}, realParams);
  d.enterRun('char_volt');
  d.onCast();
  d.onPickup();
  d.onDeath();
  d.exitRun();
  d.stopDeathMusic();
  d.dispose();
});

test('parseAudioConfig：音量越界夹到 [0,1]，缺省走默认（music 0.7 / sfx 1）', () => {
  const clamped = parseAudioConfig({ audio: { volume: { music: 5, sfx: -2 } } });
  assert.equal(clamped.musicVolume, 1);
  assert.equal(clamped.sfxVolume, 0);
  const dflt = parseAudioConfig({});
  assert.equal(dflt.musicVolume, 0.7);
  assert.equal(dflt.sfxVolume, 1);
  assert.equal(dflt.bgmRun, '');
  assert.equal(dflt.bgmDeath, '');
  assert.equal(dflt.startSfx, '');
  assert.deepEqual(dflt.deathSfx, []);
  assert.equal(dflt.characters.size, 0);
});

test('sanitizeAudioPath：拒绝越级/控制符/反斜杠/非 http 协议/协议相对，保留仓库相对与 https', () => {
  for (const bad of ['../x.mp3', 'assets/../../x.mp3', 'a\\b.mp3', 'a\nb.mp3', 'javascript:alert(1)',
    'file:///etc/passwd', '//evil.example/x.mp3', 'x'.repeat(600), '   ', 7, null]) {
    assert.equal(sanitizeAudioPath(bad), '', String(bad));
  }
  assert.equal(sanitizeAudioPath(' ./assets/audio/a.mp3 '), 'assets/audio/a.mp3');
  assert.equal(sanitizeAudioPath('https://cdn.example.com/a.mp3'), 'https://cdn.example.com/a.mp3');
  assert.equal(sanitizeAudioPath('pkg-assets/assets/audio/a.mp3'), 'pkg-assets/assets/audio/a.mp3');
});

test('parseAudioConfig：死亡池兼容单字符串/数组，剔除坏项并去重', () => {
  assert.deepEqual(parseAudioConfig({ audio: { sfx: { death: 'a.mp3' } } }).deathSfx, ['a.mp3']);
  assert.deepEqual(
    parseAudioConfig({ audio: { sfx: { death: ['a.mp3', '', 3, '../x.mp3', 'a.mp3', 'b.mp3'] } } }).deathSfx,
    ['a.mp3', 'b.mp3'],
  );
});

test('pickFromPool：随机源可注入；NaN/越界夹回合法下标；空池返回空串', () => {
  const pool = ['a', 'b', 'c'];
  assert.equal(pickFromPool(pool, () => 0), 'a');
  assert.equal(pickFromPool(pool, () => 0.5), 'b');
  assert.equal(pickFromPool(pool, () => 0.9999), 'c');
  assert.equal(pickFromPool(pool, () => 1), 'c');
  assert.equal(pickFromPool(pool, () => -3), 'a');
  assert.equal(pickFromPool(pool, () => NaN), 'a');
  assert.equal(pickFromPool([], () => 0.5), '');
});

// ---------------- 真实 config/game.json（PR #10 内容）----------------

test('真实配置：解析出 run/death BGM、开局音效、7 条死亡池与 char_volt 角色音效，且文件真实存在', () => {
  const cfg = parseAudioConfig(realParams);
  assert.equal(cfg.bgmRun, 'assets/audio/bgm/run.mp3');
  assert.equal(cfg.bgmDeath, 'assets/audio/bgm/death.mp3');
  assert.equal(cfg.startSfx, 'assets/audio/sfx/start.mp3');
  assert.equal(cfg.deathSfx.length, 7);
  const volt = cfg.characters.get('char_volt');
  assert.ok(volt && volt.cast && volt.pickup && volt.death);
  for (const p of [cfg.bgmRun, cfg.bgmDeath, cfg.startSfx, ...cfg.deathSfx, volt.cast, volt.pickup, volt.death]) {
    assert.ok(existsSync(join(root, p)), `配置引用的音频不存在：${p}`);
  }
});

test('真实配置 handoff：开局 BGM+开局音效 → 技能/拾取 → 死亡停 run BGM、播不循环死亡 BGM + 池中一条 + 角色死亡音效', () => {
  const cfg = parseAudioConfig(realParams);
  const { calls, adapter } = makeAdapter();
  const d = createAudioDirector(adapter, realParams, { random: () => 0.5 });
  const volt = cfg.characters.get('char_volt');
  const sfx = { volume: cfg.sfxVolume };
  d.enterRun('char_volt');
  d.onCast();
  d.onPickup();
  d.onDeath();
  d.onCast(); // 死亡后不再响技能/拾取
  d.onPickup();
  d.exitRun(); // run → result：死亡 BGM 延续
  assert.deepEqual(calls, [
    ['playMusic', cfg.bgmRun, { loop: true, volume: cfg.musicVolume }],
    ['playSfx', cfg.startSfx, sfx],
    ['playSfx', volt.cast, sfx],
    ['playSfx', volt.pickup, sfx],
    ['stopMusic'],
    ['playMusic', cfg.bgmDeath, { loop: false, volume: cfg.musicVolume }],
    ['playSfx', cfg.deathSfx[3], sfx],
    ['playSfx', volt.death, sfx],
  ]);
  calls.length = 0;
  d.stopDeathMusic(); // 离开结算
  d.enterRun('char_volt'); // 重开
  assert.deepEqual(calls.slice(0, 2), [['stopMusic'], ['playMusic', cfg.bgmRun, { loop: true, volume: cfg.musicVolume }]]);
});

test('真实配置：未配置角色音效的角色只响全局音效；死亡池抽取走注入随机源', () => {
  const cfg = parseAudioConfig(realParams);
  const seq = [0, 0.99];
  for (const r of seq) {
    const { calls, adapter } = makeAdapter();
    const d = createAudioDirector(adapter, realParams, { random: () => r });
    d.enterRun('char_unknown');
    d.onCast();
    d.onPickup();
    d.onDeath();
    const sfx = calls.filter(c => c[0] === 'playSfx').map(c => c[1]);
    assert.deepEqual(sfx, [cfg.startSfx, cfg.deathSfx[Math.floor(r * cfg.deathSfx.length)]]);
  }
});
