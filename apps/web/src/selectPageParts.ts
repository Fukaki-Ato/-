import type { NamedEntry } from '@tr/game/core/config/configTypes.js';
import { uiButton, uiText } from './mobileUi.js';

export function unlockLabel(entry: NamedEntry): string {
  const unlock = entry['unlock'] as { type?: unknown; cost?: unknown } | undefined;
  const cost = typeof unlock?.cost === 'number' ? new Intl.NumberFormat('zh-CN').format(unlock.cost) : '';
  switch (String(unlock?.type ?? '')) {
    case 'free': return '免费开放';
    case 'coin': return cost ? `金币 · ${cost}` : '金币';
    case 'loot': return '雷霆箱';
    case 'event': return '限时活动';
    default: return '暂未配置';
  }
}

export function abilityRow(label: string, kind: 'active' | 'passive', onInspect?: () => void): { root: HTMLElement; name: HTMLElement; desc: HTMLElement } {
  const className = `select-ability-row is-${kind}-power`;
  const root = onInspect ? uiButton('', className, onInspect) : uiText('article', '', className);
  if (onInspect) root.setAttribute('aria-haspopup', 'dialog');
  const icon = uiText('span', '', `select-power-icon is-${kind}-icon`);
  icon.setAttribute('aria-hidden', 'true');
  const text = uiText(onInspect ? 'span' : 'div', '', 'select-ability-text');
  const heading = uiText(onInspect ? 'span' : 'div', '', 'select-ability-heading');
  const name = uiText('strong', '', 'select-power-name');
  const desc = uiText(onInspect ? 'span' : 'p', '', 'select-power-desc');
  heading.append(name, uiText('span', label, 'select-power-type'));
  text.append(heading, desc);
  root.append(icon, text);
  if (onInspect) root.append(uiText('span', '›', 'select-ability-more'));
  return { root, name, desc };
}
