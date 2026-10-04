import { Color, Graphics, Label, Node } from 'cc';
import type { WelfareSignInDayView, WelfareSignInState } from '../../core/contracts';
import { FailReason } from '../../core/contracts';
import { formatNumber } from '../../core/framework/Utils';
import { applySprite } from '../framework/Assets';
import { BasePanel } from '../framework/BasePanel';
import { GridList } from '../framework/GridList';
import { RedDots } from '../framework/RedDots';
import { RewardPopup } from '../framework/RewardPopup';
import { Theme } from '../framework/Theme';
import { Toast } from '../framework/Toast';
import { type ButtonView, type TabsView, button, label, node, tabs } from '../framework/UIKit';
import { buildPanelHeader } from './PanelParts';

const TAB_SIGN = 0;
const TAB_DAILY = 1;

const SIGN_CELL_WIDTH = 145;
const SIGN_CELL_HEIGHT = 165;

/** 未来格与未知状态的灰色底。 */
const SIGN_FUTURE_BG = new Color(224, 215, 199, 255);

/**
 * 福利手册（docs/04 §3.7）：
 * 签到页（7 日三态奖励格 + 立即签到）与每日福利页（看广告领免费金币）。
 * 状态一律以 WelfareService 返回为准；跨天刷新由 day.changed 驱动。
 */
export class WelfarePanel extends BasePanel {
  private tabView: TabsView | null = null;
  private signPage: Node | null = null;
  private dailyPage: Node | null = null;
  private signGrid: GridList<WelfareSignInDayView> | null = null;
  private signCycleText: Label | null = null;
  private signButton: ButtonView | null = null;
  private dailyButton: ButtonView | null = null;
  private dailyStatusText: Label | null = null;
  private busy = false;

  private readonly onChanged = (): void => this.refresh();

  protected override onCreate(): void {
    const { bg, titleNode } = buildPanelHeader(this.node, '福利手册', () => this.close());
    RedDots.bind(titleNode, 'menu.welfare', { offset: [0, 2] });

    this.tabView = tabs({
      parent: bg,
      items: ['签到', '每日福利'],
      width: 560,
      height: 76,
      position: [0, 440],
      onChange: (index) => this.switchTab(index),
    });

    this.signPage = node('SignPage', { parent: bg, size: { width: 640, height: 880 }, position: [0, -40] });
    this.dailyPage = node('DailyPage', { parent: bg, size: { width: 640, height: 880 }, position: [0, -40], active: false });
    this.buildSignPage(this.signPage);
    this.buildDailyPage(this.dailyPage);
  }

  protected override onOpen(): void {
    // 面板打开前先处理离线跨天（幂等）。
    this.ctx.refreshDaily();
    this.ctx.events.on('welfare.changed', this.onChanged, this);
    this.ctx.events.on('day.changed', this.onChanged, this);
    this.ctx.platform.ad.preload('welfare.daily');
    this.switchTab(this.tabView?.activeIndex ?? TAB_SIGN);
  }

  protected override onClose(): void {
    this.ctx.events.off('welfare.changed', this.onChanged, this);
    this.ctx.events.off('day.changed', this.onChanged, this);
  }

  // -------------------------------------------------------------------------
  // 签到页
  // -------------------------------------------------------------------------

  private buildSignPage(page: Node): void {
    this.signCycleText = label('', {
      parent: page,
      size: { width: 620, height: 48 },
      position: [0, 400],
      fontSize: Theme.fontSize.small,
      color: Theme.color.text,
      align: 'center',
      overflow: 'shrink',
    }).getComponent(Label);

    this.signGrid = new GridList<WelfareSignInDayView>({
      parent: page,
      width: 620,
      height: 354,
      cellWidth: SIGN_CELL_WIDTH,
      cellHeight: SIGN_CELL_HEIGHT,
      columns: 4,
      gapX: 13,
      gapY: 12,
      padding: 0,
    });
    this.signGrid.node.setPosition(0, 175, 0);

    this.signButton = button({
      parent: page,
      size: { width: 400, height: 92 },
      position: [0, -110],
      text: '立即签到',
      variant: 'green',
      onClick: () => this.onSignIn(),
    });

    label('连续签到 7 天可领取钻石大奖', {
      parent: page,
      size: { width: 560, height: 40 },
      position: [0, -215],
      fontSize: Theme.fontSize.small,
      color: Theme.color.textSub,
      align: 'center',
      overflow: 'shrink',
    });
  }

