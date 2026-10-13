import type { GameContent } from '@tr/game/core/config/configTypes.js';
import type { MissionPeriod, MissionSnapshot } from '@tr/game/core/missions/types.js';
import type { MissionApi } from './missionApi.js';
import { mountMobilePage, pageHeader, pageLifecycle, uiButton, uiText } from './mobileUi.js';
import './missionPanel.css';

export function createMissionPanel(api: MissionApi, content: GameContent, onBack: () => void): () => void {
  const { root, frame } = mountMobilePage('每日与每周任务', 'mobile-missions');
  const minimum = (content.economy.params.missions as { minRunSeconds?: number } | undefined)?.minRunSeconds;
  let period: MissionPeriod = 'daily';
  let snapshot: MissionSnapshot | null = null;
  let busy = false;
  let disposed = false;
  let timer = 0;
  const status = uiText('p', '正在同步任务…', 'mission-status');
  status.setAttribute('role', 'status');
  const tabs = uiText('div', '', 'mission-tabs');
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', '任务周期');
  const list = uiText('div', '', 'mission-list');
  list.id = 'mission-list';
  list.setAttribute('role', 'tabpanel');
  const reset = uiText('p', '', 'ui-muted mission-reset');
  const wallet = uiText('div', '', 'mission-wallet ui-panel');
  wallet.hidden = true;
  const refresh = uiButton('刷新 / 重试同步', 'ui-secondary mission-refresh', () => { void load(); });
  const tabButtons = (['daily', 'weekly'] as const).map(value => {
    const button = uiButton(value === 'daily' ? '每日任务' : '每周任务', 'mission-tab', () => {
      period = value; render();
    });
    button.id = `mission-tab-${value}`;
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-controls', list.id);
    button.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      period = event.key === 'Home' ? 'daily' : event.key === 'End' ? 'weekly' : period === 'daily' ? 'weekly' : 'daily';
      render(); tabButtons[period === 'daily' ? 0 : 1]!.focus();
    });
    tabs.append(button);
    return button;
  });
  const rewardLabel = (reward: Record<string, number | string>): string => Object.entries(reward).map(([key, value]) => {
    if (key === 'shard') {
      const [id, n] = String(value).split(':');
      return `${itemName(id!)} ×${n}`;
    }
    return `${itemName(key)} ×${value}`;
  }).join(' · ');
  function itemName(id: string): string {
    if (id === 'coin') return '金币';
    if (id === 'key') return '钥匙';
    const name = content.characters.items?.find(entry => entry.id === id.replace('shard_', 'char_'))?.name?.['zh-CN'];
    return name ? `${name}碎片` : id;
  }
  function render(): void {
    tabButtons.forEach((button, index) => {
      const selected = index === (period === 'daily' ? 0 : 1);
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
    });
    list.setAttribute('aria-labelledby', `mission-tab-${period}`);
    list.setAttribute('aria-busy', String(busy));
    refresh.disabled = busy;
    list.replaceChildren();
    if (!snapshot) return;
    wallet.hidden = false;
    const group = snapshot[period];
    const date = new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(group.resetsAt);
    reset.textContent = `${period === 'daily' ? '每日零点' : '每周一零点'}更新 · 下次 ${date}（北京时间）`;
    for (const mission of group.missions) {
      const card = uiText('article', '', 'mission-card ui-panel');
      const heading = uiText('div', '', 'mission-card-heading');
      heading.append(uiText('h2', mission.title), uiText('span', mission.claimed ? '已领取' : mission.progress >= mission.target ? '可领取' : '进行中', 'mission-state'));
      const progress = document.createElement('progress');
      progress.max = mission.target;
      progress.value = Math.min(mission.progress, mission.target);
      progress.setAttribute('aria-label', `${mission.title}进度`);
      const counts = uiText('p', `${Math.floor(mission.progress).toLocaleString()} / ${mission.target.toLocaleString()}`, 'mission-count');
      const bottom = uiText('div', '', 'mission-card-bottom');
      const claim = uiButton(mission.claimed ? '已领取' : '领取奖励', 'ui-primary mission-claim', () => {
        if (busy) return;
        busy = true; status.textContent = '正在领取…'; render();
        void api.claim(period, group.periodId, mission.id).then(value => {
          if (disposed) return;
          snapshot = value; status.textContent = '领取成功，奖励已存入任务钱包';
        }).catch((error: Error) => {
          if (!disposed) status.textContent = `${error.message}；可刷新后重试`;
        }).finally(() => { if (!disposed) { busy = false; render(); } });
      });
      claim.disabled = busy || mission.claimed || mission.progress < mission.target;
      claim.setAttribute('aria-label', `${mission.title}：${mission.claimed ? '已领取' : '领取奖励'}`);
      bottom.append(uiText('span', rewardLabel(mission.reward), 'mission-reward'), claim);
      card.append(heading, progress, counts, bottom);
      list.append(card);
    }
    wallet.replaceChildren(uiText('strong', '任务钱包'));
    wallet.append(uiText('p', Object.entries(snapshot.wallet).filter(([, n]) => n > 0)
      .map(([id, n]) => `${itemName(id)} ${n.toLocaleString()}`).join(' · ') || '完成任务领取第一份奖励', 'ui-muted'));
  }
  async function load(): Promise<void> {
    if (busy || disposed) return;
    busy = true; status.textContent = '正在同步任务…'; render();
    try {
      const value = await api.load();
      if (disposed) return;
      snapshot = value;
      status.textContent = api.feedback || '进度以服务端结算为准，完成后记得领取奖励';
      window.clearTimeout(timer);
      timer = window.setTimeout(() => { void load(); }, Math.max(1000, Math.min(value.daily.resetsAt, value.weekly.resetsAt) - value.serverTime + 1000));
    } catch (error) {
      if (!disposed) status.textContent = `${(error as Error).message}；请点击重试`;
    } finally { if (!disposed) { busy = false; render(); } }
  }
  frame.append(pageHeader('任务手册', 'RUN • COLLECT • REPEAT', onBack), tabs, reset, status, list, refresh, wallet,
    uiText('p', `${typeof minimum === 'number' ? `至少跑满 ${minimum} 秒的` : ''}有效对局结束后结算；主动退出也会提交。跨周期不补领旧奖励。调试模式不计任务。`, 'mobile-page-note'));
  const dispose = pageLifecycle(root, onBack);
  render(); void load();
  return () => { disposed = true; window.clearTimeout(timer); dispose(); };
}
