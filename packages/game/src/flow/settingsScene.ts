/**
 * 设置场景（settings）：大厅右上「设置」徽标进入的独立页面；当前首项＝切换跑酷场景。
 * 场景主题的存储语义全收口在这里（THEME_KEY 读写、脏值清理、默认回退），mainFlow 只接线：
 * 点选即写本机记忆，run 进局时读同一存储注入渲染场景——「下一局生效」，不重建 GL 场景。
 * 铁律同 flow：零 DOM/wx——只读配置/存储、算纯值，页面渲染经注入的 GameViews。
 */
import type { GameContent } from '@tr/game/core/config/configTypes.js';
import type { SceneDef } from '@tr/game/core/scene/sceneMachine.js';
import type { SyncStorage } from '@tr/framework/platform/platformAdapter.js';
import type { GameViews } from './views.js';

/** 设置页「切换场景」所选主题 id（点选即写，run 进局时消费——下一局生效） */
export const THEME_KEY = 'thunderrun:theme';

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

/** boot 清理：存档主题在配置里已不存在（删/改名）→ 移除，存储不长期留脏值 */
export function pruneThemeSelection(storage: SyncStorage, content: GameContent | null): void {
  const stored = storage.get(THEME_KEY);
  if (stored !== null && !themeEntries(content).some(t => t['id'] === stored)) storage.remove(THEME_KEY);
}

export interface SettingsSceneDeps {
  storage: SyncStorage;
  views: GameViews;
  /** 当前配置（boot 后才非空；未加载＝直接回大厅） */
  content(): GameContent | null;
  goSelect(): void;
  stopDeathMusic(): void;
}

/** 设置场景定义：进入即渲染设置页；点选主题＝校验 + 写本机记忆（下一局进 run 时生效） */
export function createSettingsScene(d: SettingsSceneDeps): SceneDef {
  return {
    onEnter: () => {
      d.stopDeathMusic(); // 与回大厅同口径：死亡 BGM 不带进设置页
      const content = d.content();
      if (!content) { d.goSelect(); return; }
      d.views.renderSettings(content, {
        onBack: () => d.goSelect(),
        onSelectTheme: id => {
          if (!themeEntries(content).some(t => t['id'] === id)) return false;
          d.storage.set(THEME_KEY, id);
          d.views.toast(`已切到「${themeName(content, id)}」，下一局生效`);
          return true;
        },
      }, currentThemeId(d.storage, content));
    },
  };
}
