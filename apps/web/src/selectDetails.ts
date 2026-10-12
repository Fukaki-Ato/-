import { abilityRow } from './selectPageParts.js';
import { uiButton, uiText } from './mobileUi.js';

/** Only the full descriptions scroll; the mobile selection screen stays in one viewport. */
export function createSelectDetails(frame: HTMLElement) {
  const root = uiText('div', '', 'select-details');
  root.hidden = true;
  const panel = uiText('section', '', 'select-details-panel select-power-card');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', '角色能力');
  const header = uiText('header', '', 'select-details-header');
  const heading = uiText('h2', '角色能力');
  const closeButton = uiButton('×', 'select-details-close', close);
  closeButton.setAttribute('aria-label', '关闭角色能力');
  header.append(heading, closeButton);
  const content = uiText('div', '', 'select-details-content');
  const active = abilityRow('主动技能', 'active');
  const passive = abilityRow('被动特性', 'passive');
  content.append(active.root, passive.root);
  panel.append(header, content);
  root.append(panel);
  let isOpen = false;
  let previous: Element | null = null;
  root.addEventListener('click', event => { if (event.target === root) close(); });

  function open(): void {
    if (isOpen) return;
    previous = document.activeElement;
    isOpen = true;
    frame.inert = true;
    frame.setAttribute('aria-hidden', 'true');
    root.hidden = false;
    closeButton.focus({ preventScroll: true });
  }
  function close(): void {
    if (!isOpen) return;
    isOpen = false;
    root.hidden = true;
    frame.inert = false;
    frame.removeAttribute('aria-hidden');
    if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
  }
  return {
    root, panel, open, close,
    get isOpen(): boolean { return isOpen; },
    update(name: string, skillName: string, skillDesc: string, talentName: string, talentDesc: string): void {
      heading.textContent = `${name} · 角色能力`;
      active.name.textContent = skillName;
      active.desc.textContent = skillDesc;
      passive.name.textContent = talentName;
      passive.desc.textContent = talentDesc;
    },
    dispose(): void { close(); root.remove(); },
  };
}
