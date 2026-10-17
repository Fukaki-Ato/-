import './mobileUi.css';
import './cartoonSkins.css';

/** Shared DOM primitives. Labels stay live and never scale with a background image. */
export function uiText<K extends keyof HTMLElementTagNameMap>(tag: K, text: string, className = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

export function uiButton(label: string, className: string, onClick?: () => void): HTMLButtonElement {
  const button = uiText('button', label, className);
  button.type = 'button';
  if (onClick) button.addEventListener('click', onClick);
  return button;
}

export function mountMobilePage(label: string, className: string): { root: HTMLElement; frame: HTMLDivElement } {
  const root = uiText('section', '', `tr-mobile-page ${className}`);
  root.setAttribute('aria-label', label);
  const frame = uiText('div', '', 'mobile-frame');
  root.append(frame);
  document.body.append(root);
  return { root, frame };
}

/** Own focus and Escape handling per page; listeners disappear on navigation. */
export function pageLifecycle(root: HTMLElement, onBack?: () => void): () => void {
  const previous = document.activeElement;
  root.tabIndex = -1;
  root.focus({ preventScroll: true });
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && onBack) { event.preventDefault(); onBack(); }
  };
  root.addEventListener('keydown', onKeyDown);
  return () => {
    root.removeEventListener('keydown', onKeyDown);
    root.remove();
    if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
  };
}

export function pageHeader(title: string, eyebrow: string, onBack: () => void): HTMLElement {
  const header = uiText('header', '', 'mobile-header');
  const back = uiButton('‹', 'ui-icon-button', onBack);
  back.setAttribute('aria-label', '返回上一页');
  const heading = uiText('div', '', 'mobile-heading');
  heading.append(uiText('span', eyebrow, 'ui-eyebrow'), uiText('h1', title));
  header.append(back, heading);
  return header;
}
