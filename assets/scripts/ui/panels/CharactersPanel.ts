import { Button, Color, Graphics, Label, Node, Tween, tween, v3 } from 'cc';
import type { CharacterAttrs, CharacterId, CharacterView, OpResult, ShopTab } from '../../core/contracts';
import { applySprite } from '../framework/Assets';
import { AudioService } from '../framework/AudioService';
import { BasePanel } from '../framework/BasePanel';
import { CurrencyBar } from '../framework/CurrencyBar';
import { GridList } from '../framework/GridList';
import { PanelManager } from '../framework/PanelManager';
import { qualityColor, Theme } from '../framework/Theme';
import { Toast } from '../framework/Toast';
import { type ButtonView, button, divider, label, node, panelBg } from '../framework/UIKit';
import { PANEL_NAMES } from './panelNames';
import { backButton, costLines, costLinesText, drawRoundRect, qualityName, reasonText } from './panelHelpers';

const ATTR_ROWS: ReadonlyArray<{ key: keyof CharacterAttrs; text: string }> = [
  { key: 'speed', text: '速度' },
  { key: 'jump', text: '跳跃' },
  { key: 'magnet', text: '磁铁' },
  { key: 'coinBonus', text: '金币加成' },
];

/** 连续点击保护窗口（毫秒），避免双击重复升级。 */
const ACTION_COOLDOWN_MS = 300;

type CharacterAction = 'unlock' | 'upgrade' | 'select' | 'none';

interface AttrRowRefs {
  value: Label;
  plus: Label;
}

interface DetailRefs {
  previewHost: Node;
  name: Label;
  qualityLevel: Label;
  desc: Label;
  attrs: AttrRowRefs[];
  hint: Label;
  /** 左按钮：使用 / 使用中（未解锁时隐藏）。 */
  action: ButtonView;
  /** 右按钮：解锁 / 升级 / 已满级。 */
  upgrade: ButtonView;
}

/**
 * 角色面板（docs/04 §3.6）：
 * 上方角色卡列表 + 下方详情（大图、描述、属性、等级）；按钮按状态切换
 * 解锁/升级/使用/使用中；操作统一走 character.unlock/upgrade/select。
 * 红点 menu.characters 由 core 规则决定，面板内不自行计算。
 */
export class CharactersPanel extends BasePanel {
  private focusId: CharacterId | null = null;
  private cards: GridList<CharacterView> | null = null;
  private detail: DetailRefs | null = null;
  private action: CharacterAction = 'none';
  private lastActionAt = 0;
  private lastActionKey = '';

  private readonly onCharacterChanged = (): void => {
    if (this.isOpen) this.refresh();
  };

  private readonly onDetailChanged = (): void => {
    if (this.isOpen) this.renderDetail();
  };