  private updateSignPage(state: WelfareSignInState): void {
    this.signGrid?.setData(state.days, (day, cell) => this.renderSignDay(day, cell));

    let text: string;
    if (state.todaySigned) {
      text = state.cycleDay === 0
        ? '本轮奖励已全部领取，下一轮从第 1 天开始'
        : `今日已签到，本轮已连续签到 ${state.cycleDay} 天`;
    } else {
      const next = state.days.find((day) => day.state === 'today');
      text = next ? `今日可领取第 ${next.day} 天奖励（第 7 天为钻石大奖）` : '签到奖励配置缺失';
    }
    if (this.signCycleText) this.signCycleText.string = text;

    if (this.signButton) {
      this.signButton.setText(state.todaySigned ? '明日再来' : '立即签到');
      this.signButton.setInteractable(!state.todaySigned && !this.busy && state.days.some((day) => day.state === 'today'));
    }
  }

  private renderSignDay(day: WelfareSignInDayView, cell: Node): void {
    const g = cell.getComponent(Graphics) ?? cell.addComponent(Graphics);
    g.clear();
    const fill = day.state === 'today' ? Theme.color.panel : day.state === 'claimed' ? Theme.color.panelDeep : SIGN_FUTURE_BG;
    g.fillColor = fill;
    g.roundRect(-SIGN_CELL_WIDTH / 2, -SIGN_CELL_HEIGHT / 2, SIGN_CELL_WIDTH, SIGN_CELL_HEIGHT, Theme.radius.md);
    g.fill();
    if (day.state === 'today') {
      g.strokeColor = Theme.color.gold;
      g.lineWidth = 4;
      g.roundRect(-SIGN_CELL_WIDTH / 2, -SIGN_CELL_HEIGHT / 2, SIGN_CELL_WIDTH, SIGN_CELL_HEIGHT, Theme.radius.md);
      g.stroke();
    }

    const textColor = day.state === 'future' ? Theme.color.textDisabled : Theme.color.text;
    label(`第${day.day}天`, {
      parent: cell,
      size: { width: 125, height: 26 },
      position: [0, 60],
      fontSize: Theme.fontSize.tiny,
      color: textColor,
      align: 'center',
      overflow: 'shrink',
    });

    const first = this.ctx.reward.describe(day.reward)[0];
    if (first) {
      const iconNode = node('icon', { parent: cell, size: { width: 62, height: 62 }, position: [0, 12] });
      applySprite(iconNode, first.icon, {
        size: { width: 62, height: 62 },
        radius: Theme.radius.sm,
        placeholderText: first.name ? first.name.slice(0, 1) : '',
      });
      label(`x${formatNumber(first.count)}`, {
        parent: cell,
        size: { width: 125, height: 24 },
        position: [0, -30],
        fontSize: Theme.fontSize.tiny,
        color: textColor,
        align: 'center',
        overflow: 'shrink',
      });
    }

    const stateText = day.state === 'claimed' ? '已领取' : day.state === 'today' ? '今日可领' : '';
    if (stateText) {
      label(stateText, {
        parent: cell,
        size: { width: 125, height: 22 },
        position: [0, -60],
        fontSize: Theme.fontSize.tiny,
        color: day.state === 'today' ? Theme.color.wood : Theme.color.textSub,
        align: 'center',
        overflow: 'shrink',
      });
    }
  }

  // -------------------------------------------------------------------------
  // 每日福利页
  // -------------------------------------------------------------------------

