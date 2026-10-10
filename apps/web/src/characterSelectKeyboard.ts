const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function installCharacterSelectKeyboard(
  root: HTMLElement,
  onBack: () => void,
  onArrow: (step: number) => void,
): () => void {
  function onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      onBack();
      return;
    }
    if (event.key === 'Tab') {
      const focusable = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE))
        .filter(element => element.getClientRects().length > 0);
      const activeIndex = focusable.indexOf(document.activeElement as HTMLElement);
      if (!focusable.length) {
        event.preventDefault();
        root.focus({ preventScroll: true });
      } else if (event.shiftKey && activeIndex <= 0) {
        event.preventDefault();
        focusable[focusable.length - 1]?.focus({ preventScroll: true });
      } else if (!event.shiftKey && (activeIndex < 0 || activeIndex === focusable.length - 1)) {
        event.preventDefault();
        focusable[0]?.focus({ preventScroll: true });
      }
      return;
    }
    if (event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return;
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    onArrow(event.key === 'ArrowRight' ? 1 : -1);
  }

  document.addEventListener('keydown', onKeyDown);
  return () => document.removeEventListener('keydown', onKeyDown);
}
