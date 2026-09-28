/**
 * 音频导演测试：配置解析 + 场景事件 → AudioService 调用的映射（不涉及真实音频）。
 * 依赖编译产物：先 npm run build（或 npm run check 会先编译）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAudioDirector, parseAudioConfig } from '../packages/game/dist/core/audio/audioDirector.js';

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

test('onDeath：先停 BGM 再播一次性死亡乐；exitRun 兜底停乐', () => {
  const { calls, adapter } = makeAdapter();
  const d = createAudioDirector(adapter, params);
  d.enterRun();
  d.onDeath();
  d.exitRun();
  assert.deepEqual(calls, [
    ['playMusic', 'assets/audio/bgm/run.mp3', { loop: true, volume: 0.5 }],
    ['stopMusic'],
    ['playSfx', 'assets/audio/sfx/death.mp3', { volume: 0.8 }],
    ['stopMusic'],
  ]);
});

test('dispose：释放宿主音频资源', () => {
  const { calls, adapter } = makeAdapter();
  createAudioDirector(adapter, params).dispose();
  assert.deepEqual(calls, [['dispose']]);
});

test('配置缺失/坏类型：不播任何声源、不抛错（stop 与 dispose 照常）', () => {
  const bad = [
    {},
    { audio: {} },
    { audio: 'oops' },
    { audio: { bgm: { run: '' }, sfx: { death: 42 } } },
  ];
  for (const p of bad) {
    const { calls, adapter } = makeAdapter();
    const d = createAudioDirector(adapter, p);
    d.enterRun();
    d.onDeath();
    d.exitRun();
    d.dispose();
    assert.equal(calls.filter(c => c[0] === 'playMusic' || c[0] === 'playSfx').length, 0);
    assert.equal(calls.filter(c => c[0] === 'stopMusic').length, 2);
  }
});

test('无 audio 能力的适配器（纯逻辑测试壳）：全部空操作，不抛错', () => {
  const d = createAudioDirector({}, params);
  d.enterRun();
  d.onDeath();
  d.exitRun();
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
  assert.equal(dflt.deathSfx, '');
});
