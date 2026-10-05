import { Graphics, isValid, Label, Node } from 'cc';
import type { IGameContext, ItemConfig, ItemId } from '../../core/contracts';
import { formatNumber } from '../../core/framework/Utils';
import { applySprite } from '../framework/Assets';
import { AudioService } from '../framework/AudioService';
import { createModal } from '../framework/Modal';
import { RewardPopup } from '../framework/RewardPopup';
import { qualityColor, Theme } from '../framework/Theme';
import { Toast } from '../framework/Toast';
import { type ButtonView, button, divider, label, node } from '../framework/UIKit';
import { gainText, qualityName, reasonText } from './panelHelpers';

const TYPE_NAMES: Record<string, string> = {
  consumable: '消耗品',
  material: '材料',
  ticket: '票券',
};

/** 菜单内可用：有 useEffect，且 runBuff 类需 useTargets 含 'menu'。 */
function menuUsable(config: ItemConfig | undefined): boolean {
  if (!config?.useEffect) return false;
  if (config.useEffect.kind === 'runBuff') return config.useTargets?.includes('menu') === true;
  return true;
}

/** 仅局内可用（当前仅 run 的道具均为 runBuff）。 */
function runOnly(config: ItemConfig | undefined): boolean {
  return !!config?.useEffect && !menuUsable(config);
}

function usageText(ctx: IGameContext, config: ItemConfig | undefined): string {
  if (!config?.useEffect) return '用途：材料，暂无使用效果。';
  const effect = config.useEffect;
  if (effect.kind === 'grant') return `用途：使用后立即获得 ${gainText(ctx, effect.reward)}。`;
  if (effect.kind === 'runBuff') {
    return config.useTargets?.includes('menu') ? '用途：使用后下局生效。' : '用途：局内使用。';
  }
  const name = ctx.config.character(effect.id)?.name ?? effect.id;
  return `用途：使用后解锁角色「${name}」。`;
}

function useFailText(reason: string | undefined): string {
  if (reason === 'insufficient') return '道具数量不足';
  if (reason === 'already_claimed') return '角色已解锁';
  if (reason === 'locked') return '解锁条件未满足';
  if (reason === 'unsupported') return '该道具当前不可使用';
  return reasonText(reason);
}

/**
 * 道具详情弹窗（docs/04 §3.5）：
 * 图标/名称/品质/描述/用途 + 使用按钮；走 IGameContext.useItem，不直接操作存档。
 * 独立于面板注册表创建（Modal 外壳），可从仓库等处调用。
 */
