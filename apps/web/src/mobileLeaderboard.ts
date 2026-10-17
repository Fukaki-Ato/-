import type { LeaderboardService, LeaderboardEntry } from '@tr/game/flow/leaderboard.js';
import { mountMobilePage, pageHeader, pageLifecycle, uiButton, uiText } from './mobileUi.js';
import './mobileLeaderboard.css';

const MAX_ENTRIES = 50;
const DEFAULT_ENTRIES = 4;
const LIST_ID = 'global-leaderboard-list';
const LOAD_ERROR = '排行榜加载失败，请检查网络后重试';

export function createMobileLeaderboard(service: LeaderboardService, actions: { onBack(): void }): () => void {
  const { root, frame } = mountMobilePage('第一次吃金币前距离全服排行榜', 'mobile-leaderboard');
  frame.append(pageHeader('金币前距离榜', 'GLOBAL / 全服挑战', actions.onBack));
  const rules = uiText('section', '', 'rank-rules ui-panel');
  rules.append(uiText('h2', '第一次吃金币前，能跑多远？'), uiText('p', '记录开局到第一次吃金币前的距离和分数，后来吃金币不影响纪录，磁铁和技能吸取也算吃金币。没吃金币则取整局成绩。跑至结算后上传，按距离排名，同距离按分数；每位游客保留最佳纪录。'));
  const identity = uiText('p', '', 'ui-muted');
  const status = uiText('p', '正在加载全服成绩…', 'rank-status');
  status.setAttribute('role', 'status');
  const personal = uiText('section', '', 'rank-personal ui-panel');
  personal.hidden = true;
  personal.setAttribute('aria-label', '我的纪录');
  const list = uiText('ol', '', 'rank-list');
  list.id = LIST_ID;
  list.setAttribute('aria-label', '全服前 4 名');
  const row = (entry: LeaderboardEntry): HTMLLIElement => {
    const item = uiText('li', '', 'rank-row');
    const who = uiText('div', '', 'rank-who');
    who.append(uiText('strong', `${entry.rank}. ${entry.playerName}`));
    const stats = uiText('div', '', 'rank-stats');
    stats.append(uiText('strong', `${entry.distance.toFixed(2)} m`), uiText('span', `${entry.score.toLocaleString()} 分`));
    item.append(who, stats);
    return item;
  };
  let disposed = false, requestId = 0, loading = true, loadFailed = false;
  let hasData = false, expanded = false;
  let entries: LeaderboardEntry[] = [];
  const refresh = uiButton('刷新排行榜', 'ui-secondary rank-refresh', () => { void load(); });
  const expand = uiButton('查看完整50名排行', 'ui-secondary rank-expand');
  expand.setAttribute('aria-controls', LIST_ID);
  expand.setAttribute('aria-expanded', 'false');
  expand.addEventListener('click', () => {
    if (!hasData || entries.length <= DEFAULT_ENTRIES) return;
    expanded = !expanded;
    renderEntries();
    updateControls();
    updateStatus();
  });
  function updateControls(): void {
    const label = expanded ? '收起为前4名' : '查看完整50名排行';
    expand.textContent = label;
    expand.setAttribute('aria-label', label);
    expand.setAttribute('aria-expanded', String(expanded));
    expand.setAttribute('aria-controls', LIST_ID);
    expand.disabled = !hasData || entries.length <= DEFAULT_ENTRIES;
  }
  function renderEntries(): void {
    const visible = expanded ? entries : entries.slice(0, DEFAULT_ENTRIES);
    list.replaceChildren(...visible.map(row));
    list.setAttribute('aria-label', expanded ? '全服完整排行，最多 50 名' : '全服前 4 名');
  }
  function updateStatus(): void {
    if (!hasData) {
      status.textContent = loading ? '正在加载全服成绩…' : LOAD_ERROR;
      return;
    }
    if (entries.length === 0) {
      status.textContent = loadFailed ? LOAD_ERROR + '；全服榜暂时为空' : '全服榜暂时为空，等你来创下第一条纪录';
      return;
    }
    const mode = expanded
      ? `已展开完整排行（当前显示 ${entries.length} 名，最多 50 名）`
      : `当前展示前 ${Math.min(DEFAULT_ENTRIES, entries.length)} 名（${entries.length > DEFAULT_ENTRIES ? `可查看前 ${entries.length} 名` : '已显示全部纪录'}）`;
    status.textContent = (loading ? '正在刷新全服成绩…；' : loadFailed ? LOAD_ERROR + '；' : '') + mode + ' · 服务端校验成绩';
  }
  async function load(): Promise<void> {
    const id = ++requestId;
    loading = true;
    loadFailed = false;
    refresh.disabled = true;
    updateStatus();
    try {
      const data = await service.list();
      if (disposed || id !== requestId) return;
      entries = data.entries.slice(0, MAX_ENTRIES);
      hasData = true;
      expanded = expanded && entries.length > DEFAULT_ENTRIES;
      identity.textContent = `你是 ${data.playerName} · 游客身份保存在浏览器，清除站点数据会重置`;
      personal.hidden = false;
      personal.replaceChildren(uiText('h2', '我的最佳纪录'));
      if (data.personal) {
        personal.append(uiText('p', `第 ${data.personal.rank} 名 · ${data.personal.distance.toFixed(2)} m · ${data.personal.score.toLocaleString()} 分`));
      } else personal.append(uiText('p', '暂无金币前距离纪录，开始一局挑战吧！', 'ui-muted'));
      renderEntries();
      updateControls();
      loading = false;
      updateStatus();
    } catch {
      if (!disposed && id === requestId) {
        loading = false;
        loadFailed = true;
        updateStatus();
      }
    } finally { if (!disposed && id === requestId) refresh.disabled = false; }
  }
  updateControls();
  frame.append(rules, identity, personal, status, expand, list, refresh);
  const dispose = pageLifecycle(root, actions.onBack);
  void load();
  return () => { disposed = true; requestId++; dispose(); };
}
