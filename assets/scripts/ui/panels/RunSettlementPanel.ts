import { Color, Label, Node } from 'cc';
import type { GameplayResult, RewardBundle, RewardDisplay, SettlementResult } from '../../core/contracts';
import { Logger } from '../../core/framework/Logger';
import { formatNumber } from '../../core/framework/Utils';
import { applySprite } from '../framework/Assets';
import { BasePanel } from '../framework/BasePanel';
import { GridList } from '../framework/GridList';
import { RewardPopup } from '../framework/RewardPopup';
import { Theme } from '../framework/Theme';
import { Toast } from '../framework/Toast';
import { button, divider, label, node, overlay, panelBg, type ButtonView } from '../framework/UIKit';

const log = new Logger();

/** 结算面板打开参数（MainMenuPanel / debug 直通入口传入）。 */
export interface RunSettlementData {
  settlement: SettlementResult;
  /** 「再来一局」回调；缺省时按钮隐藏。 */
  onPlayAgain?: () => void;
}

const CARD_W = 690;
const CARD_H = 1180;

function kindColor(kind: RewardDisplay['kind']): Color {
  if (kind === 'gold') return Theme.color.gold;
  if (kind === 'diamond') return Theme.color.diamond;
  if (kind === 'character') return Theme.color.btnGreen;
  return Theme.color.skyBlue;
}

function renderReward(item: RewardDisplay, cell: Node): void {
  const iconNode = node('icon', { parent: cell, size: { width: 92, height: 92 }, position: [0, 22] });
  applySprite(iconNode, item.icon, {
    size: { width: 92, height: 92 },
    radius: Theme.radius.md,
    color: kindColor(item.kind),
    placeholderText: item.name ? item.name.slice(0, 1) : '',
  });
  label(`x${formatNumber(item.count)}`, {
    parent: cell,
    size: { width: 132, height: 32 },
    position: [0, -30],
    fontSize: Theme.fontSize.small,
    bold: true,
    align: 'center',
    overflow: 'shrink',
  });
  label(item.name, {
    parent: cell,
    size: { width: 132, height: 30 },
    position: [0, -58],
    fontSize: Theme.fontSize.tiny,
    color: Theme.color.textSub,
    align: 'center',
    overflow: 'shrink',
  });
}

/**
 * 结算面板（docs/04 §3.12 / docs/06 §4）：
 * 展示分数/距离/金币与基础奖励；双倍领取（广告每局最多成功一次）、直接领取、
 * 炫耀一下、再来一局、返回；任何未领取的关闭都会自动发放基础奖励（不丢奖）。
 * 奖励只通过 ctx.reward.grant 发放，禁止直接写存档。
 */
export class RunSettlementPanel extends BasePanel {
  private data: RunSettlementData | null = null;
  private settled = false;
  private busy = false;
  private sharing = false;

  private scoreLabel: Label | null = null;
  private distanceLabel: Label | null = null;
  private coinsLabel: Label | null = null;
  private rewardList: GridList<RewardDisplay> | null = null;

  private doubleButton: ButtonView | null = null;
  private directButton: ButtonView | null = null;
  private shareButton: ButtonView | null = null;
  private replayButton: ButtonView | null = null;
  private backButton: ButtonView | null = null;

