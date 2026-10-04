import { Color, Graphics, Label, Node } from 'cc';
import type { LeaderboardEntry, LeaderboardResult } from '../../core/contracts';
import { Logger } from '../../core/framework/Logger';
import { formatNumber } from '../../core/framework/Utils';
import { applySprite } from '../framework/Assets';
import { BasePanel } from '../framework/BasePanel';
import { LoadingMask } from '../framework/LoadingMask';
import { RowList } from '../framework/RowList';
import { Theme } from '../framework/Theme';
import { Toast } from '../framework/Toast';
import { button, divider, label, node, panelBg, tabs, type ButtonView, type TabsView } from '../framework/UIKit';

const log = new Logger();

type BoardType = 'friends' | 'global';

const BOARD_ORDER: readonly BoardType[] = ['friends', 'global'];
const BOARD_TABS = ['好友', '世界'];
const TOP_N = 50;
const ROW_HEIGHT = 100;
const MY_ROW_BG = new Color(255, 197, 61, 70);

const RANK_COLORS: Record<number, Color> = {
  1: new Color(255, 197, 61, 255),
  2: new Color(192, 197, 206, 255),
  3: new Color(205, 127, 50, 255),
};

/**
 * 排行榜面板（docs/04 §3.11）：好友/世界页签，数据仅来自 `ICloudService.getLeaderboard`；
 * 我的最佳成绩卡、前三名次配色、我的行高亮、加载/空/失败重试、离线模式小标签。
 */
export class LeaderboardPanel extends BasePanel {
  private tabsView: TabsView | null = null;
  private list: RowList<LeaderboardEntry> | null = null;
  private offlineTag: Node | null = null;
  private retryButton: ButtonView | null = null;
  private bestRankLabel: Label | null = null;
  private bestScoreLabel: Label | null = null;
  private board: BoardType = 'friends';
  private requestSeq = 0;

  protected override onCreate(): void {
    const bg = panelBg({ parent: this.node, size: { width: 660, height: 1120 } });

    label('排行榜', {
      parent: bg,
      size: { width: 520, height: 72 },
      position: [0, 480],
      fontSize: Theme.fontSize.title,
      bold: true,
      align: 'center',
      overflow: 'shrink',
    });
    button({
      parent: bg,
      size: { width: 140, height: 64 },
      position: [240, 480],
      text: '刷新',
      variant: 'secondary',
      fontSize: Theme.fontSize.small,
      onClick: () => this.load(),
    });
    divider({ parent: bg, width: 560, position: [0, 440] });

    this.tabsView = tabs({
      parent: bg,
      items: BOARD_TABS,
      width: 600,
      height: 76,
      index: 0,
      position: [0, 398],
      onChange: (index) => {
        this.board = BOARD_ORDER[index] ?? 'friends';
        this.load();
      },
    });

    this.offlineTag = this.buildOfflineTag(bg);
    this.buildBestCard(bg);

    this.list = new RowList<LeaderboardEntry>({
      parent: bg,
      width: 620,
      height: 600,
      rowHeight: ROW_HEIGHT,
      gapY: 8,
      padding: 10,
      emptyText: '暂无数据',
    });
    this.list.node.setPosition(0, -110, 0);

    this.retryButton = button({
      parent: bg,
      size: { width: 240, height: 88 },
      position: [0, -110],
      text: '重试',
      variant: 'green',
      onClick: () => this.load(),
    });
    this.retryButton.node.active = false;

    button({
      parent: bg,
      size: { width: 360, height: 88 },
      position: [0, -490],
      text: '返回',
      variant: 'primary',
      onClick: () => this.close(),
    });
  }

  protected override onOpen(): void {
    this.board = 'friends';
    this.tabsView?.setActive(0);
    this.load();
  }

  protected override onClose(): void {
    // 使未返回的请求失效，避免关闭后继续刷新界面。
    this.requestSeq += 1;
  }

  // -------------------------------------------------------------------------
  // 构建
  // -------------------------------------------------------------------------

  private buildOfflineTag(parent: Node): Node {
    const tag = node('OfflineTag', { parent, size: { width: 128, height: 34 }, position: [230, 331] });
    const g = tag.addComponent(Graphics);
    g.fillColor = Theme.color.toastBg;
    g.roundRect(-64, -17, 128, 34, 17);
    g.fill();
    label('离线模式', {
      parent: tag,
      size: { width: 128, height: 34 },
      fontSize: Theme.fontSize.tiny,
      color: Theme.color.sand,
      align: 'center',
      overflow: 'shrink',
    });
    tag.active = false;
    return tag;
  }