  protected override onCreate(): void {
    const bg = panelBg({ parent: this.node, size: { width: 700, height: 1500 } });

    backButton(bg, () => this.close()).setPosition(-290, 668, 0);
    label('角色', {
      parent: bg,
      size: { width: 300, height: 76 },
      position: [0, 664],
      fontSize: Theme.fontSize.title,
      bold: true,
      align: 'center',
      overflow: 'shrink',
    });
    new CurrencyBar(bg, this.ctx, {
      width: 440,
      goldPlus: () => this.openShop('gold'),
      diamondPlus: () => this.openShop('diamond'),
    }).node.setPosition(0, 574, 0);
    divider({ parent: bg, width: 620, position: [0, 518] });

    this.cards = new GridList<CharacterView>({
      parent: bg,
      width: 660,
      height: 250,
      cellWidth: 202,
      cellHeight: 222,
      columns: 3,
      gapX: 16,
      gapY: 12,
      padding: 5,
      emptyText: '暂无角色，敬请期待',
    });
    this.cards.node.setPosition(0, 380, 0);
    divider({ parent: bg, width: 620, position: [0, 240] });

    // 详情区：左立绘 + 右信息。
    const previewHost = node('previewHost', { parent: bg, size: { width: 246, height: 314 }, position: [-230, 40] });
    const infoX = 120;
    const infoW = 420;
    const name = label('', {
      parent: bg,
      size: { width: infoW, height: 56 },
      position: [infoX, 160],
      fontSize: 38,
      bold: true,
      align: 'left',
      overflow: 'shrink',
    }).getComponent(Label)!;
    const qualityLevel = label('', {
      parent: bg,
      size: { width: infoW, height: 34 },
      position: [infoX, 116],
      fontSize: 24,
      align: 'left',
      overflow: 'shrink',
    }).getComponent(Label)!;
    const desc = label('', {
      parent: bg,
      size: { width: infoW, height: 76 },
      position: [infoX, 66],
      fontSize: 22,
      color: Theme.color.textSub,
      maxWidth: infoW,
      align: 'left',
      overflow: 'clamp',
    }).getComponent(Label)!;

    const attrs: AttrRowRefs[] = [];
    ATTR_ROWS.forEach((row, index) => {
      const rowNode = node(`attr_${row.key}`, { parent: bg, size: { width: infoW, height: 38 }, position: [infoX, 6 - index * 44] });
      label(row.text, {
        parent: rowNode,
        size: { width: 160, height: 34 },
        anchor: [0, 0.5],
        position: [-infoW / 2, 0],
        fontSize: 24,
        color: Theme.color.textSub,
        align: 'left',
        overflow: 'shrink',
      });
      const value = label('0', {
        parent: rowNode,
        size: { width: 130, height: 34 },
        position: [30, 0],
        fontSize: 26,
        bold: true,
        align: 'right',
        overflow: 'shrink',
      }).getComponent(Label)!;
      const plus = label('', {
        parent: rowNode,
        size: { width: 100, height: 34 },
        position: [150, 0],
        fontSize: 22,
        color: Theme.color.btnGreen,
        align: 'left',
        overflow: 'shrink',
      }).getComponent(Label)!;
      attrs.push({ value, plus });
    });

    const hint = label('', {
      parent: bg,
      size: { width: 640, height: 40 },
      position: [0, -230],
      fontSize: 24,
      color: Theme.color.textSub,
      align: 'center',
      overflow: 'shrink',
    }).getComponent(Label)!;
    const action = button({
      parent: bg,
      size: { width: 240, height: 96 },
      position: [-128, -330],
      text: '使用',
      variant: 'primary',
      fontSize: 32,
      onClick: () => this.onUseAction(),
    });
    const upgrade = button({
      parent: bg,
      size: { width: 240, height: 96 },
      position: [128, -330],
      text: '升级',
      variant: 'green',
      fontSize: 32,
      onClick: () => this.onUpgradeAction(),
    });
    label('解锁/升级消耗金币或钻石，属性在下一局生效。', {
      parent: bg,
      size: { width: 640, height: 36 },
      position: [0, -430],
      fontSize: 22,
      color: Theme.color.textSub,
      align: 'center',
      overflow: 'shrink',
    });

    this.detail = { previewHost, name, qualityLevel, desc, attrs, hint, action, upgrade };

    this.ctx.events.on('character.changed', this.onCharacterChanged, this);
    this.ctx.events.on('currency.changed', this.onDetailChanged, this);
    this.ctx.events.on('inventory.changed', this.onDetailChanged, this);
    this.node.once(Node.EventType.NODE_DESTROYED, () => this.ctx.events.offTarget(this));
  }

  protected override onOpen(): void {
    const views = this.ctx.character.list();
    if (!this.focusId || !views.some((view) => view.config.id === this.focusId)) {
      this.focusId = views.find((view) => view.selected)?.config.id ?? views[0]?.config.id ?? null;
    }
    this.refresh();
  }

  // -------------------------------------------------------------------------
  // 渲染
  // -------------------------------------------------------------------------

  private refresh(): void {
    this.renderCards();
    this.renderDetail();
  }

  private renderCards(): void {
    if (!this.cards) return;
    const views = this.ctx.character.list();
    this.cards.setData(views, (view, cell) => this.renderCard(view, cell));
  }

