import type { GameContent } from '@tr/game/core/config/configTypes.js';
import type { ResultActions, RunSummary, SettingsActions } from '@tr/game/flow/views.js';
import { themeOptions } from '@tr/game/ui/settingsView.js';
import { mountMobilePage, pageHeader, pageLifecycle, uiButton, uiText } from './mobileUi.js';
import './mobilePanels.css';

export function createMobileSettings(content: GameContent, actions: SettingsActions, currentThemeId: string | null): () => void {
  const { root, frame } = mountMobilePage('设置', 'mobile-settings');
  frame.append(pageHeader('旅途设置', 'MAKE IT YOURS / 设置', actions.onBack));
  const panel = uiText('section', '', 'settings-panel ui-panel');
  panel.append(uiText('h2', '下一站，想去哪里？'), uiText('p', '点选即保存，下一局生效', 'ui-muted'));
  const options = themeOptions(content);
  let current = currentThemeId ?? options[0]?.id ?? null;
  const buttons = new Map<string, HTMLButtonElement>();
  const status = uiText('p', '', 'settings-status ui-muted');
  status.setAttribute('role', 'status');
  const paint = (): void => {
    for (const [id, button] of buttons) {
      const selected = current === id;
      button.classList.toggle('is-selected', selected);
      button.setAttribute('aria-pressed', String(selected));
      button.querySelector('.theme-marker')!.textContent = selected ? '使用中 ✓' : '选择';
    }
  };
  for (const option of options) {
    const button = uiButton('', 'settings-theme', () => {
      if (option.id === current) return;
      if (!actions.onSelectTheme(option.id)) { status.textContent = '暂时无法切换，请重新选择'; return; }
      current = option.id;
      status.textContent = `已选择${option.name}，下一局生效`;
      paint();
    });
    const preview = uiText('span', '', 'theme-preview');
    preview.style.background = `linear-gradient(180deg, ${option.sky} 60%, ${option.ground} 60%)`;
    preview.setAttribute('aria-hidden', 'true');
    button.append(preview, uiText('strong', option.name), uiText('span', '', 'theme-marker'));
    buttons.set(option.id, button);
    panel.append(button);
  }
  if (!options.length) panel.append(uiText('p', '暂无可选场景', 'ui-muted'));
  panel.append(status);
  frame.append(panel, uiText('p', '海风会记得你的选择。', 'mobile-page-note'));
  paint();
  return pageLifecycle(root, actions.onBack);
}

export function createMobileResult(summary: RunSummary, best: number, actions: ResultActions): () => void {
  const { root, frame } = mountMobilePage('跑酷结算', 'mobile-result');
  const isNew = summary.score > best && summary.score > 0;
  const header = uiText('header', '', 'result-heading');
  header.append(uiText('span', 'RUN COMPLETE / 旅途小结', 'ui-eyebrow'), uiText('h1', isNew ? '这次，超越自己！' : '到站，休息一下。'));
  const ticket = uiText('section', '', 'result-ticket ui-panel');
  const emblem = uiText('span', isNew ? '✦' : '⚑', 'result-emblem');
  emblem.setAttribute('aria-hidden', 'true');
  ticket.append(emblem, uiText('span', isNew ? 'NEW BEST / 新纪录' : '本次得分', 'ui-eyebrow'), uiText('strong', summary.score.toLocaleString(), 'result-score'));
  const bestLine = uiText('p', `历史最佳  ${Math.max(best, summary.score).toLocaleString()}`, 'result-best');
  ticket.append(bestLine);
  const stats = uiText('dl', '', 'result-stats');
  for (const [label, value] of [['奔跑距离', `${Math.floor(summary.distance)} m`], ['收集金币', `${summary.coins}`], ['惊险擦身', `${summary.nearMiss} 次`], ['受击次数', `${summary.hits} 次`]]) {
    const stat = uiText('div', '', 'result-stat');
    stat.append(uiText('dt', label!), uiText('dd', value!));
    stats.append(stat);
  }
  const runner = uiText('div', '', 'result-runner');
  runner.append(uiText('strong', summary.charName || summary.charId), uiText('span', `技能释放 ${summary.casts ?? 0} 次`));
  ticket.append(stats, runner);
  const buttons = uiText('div', '', 'ui-footer-actions');
  buttons.append(uiButton('再跑一次  →', 'ui-primary', actions.onRetry), uiButton('返回大厅', 'ui-secondary', actions.onSelect));
  frame.append(header, ticket, buttons, uiText('p', '下一次海风，等你来追。', 'mobile-page-note'));
  return pageLifecycle(root, actions.onSelect);
}
