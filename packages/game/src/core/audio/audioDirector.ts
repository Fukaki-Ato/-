/**
 * 音频导演（core 层，零宿主 API）：把内容配置翻译成 PlatformAdapter.audio 调用。
 * 配置位置：game.json → params.audio（可选；缺省=全程静音，不报错）：
 *   {
 *     "volume": { "music": 0.7, "sfx": 1 },
 *     "bgm": { "run": "assets/audio/bgm/run.mp3", "death": "assets/audio/bgm/death.mp3" },
 *     "sfx": { "start": "assets/audio/sfx/start.mp3", "death": ["assets/audio/sfx/death-1.mp3", "..."] },
 *     "characters": { "char_volt": { "sfx": { "cast": "...", "pickup": "...", "death": "..." } } }
 *   }
 * sfx.death 兼容旧版单字符串与非空数组（死亡音效池，每次随机挑一条）。
 * 生命周期：enterRun 播循环 run BGM + 开局音效；onDeath 停 run BGM、播一次性死亡 BGM、
 * 一条全局死亡音效 + 所选角色死亡音效；死亡 BGM 延续到结算页，stopDeathMusic（离开结算/重开/回选角）停掉。
 * 中途退出（未死亡）exitRun 直接停 BGM。onCast/onPickup 只播所选角色的技能/拾取音效。
 * 随机源独立于玩法 RNG（可注入，缺省为独立 mulberry32 流），不消耗 RunRng、不影响赛道复现。
 * adapter.audio 缺省（纯逻辑测试壳）或配置缺失/畸形时全部空操作——音频不阻塞玩法。
 * 内容规范见 docs/audio.md。
 */
import type { PlatformAdapter } from '@tr/framework/platform/platformAdapter.js';
import { mulberry32 } from '@tr/game/core/rng.js';

export interface AudioDirector {
  /** 进入 run：播放循环 run BGM 与开局音效；charId 决定角色音效。 */
  enterRun(charId?: string): void;
  /** 离开 run：未死亡（中途退出）时停 BGM；已死亡则保留死亡 BGM 到结算页。 */
  exitRun(): void;
  /** 死亡瞬间：停 run BGM，播一次性死亡 BGM + 全局死亡音效 + 角色死亡音效（每局仅一次）。 */
  onDeath(): void;
  /** sim 的 cast 事件：所选角色技能音效。 */
  onCast(): void;
  /** sim 的 pickup 事件（道具箱，非金币）：所选角色拾取音效。 */
  onPickup(): void;
  /** 离开结算页 / 死亡后直接回选角：停死亡 BGM，避免与下一局重叠。 */
  stopDeathMusic(): void;
  /** 释放宿主音频资源（会话退出路径）。 */
  dispose(): void;
}

export interface CharacterCues {
  cast: string;
  pickup: string;
  death: string;
}

export interface AudioConfig {
  bgmRun: string;
  bgmDeath: string;
  startSfx: string;
  /** 全局死亡音效池（旧版单字符串归一为单元素池；无效项剔除） */
  deathSfx: string[];
  /** 角色 id → 角色音效（只收自有键、净化后的路径） */
  characters: Map<string, CharacterCues>;
  musicVolume: number;
  sfxVolume: number;
}

export interface AudioDirectorOptions {
  /** 音频专用随机源 [0,1)；与玩法 RNG 分离，测试可注入（缺省=固定种子的独立 mulberry32 流） */
  random?: () => number;
}

const AUDIO_SEED = 0xa0d10;

export const DEFAULT_MUSIC_VOLUME = 0.7;
export const DEFAULT_SFX_VOLUME = 1;
const MAX_PATH_LEN = 512;
const NO_CUES: CharacterCues = { cast: '', pickup: '', death: '' };

