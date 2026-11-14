/**
 * 成就 DOM 面板（web 壳，overlayViews 的 achievementsRenderer 注入）：与 canvas 页同一份
 * AchievementsPageView（场景层合并服务端快照与本机 totals），本文件只做布局与交互。
 * 档位以行外框颜色表达（ach-row--{tier} 类，CSS 固定语义色），不再放铜/银/金徽标。
 * 领取：onClaim 结果 message 回显 role=status 状态行；受理（ok）即置灰，场景层整页重绘接管
 * （受理提示/领取结果由页面数据 statusMessage 携带，写旧节点的回显只在兜底场景可见）。
 * 测试按类名+aria 定位（dom-fixture 约定）；文案来自场景层视图数据，本文件不硬编码配置文案。
 */
import type { AchievementsActions, AchievementsPageView, AchievementRowView } from '@tr/game/flow/views.js';
import { mountMobilePage, pageHeader, pageLifecycle, uiButton, uiText } from './mobileUi.js';
import './mobileAchievements.css';

export function createMobileAchievements(_content: unknown, page: AchievementsPageView, actions: AchievementsActions): () => void {
  const { root, frame } = mountMobilePage('成就', 'mobile-achievements');
  frame.append(pageHeader('成就勋章', 'ACHIEVEMENTS / 成就', actions.onBack));
  frame.append(uiText('p', `已领取 ${page.claimedCount} / ${page.total}`, 'ach-summary'));
  // 状态行优先展示场景层随重绘带来的最新消息（load 失败原因/领取提示），无则按离线/联网默认口径
  const status = uiText('p', page.statusMessage ?? (page.offline ? page.offlineMessage : '服务端成就联网结算，本机成就即时入账'), 'ach-status ui-muted');
  status.setAttribute('role', 'status');
  frame.append(status);

  const achRow = (row: AchievementRowView): HTMLElement => {
    const rowEl = uiText('div', '', `ach-row ach-row--${row.tier}`);
    const info = uiText('div', '', 'ach-info');
    info.append(uiText('strong', row.name), uiText('p', row.desc, 'ach-desc ui-muted'), uiText('span', row.rewardText, 'ach-reward'));
    const pct = row.target > 0 ? Math.max(0, Math.min(100, row.progress / row.target * 100)) : 0;
    const progress = uiText('div', '', 'ach-progress');
    progress.setAttribute('role', 'progressbar');
    progress.setAttribute('aria-label', `${row.name}进度`);
    progress.setAttribute('aria-valuemin', '0');
    progress.setAttribute('aria-valuemax', String(row.target));
    progress.setAttribute('aria-valuenow', String(Math.floor(row.progress)));
    const fill = uiText('div', '', 'ach-fill');
    fill.style.width = `${pct}%`;
    progress.append(fill);
    const count = uiText('span', `${Math.floor(row.progress).toLocaleString()} / ${row.target.toLocaleString()}`, 'ach-count');
    const state = uiText('div', '', 'ach-state');
    if (row.claimed) {
      rowEl.classList.add('is-claimed');
      state.classList.add('ach-state--claimed');
      state.append(uiText('span', '已领取 ✓', 'ach-flag ach-flag--claimed'));
    } else if (row.claimable || row.locked) {
      state.classList.add('ach-state--ready');
      const claim = uiButton('领取', 'ach-claim', () => {
        if (claim.disabled) return;
        const result = actions.onClaim(row.id);
        // 受理（ok）时场景层会整页重绘接管状态（按钮置灰+提示上状态行），此处写旧节点只为
        // 不重绘的兜底场景；失败原因（未连网/受理中）原样回显
        status.textContent = result.message;
        if (result.ok) { rowEl.classList.add('is-claimed'); claim.disabled = true; }
      });
      claim.disabled = row.locked || row.claiming; // 离线锁定/受理中：置灰
      claim.setAttribute('aria-label', `${row.name}：领取奖励`);
      state.append(claim);
    } else {
      state.classList.add('ach-state--pending');
      state.append(uiText('span', '未达成', 'ach-flag ach-flag--pending'));
    }
    rowEl.append(info, progress, count, state);
    return rowEl;
  };

  for (const section of page.sections) {
    const panel = uiText('section', '', 'ach-panel ui-panel');
    panel.append(uiText('h2', section.title), uiText('p', section.note, 'ui-muted'));
    for (const row of section.rows) panel.append(achRow(row));
    frame.append(panel);
  }
  if (!page.rows.length) frame.append(uiText('p', '暂无成就', 'ui-muted'));
  frame.append(uiText('p', '奔跑、收集、解锁——勋章见证每一程。', 'mobile-page-note'));
  return pageLifecycle(root, actions.onBack);
}
