import type { GameContent } from '../config/configTypes.js';

/** 与设置页一致：live/draft 可选；省略或失效的本机选择回首个 live 主题。 */
export function resolveRunThemeId(content: GameContent, themeId?: string): string | undefined {
  const themes = (content.themes?.items ?? []).filter(theme => theme.status === 'live' || theme.status === 'draft');
  return (themes.find(theme => theme.id === themeId) ?? themes.find(theme => theme.status === 'live') ?? themes[0])?.id;
}

/** 每局从同一份权威配置派生主题玩法，不修改共享内容；客户端和服务端都由 RunnerSim 使用。 */
export function contentForRunTheme(content: GameContent, themeId?: string): GameContent {
  const id = resolveRunThemeId(content, themeId);
  const scenery = (content.themes?.items ?? []).find(theme => theme.id === id)?.['scenery'];
  const obstacles = { ...content.obstacles };
  if (scenery !== 'library') delete obstacles['antigrav'];
  if (scenery !== 'forgeheart') delete obstacles['tideAware'];
  if (scenery !== 'stormspire') delete obstacles['crossings'];
  return { ...content, obstacles };
}
