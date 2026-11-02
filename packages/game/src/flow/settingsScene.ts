/**
 * 设置场景（settings）：大厅右上「设置」徽标进入的独立页面；当前项＝切换跑酷场景 + 音乐/音效音量。
 * 场景主题与音量的存储语义全收口在这里（KEY 读写、脏值清理、默认回退），mainFlow 只接线：
 * 主题点选即写本机记忆，run 进局时读同一存储注入渲染场景——「下一局生效」，不重建 GL 场景；
 * 音量只写本机记忆，音频导演每次播放经 volumes 提供者读同一存储——「立即生效」。
 * 铁律同 flow：零 DOM/wx——只读配置/存储、算纯值，页面渲染经注入的 GameViews。
 */
import { parseAudioConfig } from '@tr/game/core/audio/audioDirector.js';
import type { GameContent } from '@tr/game/core/config/configTypes.js';
import type { SceneDef } from '@tr/game/core/scene/sceneMachine.js';
import type { SyncStorage } from '@tr/framework/platform/platformAdapter.js';
import type { GameViews, VolumeKind, VolumeSettings } from './views.js';

/** 设置页「切换场景」所选主题 id（点选即写，run 进局时消费——下一局生效） */
export const THEME_KEY = 'thunderrun:theme';

/** 音量偏好存储键（0..100 整数百分比字符串；设置页写，音频导演每次播放时读） */
export const MUSIC_VOLUME_KEY = 'thunderrun:volume-music';
export const SFX_VOLUME_KEY = 'thunderrun:volume-sfx';

const VOLUME_KEYS: Record<VolumeKind, string> = { music: MUSIC_VOLUME_KEY, sfx: SFX_VOLUME_KEY };

type Entry = Record<string, unknown>;

/** 配置里的主题条目（顺序即设置页展示顺序） */
function themeEntries(content: GameContent | null): Entry[] {
  return content ? ((content.themes.items ?? []) as Entry[]) : [];
}

/** 主题显示名（name.zh-CN；缺省回 id——提示文案不硬编码，主题改名不漏改） */
function themeName(content: GameContent | null, id: string): string {
  const name = themeEntries(content).find(t => t['id'] === id)?.['name'] as Record<string, string> | undefined;
  return name?.['zh-CN'] ?? id;
}

/** 默认主题＝首个 live 条目（与 runnerScene 缺省口径一致，不硬编码 id，删主题不漏改） */
function defaultThemeId(content: GameContent | null): string | null {
  const items = themeEntries(content);
  const item = items.find(t => t['status'] === 'live') ?? items[0];
  return typeof item?.['id'] === 'string' ? item['id'] : null;
}

/** 生效主题：本机记忆合法才用，否则回默认（设置页与渲染场景同一口径，无效 id 不进渲染） */
export function currentThemeId(storage: SyncStorage, content: GameContent | null): string | null {
  const stored = storage.get(THEME_KEY);
  return stored !== null && themeEntries(content).some(t => t['id'] === stored) ? stored : defaultThemeId(content);
}

/**
 * 生效主题的专属 BGM（themes.json 的 music 字段）；缺字段或脏值返回 null，由音频层回退全局 run BGM。
 * 路径净化在 audioDirector 侧做（core 唯一收口），这里只保证「取到的是非空字符串」。
 */
export function themeMusic(storage: SyncStorage, content: GameContent | null): string | null {
  const id = currentThemeId(storage, content);
  const music = id === null ? undefined : themeEntries(content).find(t => t['id'] === id)?.['music'];
  return typeof music === 'string' && music !== '' ? music : null;
}

/** boot 清理：存档主题在配置里已不存在（删/改名）→ 移除，存储不长期留脏值 */
export function pruneThemeSelection(storage: SyncStorage, content: GameContent | null): void {
  const stored = storage.get(THEME_KEY);
  if (stored !== null && !themeEntries(content).some(t => t['id'] === stored)) storage.remove(THEME_KEY);
}

/** 存储里的音量偏好（换算成 0..1）；未存/脏值（非整数、越界百分比）返回 null，交配置默认 */
export function storedVolume(storage: SyncStorage, kind: VolumeKind): number | null {
  const raw = storage.get(VOLUME_KEYS[kind]);
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 && n <= 100 ? n / 100 : null;
}

/** 生效音量：用户偏好优先，缺省回 params.audio.volume 配置默认（设置页展示与音频播放同一口径） */
export function volumePrefs(storage: SyncStorage, content: GameContent | null): VolumeSettings {
  const cfg = parseAudioConfig(content?.game.params);
  return {
    music: storedVolume(storage, 'music') ?? cfg.musicVolume,
    sfx: storedVolume(storage, 'sfx') ?? cfg.sfxVolume,
  };
}

/** 进设置页清理：脏音量存档（非整数/越界百分比）→ 移除，存储不长期留脏值 */
export function pruneVolumePrefs(storage: SyncStorage): void {
  for (const key of Object.values(VOLUME_KEYS)) {
    const raw = storage.get(key);
    if (raw === null) continue;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0 || n > 100) storage.remove(key);
  }
}

export interface SettingsSceneDeps {
  storage: SyncStorage;
  views: GameViews;
  /** 当前配置（boot 后才非空；未加载＝直接回大厅） */
  content(): GameContent | null;
  goSelect(): void;
  stopDeathMusic(): void;
}

/** 设置场景定义：进入即渲染设置页；点选主题/调节音量＝校验 + 写本机记忆（主题下一局生效，音量立即生效） */
export function createSettingsScene(d: SettingsSceneDeps): SceneDef {
  return {
    onEnter: () => {
      d.stopDeathMusic(); // 与回大厅同口径：死亡 BGM 不带进设置页
      const content = d.content();
      if (!content) { d.goSelect(); return; }
      pruneVolumePrefs(d.storage);
      d.views.renderSettings(content, {
        onBack: () => d.goSelect(),
        onSelectTheme: id => {
          if (!themeEntries(content).some(t => t['id'] === id)) return false;
          d.storage.set(THEME_KEY, id);
          d.views.toast(`已切到「${themeName(content, id)}」，下一局生效`);
          return true;
        },
        // 音量按 0..100 整数百分比落盘；音频导演经 volumes 提供者读同一存储，下一次播放即用新值
        onSetVolume: (kind, value) => {
          if (kind !== 'music' && kind !== 'sfx') return false;
          if (typeof value !== 'number' || !Number.isFinite(value)) return false;
          const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
          d.storage.set(VOLUME_KEYS[kind], String(pct));
          return true;
        },
      }, currentThemeId(d.storage, content), volumePrefs(d.storage, content));
    },
  };
}