  protected override onCreate(): void {
    overlay({ parent: this.node, color: new Color(0, 0, 0, 150) });
    const card = panelBg({ parent: this.node, size: { width: CARD_W, height: CARD_H } });

    label('结算', {
      parent: card,
      size: { width: 360, height: 68 },
      position: [0, CARD_H / 2 - 70],
      fontSize: Theme.fontSize.title,
      bold: true,
      align: 'center',
      overflow: 'shrink',
    });
    this.backButton = button({
      parent: card,
      size: { width: 150, height: 64 },
      position: [-CARD_W / 2 + 95, CARD_H / 2 - 70],
      text: '返回',
      variant: 'ghost',
      fontSize: Theme.fontSize.small,
      textColor: Theme.color.text,
      onClick: () => this.onBack(),
    });

    label('本局得分', {
      parent: card,
      size: { width: 400, height: 40 },
      position: [0, 420],
      fontSize: Theme.fontSize.small,
      color: Theme.color.textSub,
      align: 'center',
      overflow: 'shrink',
    });
    this.scoreLabel = label('0', {
      parent: card,
      size: { width: 620, height: 112 },
      position: [0, 350],
      fontSize: 88,
      bold: true,
      color: Theme.color.gold,
      outline: { color: Theme.color.wood, width: 5 },
      align: 'center',
      overflow: 'shrink',
    }).getComponent(Label);
    this.distanceLabel = label('距离 0 m', {
      parent: card,
      size: { width: 520, height: 44 },
      position: [0, 278],
      fontSize: Theme.fontSize.body,
      color: Theme.color.textSub,
      align: 'center',
      overflow: 'shrink',
    }).getComponent(Label);
    this.coinsLabel = label('拾取金币 0 枚', {
      parent: card,
      size: { width: 520, height: 44 },
      position: [0, 232],
      fontSize: Theme.fontSize.body,
      color: Theme.color.textSub,
      align: 'center',
      overflow: 'shrink',
    }).getComponent(Label);

    divider({ parent: card, width: 610, position: [0, 196] });
    label('获得奖励（基础）', {
      parent: card,
      size: { width: 400, height: 40 },
      position: [0, 152],
      fontSize: Theme.fontSize.small,
      color: Theme.color.textSub,
      align: 'center',
      overflow: 'shrink',
    });

    this.rewardList = new GridList<RewardDisplay>({
      parent: card,
      width: 610,
      height: 290,
      cellWidth: 140,
      cellHeight: 145,
      columns: 4,
      gapX: 8,
      gapY: 8,
      padding: 8,
      emptyText: '暂无奖励',
    });
    this.rewardList.node.setPosition(0, -35, 0);

    this.doubleButton = button({
      parent: card,
      size: { width: 560, height: 104 },
      position: [0, -265],
      text: '双倍领取（广告）',
      variant: 'green',
      onClick: () => void this.onDoubleClaim(),
    });
    this.directButton = button({
      parent: card,
      size: { width: 560, height: 96 },
      position: [0, -385],
      text: '直接领取',
      variant: 'primary',
      onClick: () => this.onDirectClaim(),
    });
    this.shareButton = button({
      parent: card,
      size: { width: 260, height: 80 },
      position: [-140, -505],
      text: '炫耀一下',
      variant: 'secondary',
      fontSize: Theme.fontSize.small,
      onClick: () => void this.onShare(),
    });
    this.replayButton = button({
      parent: card,
      size: { width: 260, height: 80 },
      position: [140, -505],
      text: '再来一局',
      variant: 'secondary',
      fontSize: Theme.fontSize.small,
      onClick: () => this.onReplay(),
    });
  }

  protected override onOpen(data?: unknown): void {
    const payload = data as RunSettlementData | null | undefined;
    if (!payload || !payload.settlement) {
      log.warn('RunSettlementPanel 缺少结算数据，忽略本次打开');
      return;
    }
    this.data = payload;
    this.settled = false;
    this.busy = false;
    this.sharing = false;

    const { result, base } = payload.settlement;
    if (this.scoreLabel) this.scoreLabel.string = formatNumber(Math.max(0, result.score));
    if (this.distanceLabel) this.distanceLabel.string = `距离 ${formatNumber(Math.max(0, result.distance))} m`;
    if (this.coinsLabel) this.coinsLabel.string = `拾取金币 ${formatNumber(Math.max(0, result.coins))} 枚`;
    if (this.rewardList) this.rewardList.setData(this.ctx.reward.describe(base), renderReward);
    if (this.replayButton) this.replayButton.node.active = typeof payload.onPlayAgain === 'function';
    this.refreshButtons();

    // fire-and-forget：失败仅日志（Local 模式自动模拟）
    void this.submitScore(result);
  }

