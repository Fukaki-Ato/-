/**
 * 活动 DOM 页（Web 壳）：登录签到周——7 天奖励列表 + 领取今日按钮。
 * 状态/领取走 flow/localEconomy（mainFlow 场景注入 actions）；无进行中活动时显示空态。
 */
import type { GameContent } from '@tr/game/core/config/configTypes.js';
import type { EventsActions } from '@tr/game/flow/views.js';
import { mountMobilePage, pageHeader, pageLifecycle, uiButton, uiText } from './mobileUi.js';
import './eventsOverlay.css';

const DAY_LABEL: Record<string, string> = { claimed: '已领取', today: '今天', locked: '未开放' };

export function createEventsOverlay(content: GameContent, actions: EventsActions, _fonts: unknown): () => void {
  void content;
  const { root, frame } = mountMobilePage('活动', 'tr-events-overlay');
  const header = pageHeader('限时活动', 'EVENTS / 活动', actions.onBack);
  header.querySelector('button')!.setAttribute('aria-label', '返回上一页');
  const list = uiText('div', '', 'events-list');
  const claim = uiButton('领取今日签到', 'events-claim', () => {
    const r = actions.onClaim();
    hint.textContent = r.message;
    render();
  });
  const hint = uiText('p', '', 'events-hint');
  hint.setAttribute('aria-live', 'polite');
  frame.append(header, list, claim, hint);

  function render(): void {
    const state = actions.state();
    list.replaceChildren();
    if (!state) {
      list.append(uiText('p', '当前没有进行中的活动，先来跑一局吧', 'events-empty ui-panel'));
      claim.disabled = true;
      return;
    }
    claim.disabled = !state.canClaim;
    list.append(uiText('h2', state.name, 'events-title'));
    for (const d of state.days) {
      const row = uiText('div', '', `events-day ui-panel is-${d.status}`);
      row.append(
        uiText('span', `第 ${d.day} 天`, 'events-day-index'),
        uiText('span', d.rewardText, 'events-day-reward'),
        uiText('span', DAY_LABEL[d.status] ?? '', 'events-day-state'),
      );
      list.append(row);
    }
  }
  render();
  return pageLifecycle(root, actions.onBack);
}
