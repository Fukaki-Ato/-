import { isValid, Node } from 'cc';
import type { TaskConfig, TaskType, TaskView } from '../../core/contracts';
import { FailReason } from '../../core/contracts';
import { BasePanel } from '../framework/BasePanel';
import { PanelManager } from '../framework/PanelManager';
import { RedDots } from '../framework/RedDots';
import { RewardPopup } from '../framework/RewardPopup';
import { RowList } from '../framework/RowList';
import { Toast } from '../framework/Toast';
import { type ButtonView, button, tabs } from '../framework/UIKit';
import { buildPanelHeader, buildProgressRow } from './PanelParts';
import { PANEL_NAMES } from './panelNames';

/**
 * 任务面板（docs/04 §3.8）：
 * 每日/每周页签、进度行（去完成/领取/已领取）、一键领取。
 * 进度与可领取状态一律取自 TaskService；link 跳转走 PanelManager。
 */
export class TasksPanel extends BasePanel {
  private type: TaskType = 'daily';
  private claimAllButton: ButtonView | null = null;
  private list: RowList<TaskView> | null = null;
  private renderedType: TaskType | null = null;
  private busy = false;

  private readonly onChanged = (): void => this.refresh();

  protected override onCreate(): void {
    const { bg, titleNode } = buildPanelHeader(this.node, '任务', () => this.close());
    RedDots.bind(titleNode, 'menu.tasks', { offset: [0, 2] });

    tabs({
      parent: bg,
      items: ['每日', '每周'],
      width: 560,
      height: 76,
      position: [0, 440],
      onChange: (index) => this.switchType(index === 0 ? 'daily' : 'weekly'),
    });

    this.claimAllButton = button({
      parent: bg,
      size: { width: 560, height: 84 },
      position: [0, 356],
      text: '一键领取',
      variant: 'green',
      onClick: () => void this.onClaimAll(),
    });

    this.list = new RowList<TaskView>({
      parent: bg,
      width: 650,
      height: 760,
      rowHeight: 180,
      gapY: 14,
      padding: 0,
      emptyText: '暂无任务',
    });
    this.list.node.setPosition(0, -110, 0);
  }

  protected override onOpen(): void {
    this.ctx.refreshDaily();
    this.ctx.events.on('task.changed', this.onChanged, this);
    this.ctx.events.on('day.changed', this.onChanged, this);
    this.refresh();
  }

  protected override onClose(): void {
    this.ctx.events.off('task.changed', this.onChanged, this);
    this.ctx.events.off('day.changed', this.onChanged, this);
  }

  // -------------------------------------------------------------------------
  // 渲染
  // -------------------------------------------------------------------------

  private switchType(type: TaskType): void {
    if (this.type === type) return;
    this.type = type;
    this.refresh();
  }

  private refresh(): void {
    const list = this.list;
    if (!list) return;
    const views = this.ctx.task.list(this.type);
    const prevY = this.renderedType === this.type ? list.content.position.y : null;
    list.setData(views, (view, cell) => this.renderRow(view, cell));
    // setData 会把 content 复位到顶部；同一页签的数据刷新保留滚动位置。
    if (prevY !== null) list.content.setPosition(0, prevY, 0);
    this.renderedType = this.type;
    this.claimAllButton?.setInteractable(!this.busy && views.some((view) => view.claimable));
  }

  private renderRow(view: TaskView, cell: Node): void {
    const action = view.claimed
      ? { text: '已领取', variant: 'secondary' as const, enabled: false, onClick: () => undefined }
      : view.claimable
        ? {
            text: '领取',
            variant: 'green' as const,
            enabled: !this.busy,
            onClick: (btn: ButtonView) => void this.onClaim(view, btn),
          }
        : {
            text: '去完成',
            variant: 'primary' as const,
            enabled: true,
            onClick: () => this.onLink(view.config.link),
          };

    buildProgressRow(cell, {
      ctx: this.ctx,
      width: 650,
      height: 180,
      name: view.config.name,
      desc: view.config.desc,
      progress: view.progress,
      target: view.target,
      reward: view.config.reward,
      completed: view.claimable || view.claimed,
      action,
    });
  }

  // -------------------------------------------------------------------------
  // 交互
  // -------------------------------------------------------------------------

  private async onClaim(view: TaskView, btn: ButtonView): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    if (isValid(btn.node)) btn.setInteractable(false);
    this.claimAllButton?.setInteractable(false);
    try {
      const result = this.ctx.task.claim(view.config.id);
      if (!result.ok) {
        Toast.show(result.reason === FailReason.AlreadyClaimed ? '奖励已领取' : '领取失败，请稍后再试');
        return;
      }
      // task.changed 已同步触发列表刷新；弹窗展示本次奖励。
      await RewardPopup.show(this.ctx.reward.describe(view.config.reward), { title: view.config.name });
    } finally {
      this.busy = false;
      this.refresh();
    }
  }

  private async onClaimAll(): Promise<void> {
    if (this.busy) return;
    if (!this.ctx.task.list(this.type).some((view) => view.claimable)) return;
    this.busy = true;
    this.claimAllButton?.setInteractable(false);
    try {
      const result = this.ctx.task.claimAll(this.type);
      if (result.claimed.length === 0) {
        Toast.show('暂无可领取奖励');
        return;
      }
      Toast.show(`已领取 ${result.claimed.length} 项奖励`);
      await RewardPopup.show(this.ctx.reward.describe(result.reward), { title: '一键领取' });
    } finally {
      this.busy = false;
      this.refresh();
    }
  }

  private onLink(link: TaskConfig['link']): void {
    if (!link || link === 'none') {
      Toast.show('完成对应行为后即可领取');
      return;
    }
    if (link === 'run') {
      Toast.show('请从主界面点击「开始酷跑」');
      this.close();
      return;
    }
    const target = link === 'shop' ? PANEL_NAMES.shop : link === 'character' ? PANEL_NAMES.characters : PANEL_NAMES.welfare;
    if (!PanelManager.has(target)) {
      Toast.show('对应功能开发中');
      return;
    }
    void PanelManager.open(target, link === 'shop' ? { tab: 'gold' } : undefined);
  }
}