  private buildDailyPage(page: Node): void {
    const card = node('DailyCard', { parent: page, size: { width: 560, height: 430 }, position: [0, 60] });
    const g = card.addComponent(Graphics);
    g.fillColor = Theme.color.panel;
    g.roundRect(-280, -215, 560, 430, Theme.radius.lg);
    g.fill();
    g.strokeColor = Theme.color.border;
    g.lineWidth = 2;
    g.roundRect(-280, -215, 560, 430, Theme.radius.lg);
    g.stroke();

    const free = this.ctx.config.welfare().dailyFreeAd;
    label('每日福利', {
      parent: card,
      size: { width: 480, height: 48 },
      position: [0, 165],
      fontSize: Theme.fontSize.body,
      bold: true,
      align: 'center',
      overflow: 'shrink',
    });

    const display = free ? this.ctx.reward.describe(free.reward)[0] : undefined;
    if (display) {
      const iconNode = node('icon', { parent: card, size: { width: 116, height: 116 }, position: [0, 72] });
      applySprite(iconNode, display.icon, {
        size: { width: 116, height: 116 },
        radius: Theme.radius.md,
        placeholderText: display.name ? display.name.slice(0, 1) : '',
      });
      label(`x${formatNumber(display.count)}`, {
        parent: card,
        size: { width: 300, height: 32 },
        position: [0, -6],
        fontSize: Theme.fontSize.body,
        bold: true,
        align: 'center',
        overflow: 'shrink',
      });
    }

    this.dailyButton = button({
      parent: card,
      size: { width: 340, height: 88 },
      position: [0, -130],
      text: '看视频领取',
      variant: 'green',
      onClick: () => void this.onDailyAd(),
    });

    this.dailyStatusText = label('', {
      parent: card,
      size: { width: 480, height: 32 },
      position: [0, -195],
      fontSize: Theme.fontSize.small,
      color: Theme.color.textSub,
      align: 'center',
      overflow: 'shrink',
    }).getComponent(Label);
  }

  private updateDailyPage(): void {
    const free = this.ctx.config.welfare().dailyFreeAd;
    const claimed = this.ctx.welfare.dailyFreeAdClaimed();
    if (this.dailyButton) {
      this.dailyButton.setText(!free ? '暂未开放' : claimed ? '今日已领取' : '看视频领取');
      this.dailyButton.setInteractable(!!free && !claimed && !this.busy);
    }
    if (this.dailyStatusText) {
      this.dailyStatusText.string = !free
        ? '每日福利暂未开放'
        : claimed
          ? '今日福利已领取，明日再来'
          : '每日一次，看完视频立即到账';
    }
  }

  // -------------------------------------------------------------------------
  // 交互
  // -------------------------------------------------------------------------

  private switchTab(index: number): void {
    if (this.signPage) this.signPage.active = index === TAB_SIGN;
    if (this.dailyPage) this.dailyPage.active = index === TAB_DAILY;
    if (index === TAB_DAILY) {
      this.ctx.platform.ad.preload('welfare.daily');
      this.updateDailyPage();
    } else {
      this.updateSignPage(this.ctx.welfare.signInState());
    }
  }

  private refresh(): void {
    this.updateSignPage(this.ctx.welfare.signInState());
    this.updateDailyPage();
  }

  private setBusy(value: boolean): void {
    this.busy = value;
    this.updateSignPage(this.ctx.welfare.signInState());
    this.updateDailyPage();
  }

  private onSignIn(): void {
    if (this.busy) return;
    const before = this.ctx.welfare.signInState();
    if (before.todaySigned) return;
    const todayView = before.days.find((day) => day.state === 'today');
    this.setBusy(true);
    const result = this.ctx.welfare.signIn();
    if (!result.ok) {
      this.setBusy(false);
      Toast.show(this.reasonText(result.reason, '签到失败，请稍后再试'));
      return;
    }
    // 幂等；奖励来自签到前定位到的「今日」格。
    void RewardPopup.show(this.ctx.reward.describe(todayView?.reward ?? {}), { title: '签到奖励' })
      .finally(() => this.setBusy(false));
  }

  private async onDailyAd(): Promise<void> {
    if (this.busy) return;
    const free = this.ctx.config.welfare().dailyFreeAd;
    if (!free) return;
    this.setBusy(true);
    try {
      if (!this.ctx.platform.ad.isReady('welfare.daily')) {
        Toast.show('广告暂未就绪，请稍后再试');
        return;
      }
      let completed = false;
      try {
        const result = await this.ctx.platform.ad.show('welfare.daily');
        completed = result.completed;
      } catch {
        Toast.show('广告加载失败，请稍后再试');
        return;
      }
      if (!completed) {
        Toast.show('广告未看完，未发放奖励');
        return;
      }
      const claim = this.ctx.welfare.claimDailyFreeAd();
      if (!claim.ok) {
        Toast.show(this.reasonText(claim.reason, '领取失败，请稍后再试'));
        return;
      }
      await RewardPopup.show(this.ctx.reward.describe(free.reward), { title: '每日福利' });
    } finally {
      this.setBusy(false);
    }
  }

  private reasonText(reason: string | undefined, fallback: string): string {
    if (reason === FailReason.AlreadyClaimed) return '今日已领取';
    if (reason === FailReason.Unsupported) return '每日福利暂未开放';
    return fallback;
  }
}