  protected override onClose(): void {
    // 未领取就关闭（返回/再来一局/外部关闭）→ 自动发放基础奖励，保证不丢奖
    if (this.data && !this.settled) {
      this.settleReward(this.data.settlement.base, false);
    }
    this.busy = false;
    this.ctx.flush();
    this.ctx.redDot.refresh();
  }

  // -------------------------------------------------------------------------
  // 交互
  // -------------------------------------------------------------------------

  private onDirectClaim(): void {
    if (!this.data || this.busy || this.settled) return;
    this.busy = true;
    this.settleReward(this.data.settlement.base, false);
    this.refreshButtons();
    this.close();
  }

  private async onDoubleClaim(): Promise<void> {
    if (!this.data || this.busy || this.settled) return;
    const data = this.data;
    this.busy = true;
    this.refreshButtons();

    let completed = false;
    try {
      const ad = await this.ctx.platform.ad.show('settlement.double');
      completed = ad.completed === true;
    } catch (err) {
      log.warn('结算双倍广告异常', err);
    }
    // 广告期间面板被外部关闭（如场景切换）：不再发放，避免与关闭时的基础奖励重复
    if (!this.isOpen || this.data !== data) return;
    if (!completed) {
      this.busy = false;
      this.refreshButtons();
      Toast.show('广告未完整观看，可再次尝试');
      return;
    }

    this.settleReward(data.settlement.double, true);
    this.refreshButtons();
    await RewardPopup.show(this.ctx.reward.describe(data.settlement.double), { title: '双倍奖励' });
    this.close();
  }

  private onBack(): void {
    if (this.busy) return;
    this.close(); // onClose 自动发放基础奖励
  }

  private onReplay(): void {
    const again = this.data?.onPlayAgain;
    if (!this.data || this.busy || !again) return;
    this.close(); // onClose 自动发放基础奖励
    void this.waitClosed().then(() => again());
  }

  private async onShare(): Promise<void> {
    if (!this.data || this.busy || this.sharing) return;
    this.sharing = true;
    const score = Math.max(0, Math.trunc(this.data.settlement.result.score));
    try {
      const ok = await this.ctx.platform.share({ title: `我在雷霆酷跑拿了 ${formatNumber(score)} 分，快来挑战！` });
      if (!ok) Toast.show('分享未完成');
    } catch (err) {
      log.debug('分享失败（静默）', err);
      Toast.show('分享未完成');
    } finally {
      this.sharing = false;
    }
  }

  /** 唯一发放入口：grant → run.settled；settled 标记保证每局最多发放一次。 */
  private settleReward(bundle: RewardBundle, doubled: boolean): void {
    if (!this.data) return;
    this.settled = true;
    this.ctx.reward.grant(bundle, doubled ? 'settlement.ad' : 'settlement');
    this.ctx.events.emit('run.settled', { result: this.data.settlement.result, reward: bundle, doubled });
  }

  /** 领取操作进行中禁用全部按钮；领取完成后双倍/直接领取置灰。 */
  private refreshButtons(): void {
    const idle = !this.busy;
    const claimable = idle && !this.settled;
    this.doubleButton?.setInteractable(claimable);
    this.directButton?.setInteractable(claimable);
    this.shareButton?.setInteractable(idle);
    this.replayButton?.setInteractable(idle);
    this.backButton?.setInteractable(idle);
  }

  private async submitScore(result: GameplayResult): Promise<void> {
    const profile = this.ctx.save.profile;
    try {
      const submitted = await this.ctx.platform.cloud.submitScore({
        score: Number.isFinite(result.score) ? Math.max(0, Math.trunc(result.score)) : 0,
        distance: Number.isFinite(result.distance) ? Math.max(0, Math.trunc(result.distance)) : 0,
        mode: result.mode,
        nickname: profile.nickname,
        avatarUrl: profile.avatarUrl,
      });
      if (!submitted.ok) log.warn('成绩提交失败（已忽略）', submitted);
    } catch (err) {
      log.warn('成绩提交异常（已忽略）', err);
    }
  }
}
