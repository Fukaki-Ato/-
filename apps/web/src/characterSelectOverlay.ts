import type { NamedEntry, GameContent } from '@tr/game/core/config/configTypes.js';
import { buildLoadout, playableCharacters } from '@tr/game/core/sim/character.js';
import type { CharacterSelectPageActions } from '@tr/game/flow/views.js';
import { entryLabel, type EntryMethod } from '@tr/game/flow/session.js';
import type { FontSet } from '@tr/framework/ui/text/metrics.js';
import { createShopTextRenderer } from './shopText.js';
import { installCharacterSelectKeyboard } from './characterSelectKeyboard.js';
import backgroundArt from './assets/character-select/bg_select.webp';
import runnerSheet from './assets/character-select/runners-sheet-centered.png';
import './characterSelectOverlay.css';

const ART_CELLS: Record<string, [string, string]> = {
  char_volt: ['0%', '0%'],
  char_ama: ['50%', '0%'],
  char_kaze: ['100%', '0%'],
  char_rina: ['0%', '100%'],
  char_bolt: ['50%', '100%'],
};

interface RosterItem {
  entry: NamedEntry;
  loadout: ReturnType<typeof buildLoadout>;
  locked: boolean;
  unlockText: string;
}

function sdf(tag: keyof HTMLElementTagNameMap, text: string, className: string, color: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = `select-sdf-text shop-sdf-text ${className}`;
  node.textContent = text;
  node.dataset.sdfColor = color;
  return node;
}

