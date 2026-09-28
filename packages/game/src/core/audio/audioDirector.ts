/**
 * 音频导演（core 层，零宿主 API）：把内容配置翻译成 PlatformAdapter.audio 调用。
 * 配置位置：game.json → params.audio（可选；缺省=全程静音，不报错）：
 *   {
 *     "volume": { "music": 0.7, "sfx": 1 },
 *     "bgm": { "run": "assets/audio/bgm/run.mp3" },
 *     "sfx": { "death": "assets/audio/sfx/death.mp3" }
 *   }
 * 行为：enterRun 播循环 BGM；onDeath 停 BGM 并播一次性死亡乐；exitRun 兜底停 BGM。
 * adapter.audio 缺省（纯逻辑测试壳）或配置缺失时全部空操作——音频不阻塞玩法。
 * 内容规范见 docs/audio.md。
 */
import type { PlatformAdapter } from '@tr/framework/platform/platformAdapter.js';

export interface AudioDirector {
  /** 进入 run：播放循环背景音乐。 */
  enterRun(): void;
  /** 离开 run：停背景音乐（死亡后兜底，避免残留）。 */
  exitRun(): void;
  /** 死亡瞬间：停背景音乐并播放一次性死亡乐。 */
  onDeath(): void;
  /** 释放宿主音频资源（会话退出路径）。 */
  dispose(): void;
}

export interface AudioConfig {
  bgmRun: string;
  deathSfx: string;
  musicVolume: number;
  sfxVolume: number;
}

export const DEFAULT_MUSIC_VOLUME = 0.7;
export const DEFAULT_SFX_VOLUME = 1;

const asRecord = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const asPath = (v: unknown): string => (typeof v === 'string' && v.length > 0 ? v : '');
const asVolume = (v: unknown, dflt: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : dflt;

/** 解析 game.json 的 params.audio 段；缺省段/坏类型全部走默认（不抛错）。 */
export function parseAudioConfig(params: unknown): AudioConfig {
  const audio = asRecord(asRecord(params)['audio']);
  const volume = asRecord(audio['volume']);
  return {
    bgmRun: asPath(asRecord(audio['bgm'])['run']),
    deathSfx: asPath(asRecord(audio['sfx'])['death']),
    musicVolume: asVolume(volume['music'], DEFAULT_MUSIC_VOLUME),
    sfxVolume: asVolume(volume['sfx'], DEFAULT_SFX_VOLUME),
  };
}

export function createAudioDirector(adapter: PlatformAdapter, params: unknown): AudioDirector {
  const audio = adapter.audio;
  const cfg = parseAudioConfig(params);
  return {
    enterRun() {
      if (audio && cfg.bgmRun) audio.playMusic(cfg.bgmRun, { loop: true, volume: cfg.musicVolume });
    },
    exitRun() {
      audio?.stopMusic();
    },
    onDeath() {
      if (!audio) return;
      audio.stopMusic();
      if (cfg.deathSfx) audio.playSfx(cfg.deathSfx, { volume: cfg.sfxVolume });
    },
    dispose() {
      audio?.dispose();
    },
  };
}