  private renderCard(view: CharacterView, cell: Node): void {
    const config = view.config;
    const focused = this.focusId === config.id;
    const qColor = qualityColor(config.quality);
    const card = node('card', { parent: cell, size: { width: 198, height: 218 } });
    drawRoundRect(card, 198, 218, Theme.color.panel, 18, focused ? Theme.color.gold : qColor, focused ? 5 : 3);

    const iconNode = node('icon', { parent: card, size: { width: 118, height: 118 }, position: [0, 38] });
    applySprite(iconNode, config.icon, {
      size: { width: 118, height: 118 },
      radius: Theme.radius.md,
      color: qColor,
      placeholderText: config.name ? config.name.slice(0, 1) : '?',
    });
    label(config.name, {
      parent: card,
      size: { width: 184, height: 34 },
      position: [0, -38],
      fontSize: 26,
      bold: true,
      align: 'center',
      overflow: 'shrink',
    });
    const status = view.selected ? '使用中' : view.unlocked ? `Lv.${view.level}` : '未解锁';
    const statusColor = view.selected ? Theme.color.btnGreen : view.unlocked ? Theme.color.textSub : Theme.color.red;
    label(status, {
      parent: card,
      size: { width: 184, height: 30 },
      position: [0, -72],
      fontSize: 22,
      color: statusColor,
      align: 'center',
      overflow: 'shrink',
    });

    const buttonComp = card.addComponent(Button);
    buttonComp.transition = Button.Transition.SCALE;
    buttonComp.target = card;
    buttonComp.zoomScale = 0.95;
    buttonComp.duration = 0.08;
    card.on(Button.EventType.CLICK, () => AudioService.playSfx(Theme.assets.sfxClick));
    card.on(Button.EventType.CLICK, () => this.focus(config.id));
  }

  private focus(id: CharacterId): void {
    if (this.focusId === id) return;
    this.focusId = id;
    this.renderCards();
    this.renderDetail();
  }

  private focusView(): CharacterView | undefined {
    if (!this.focusId) return undefined;
    return this.ctx.character.list().find((view) => view.config.id === this.focusId);
  }

  private renderDetail(): void {
    const refs = this.detail;
    if (!refs) return;
    const view = this.focusView();
    if (!view) {
      this.clearPreview();
      refs.name.string = '请选择角色';
      refs.qualityLevel.string = '';
      refs.desc.string = '点击上方角色卡查看详情。';
      for (const row of refs.attrs) {
        row.value.string = '-';
        row.plus.string = '';
      }
      refs.hint.string = '';
      refs.action.node.active = false;
      refs.upgrade.setText('—');
      refs.upgrade.setInteractable(false);
      this.action = 'none';
      return;
    }

    const config = view.config;
    const qColor = qualityColor(config.quality);
    this.renderPreview(config.preview || config.icon, config.name, qColor);

    refs.name.string = config.name;
    refs.qualityLevel.string = `${qualityName(config.quality)}${view.unlocked ? ` · Lv.${view.level}` : ' · 未解锁'}`;
    refs.qualityLevel.color = qColor;
    refs.desc.string = config.desc;

    const maxLevel = config.upgrade.maxLevel;
    const canPreviewNext = view.unlocked && view.level < maxLevel;
    ATTR_ROWS.forEach((row, index) => {
      const rowRefs = refs.attrs[index];
      rowRefs.value.string = String(view.attrs[row.key]);
      const growth = config.upgrade.growth[row.key] ?? 0;
      rowRefs.plus.string = canPreviewNext && growth > 0 ? `+${growth}` : '';
    });

    let hint = '';
    let hintColor = Theme.color.textSub;
    let action: CharacterAction = 'none';
    let useText = '使用';
    let useEnabled = false;
    let showUse = false;
    let upgradeText = '升级';
    let upgradeEnabled = false;

    if (!view.unlocked) {
      if (config.unlock.type === 'condition') {
        upgradeText = '条件未解锁';
        hint = `锁定原因：${config.unlock.condition || '暂未开放'}`;
        hintColor = Theme.color.red;
      } else {
        action = 'unlock';
        upgradeText = '解锁';
        let text = `解锁费用：${costLinesText(costLines(this.ctx, view.unlockCost))}`;
        if (config.unlock.type === 'item') {
          const lines = costLines(this.ctx, view.unlockCost);
          const itemId = config.unlock.itemId ?? lines.find((line) => line.kind === 'item')?.itemId;
          if (itemId) text += `（拥有 ${this.ctx.inventory.count(itemId)}）`;
        }
        upgradeEnabled = view.canUnlock;
        if (!view.canUnlock) {
          text += '（资源不足）';
          hintColor = Theme.color.red;
        }
        hint = text;
      }
    } else {
      showUse = true;
      useText = view.selected ? '使用中' : '使用';
      useEnabled = !view.selected;
      if (view.level < maxLevel) {
        action = 'upgrade';
        upgradeText = '升级';
        let text = `升级费用：${costLinesText(costLines(this.ctx, view.upgradeCost))}（Lv.${view.level} → Lv.${view.level + 1}）`;
        upgradeEnabled = view.canUpgrade;
        if (!view.canUpgrade) {
          text += '（资源不足）';
          hintColor = Theme.color.red;
        }
        hint = text;
      } else {
        upgradeText = '已满级';
        hint = `已满级（Lv.${view.level}）`;
      }
    }

    this.action = action;
    refs.hint.string = hint;
    refs.hint.color = hintColor;
    refs.action.node.active = showUse;
    refs.action.setText(useText);
    refs.action.setInteractable(useEnabled);
    refs.upgrade.node.setPosition(showUse ? 128 : 0, -330, 0);
    refs.upgrade.setText(upgradeText);
    refs.upgrade.setInteractable(upgradeEnabled);
  }