function unlockLabel(entry: NamedEntry): string {
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

function makePortrait(item: RosterItem, className: string): HTMLDivElement {
  const portrait = document.createElement('div');
  portrait.className = className;
  portrait.setAttribute('aria-hidden', 'true');
  portrait.style.setProperty('--char-tint', item.loadout.tint);
  const position = ART_CELLS[item.loadout.charId];
  if (position) {
    portrait.classList.add('is-sheet-art');
    portrait.style.backgroundImage = `url("${runnerSheet}")`;
    portrait.style.backgroundPosition = `${position[0]} ${position[1]}`;
  } else {
    portrait.classList.add('is-generic-art');
    portrait.append(sdf('span', [...item.loadout.name][0] ?? '跑', 'select-portrait-initial', '#fff8e5'));
  }
  return portrait;
}

function makeButton(label: string, className: string, ariaLabel: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.setAttribute('aria-label', ariaLabel);
  button.append(sdf('span', label, 'select-button-label', className === 'select-start-button' ? '#63371c' : '#fff8e5'));
  return button;
}

export function createCharacterSelectOverlay(
  content: GameContent,
  actions: CharacterSelectPageActions,
  currentCharId: string,
  entry: EntryMethod | null,
  fonts: FontSet,
): () => void {
  const items: RosterItem[] = playableCharacters(content).map(character => {
    const locked = String(character.status ?? '') === 'locked' || character['locked'] === true;
    return {
      entry: character,
      loadout: buildLoadout(content, character.id),
      locked,
      unlockText: unlockLabel(character),
    };
  });
  let chosen = items.some(item => item.loadout.charId === currentCharId)
    ? currentCharId : (items[0]?.loadout.charId ?? '');

  const root = document.createElement('section');
  root.className = 'tr-character-select';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', '选择跑者');
  root.tabIndex = -1;
  root.style.backgroundImage = `linear-gradient(125deg, rgba(5, 52, 61, .72), rgba(35, 52, 46, .62)), url("${backgroundArt}")`;

  const frame = document.createElement('div');
  frame.className = 'character-select-frame';
  const header = document.createElement('header');
  header.className = 'select-header';
  const backButton = makeButton('返回', 'select-back-button', '返回主菜单');
  backButton.addEventListener('click', returnToMainMenu);
  const heading = document.createElement('div');
  heading.className = 'select-heading';
  heading.append(
    sdf('span', `SEA BREEZE · ${entryLabel(entry)}`, 'select-eyebrow', '#ffe7a8'),
    sdf('h1', '选择角色', 'select-title', '#fff7e4'),
  );
  const counter = sdf('div', '', 'select-counter', '#fff7e4');
  header.append(backButton, heading, counter);

  const showcase = document.createElement('main');
  showcase.className = 'select-showcase';
  const portraitPanel = document.createElement('div');
  portraitPanel.className = 'select-portrait-panel';
  const heroPortrait = document.createElement('div');
  heroPortrait.className = 'select-hero-portrait';
  heroPortrait.setAttribute('aria-hidden', 'true');
  portraitPanel.append(heroPortrait);
  const identity = document.createElement('div');
  identity.className = 'select-identity';
  const identityMeta = document.createElement('div');
  identityMeta.className = 'select-identity-meta';
  const rarity = sdf('span', '', 'select-rarity', '#65401f');
  const state = sdf('span', '', 'select-state', '#276354');
  identityMeta.append(rarity, state);
  const name = sdf('h2', '', 'select-name', '#50331e');
  const tagline = sdf('p', '', 'select-tagline', '#725332');
  const unlock = sdf('span', '', 'select-unlock', '#79552e');
  identity.append(identityMeta, name, tagline, unlock);

  const powers = document.createElement('div');
  powers.className = 'select-powers';
  const activeCard = document.createElement('article');
  activeCard.className = 'select-power-card is-active-power';
  const activeIcon = document.createElement('span');
  activeIcon.className = 'select-power-icon is-active-icon';
  activeIcon.setAttribute('aria-hidden', 'true');
  const activeTitle = sdf('span', '主动技能', 'select-power-type', '#8b652f');
  const activeName = sdf('strong', '', 'select-power-name', '#53381f');
  const activeDesc = sdf('p', '', 'select-power-desc', '#74583a');
  activeCard.append(activeIcon, activeTitle, activeName, activeDesc);
  const passiveCard = document.createElement('article');
  passiveCard.className = 'select-power-card is-passive-power';
  const passiveIcon = document.createElement('span');
  passiveIcon.className = 'select-power-icon is-passive-icon';
  passiveIcon.setAttribute('aria-hidden', 'true');
  const passiveTitle = sdf('span', '被动特性', 'select-power-type', '#8b652f');
  const passiveName = sdf('strong', '', 'select-power-name', '#53381f');
  const passiveDesc = sdf('p', '', 'select-power-desc', '#74583a');
  passiveCard.append(passiveIcon, passiveTitle, passiveName, passiveDesc);
  powers.append(activeCard, passiveCard);
  showcase.append(portraitPanel, identity, powers);

  const roster = document.createElement('section');
  roster.className = 'select-roster';
  roster.setAttribute('aria-label', '角色名单');
  const rosterHead = document.createElement('div');
  rosterHead.className = 'select-roster-head';
  rosterHead.append(
    sdf('h3', '伙伴', 'select-roster-title', '#fff5d9'),
    sdf('span', '点选角色 · 左右选择', 'select-roster-hint', '#ffe9bd'),
  );
  const rosterList = document.createElement('div');
  rosterList.className = 'select-roster-list';
  rosterList.setAttribute('role', 'list');
  const cards = new Map<string, HTMLButtonElement>();
  for (const item of items) {
    const id = item.loadout.charId;
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'select-roster-card';
    card.dataset.charId = id;
    card.dataset.locked = String(item.locked);
    card.style.setProperty('--char-tint', item.loadout.tint);
    card.setAttribute('aria-label', `${item.loadout.name}，${item.locked ? '锁定角色，仅查看' : '演示可选'}`);
    card.append(makePortrait(item, 'select-card-art'));
    const cardName = sdf('span', item.loadout.name, 'select-card-name', '#fff7e4');
    const cardStatus = sdf('span', item.locked ? '锁定' : item.loadout.rarity, 'select-card-status', '#ffe7ae');
    card.append(cardName, cardStatus);
    card.addEventListener('click', () => select(id));
    cards.set(id, card);
    rosterList.append(card);
  }
  roster.append(rosterHead, rosterList);

  const footer = document.createElement('footer');
  footer.className = 'select-actions';
  const shopButton = makeButton('打开商店', 'select-shop-button', '打开商店');
  const actionNote = sdf('span', '选好伙伴，出发看海', 'select-action-note', '#fff0ce');
  const startButton = makeButton('开始酷跑', 'select-start-button', '开始酷跑');
  shopButton.addEventListener('click', () => { if (chosen) actions.onShop(chosen); });
  startButton.addEventListener('click', () => { if (chosen && !startButton.disabled) actions.onStartRun(chosen); });
  footer.append(shopButton, actionNote, startButton);
  frame.append(header, showcase, roster, footer);
  const textCanvas = document.createElement('canvas');
  textCanvas.className = 'select-text-layer';
  textCanvas.setAttribute('aria-hidden', 'true');
  root.append(frame, textCanvas);
  document.body.append(root);

  const paintText = createShopTextRenderer(root, textCanvas, fonts);
  let selectedIndex = 0;

  function select(id: string): void {
    const item = items.find(candidate => candidate.loadout.charId === id);
    if (!item) return;
    chosen = id;
    selectedIndex = items.indexOf(item);
    const tint = item.loadout.tint;
    root.style.setProperty('--char-tint', tint);
    heroPortrait.style.setProperty('--char-tint', tint);
    const position = ART_CELLS[id];
    heroPortrait.classList.toggle('is-sheet-art', Boolean(position));
    heroPortrait.classList.toggle('is-generic-art', !position);
    if (position) {
      heroPortrait.style.backgroundImage = `url("${runnerSheet}")`;
      heroPortrait.style.backgroundPosition = `${position[0]} ${position[1]}`;
      heroPortrait.replaceChildren();
    } else {
      heroPortrait.style.backgroundImage = '';
      heroPortrait.replaceChildren(sdf('span', [...item.loadout.name][0] ?? '跑', 'select-portrait-initial', '#fff8e5'));
    }
    rarity.textContent = `${item.loadout.rarity} · ${id.replace(/^char_/, '').toUpperCase()}`;
    rarity.style.setProperty('--rarity-color', item.loadout.rarity === 'SSR' ? '#ffc86e' : item.loadout.rarity === 'SR' ? '#7ee0d0' : '#d9e6e3');
    state.textContent = item.locked ? '锁定 · 仅查看' : '演示可选';
    state.classList.toggle('is-locked', item.locked);
    state.dataset.sdfColor = item.locked ? '#853e2c' : '#276354';
    name.textContent = item.loadout.name;
    tagline.textContent = item.loadout.tagline || '海风正好，准备出发';
    unlock.textContent = `入手方式 · ${item.unlockText}`;
    activeName.textContent = item.loadout.skill?.label || '暂无主动技能';
    activeDesc.textContent = item.loadout.skill?.desc || '这位跑者暂未配置主动技能。';
    passiveName.textContent = item.loadout.talentLabel || '暂无被动特性';
    passiveDesc.textContent = item.loadout.talentDesc || '这位跑者暂未配置被动特性。';
    counter.textContent = `${String(selectedIndex + 1).padStart(2, '0')} / ${String(items.length).padStart(2, '0')}`;
    actionNote.textContent = item.locked ? '锁定角色仅供查看' : `${item.loadout.name} · 演示可选`;
    startButton.disabled = item.locked || !chosen;
    startButton.setAttribute('aria-label', item.locked ? `${item.loadout.name}尚未解锁` : `以${item.loadout.name}身份开始酷跑`);
    for (const [cardId, card] of cards) {
      const selected = cardId === id;
      card.classList.toggle('is-selected', selected);
      card.setAttribute('aria-pressed', String(selected));
      const cardItem = items.find(candidate => candidate.loadout.charId === cardId);
      card.setAttribute('aria-label', `${cardItem?.loadout.name ?? cardId}，${selected ? '已选' : '选择'}${cardItem?.locked ? '，锁定角色，仅查看' : '，演示可选'}`);
    }
    actions.onSelect(id);
    paintText(1);
  }

  function returnToMainMenu(): void {
    actions.onBack();
    const menuEntry = document.querySelector<HTMLButtonElement>('.tr-main-menu .main-menu-nav-hotspot[aria-label="角色"]');
    (menuEntry ?? document.querySelector<HTMLCanvasElement>('.tr-ui-canvas'))?.focus({ preventScroll: true });
  }

  const disposeKeyboard = installCharacterSelectKeyboard(root, returnToMainMenu, step => {
    if (!items.length) return;
    const next = (selectedIndex + step + items.length) % items.length;
    select(items[next]!.loadout.charId);
  });

  function repaintText(): void { paintText(1); }
  window.addEventListener('resize', repaintText);
  window.visualViewport?.addEventListener('resize', repaintText);
  root.addEventListener('scroll', repaintText, { capture: true, passive: true });
  if (chosen) select(chosen);
  else {
    name.textContent = '暂无可选角色';
    state.textContent = '等待角色配置';
    startButton.disabled = true;
    counter.textContent = '00 / 00';
  }
  root.focus({ preventScroll: true });

  return () => {
    window.removeEventListener('resize', repaintText);
    window.visualViewport?.removeEventListener('resize', repaintText);
    root.removeEventListener('scroll', repaintText, true);
    disposeKeyboard();
    root.remove();
  };
}
