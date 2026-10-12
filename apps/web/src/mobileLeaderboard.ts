import type { LeaderboardService, LeaderboardEntry } from '@tr/game/flow/leaderboard.js';
import { mountMobilePage, pageHeader, pageLifecycle, uiButton, uiText } from './mobileUi.js';
import './mobileLeaderboard.css';

export function createMobileLeaderboard(service: LeaderboardService, actions: { onBack(): void }): () => void {
  const { root, frame } = mountMobilePage('零金币全服排行榜', 'mobile-leaderboard');
  frame.append(pageHeader('零金币排行榜', 'GLOBAL / 全服挑战', actions.onBack));
  const rules = uiText('section', '', 'rank-rules ui-panel');
  rules.append(uiText('h2', '不吃金币，能跑多远？'), uiText('p', '整局零金币且跑至结算才可入榜，技能吸取也算吃金币。按距离排名，同距离按分数；每位游客保留最佳纪录。'));
  const identity = uiText('p', '', 'ui-muted');
  const status = uiText('p', '正在加载全服成绩…', 'rank-status');
  status.setAttribute('role', 'status');
  const personal = uiText('section', '', 'rank-personal ui-panel');
  personal.hidden = true;
  personal.setAttribute('aria-label', '我的纪录');
  const list = uiText('ol', '', 'rank-list');
  list.setAttribute('aria-label', '全服前 50 名');
  const row = (entry: LeaderboardEntry): HTMLLIElement => {
    const item = uiText('li', '', 'rank-row');
    const who = uiText('div', '', 'rank-who');
    who.append(uiText('strong', `${entry.rank}. ${entry.playerName}`));
    const stats = uiText('div', '', 'rank-stats');
    stats.append(uiText('strong', `${entry.distance.toFixed(2)} m`), uiText('span', `${entry.score.toLocaleString()} 分`));
    item.append(who, stats);
    return item;
  };
  let disposed = false, requestId = 0;
  const refresh = uiButton('刷新排行榜', 'ui-secondary rank-refresh', () => { void load(); });
  async function load(): Promise<void> {
    const id = ++requestId;
    refresh.disabled = true;
    status.textContent = '正在加载全服成绩…';
    try {
      const data = await service.list();
      if (disposed || id !== requestId) return;
      identity.textContent = `你是 ${data.playerName} · 游客身份保存在浏览器，清除站点数据会重置`;
      personal.hidden = false;
      personal.replaceChildren(uiText('h2', '我的最佳纪录'));
      if (data.personal) {
        personal.append(uiText('p', `第 ${data.personal.rank} 名 · ${data.personal.distance.toFixed(2)} m · ${data.personal.score.toLocaleString()} 分`));
      } else personal.append(uiText('p', '暂无零金币纪录，开始一局挑战吧！', 'ui-muted'));
      list.replaceChildren(...data.entries.map(row));
      status.textContent = data.entries.length ? '全服前 50 名 · 服务端校验成绩' : '全服榜暂时为空，等你来创下第一条纪录';
    } catch {
      if (!disposed && id === requestId) status.textContent = '排行榜加载失败，请检查网络后重试';
    } finally { if (!disposed && id === requestId) refresh.disabled = false; }
  }
  frame.append(rules, identity, personal, status, list, refresh);
  const dispose = pageLifecycle(root, actions.onBack);
  void load();
  return () => { disposed = true; requestId++; dispose(); };
}
