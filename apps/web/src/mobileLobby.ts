import type { GameContent } from '@tr/game/core/config/configTypes.js';
import type { SelectActions, SelectExtras } from '@tr/game/flow/views.js';
import { buildLoadout, isCharacterLocked, playableCharacters } from '@tr/game/core/sim/character.js';
import { createCharacterPortrait } from './characterArt.js';
import { mountMobilePage, pageLifecycle, uiButton, uiText } from './mobileUi.js';
import shopIcon from './assets/mobile-ui/nav-shop.webp';
import handbookIcon from './assets/mobile-ui/nav-handbook.webp';
import chestIcon from './assets/mobile-ui/nav-chest.webp';
import characterIcon from './assets/mobile-ui/nav-character.webp';
import eventIcon from './assets/mobile-ui/icon-event.webp';
import taskIcon from './assets/mobile-ui/icon-task.webp';
import achievementIcon from './assets/mobile-ui/icon-achieve.webp';
import rankIcon from './assets/mobile-ui/icon-rank.webp';
import settingsIcon from './assets/mobile-ui/icon-settings.webp';
import './mobileLobby.css';

export function createMobileLobby(content: GameContent, actions: SelectActions, currentCharId: string, extras?: SelectExtras): () => void {
  const { root, frame } = mountMobilePage('雷霆酷跑主菜单', 'mobile-lobby');
  const roster = playableCharacters(content);
  const character = roster.find(item => item.id === currentCharId && !isCharacterLocked(item))
    ?? roster.find(item => !isCharacterLocked(item));
  const loadout = character ? buildLoadout(content, character.id) : null;
  let toastTimer = 0;
  const toast = uiText('div', '', 'lobby-toast');
  toast.setAttribute('role', 'status');
  const comingSoon = (): void => {
    toast.textContent = '这项功能还在准备中，先来跑一局吧';
    toast.classList.add('is-visible');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove('is-visible'), 2200);
  };
  const openCharacters = (): void => { if (actions.onCharacterSelect) actions.onCharacterSelect(); else comingSoon(); };
  const header = uiText('header', '', 'lobby-header');
  const currency = uiText('div', '', 'lobby-wallet');
  const amount = (label: string, value: number, icon: string): HTMLButtonElement => {
    const button = uiButton('', 'lobby-currency', actions.onShop ?? comingSoon);
    button.setAttribute('aria-label', `${label} ${value}，打开商店`);
    const image = document.createElement('img');
    image.src = `${import.meta.env.BASE_URL}assets/ui/${icon}`;
    image.alt = '';
    button.append(image, uiText('strong', value.toLocaleString()), uiText('span', '+', 'currency-plus'));
    return button;
  };
  currency.append(amount('金币', extras?.coins ?? 0, 'icon_gold.png'), amount('钻石', extras?.diamonds ?? 0, 'icon_diamond.png'));
  const settings = uiButton('', 'ui-icon-button lobby-settings', actions.onSettings ?? comingSoon);
  const gear = document.createElement('img');
  gear.src = settingsIcon;
  gear.alt = '';
  settings.append(gear);
  settings.setAttribute('aria-label', '设置');
  header.append(currency, settings);

  const brand = uiText('div', '', 'lobby-brand');
  brand.append(uiText('h1', '雷霆酷跑'));
  const shortcuts = uiText('nav', '', 'lobby-shortcuts');
  shortcuts.setAttribute('aria-label', '更多玩法');
  for (const [label, icon] of [['活动', eventIcon], ['任务', taskIcon], ['成就', achievementIcon], ['排行榜', rankIcon]]) {
    const action = label === '排行榜' ? actions.onLeaderboard : label === '任务' ? actions.onTasks : undefined;
    const button = uiButton('', 'lobby-shortcut', action ?? comingSoon);
    const image = document.createElement('img');
    image.src = icon!;
    image.alt = '';
    button.append(image, uiText('span', label!, 'shortcut-label'));
    shortcuts.append(button);
  }

  const hero = uiText('div', '', 'lobby-hero');
  hero.append(shortcuts);
  const dock = uiText('div', '', 'lobby-dock');
  const runner = uiButton('', 'lobby-runner ui-panel', openCharacters);
  if (loadout) {
    runner.append(createCharacterPortrait(loadout, 'lobby-portrait'));
    const identity = uiText('div', '', 'lobby-runner-info');
    identity.append(uiText('strong', loadout.name));
    runner.append(identity, uiText('span', '更换 ›', 'runner-change'));
  } else runner.textContent = '暂无可选跑者';
  runner.setAttribute('aria-label', `选择角色，当前${loadout?.name ?? '无角色'}`);
  const start = uiButton('', 'lobby-start ui-primary', () => { if (character) actions.onStartRun(character.id); });
  start.disabled = !character;
  start.setAttribute('aria-label', '开始酷跑');
  start.append(uiText('span', '开始酷跑'), uiText('span', 'GO →', 'start-arrow'));
  const hint = uiText('p', '左右滑动换道 · 上滑跳跃 · 下滑翻滚', 'lobby-play-hint');
  const nav = uiText('nav', '', 'lobby-bottom-nav');
  nav.setAttribute('aria-label', '主菜单导航');
  for (const [label, icon, action] of [
    ['商店', shopIcon, actions.onShop ?? comingSoon], ['福利手册', handbookIcon, comingSoon],
    ['仓库', chestIcon, comingSoon], ['角色', characterIcon, openCharacters],
  ] as const) {
    const button = uiButton('', 'lobby-nav-button', action);
    const image = document.createElement('img');
    image.src = icon;
    image.alt = '';
    button.append(image, uiText('span', label));
    nav.append(button);
  }
  dock.append(runner, start, hint, nav);
  frame.append(header, brand, hero, dock, toast);
  const dispose = pageLifecycle(root);
  return () => { window.clearTimeout(toastTimer); dispose(); };
}
