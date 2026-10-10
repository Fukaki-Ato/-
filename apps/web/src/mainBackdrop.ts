import '../style.css';
import mainMenuArt from './assets/main-menu/bg_main.png';

export interface MainBackdrop {
  setVisible(visible: boolean): void;
  dispose(): void;
}

export function createMainBackdrop(): MainBackdrop {
  const layer = document.createElement('div');
  layer.className = 'tr-main-backdrop';
  layer.setAttribute('aria-hidden', 'true');
  layer.style.backgroundImage = `linear-gradient(rgba(8, 65, 76, 0.42), rgba(8, 65, 76, 0.56)), url("${mainMenuArt}")`;
  document.body.appendChild(layer);
  return {
    setVisible(visible): void {
      layer.classList.toggle('is-visible', visible);
    },
    dispose(): void {
      layer.remove();
    },
  };
}
