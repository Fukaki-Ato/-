import type { GameContent } from '@tr/game/core/config/configTypes.js';
import { buildLoadout, isCharacterLocked, playableCharacters } from '@tr/game/core/sim/character.js';
import type { CharacterSelectPageActions } from '@tr/game/flow/views.js';
import type { EntryMethod } from '@tr/game/flow/session.js';
import type { FontSet } from '@tr/framework/ui/text/metrics.js';
import { applySelectArt, createSelectPortrait } from './selectCharacterArt.js';
import { installCharacterSelectKeyboard } from './characterSelectKeyboard.js';
import { pageLifecycle, uiButton, uiText } from './mobileUi.js';
import { unlockLabel, abilityRow } from './selectPageParts.js';
import { createSelectDetails } from './selectDetails.js';
import './characterSelectOverlay.css';

export function createCharacterSelectOverlay(
  content: GameContent,
  actions: CharacterSelectPageActions,
  currentCharId: string,
  _entry: EntryMethod | null,
  _fonts: FontSet,
): () => void {
  const items = playableCharacters(content).map(character => ({
    entry: character, loadout: buildLoadout(content, character.id),
    locked: isCharacterLocked(character), unlockText: unlockLabel(character),
  }));
  let selectedIndex = Math.max(0, items.findIndex(item => item.loadout.charId === currentCharId));
  let chosen = items[selectedIndex]?.loadout.charId ?? '';

  const root = uiText('section', '', 'tr-character-select island-select');
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', '选择跑者');
  const frame = uiText('div', '', 'character-select-frame');
  const details = createSelectDetails(frame);
  const header = uiText('header', '', 'select-header');
  const backButton = uiButton('‹', 'select-back-button', returnToMainMenu);
  backButton.setAttribute('aria-label', '返回主菜单');
  const heading = uiText('div', '', 'select-page-heading');
  heading.append(uiText('h1', '选择角色', 'select-title'));
  const counter = uiText('span', '', 'select-counter');
  header.append(backButton, heading, counter);

  const showcase = uiText('main', '', 'select-showcase');
  const display = uiText('div', '', 'select-display');
  const portraitPanel = uiText('div', '', 'select-portrait-panel');
  const halo = uiText('div', '', 'select-stage-halo');
  halo.setAttribute('aria-hidden', 'true');
  const heroPortrait = uiText('div', '', 'select-hero-portrait');
  heroPortrait.setAttribute('aria-hidden', 'true');
  const pedestal = uiText('div', '', 'select-pedestal');
  pedestal.setAttribute('aria-hidden', 'true');
  portraitPanel.append(halo, pedestal, heroPortrait);
  const previous = uiButton('‹', 'select-cycle-button select-previous', () => step(-1));
  previous.setAttribute('aria-label', '上一个角色');
  const next = uiButton('›', 'select-cycle-button select-next', () => step(1));
  next.setAttribute('aria-label', '下一个角色');
  const rarity = uiText('span', '', 'select-rarity');
  display.append(portraitPanel, previous, next, rarity);

  const identity = uiText('div', '', 'select-identity');
  const nameRow = uiText('div', '', 'select-name-row');
  const name = uiText('h2', '', 'select-name');
  const state = uiText('span', '', 'select-state');
  nameRow.append(name, state);
  const tagline = uiText('p', '', 'select-tagline');
  identity.append(nameRow, tagline);

  const powers = uiText('section', '', 'select-power-card select-ability-board');
  powers.setAttribute('aria-label', '角色能力');
  const active = abilityRow('主动技能', 'active', () => { if (chosen) details.open(); });
  const passive = abilityRow('被动特性', 'passive', () => { if (chosen) details.open(); });
  powers.append(active.root, passive.root);
  showcase.append(display, identity);

  const roster = uiText('section', '', 'select-roster');
  roster.setAttribute('aria-label', '角色名单');
  const rosterHead = uiText('div', '', 'select-roster-head');
  rosterHead.append(uiText('h3', '跑者小队', 'select-roster-title'), uiText('span', '左右滑动 · 点选伙伴', 'select-roster-hint'));
  const rosterList = uiText('div', '', 'select-roster-list');
  const cards = new Map<string, HTMLButtonElement>();
  for (const item of items) {
    const id = item.loadout.charId;
    const card = uiButton('', 'select-roster-card', () => select(id, true));
    card.dataset.charId = id;
    card.dataset.locked = String(item.locked);
    card.style.setProperty('--char-tint', item.loadout.tint);
    card.append(createSelectPortrait(item.loadout, 'select-card-art'), uiText('span', item.loadout.name, 'select-card-name'));
    const tier = uiText('span', item.locked ? '锁定' : item.loadout.rarity, 'select-card-tier');
    card.append(tier);
    cards.set(id, card);
    rosterList.append(card);
  }
  roster.append(rosterHead, rosterList);
  const controls = uiText('div', '', 'select-controls');
  controls.append(powers, roster);

  const footer = uiText('footer', '', 'select-actions');
  const unlock = uiText('span', '', 'select-unlock');
  const footerMeta = uiText('div', '', 'select-footer-meta');
  const actionNote = uiText('span', '', 'select-action-note');
  actionNote.setAttribute('role', 'status');
  footerMeta.append(unlock, actionNote);
  const actionRow = uiText('div', '', 'select-action-row');
  const shopButton = uiButton('商店', 'select-shop-button');
  shopButton.setAttribute('aria-label', '打开商店');
  const startButton = uiButton('', 'select-start-button');
  startButton.append(uiText('span', '开始酷跑', 'select-button-label'), uiText('span', '→', 'select-start-arrow'));
  shopButton.addEventListener('click', () => { if (chosen) actions.onShop(chosen); });
  startButton.addEventListener('click', () => { if (chosen && !startButton.disabled) actions.onStartRun(chosen); });
  actionRow.append(shopButton, startButton);
  identity.append(footerMeta);
  footer.append(actionRow);
  frame.append(header, showcase, controls, footer);
  root.append(frame, details.root);
  document.body.append(root);
  const disposePage = pageLifecycle(root);
  const disposeKeyboard = installCharacterSelectKeyboard(root, returnToMainMenu, delta => {
    if (!details.isOpen) step(delta);
  }, () => details.isOpen ? details.panel : frame);

  function step(delta: number): void {
    if (!items.length) return;
    select(items[(selectedIndex + delta + items.length) % items.length]!.loadout.charId, true);
  }

  function select(id: string, reveal = false): void {
    const item = items.find(candidate => candidate.loadout.charId === id);
    if (!item) return;
    chosen = id;
    selectedIndex = items.indexOf(item);
    root.style.setProperty('--char-tint', item.loadout.tint);
    root.dataset.rarity = item.loadout.rarity;
    applySelectArt(heroPortrait, item.loadout);
    rarity.textContent = item.loadout.rarity;
    name.textContent = item.loadout.name;
    state.textContent = item.locked ? '锁定 · 仅查看' : '演示可选';
    state.classList.toggle('is-locked', item.locked);
    tagline.textContent = item.loadout.tagline || '海风正好，准备出发';
    unlock.textContent = `入手方式 · ${item.unlockText}`;
    active.name.textContent = item.loadout.skill?.label || '暂无主动技能';
    active.desc.textContent = item.loadout.skill?.desc || '这位跑者暂未配置主动技能。';
    passive.name.textContent = item.loadout.talentLabel || '暂无被动特性';
    passive.desc.textContent = item.loadout.talentDesc || '这位跑者暂未配置被动特性。';
    active.root.setAttribute('aria-label', `查看主动技能 · ${active.name.textContent}`);
    passive.root.setAttribute('aria-label', `查看被动特性 · ${passive.name.textContent}`);
    details.update(item.loadout.name, active.name.textContent, active.desc.textContent,
      passive.name.textContent, passive.desc.textContent);
    counter.textContent = `${String(selectedIndex + 1).padStart(2, '0')} / ${String(items.length).padStart(2, '0')}`;
    actionNote.textContent = item.locked ? `${item.loadout.name} · 锁定，仅供查看` : `出战 · ${item.loadout.name}`;
    startButton.disabled = item.locked || !chosen;
    startButton.setAttribute('aria-label', item.locked ? `${item.loadout.name}尚未解锁` : `以${item.loadout.name}身份开始酷跑`);
    for (const [cardId, card] of cards) {
      const selected = cardId === id;
      const cardItem = items.find(candidate => candidate.loadout.charId === cardId)!;
      card.classList.toggle('is-selected', selected);
      card.setAttribute('aria-pressed', String(selected));
      card.setAttribute('aria-label', `${cardItem.loadout.name}，${selected ? '已选' : '选择'}${cardItem.locked ? '，锁定角色，仅查看' : '，演示可选'}`);
    }
    if (reveal) {
      const card = cards.get(id)!;
      const left = card.offsetLeft - (rosterList.clientWidth - card.offsetWidth) / 2;
      // Selection must be visible immediately on a phone, including last-to-first cycling.
      rosterList.scrollTo({ left, behavior: 'auto' });
    }
    actions.onSelect(id);
  }

  function returnToMainMenu(): void {
    if (details.isOpen) { details.close(); return; }
    actions.onBack();
    document.querySelector<HTMLButtonElement>('.mobile-lobby button[aria-label^="选择角色"]')?.focus({ preventScroll: true });
  }

  if (chosen) {
    select(chosen);
    const card = cards.get(chosen)!;
    rosterList.scrollLeft = Math.max(0, card.offsetLeft - (rosterList.clientWidth - card.offsetWidth) / 2);
  } else {
    name.textContent = '暂无可选角色';
    state.textContent = '等待角色配置';
    startButton.disabled = true;
    counter.textContent = '00 / 00';
  }
  previous.disabled = next.disabled = items.length < 2;
  (active.root as HTMLButtonElement).disabled = !items.length;
  (passive.root as HTMLButtonElement).disabled = !items.length;
  return () => { disposeKeyboard(); details.dispose(); disposePage(); };
}