const asRecord = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const asVolume = (v: unknown, dflt: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : dflt;

/**
 * 音频路径净化：非字符串/空白/超长/含控制符或反斜杠/含 '..' 段/协议相对 '//'/非 http(s) 协议 → ''。
 * 合法：仓库相对路径（'assets/audio/...'，去掉开头 './'）、包相对路径、http(s) URL。
 */
export function sanitizeAudioPath(v: unknown): string {
  if (typeof v !== 'string') return '';
  const s = v.trim();
  if (!s || s.length > MAX_PATH_LEN || /[\u0000-\u001f\u007f\\]/.test(s) || s.startsWith('//')) return '';
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return /^https?:\/\/[^/]/i.test(s) ? s : '';
  if (s.split('/').some(seg => seg === '..')) return '';
  return s.replace(/^(\.\/)+/, '');
}

/** 单字符串或数组 → 去重后的有效路径池。 */
function asPool(v: unknown): string[] {
  const raw = Array.isArray(v) ? v : [v];
  const out: string[] = [];
  for (const item of raw) {
    const p = sanitizeAudioPath(item);
    if (p && !out.includes(p)) out.push(p);
  }
  return out;
}

function parseCharacters(v: unknown): Map<string, CharacterCues> {
  const map = new Map<string, CharacterCues>();
  const chars = asRecord(v);
  for (const id of Object.keys(chars)) {
    const sfx = asRecord(asRecord(chars[id])['sfx']);
    const cues: CharacterCues = {
      cast: sanitizeAudioPath(sfx['cast']),
      pickup: sanitizeAudioPath(sfx['pickup']),
      death: sanitizeAudioPath(sfx['death']),
    };
    if (cues.cast || cues.pickup || cues.death) map.set(id, cues);
  }
  return map;
}

/** 解析 game.json 的 params.audio 段；缺省段/坏类型全部走默认（不抛错）。 */
export function parseAudioConfig(params: unknown): AudioConfig {
  const audio = asRecord(asRecord(params)['audio']);
  const volume = asRecord(audio['volume']);
  const bgm = asRecord(audio['bgm']);
  const sfx = asRecord(audio['sfx']);
  return {
    bgmRun: sanitizeAudioPath(bgm['run']),
    bgmDeath: sanitizeAudioPath(bgm['death']),
    startSfx: sanitizeAudioPath(sfx['start']),
    deathSfx: asPool(sfx['death']),
    characters: parseCharacters(audio['characters']),
    musicVolume: asVolume(volume['music'], DEFAULT_MUSIC_VOLUME),
    sfxVolume: asVolume(volume['sfx'], DEFAULT_SFX_VOLUME),
  };
}

/** 从池中按随机源取一项；随机源异常值（NaN/越界）夹回合法下标。 */
export function pickFromPool(pool: readonly string[], random: () => number): string {
  if (pool.length === 0) return '';
  const r = random();
  const i = Number.isFinite(r) ? Math.floor(r * pool.length) : 0;
  return pool[Math.min(pool.length - 1, Math.max(0, i))] ?? '';
}

export function createAudioDirector(
  adapter: PlatformAdapter, params: unknown, options: AudioDirectorOptions = {},
): AudioDirector {
  const audio = adapter.audio;
  const cfg = parseAudioConfig(params);
  const random = options.random ?? mulberry32(AUDIO_SEED);
  const music = { volume: cfg.musicVolume };
  const sfx = { volume: cfg.sfxVolume };
  /** idle：无局内音乐；run：run BGM 中；dead：死亡 BGM 可能仍在播（结算页） */
  let phase: 'idle' | 'run' | 'dead' = 'idle';
  let cues = NO_CUES;
  const playSfx = (url: string) => { if (audio && url) audio.playSfx(url, sfx); };

  return {
    enterRun(charId) {
      if (phase !== 'idle') audio?.stopMusic(); // 兜底：上一局残留的死亡 BGM 不与新局重叠
      phase = 'run';
      cues = (charId !== undefined && cfg.characters.get(charId)) || NO_CUES;
      if (audio && cfg.bgmRun) audio.playMusic(cfg.bgmRun, { loop: true, ...music });
      playSfx(cfg.startSfx);
    },
    exitRun() {
      if (phase === 'run') { audio?.stopMusic(); phase = 'idle'; }
    },
    onDeath() {
      if (phase !== 'run') return;
      phase = 'dead';
      if (!audio) return;
      audio.stopMusic();
      if (cfg.bgmDeath) audio.playMusic(cfg.bgmDeath, { loop: false, ...music });
      playSfx(pickFromPool(cfg.deathSfx, random));
      playSfx(cues.death);
    },
    onCast() {
      if (phase === 'run') playSfx(cues.cast);
    },
    onPickup() {
      if (phase === 'run') playSfx(cues.pickup);
    },
    stopDeathMusic() {
      if (phase === 'dead') audio?.stopMusic();
      if (phase !== 'run') phase = 'idle';
    },
    dispose() {
      phase = 'idle';
      audio?.dispose();
    },
  };
}
