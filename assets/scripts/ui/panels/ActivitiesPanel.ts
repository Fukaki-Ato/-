import { Button, Color, Graphics, Label, Node } from 'cc';
import {
  FailReason,
  type ActivityId,
  type ActivityMilestoneView,
  type ActivityView,
  type RewardDisplay,
} from '../../core/contracts';
import { formatNumber } from '../../core/framework/Utils';
import { applySprite } from '../framework/Assets';
import { AudioService } from '../framework/AudioService';
import { BasePanel } from '../framework/BasePanel';
import { RedDots } from '../framework/RedDots';
import { RewardPopup } from '../framework/RewardPopup';
import { RowList } from '../framework/RowList';
import { TextDialog } from '../framework/TextDialog';
import { Theme } from '../framework/Theme';
import { Toast } from '../framework/Toast';
import { button, divider, label, node, panelBg, progressBar, type ButtonVariant, type ButtonView } from '../framework/UIKit';

const PANEL_WIDTH = 660;
const PANEL_HEIGHT = 1120;
const CARD_WIDTH = 600;
const CARD_HEIGHT = 236;
const MILESTONE_ROW_HEIGHT = 150;
const MILESTONE_BG = new Color(255, 246, 227, 210);

const STATUS_TEXT: Record<ActivityView['status'], string> = {
  active: '进行中',
  upcoming: '未开始',
  ended: '已结束',
};

const STATUS_COLOR: Record<ActivityView['status'], Color> = {
  active: Theme.color.btnGreen,
  upcoming: Theme.color.skyBlue,
  ended: Theme.color.textDisabled,
};

/** 时间字符串 `YYYY-MM-DD HH:mm` → `MM-DD HH:mm`（仅展示裁剪）。 */
function shortTime(text: string): string {
  const match = /^\d{4}-(\d{2}-\d{2})[ T](\d{2}:\d{2})/.exec(text.trim());
  return match ? `${match[1]} ${match[2]}` : text;
}

function rangeText(view: ActivityView): string {
  return `${shortTime(view.config.startTime)} ~ ${shortTime(view.config.endTime)}`;
}

function rewardText(rewards: readonly RewardDisplay[]): string {
  if (rewards.length === 0) return '—';
  return rewards.map((item) => `${item.name}x${formatNumber(item.count)}`).join(' ');
}

function claimFailText(reason?: string): string {
  if (reason === FailReason.AlreadyClaimed) return '该奖励已领取';
  if (reason === FailReason.Expired) return '活动已结束';
  if (reason === FailReason.Locked) return '活动未开始';
  if (reason === FailReason.Insufficient) return '进度未达成';
  return '领取失败';
}

/**
 * 活动面板（docs/04 §3.10）：Banner 列表（时间窗三态/可领取红点）+ 同面板详情
 * （规则 TextDialog、里程碑进度/奖励/领取 → RewardPopup）。
 * 进度由 ActivityService 计算；订阅 activity.changed / currency.changed 刷新。
 */
export class ActivitiesPanel extends BasePanel {
  private listView: Node | null = null;
  private list: RowList<ActivityView> | null = null;
  private detailView: Node | null = null;
  private detailBanner: Node | null = null;
  private detailName: Label | null = null;
  private detailStatus: Label | null = null;
  private milestoneList: RowList<ActivityMilestoneView> | null = null;
  private backButton: ButtonView | null = null;
  private openedId: ActivityId | null = null;

  protected override onCreate(): void {
    const bg = panelBg({ parent: this.node, size: { width: PANEL_WIDTH, height: PANEL_HEIGHT } });

    const title = label('活动', {
      parent: bg,
      size: { width: 520, height: 72 },
      position: [0, 470],
      fontSize: Theme.fontSize.title,
      bold: true,
      align: 'center',
      overflow: 'shrink',
    });
    RedDots.bind(title, 'menu.activities', { offset: [56, 0] });
    divider({ parent: bg, width: 560, position: [0, 424] });

    this.buildListView(bg);
    this.buildDetailView(bg);

    this.backButton = button({
      parent: bg,
      size: { width: 360, height: 88 },
      position: [0, -490],
      text: '返回',
      variant: 'primary',
      onClick: () => this.onBack(),
    });

    this.ctx.events.on('activity.changed', this.onDataChanged, this);
    this.ctx.events.on('currency.changed', this.onDataChanged, this);
    this.node.once(Node.EventType.NODE_DESTROYED, () => this.ctx.events.offTarget(this));
  }

  protected override onOpen(): void {
    this.ctx.activity.refreshIfNeeded();
    this.showList();
  }

  // -------------------------------------------------------------------------
  // 视图切换
  // -------------------------------------------------------------------------

  private showList(): void {
    this.openedId = null;
    if (this.detailView) this.detailView.active = false;
    if (this.listView) this.listView.active = true;
    this.backButton?.setText('返回');
    this.renderList();
  }

  private openDetail(id: ActivityId): void {
    this.openedId = id;
    if (this.listView) this.listView.active = false;
    if (this.detailView) this.detailView.active = true;
    this.backButton?.setText('返回列表');
    this.renderDetail(id);
  }

