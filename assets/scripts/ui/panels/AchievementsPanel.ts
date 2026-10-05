import { isValid, Node } from 'cc';
import type { AchievementView } from '../../core/contracts';
import { FailReason } from '../../core/contracts';
import { BasePanel } from '../framework/BasePanel';
import { RedDots } from '../framework/RedDots';
import { RewardPopup } from '../framework/RewardPopup';
import { RowList } from '../framework/RowList';
import { Theme } from '../framework/Theme';
import { Toast } from '../framework/Toast';
import type { ButtonView } from '../framework/UIKit';
import { buildPanelHeader, buildProgressRow } from './PanelParts';

/**
 * 成就面板（docs/04 §3.9）：
 * 勋章占位图 + 名称 + 描述 + 进度条 + 奖励 + 领取按钮。
 * 进度与可领取状态一律取自 AchievementService。
 */
export class AchievementsPanel extends BasePanel {
  private list: RowList<AchievementView> | null = null;
  private busy = false;

  private readonly onChanged = (): void => this.refresh();

  protected override onCreate(): void {
    const { bg, titleNode } = buildPanelHeader(this.node, '成就', () => this.close());
    RedDots.bind(titleNode, 'menu.achievements', { offset: [0, 2] });

    this.list = new RowList<AchievementView>({
      parent: bg,
      width: 650,
      height: 900,
      rowHeight: 180,
      gapY: 14,
      padding: 0,
      emptyText: '暂无成就',
    });
    this.list.node.setPosition(0, -30, 0);
  }

  protected override onOpen(): void {
    this.ctx.events.on('achievement.changed', this.onChanged, this);
    this.refresh();
  }

  protected override onClose(): void {
    this.ctx.events.off('achievement.changed', this.onChanged, this);
  }

  private refresh(): void {
    const list = this.list;
    if (!list) return;
    const views = this.ctx.achievement.list();
    const prevY = list.content.position.y;
    list.setData(views, (view, cell) => this.renderRow(view, cell));
    // setData 会把 content 复位到顶部；数据刷新保留滚动位置。
    list.content.setPosition(0, prevY, 0);
  }

  private renderRow(view: AchievementView, cell: Node): void {
    const action = view.claimed
      ? { text: '已领取', variant: 'secondary' as const, enabled: false, onClick: () => undefined }
      : view.claimable
        ? {
            text: '领取',
            variant: 'green' as const,
            enabled: !this.busy,
            onClick: (btn: ButtonView) => void this.onClaim(view, btn),
          }
        : { text: '未达成', variant: 'secondary' as const, enabled: false, onClick: () => undefined };

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
      icon: { path: Theme.assets.iconAchievement, placeholderText: '勋', color: Theme.color.gold },
      action,
    });
  }

  private async onClaim(view: AchievementView, btn: ButtonView): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    if (isValid(btn.node)) btn.setInteractable(false);
    try {
      const result = this.ctx.achievement.claim(view.config.id);
      if (!result.ok) {
        Toast.show(result.reason === FailReason.AlreadyClaimed ? '奖励已领取' : '领取失败，请稍后再试');
        return;
      }
      await RewardPopup.show(this.ctx.reward.describe(view.config.reward), { title: view.config.name });
    } finally {
      this.busy = false;
      this.refresh();
    }
  }
}
