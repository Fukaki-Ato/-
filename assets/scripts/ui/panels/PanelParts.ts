import { Button, Color, Graphics, Node } from 'cc';
import type { IGameContext, RewardBundle } from '../../core/contracts';
import { formatNumber } from '../../core/framework/Utils';
import { applySprite } from '../framework/Assets';
import { AudioService } from '../framework/AudioService';
import { RewardPopup } from '../framework/RewardPopup';
import { Theme } from '../framework/Theme';
import { type ButtonVariant, type ButtonView, button, divider, label, node, panelBg, progressBar } from '../framework/UIKit';

/** S07 三个面板统一的面板底尺寸（750×1624 设计分辨率下的居中大板）。 */
export const PANEL_SIZE = { width: 690, height: 1210 } as const;

export interface PanelHeaderView {
  bg: Node;
  /** 标题节点：调用方可绑定红点。 */
  titleNode: Node;
}

/**
 * 面板统一头部：底板 + 标题 + 分隔线 + 底部返回按钮。
 * 内容区约定：y ∈ [-490, 480]（页签 440、底部返回 -540）。
 */
export function buildPanelHeader(root: Node, title: string, onBack: () => void): PanelHeaderView {
  const bg = panelBg({ parent: root, size: { ...PANEL_SIZE } });
  const titleNode = label(title, {
    parent: bg,
    size: { width: 560, height: 64 },
    position: [0, 528],
    fontSize: Theme.fontSize.subtitle,
    bold: true,
    align: 'center',
    overflow: 'shrink',
  });
  divider({ parent: bg, width: 600, position: [0, 488] });
  button({
    parent: bg,
    size: { width: 360, height: 88 },
    position: [0, -540],
    text: '返回',
    variant: 'secondary',
    onClick: onBack,
  });
  return { bg, titleNode };
}

// ---------------------------------------------------------------------------
// 任务 / 成就行卡片
// ---------------------------------------------------------------------------

const ROW_BG = new Color(255, 251, 241, 255);
const ROW_BORDER = new Color(233, 206, 162, 255);

export interface ProgressRowAction {
  text: string;
  variant: ButtonVariant;
  enabled: boolean;
  onClick(view: ButtonView): void;
}

export interface ProgressRowOptions {
  ctx: IGameContext;
  width: number;
  height: number;
  name: string;
  desc: string;
  progress: number;
  target: number;
  reward: RewardBundle;
  /** 完成态由服务视图传入（claimable || claimed），UI 不自行计算。 */
  completed: boolean;
  /** 左侧图标（如成就勋章）；缺省不渲染。 */
  icon?: { path: string; placeholderText?: string; color?: Color };
  action: ProgressRowAction;
}

/** 任务/成就通用行卡片：名称+描述、进度条 x/y、可点击奖励预览、右侧操作按钮。 */
export function buildProgressRow(cell: Node, opts: ProgressRowOptions): void {
  const { ctx, width, height } = opts;
  const g = cell.getComponent(Graphics) ?? cell.addComponent(Graphics);
  g.clear();
  const radius = Theme.radius.md;
  g.fillColor = ROW_BG;
  g.roundRect(-width / 2, -height / 2, width, height, radius);
  g.fill();
  g.strokeColor = ROW_BORDER;
  g.lineWidth = 2;
  g.roundRect(-width / 2, -height / 2, width, height, radius);
  g.stroke();

  const left = -width / 2 + 18;
  let textLeft = left;
  if (opts.icon) {
    const iconSize = 84;
    const iconNode = node('icon', { parent: cell, size: { width: iconSize, height: iconSize }, position: [left + iconSize / 2, 4] });
    applySprite(iconNode, opts.icon.path, {
      size: { width: iconSize, height: iconSize },
      radius: Theme.radius.md,
      color: opts.icon.color,
      placeholderText: opts.icon.placeholderText,
    });
    textLeft = left + iconSize + 14;
  }

  label(opts.name, {
    parent: cell,
    size: { width: 300, height: 36 },
    anchor: [0, 0.5],
    position: [textLeft, 44],
    fontSize: Theme.fontSize.body,
    bold: true,
    align: 'left',
    overflow: 'shrink',
  });
  label(opts.desc, {
    parent: cell,
    size: { width: 320, height: 30 },
    anchor: [0, 0.5],
    position: [textLeft, 12],
    fontSize: Theme.fontSize.tiny,
    color: Theme.color.textSub,
    align: 'left',
    overflow: 'shrink',
  });

  const barWidth = 220;
  const completed = opts.completed;
  const bar = progressBar({ parent: cell, width: barWidth, height: 14, position: [left + barWidth / 2, -38] });
  bar.setProgress(opts.target > 0 ? opts.progress / opts.target : 0);
  label(`${formatNumber(opts.progress)}/${formatNumber(opts.target)}`, {
    parent: cell,
    size: { width: 112, height: 30 },
    anchor: [0, 0.5],
    position: [left + barWidth + 10, -38],
    fontSize: Theme.fontSize.small,
    color: completed ? Theme.color.btnGreen : Theme.color.textSub,
    bold: completed,
    align: 'left',
    overflow: 'shrink',
  });

  renderRewardPreview(cell, ctx, opts);

  const actionView: ButtonView = button({
    parent: cell,
    size: { width: 150, height: 76 },
    position: [width / 2 - 93, -38],
    text: opts.action.text,
    variant: opts.action.variant,
    fontSize: Theme.fontSize.body,
    onClick: () => opts.action.onClick(actionView),
  });
  actionView.setInteractable(opts.action.enabled);
}

/** 奖励预览（最多 3 项）：图标+数量，整块可点击查看 RewardPopup 详情。 */
function renderRewardPreview(cell: Node, ctx: IGameContext, opts: ProgressRowOptions): void {
  const displays = ctx.reward.describe(opts.reward).slice(0, 3);
  const centerX = opts.width / 2 - 100;
  const step = 62;
  const startX = centerX - ((displays.length - 1) * step) / 2;
  displays.forEach((display, index) => {
    const item = node('reward', { parent: cell, size: { width: 56, height: 74 }, position: [startX + index * step, 32] });
    const iconNode = node('icon', { parent: item, size: { width: 52, height: 52 }, position: [0, 10] });
    applySprite(iconNode, display.icon, {
      size: { width: 52, height: 52 },
      radius: Theme.radius.sm,
      placeholderText: display.name ? display.name.slice(0, 1) : '',
    });
    label(`x${formatNumber(display.count)}`, {
      parent: item,
      size: { width: 56, height: 24 },
      position: [0, -26],
      fontSize: Theme.fontSize.tiny,
      align: 'center',
      overflow: 'shrink',
    });
    const hit = item.addComponent(Button);
    hit.transition = Button.Transition.NONE;
    item.on(Button.EventType.CLICK, () => {
      AudioService.playSfx(Theme.assets.sfxClick);
      void RewardPopup.show(ctx.reward.describe(opts.reward), { title: opts.name });
    });
  });
}