  private onBack(): void {
    if (this.openedId !== null) this.showList();
    else this.close();
  }

  private readonly onDataChanged = (): void => {
    if (!this.isOpen) return;
    if (this.openedId !== null) this.renderDetail(this.openedId);
    else this.renderList();
  };

  // -------------------------------------------------------------------------
  // 列表视图
  // -------------------------------------------------------------------------

  private buildListView(bg: Node): void {
    this.listView = node('ActivityList', { parent: bg, size: { width: PANEL_WIDTH, height: 800 } });
    this.listView.setPosition(0, -10, 0);
    this.list = new RowList<ActivityView>({
      parent: this.listView,
      width: 620,
      height: 800,
      rowHeight: CARD_HEIGHT,
      gapY: 18,
      padding: 10,
      emptyText: '暂无活动',
    });
  }

  private renderList(): void {
    if (!this.list) return;
    this.list.setData(this.ctx.activity.list(), (activity, cell) => this.renderCard(activity, cell));
  }

  private renderCard(activity: ActivityView, cell: Node): void {
    const bannerWidth = CARD_WIDTH - 32;
    const banner = node('banner', {
      parent: cell,
      size: { width: bannerWidth, height: 138 },
      position: [0, 40],
    });
    applySprite(banner, activity.config.banner, {
      size: { width: bannerWidth, height: 138 },
      radius: Theme.radius.md,
      color: STATUS_COLOR[activity.status],
      placeholderText: activity.config.name.slice(0, 1),
    });

    label(activity.config.name, {
      parent: cell,
      size: { width: 380, height: 44 },
      anchor: [0, 0.5],
      position: [-CARD_WIDTH / 2 + 16, -50],
      fontSize: Theme.fontSize.body,
      bold: true,
      align: 'left',
      overflow: 'shrink',
    });

    const tag = node('statusTag', {
      parent: cell,
      size: { width: 120, height: 42 },
      position: [CARD_WIDTH / 2 - 76, -50],
    });
    const tagBg = tag.addComponent(Graphics);
    tagBg.fillColor = STATUS_COLOR[activity.status];
    tagBg.roundRect(-60, -21, 120, 42, 21);
    tagBg.fill();
    label(STATUS_TEXT[activity.status], {
      parent: tag,
      size: { width: 120, height: 42 },
      fontSize: Theme.fontSize.tiny,
      color: Theme.color.textOnDark,
      align: 'center',
      overflow: 'shrink',
    });

    label(rangeText(activity), {
      parent: cell,
      size: { width: CARD_WIDTH - 32, height: 34 },
      anchor: [0, 0.5],
      position: [-CARD_WIDTH / 2 + 16, -96],
      fontSize: Theme.fontSize.tiny,
      color: Theme.color.textSub,
      align: 'left',
      overflow: 'shrink',
    });

    // 该活动存在可领取里程碑时的红点提示。
    if (activity.milestones.some((milestone) => milestone.claimable)) {
      const dot = node('ClaimDot', {
        parent: cell,
        size: { width: 24, height: 24 },
        position: [CARD_WIDTH / 2 - 30, 98],
      });
      const dotBg = dot.addComponent(Graphics);
      dotBg.fillColor = Theme.color.red;
      dotBg.circle(0, 0, 11);
      dotBg.fill();
      dotBg.strokeColor = Theme.color.white;
      dotBg.lineWidth = 3;
      dotBg.circle(0, 0, 11);
      dotBg.stroke();
    }

    // 单元格跨刷新复用：Button 只创建一次，点击监听每次重建（闭包持有当前活动）。
    let cellButton = cell.getComponent(Button);
    if (!cellButton) {
      cellButton = cell.addComponent(Button);
      cellButton.transition = Button.Transition.SCALE;
      cellButton.target = cell;
      cellButton.zoomScale = 0.96;
      cellButton.duration = 0.08;
    }
    cell.off(Button.EventType.CLICK);
    cell.on(Button.EventType.CLICK, () => {
      AudioService.playSfx(Theme.assets.sfxClick);
      this.openDetail(activity.config.id);
    });
  }

  // -------------------------------------------------------------------------
  // 详情视图
  // -------------------------------------------------------------------------