export class ItemDetailPopup {
  static show(ctx: IGameContext, itemId: ItemId): Promise<void> {
    const config = ctx.config.item(itemId);
    const width = 620;
    const height = 920;
    const modal = createModal({ width, height, closeOnBackdrop: true });
    const content = modal.content;

    const title = config?.name ?? itemId;
    const quality = config?.quality ?? 1;
    const qColor = qualityColor(quality);
    const typeName = config ? TYPE_NAMES[config.type] ?? config.type : '未知';

    const iconSize = 190;
    const iconY = height / 2 - 150;
    const iconNode = node('icon', { parent: content, size: { width: iconSize, height: iconSize }, position: [0, iconY] });
    applySprite(iconNode, config?.icon ?? '', {
      size: { width: iconSize, height: iconSize },
      radius: Theme.radius.lg,
      color: qColor,
      placeholderText: title ? title.slice(0, 1) : '?',
    });
    const frame = node('frame', { parent: content, size: { width: iconSize + 10, height: iconSize + 10 }, position: [0, iconY] });
    const frameGraphics = frame.addComponent(Graphics);
    frameGraphics.strokeColor = qColor;
    frameGraphics.lineWidth = 4;
    frameGraphics.roundRect(-(iconSize + 10) / 2, -(iconSize + 10) / 2, iconSize + 10, iconSize + 10, Theme.radius.lg);
    frameGraphics.stroke();

    label(title, {
      parent: content,
      size: { width: 540, height: 50 },
      position: [0, 165],
      fontSize: 36,
      bold: true,
      align: 'center',
      overflow: 'shrink',
    });
    label(`${qualityName(quality)} · ${typeName}`, {
      parent: content,
      size: { width: 540, height: 34 },
      position: [0, 120],
      fontSize: 24,
      color: qColor,
      align: 'center',
      overflow: 'shrink',
    });
    divider({ parent: content, width: 540, position: [0, 95] });
    label(config?.desc ?? '道具配置缺失，仅作占位展示。', {
      parent: content,
      size: { width: 540, height: 90 },
      position: [0, 40],
      fontSize: 24,
      color: Theme.color.textSub,
      maxWidth: 540,
      align: 'center',
      overflow: 'clamp',
    });
    label(usageText(ctx, config), {
      parent: content,
      size: { width: 540, height: 80 },
      position: [0, -70],
      fontSize: 22,
      color: Theme.color.textSub,
      maxWidth: 540,
      align: 'center',
      overflow: 'clamp',
    });

    const countLabel = label(`拥有 x${formatNumber(ctx.inventory.count(itemId))}`, {
      parent: content,
      size: { width: 300, height: 36 },
      position: [0, -152],
      fontSize: 24,
      bold: true,
      align: 'center',
      overflow: 'shrink',
    }).getComponent(Label)!;

    // 底部按钮：使用（menu 可用）/ 禁用「局内使用」/ 材料标签 + 关闭。
    const buttonY = -360;
    let useButton: ButtonView | null = null;
    if (menuUsable(config)) {
      useButton = button({
        parent: content,
        size: { width: 240, height: 88 },
        position: [-124, buttonY],
        text: '使用',
        variant: 'green',
        onClick: () => this.use(ctx, itemId, config, modal.close, useButton),
      });
      useButton.setInteractable(ctx.inventory.count(itemId) > 0);
    } else if (runOnly(config)) {
      useButton = button({
        parent: content,
        size: { width: 240, height: 88 },
        position: [-124, buttonY],
        text: '局内使用',
        variant: 'secondary',
        onClick: () => {},
      });
      useButton.setInteractable(false);
    } else {
      label('材料', {
        parent: content,
        size: { width: 240, height: 60 },
        position: [-124, buttonY],
        fontSize: 28,
        color: Theme.color.textDisabled,
        align: 'center',
        overflow: 'shrink',
      });
    }
    button({
      parent: content,
      size: { width: 240, height: 88 },
      position: [124, buttonY],
      text: '关闭',
      variant: 'primary',
      onClick: () => {
        void modal.close();
      },
    });

    // 数量变化（如其他入口使用）时同步；弹窗销毁即解绑。
    const canUseInMenu = menuUsable(config);
    const onInventoryChanged = (): void => {
      const count = ctx.inventory.count(itemId);
      if (isValid(countLabel.node)) countLabel.string = `拥有 x${formatNumber(count)}`;
      if (canUseInMenu) useButton?.setInteractable(count > 0);
    };
    ctx.events.on('inventory.changed', onInventoryChanged);

    return new Promise<void>((resolve) => {
      let settled = false;
      const settle = (): void => {
        if (settled) return;
        settled = true;
        ctx.events.off('inventory.changed', onInventoryChanged);
        resolve();
      };
      modal.root.once(Node.EventType.NODE_DESTROYED, settle);
      void modal.openIn();
    });
  }

  private static use(
    ctx: IGameContext,
    itemId: ItemId,
    config: ItemConfig | undefined,
    close: () => Promise<void>,
    buttonView: ButtonView | null,
  ): void {
    const result = ctx.useItem(itemId);
    if (!result.ok) {
      AudioService.playSfx(Theme.assets.sfxError);
      Toast.show(useFailText(result.reason));
      return;
    }
    AudioService.playSfx(Theme.assets.sfxReward);
    if (buttonView) buttonView.setInteractable(false);
    void close().then(() => {
      const effect = config?.useEffect;
      if (!effect) return;
      if (effect.kind === 'runBuff') {
        Toast.show('已激活，下局生效');
        return;
      }
      if (effect.kind === 'grant') {
        void RewardPopup.show(ctx.reward.describe(effect.reward), { title: '使用成功' });
        return;
      }
      const character = ctx.config.character(effect.id);
      if (character) {
        void RewardPopup.show(
          [{ kind: 'character', id: character.id, name: character.name, icon: character.icon, count: 1 }],
          { title: '解锁成功' },
        );
      } else {
        Toast.show('角色已解锁');
      }
    });
  }
}
