import type { MainMenuActions } from '@tr/game/flow/views.js';
import type { FontSet } from '@tr/framework/ui/text/metrics.js';
import { createShopTextRenderer } from './shopText.js';
import backgroundArt from './assets/main-menu/bg_main.png';
import './mainMenu.css';

const DESIGN_WIDTH = 750;
const DESIGN_HEIGHT = 1624;
const MAX_WIDTH_BOOST = 1.06;

interface Hotspot {
  left: number;
  top: number;
  width: number;
  height: number;
}

function addHotspot(
  parent: HTMLElement,
  label: string,
  bounds: Hotspot,
  onClick: () => void,
  className = '',
): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `main-menu-hotspot${className ? ` ${className}` : ''}`;
  button.setAttribute('aria-label', label);
  button.title = label;
  Object.assign(button.style, {
    left: `${bounds.left}px`,
    top: `${bounds.top}px`,
    width: `${bounds.width}px`,
    height: `${bounds.height}px`,
  });
  button.addEventListener('click', onClick);
  parent.append(button);
  return button;
}

function safeInset(name: 'top' | 'right' | 'bottom' | 'left'): number {
  const probe = document.createElement('div');
  probe.style.cssText = `position:fixed;visibility:hidden;padding-${name}:env(safe-area-inset-${name}, 0px)`;
  document.body.append(probe);
  const value = Number.parseFloat(getComputedStyle(probe).getPropertyValue(`padding-${name}`)) || 0;
  probe.remove();
  return value;
}

export function createMainMenuOverlay(actions: MainMenuActions, fonts: FontSet): () => void {
  const root = document.createElement('section');
  root.className = 'tr-main-menu';
  root.setAttribute('aria-label', '雷霆酷跑主菜单');

  const stage = document.createElement('div');
  stage.className = 'tr-main-menu-stage';
  stage.style.backgroundImage = `url("${backgroundArt}")`;
  root.append(stage);

  const toast = document.createElement('div');
  toast.className = 'main-menu-toast';
  toast.setAttribute('role', 'status');
  toast.textContent = '开发中';
  toast.dataset.sdfColor = '#fff3d0';
  stage.append(toast);

  const textCanvas = document.createElement('canvas');
  textCanvas.className = 'main-menu-text-layer';
  textCanvas.setAttribute('aria-hidden', 'true');
  root.append(textCanvas);

  let stageScale = 1;
  let toastTimer = 0;
  let paintTextAtScale = (_scale: number): void => undefined;
  const paintText = (): void => paintTextAtScale(stageScale);
  function showComingSoon(): void {
    actions.onUnsupported();
    toast.classList.add('is-visible', 'shop-sdf-text');
    paintText();
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      toast.classList.remove('is-visible', 'shop-sdf-text');
      paintText();
    }, 1800);
  }

  addHotspot(stage, '购买金币', { left: 332, top: 27, width: 58, height: 58 }, actions.onShop, 'main-menu-currency-hit');
  addHotspot(stage, '购买钻石', { left: 481, top: 27, width: 58, height: 58 }, actions.onShop, 'main-menu-currency-hit');
  addHotspot(stage, '设置', { left: 652, top: 8, width: 92, height: 98 }, showComingSoon);
  addHotspot(stage, '活动', { left: 4, top: 8, width: 116, height: 156 }, showComingSoon);
  addHotspot(stage, '任务', { left: 4, top: 178, width: 116, height: 156 }, showComingSoon);
  addHotspot(stage, '成就', { left: 632, top: 124, width: 114, height: 154 }, showComingSoon);
  addHotspot(stage, '排行榜', { left: 632, top: 274, width: 114, height: 158 }, showComingSoon);
  addHotspot(stage, '开始酷跑', { left: 126, top: 1158, width: 500, height: 230 }, actions.onStartRun);

  const nav = document.createElement('nav');
  nav.className = 'main-menu-bottom-nav';
  nav.setAttribute('aria-label', '主菜单导航');
  const entries = [
    { label: '商店', onClick: actions.onShop },
    { label: '福利手册', onClick: showComingSoon },
    { label: '仓库', onClick: showComingSoon },
    { label: '角色', onClick: showComingSoon },
  ];
  for (const entry of entries) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'main-menu-hotspot main-menu-nav-hotspot';
    button.setAttribute('aria-label', entry.label);
    button.title = entry.label;
    button.addEventListener('click', entry.onClick);
    nav.append(button);
  }
  stage.append(nav);

  document.body.append(root);
  paintTextAtScale = createShopTextRenderer(root, textCanvas, fonts);

  function resize(): void {
    const viewport = window.visualViewport;
    const width = Math.max(1, viewport?.width ?? window.innerWidth);
    const height = Math.max(1, viewport?.height ?? window.innerHeight);
    const top = safeInset('top');
    const right = safeInset('right');
    const bottom = safeInset('bottom');
    const left = safeInset('left');
    const usableWidth = Math.max(1, width - left - right);
    const usableHeight = Math.max(1, height - top - bottom);
    const scale = Math.min(usableWidth / DESIGN_WIDTH, usableHeight / DESIGN_HEIGHT);
    const widthScale = Math.min(MAX_WIDTH_BOOST, usableWidth / (DESIGN_WIDTH * scale));
    stageScale = scale;
    stage.style.left = `${left + usableWidth / 2}px`;
    stage.style.top = `${top + usableHeight / 2}px`;
    stage.style.transform = `translate(-50%, -50%) scale(${scale * widthScale}, ${scale})`;
    paintTextAtScale(scale);
  }

  window.addEventListener('resize', resize);
  window.visualViewport?.addEventListener('resize', resize);
  resize();

  return () => {
    window.removeEventListener('resize', resize);
    window.visualViewport?.removeEventListener('resize', resize);
    window.clearTimeout(toastTimer);
    root.remove();
  };
}