  private renderPreview(path: string, name: string, qColor: Color): void {
    const refs = this.detail;
    if (!refs) return;
    this.clearPreview();
    const preview = node('preview', { parent: refs.previewHost, size: { width: 238, height: 306 } });
    applySprite(preview, path, {
      size: { width: 238, height: 306 },
      radius: Theme.radius.lg,
      color: qColor,
      placeholderText: name ? name.slice(0, 1) : '?',
    });
    const frame = node('frame', { parent: refs.previewHost, size: { width: 246, height: 314 } });
    const graphics = frame.addComponent(Graphics);
    graphics.strokeColor = qColor;
    graphics.lineWidth = 4;
    graphics.roundRect(-123, -157, 246, 314, Theme.radius.lg);
    graphics.stroke();
  }

  private clearPreview(): void {
    const host = this.detail?.previewHost;
    if (!host) return;
    for (const child of host.children.slice()) {
      child.removeFromParent();
      child.destroy();
    }
  }

  // -------------------------------------------------------------------------
  // 操作
  // -------------------------------------------------------------------------

  /** 左按钮：选择出战（已解锁且未选中时可用）。 */
  private onUseAction(): void {
    const view = this.focusView();
    if (!view || !view.unlocked || view.selected) return;
    if (!this.beginAction(`select:${view.config.id}`)) return;
    this.afterAction(this.ctx.character.select(view.config.id), view, 'select');
  }

  /** 右按钮：解锁 / 升级（防连点：同一角色同一操作 300ms 内忽略）。 */
  private onUpgradeAction(): void {
    const view = this.focusView();
    if (!view) return;
    if (this.action !== 'unlock' && this.action !== 'upgrade') return;
    if (!this.beginAction(`${this.action}:${view.config.id}`)) return;
    const result =
      this.action === 'unlock' ? this.ctx.character.unlock(view.config.id) : this.ctx.character.upgrade(view.config.id);
    this.afterAction(result, view, this.action);
  }

  private beginAction(key: string): boolean {
    const now = this.ctx.clock.now();
    if (this.lastActionKey === key && now - this.lastActionAt < ACTION_COOLDOWN_MS) return false;
    this.lastActionAt = now;
    this.lastActionKey = key;
    return true;
  }

  private afterAction(result: OpResult, view: CharacterView, kind: CharacterAction): void {
    if (!result.ok) {
      AudioService.playSfx(Theme.assets.sfxError);
      Toast.show(this.failText(result.reason, view));
      return;
    }
    AudioService.playSfx(Theme.assets.sfxReward);
    const name = view.config.name;
    if (kind === 'unlock') Toast.show(`已解锁「${name}」`);
    else if (kind === 'upgrade') Toast.show(`「${name}」升至 Lv.${view.level + 1}`);
    else Toast.show(`已选择「${name}」`);
    this.playPop();
  }

  private failText(reason: string | undefined, view: CharacterView): string {
    if (reason === 'insufficient') {
      const cost = view.unlocked ? view.upgradeCost : view.unlockCost;
      if (cost?.diamond !== undefined && cost.gold === undefined) return '钻石不足';
      if (cost?.gold !== undefined) return '金币不足';
      return '资源不足';
    }
    if (reason === 'locked') return '尚未满足解锁条件';
    if (reason === 'max_level') return '已满级';
    return reasonText(reason);
  }

  private playPop(): void {
    const target = this.detail?.previewHost;
    if (!target) return;
    Tween.stopAllByTarget(target);
    target.setScale(1, 1, 1);
    tween(target)
      .to(0.09, { scale: v3(1.06, 1.06, 1) })
      .to(0.09, { scale: v3(1, 1, 1) })
      .start();
  }

  private openShop(tab: ShopTab): void {
    if (PanelManager.has(PANEL_NAMES.shop)) {
      void PanelManager.open(PANEL_NAMES.shop, { tab });
      return;
    }
    Toast.show('商店开发中');
  }
}