  private buildDetailView(bg: Node): void {
    const detail = node('ActivityDetail', { parent: bg, size: { width: 640, height: 880 } });
    detail.setPosition(0, -30, 0);
    detail.active = false;
    this.detailView = detail;

    this.detailBanner = node('banner', { parent: detail, size: { width: 568, height: 168 }, position: [0, 330] });

    const nameNode = label('', {
      parent: detail,
      size: { width: 600, height: 56 },
      position: [0, 218],
      fontSize: Theme.fontSize.subtitle,
      bold: true,
      align: 'center',
      overflow: 'shrink',
    });
    this.detailName = nameNode.getComponent(Label);

    const statusNode = label('', {
      parent: detail,
      size: { width: 600, height: 36 },
      position: [0, 172],
      fontSize: Theme.fontSize.tiny,
      color: Theme.color.textSub,
      align: 'center',
      overflow: 'shrink',
    });
    this.detailStatus = statusNode.getComponent(Label);

    button({
      parent: detail,
      size: { width: 240, height: 64 },
      position: [0, 112],
      text: '活动规则',
      variant: 'secondary',
      fontSize: Theme.fontSize.small,
      onClick: () => {
        const current = this.openedId ? this.ctx.activity.get(this.openedId) : null;
        if (!current) return;
        void TextDialog.show({
          title: `${current.config.name} · 规则`,
          text: current.config.ruleText || current.config.desc,
        });
      },
    });

    label('里程碑', {
      parent: detail,
      size: { width: 560, height: 40 },
      anchor: [0, 0.5],
      position: [-280, 56],
      fontSize: Theme.fontSize.body,
      bold: true,
      align: 'left',
      overflow: 'shrink',
    });

    this.milestoneList = new RowList<ActivityMilestoneView>({
      parent: detail,
      width: 600,
      height: 460,
      rowHeight: MILESTONE_ROW_HEIGHT,
      gapY: 8,
      padding: 4,
      emptyText: '暂无里程碑',
    });
    this.milestoneList.node.setPosition(0, -194, 0);
  }

  private renderDetail(id: ActivityId): void {
    const view = this.ctx.activity.get(id);
    if (!view || !this.detailView) {
      this.showList();
      return;
    }

    if (this.detailBanner) {
      applySprite(this.detailBanner, view.config.banner, {
        size: { width: 568, height: 168 },
        radius: Theme.radius.md,
        color: STATUS_COLOR[view.status],
        placeholderText: view.config.name.slice(0, 1),
      });
    }
    if (this.detailName) this.detailName.string = view.config.name;
    if (this.detailStatus) this.detailStatus.string = `${STATUS_TEXT[view.status]} · ${rangeText(view)}`;

    this.milestoneList?.setData(view.milestones, (milestone, cell) => this.renderMilestone(view, milestone, cell));
  }

  private renderMilestone(view: ActivityView, milestone: ActivityMilestoneView, cell: Node): void {
    const rowBg = node('rowBg', { parent: cell, size: { width: 588, height: 142 } });
    const g = rowBg.addComponent(Graphics);
    g.fillColor = MILESTONE_BG;
    g.roundRect(-294, -71, 588, 142, Theme.radius.md);
    g.fill();

    label(`目标 ${formatNumber(milestone.target)}`, {
      parent: cell,
      size: { width: 320, height: 36 },
      anchor: [0, 0.5],
      position: [-280, 42],
      fontSize: Theme.fontSize.small,
      align: 'left',
      overflow: 'shrink',
    });
    const current = Math.min(Math.max(0, milestone.progress), milestone.target);
    label(`${formatNumber(current)}/${formatNumber(milestone.target)}`, {
      parent: cell,
      size: { width: 220, height: 36 },
      anchor: [1, 0.5],
      position: [280, 42],
      fontSize: Theme.fontSize.small,
      color: Theme.color.textSub,
      align: 'right',
      overflow: 'shrink',
    });

    const bar = progressBar({ parent: cell, width: 540, height: 24, position: [-10, 0] });
    bar.setProgress(milestone.target > 0 ? current / milestone.target : 0);

    label(`奖励：${rewardText(this.ctx.reward.describe(milestone.reward))}`, {
      parent: cell,
      size: { width: 380, height: 34 },
      anchor: [0, 0.5],
      position: [-280, -44],
      fontSize: Theme.fontSize.tiny,
      color: Theme.color.textSub,
      align: 'left',
      overflow: 'shrink',
    });

    const state = this.milestoneButtonState(view, milestone);
    const claimButton = button({
      parent: cell,
      size: { width: 170, height: 66 },
      position: [206, -40],
      text: state.text,
      variant: state.variant,
      fontSize: Theme.fontSize.small,
      onClick: () => this.claim(view, milestone),
    });
    claimButton.setInteractable(state.enabled);
  }

  private milestoneButtonState(
    view: ActivityView,
    milestone: ActivityMilestoneView,
  ): { text: string; variant: ButtonVariant; enabled: boolean } {
    if (milestone.claimed) return { text: '已领取', variant: 'secondary', enabled: false };
    if (view.status === 'upcoming') return { text: '未开始', variant: 'secondary', enabled: false };
    if (view.status === 'ended') return { text: '已结束', variant: 'secondary', enabled: false };
    if (milestone.claimable) return { text: '领取', variant: 'green', enabled: true };
    return { text: '未达成', variant: 'secondary', enabled: false };
  }

  private claim(view: ActivityView, milestone: ActivityMilestoneView): void {
    const result = this.ctx.activity.claim(view.config.id, milestone.index);
    if (!result.ok) {
      Toast.show(claimFailText(result.reason));
      return;
    }
    // 领取成功由 activity.changed 监听刷新视图；此处仅弹出奖励展示。
    void RewardPopup.show(this.ctx.reward.describe(milestone.reward));
  }
}