  private buildBestCard(parent: Node): void {
    const card = node('BestCard', { parent, size: { width: 600, height: 104 }, position: [0, 258] });
    const g = card.addComponent(Graphics);
    g.fillColor = Theme.color.panelDeep;
    g.roundRect(-300, -52, 600, 104, Theme.radius.md);
    g.fill();

    label('我的最佳成绩', {
      parent: card,
      size: { width: 300, height: 34 },
      anchor: [0, 0.5],
      position: [-280, 26],
      fontSize: Theme.fontSize.small,
      color: Theme.color.textSub,
      align: 'left',
      overflow: 'shrink',
    });
    const rankNode = label('未上榜', {
      parent: card,
      size: { width: 300, height: 40 },
      anchor: [0, 0.5],
      position: [-280, -20],
      fontSize: Theme.fontSize.body,
      bold: true,
      align: 'left',
      overflow: 'shrink',
    });
    this.bestRankLabel = rankNode.getComponent(Label);

    const scoreNode = label('0', {
      parent: card,
      size: { width: 260, height: 64 },
      anchor: [1, 0.5],
      position: [280, 0],
      fontSize: Theme.fontSize.title,
      bold: true,
      color: Theme.color.gold,
      align: 'right',
      overflow: 'shrink',
    });
    this.bestScoreLabel = scoreNode.getComponent(Label);
  }

  // -------------------------------------------------------------------------
  // 数据加载
  // -------------------------------------------------------------------------

  private load(): void {
    const seq = ++this.requestSeq;
    if (this.retryButton) this.retryButton.node.active = false;
    LoadingMask.show('排行榜加载中...');
    this.ctx.platform.cloud
      .getLeaderboard({ board: this.board, top: TOP_N })
      .then((result) => {
        if (seq !== this.requestSeq) return;
        this.applyResult(result);
      })
      .catch((err: unknown) => {
        if (seq !== this.requestSeq) return;
        log.error('排行榜加载失败', err);
        Toast.show('排行榜加载失败，请重试');
        this.list?.clear();
        if (this.retryButton) this.retryButton.node.active = true;
      })
      .finally(() => {
        LoadingMask.hide();
      });
  }

  private applyResult(result: LeaderboardResult): void {
    if (this.offlineTag) this.offlineTag.active = result.offline === true;

    const me = result.me;
    const bestScore = me?.score ?? this.ctx.save.stats.bestScore;
    if (this.bestRankLabel) this.bestRankLabel.string = me ? `第 ${me.rank} 名` : '未上榜';
    if (this.bestScoreLabel) this.bestScoreLabel.string = formatNumber(bestScore);

    this.list?.setData(result.list, (entry, cell) => this.renderRow(entry, cell));
  }

  private renderRow(entry: LeaderboardEntry, cell: Node): void {
    const isMe = entry.isMe === true;
    if (isMe) {
      const highlight = node('myRowBg', { parent: cell, size: { width: 596, height: ROW_HEIGHT - 8 } });
      const g = highlight.addComponent(Graphics);
      g.fillColor = MY_ROW_BG;
      g.roundRect(-298, -(ROW_HEIGHT - 8) / 2, 596, ROW_HEIGHT - 8, Theme.radius.sm);
      g.fill();
    }

    label(`${entry.rank}`, {
      parent: cell,
      size: { width: 70, height: 52 },
      position: [-265, 0],
      fontSize: Theme.fontSize.subtitle,
      bold: true,
      color: RANK_COLORS[entry.rank] ?? Theme.color.textSub,
      align: 'center',
      overflow: 'shrink',
    });

    const avatar = node('avatar', { parent: cell, size: { width: 64, height: 64 }, position: [-200, 0] });
    applySprite(avatar, entry.avatarUrl, {
      size: { width: 64, height: 64 },
      radius: 32,
      color: isMe ? Theme.color.gold : Theme.color.placeholder,
      placeholderText: entry.nickname ? entry.nickname.slice(0, 1) : '?',
    });

    label(entry.nickname || '酷跑玩家', {
      parent: cell,
      size: { width: 320, height: 52 },
      anchor: [0, 0.5],
      position: [-150, 0],
      fontSize: Theme.fontSize.body,
      bold: isMe,
      color: isMe ? Theme.color.wood : Theme.color.text,
      align: 'left',
      overflow: 'shrink',
    });

    label(formatNumber(entry.score), {
      parent: cell,
      size: { width: 220, height: 52 },
      anchor: [1, 0.5],
      position: [288, 0],
      fontSize: Theme.fontSize.body,
      bold: true,
      color: isMe ? Theme.color.wood : Theme.color.text,
      align: 'right',
      overflow: 'shrink',
    });
  }
}
