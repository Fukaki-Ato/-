import { Color, Node } from 'cc';
import type { RewardDisplay } from '../../core/contracts';
import { Logger } from '../../core/framework/Logger';
import { formatNumber } from '../../core/framework/Utils';
import { applySprite } from './Assets';
import { GridList } from './GridList';
import { createModal } from './Modal';
import { Theme } from './Theme';
import { button, label, node } from './UIKit';

export interface RewardPopupOptions {
  title?: string;
  confirmText?: string;
  /** 传入则显示「双倍领取」按钮（S08 在此回调广告逻辑）。 */
  doubleText?: string;
  onDouble?: () => void | Promise<void>;
}

export type RewardPopupResult = 'confirm' | 'double';

const log = new Logger();

function kindColor(kind: RewardDisplay['kind']): Color {
  if (kind === 'gold') return Theme.color.gold;
  if (kind === 'diamond') return Theme.color.diamond;
  if (kind === 'character') return Theme.color.btnGreen;
  return Theme.color.skyBlue;
}

/** 奖励弹窗：图标+数量+名称，支持双倍领取回调；素材缺失自动占位。 */
export class RewardPopup {
  static show(rewards: readonly RewardDisplay[], opts: RewardPopupOptions = {}): Promise<RewardPopupResult> {
    const list = rewards.slice(0, 12);
    const columns = Math.max(1, Math.min(4, list.length || 1));
    const rows = Math.max(1, Math.ceil(list.length / columns));
    const cellWidth = 138;
    const cellHeight = 168;
    const gridHeight = Math.min(430, 24 + rows * cellHeight + (rows - 1) * 14);
    const height = gridHeight + 270;
    const modal = createModal({ width: 660, height });

    label(opts.title ?? '获得奖励', {
      parent: modal.content,
      size: { width: 560, height: 60 },
      position: [0, height / 2 - 64],
      fontSize: Theme.fontSize.subtitle,
      bold: true,
      align: 'center',
      overflow: 'shrink',
    });

    const grid = new GridList<RewardDisplay>({
      parent: modal.content,
      width: 620,
      height: gridHeight,
      cellWidth,
      cellHeight,
      columns,
      gapX: 14,
      gapY: 14,
      padding: 12,
      emptyText: '暂无奖励',
    });
    grid.node.setPosition(0, height / 2 - 110 - gridHeight / 2, 0);
    grid.setData(list, (item, cell) => {
      const iconNode = node('icon', { parent: cell, size: { width: 100, height: 100 }, position: [0, 30] });
      applySprite(iconNode, item.icon, {
        size: { width: 100, height: 100 },
        radius: Theme.radius.md,
        color: kindColor(item.kind),
        placeholderText: item.name ? item.name.slice(0, 1) : '',
      });
      label(`x${formatNumber(item.count)}`, {
        parent: cell,
        size: { width: cellWidth - 8, height: 30 },
        position: [0, -32],
        fontSize: Theme.fontSize.small,
        bold: true,
        align: 'center',
        overflow: 'shrink',
      });
      label(item.name, {
        parent: cell,
        size: { width: cellWidth - 8, height: 30 },
        position: [0, -62],
        fontSize: Theme.fontSize.tiny,
        color: Theme.color.textSub,
        maxWidth: cellWidth - 8,
        align: 'center',
        overflow: 'shrink',
      });
    });

    const buttonY = -height / 2 + 76;
    return new Promise<RewardPopupResult>((resolve) => {
      let settled = false;
      const settle = (result: RewardPopupResult): void => {
        if (settled) return;
        settled = true;
        if (result === 'double') {
          try {
            void opts.onDouble?.();
          } catch (err) {
            log.error('双倍领取回调异常', err);
          }
        }
        void modal.close();
        resolve(result);
      };
      // 弹窗被外部销毁时按「确定」处理（与 docs/04 默认自动发放基础奖励一致），避免 Promise 悬挂。
      modal.root.once(Node.EventType.NODE_DESTROYED, () => settle('confirm'));
      if (opts.doubleText) {
        button({
          parent: modal.content,
          size: { width: 240, height: 88 },
          position: [-132, buttonY],
          text: opts.doubleText,
          variant: 'green',
          onClick: () => settle('double'),
        });
        button({
          parent: modal.content,
          size: { width: 240, height: 88 },
          position: [132, buttonY],
          text: opts.confirmText ?? '确定',
          variant: 'primary',
          onClick: () => settle('confirm'),
        });
      } else {
        button({
          parent: modal.content,
          size: { width: 320, height: 88 },
          position: [0, buttonY],
          text: opts.confirmText ?? '确定',
          variant: 'primary',
          onClick: () => settle('confirm'),
        });
      }
      void modal.openIn();
    });
  }
}
