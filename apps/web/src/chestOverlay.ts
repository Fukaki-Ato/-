/**
 * 宝箱页（web DOM 版，bootstrap chestRenderer 注入；canvas 兜底在 packages/game chestView）。
 * 铜/银/金三档卡 + 开启动效：扣钥匙→按档连抽→发货（flow/chest.ts 结算）。
 * 动效为 CSS keyframes（先例 mobileAchievements ach-glow / characterSelectOverlay select-arrival，
 * prefers-reduced-motion 由 mobileUi.css 全局兜底）：摇箱（rotate 衰减）+ 稀有度色粒子抛散
 * （方向由索引计算内联 CSS 变量，不用 Math.random）；奖励清单逻辑先行即时渲染。
 */
import type { GameContent } from '@tr/game/core/config/configTypes.js';
import type { ChestActions, ChestCardView } from '@tr/game/flow/chest.js';
import { rewardText } from '@tr/game/flow/chest.js';
import { mountMobilePage, pageHeader, pageLifecycle, uiButton, uiText } from './mobileUi.js';
import chestIcon from './assets/mobile-ui/nav-chest.webp';
import './chestOverlay.css';

const RARITY_LABELS: Record<string, string> = { common: '普通', rare: '稀有', sr: '高级', ssr: '传说' };

/** 粒子方向按索引确定性计算（环形散开），渲染进 CSS 变量——无 Math.random 依赖 */
function burstChips(): HTMLElement[] {
  const chips: HTMLElement[] = [];
  for (let i = 0; i < 8; i++) {
    const angle = Math.PI * 2 * (i / 8) + 0.35;
    const dist = 56 + (i % 3) * 16;
    const chip = uiText('span', '', 'chest-chip');
    chip.style.setProperty('--dx', `${Math.round(Math.cos(angle) * dist)}px`);
    chip.style.setProperty('--dy', `${Math.round(Math.sin(angle) * dist - 34)}px`);
    chip.style.animationDelay = `${80 + i * 55}ms`;
    chips.push(chip);
  }
  return chips;
}

export function createChestOverlay(content: GameContent, actions: ChestActions, _fonts: unknown): () => void {
  const { root, frame } = mountMobilePage('宝箱', 'tr-chest-overlay');
  const header = pageHeader('藏宝秘库', 'TREASURE VAULT / 宝箱', actions.onBack);
  header.querySelector('button')!.setAttribute('aria-label', '返回上一页');
  const note = uiText('p', '铜银金三档宝箱，钥匙越多开得越富。', 'chest-intro');
  const walletBar = uiText('p', '', 'chest-wallet');
  const cards = uiText('div', '', 'chest-card-layer');
  cards.setAttribute('aria-label', '宝箱列表');
  let pending: string | null = null;
  let openCount = 0;

  function render(): void {
    const wallet = actions.wallet();
    walletBar.textContent = `余额：能量币 ${wallet.coins} · 钥匙 ${wallet.keys} · 钻石 ${wallet.diamonds}`;
    const list = actions.chests();
    cards.replaceChildren(...list.map(card => makeCard(card)));
    if (!list.length) cards.append(uiText('p', '暂无宝箱配置', 'chest-empty-message ui-panel'));
  }

  function makeCard(card: ChestCardView): HTMLElement {
    const el = uiText('article', '', `chest-card ui-panel is-${card.tier}`);
    el.dataset.tableId = card.tableId;
    const art = uiText('div', '', 'chest-art');
    art.setAttribute('aria-hidden', 'true');
    const img = document.createElement('img');
    img.src = chestIcon;
    img.alt = '';
    art.append(img, ...burstChips());
    const keys = actions.wallet().keys;
    const affordable = keys >= card.costKeys;
    const pityText = card.pityEveryN > 0 ? ` · 保底${card.pityEveryN}次出高级` : '';
    const details = uiText('div', '', 'chest-details');
    details.append(
      uiText('span', `钥匙×${card.costKeys} 开一次`, 'chest-cost'),
      uiText('h2', card.name),
      uiText('p', `每次开出 ${card.draws} 件物品${pityText}`, 'chest-desc'),
    );
    const actionRow = uiText('div', '', 'chest-action-row');
    if (pending === card.tableId) {
      const confirm = uiButton('✔ 确认开启', 'chest-action is-confirm', () => {
        const result = actions.onOpen(card.tableId);
        pending = null;
        render();
        if (result.ok) playOpen(card.tableId, result.rewards);
        else showFeedback(card.tableId, result.message);
      });
      const cancel = uiButton('取消', 'chest-action chest-cancel-action', () => { pending = null; render(); });
      actionRow.append(confirm, cancel);
    } else {
      const button = uiButton(affordable ? '开启' : '钥匙不足', 'chest-action', () => { pending = card.tableId; render(); });
      if (!affordable) button.disabled = true;
      actionRow.append(button);
    }
    details.append(actionRow);
    const feedback = uiText('p', '', 'chest-feedback');
    feedback.dataset.for = card.tableId;
    const rewards = uiText('ul', '', 'chest-rewards');
    rewards.dataset.for = card.tableId;
    el.append(art, details, feedback, rewards);
    return el;
  }

  /** 开启动效：卡片摇晃 + 粒子抛散（CSS 驱动），奖励清单即时渲染；动画结束撤下装饰类 */
  function playOpen(tableId: string, rewards: { ref: string; item: string; count: number; rarity: string }[]): void {
    const card = cards.querySelector<HTMLElement>(`[data-table-id="${tableId}"]`);
    if (card) {
      const art = card.querySelector<HTMLElement>('.chest-art');
      art?.classList.remove('is-shaking');
      void art?.offsetWidth; // 重启动画：先摘类再强制回流
      art?.classList.add('is-shaking');
      const serial = ++openCount;
      window.setTimeout(() => {
        if (serial === openCount) art?.classList.remove('is-shaking');
      }, 1400);
    }
    const feedback = cards.querySelector<HTMLElement>(`[data-for="${tableId}"].chest-feedback`);
    if (feedback) feedback.textContent = rewards.some(r => r.rarity === 'sr' || r.rarity === 'ssr') ? '保底触发！' : '';
    const list = cards.querySelector<HTMLElement>(`[data-for="${tableId}"].chest-rewards`);
    if (list) {
      list.replaceChildren(...rewards.map(reward => {
        const li = uiText('li', rewardText(content, reward), `chest-reward is-${reward.rarity}`);
        const tag = uiText('span', RARITY_LABELS[reward.rarity] ?? '普通', 'chest-reward-tag');
        li.prepend(tag);
        return li;
      }));
    }
  }

  function showFeedback(tableId: string, message: string): void {
    const feedback = cards.querySelector<HTMLElement>(`[data-for="${tableId}"].chest-feedback`);
    if (feedback) feedback.textContent = message;
  }

  frame.append(header, note, walletBar, cards);
  render();
  return pageLifecycle(root, actions.onBack);
}
