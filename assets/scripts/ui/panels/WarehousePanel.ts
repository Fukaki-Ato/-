import { Button, Color, Node } from 'cc';
import type { ItemConfig, ItemId } from '../../core/contracts';
import { formatNumber } from '../../core/framework/Utils';
import { applySprite } from '../framework/Assets';
import { AudioService } from '../framework/AudioService';
import { BasePanel } from '../framework/BasePanel';
import { GridList } from '../framework/GridList';
import { qualityColor, Theme } from '../framework/Theme';
import { type TabsView, divider, label, node, panelBg, tabs } from '../framework/UIKit';
import { ItemDetailPopup } from './ItemDetailPopup';
import { backButton, drawRoundRect } from './panelHelpers';

type WarehouseTabKey = 'all' | 'props' | 'material';

const WAREHOUSE_TABS: ReadonlyArray<{ key: WarehouseTabKey; text: string }> = [
  { key: 'all', text: '全部' },
  { key: 'props', text: '道具' },
  { key: 'material', text: '材料' },
];

const BADGE_COLOR = new Color(38, 30, 22, 190);

interface WarehouseEntry {
  id: ItemId;
  count: number;
  /** 配置缺失时为 null，卡片与详情按占位处理，不崩溃。 */
  config: ItemConfig | null;
}

/**
 * 仓库面板（docs/04 §3.5）：
 * 全部/道具/材料页签；数据来自 inventory.all() + items 配置；数量为 0 的条目不显示；
 * 品质边框、数量角标，点击打开 ItemDetailPopup；订阅 inventory.changed 刷新。
 */
export class WarehousePanel extends BasePanel {
  private tabIndex = 0;
  private tabsView: TabsView | null = null;
  private list: GridList<WarehouseEntry> | null = null;

  private readonly onInventoryChanged = (): void => {
    if (this.isOpen) this.reload();
  };

  protected override onCreate(): void {
    const bg = panelBg({ parent: this.node, size: { width: 700, height: 1500 } });

    backButton(bg, () => this.close()).setPosition(-290, 668, 0);
    label('仓库', {
      parent: bg,
      size: { width: 300, height: 76 },
      position: [0, 664],
      fontSize: Theme.fontSize.title,
      bold: true,
      align: 'center',
      overflow: 'shrink',
    });
    label('仅显示数量大于 0 的道具', {
      parent: bg,
      size: { width: 600, height: 36 },
      position: [0, 592],
      fontSize: 22,
      color: Theme.color.textSub,
      align: 'center',
      overflow: 'shrink',
    });
    divider({ parent: bg, width: 620, position: [0, 550] });

    this.tabsView = tabs({
      parent: bg,
      items: WAREHOUSE_TABS.map((item) => item.text),
      index: 0,
      width: 480,
      height: 76,
      gap: 12,
      position: [0, 488],
      onChange: (index) => {
        this.tabIndex = index;
        this.reload();
      },
    });

    this.list = new GridList<WarehouseEntry>({
      parent: bg,
      width: 660,
      height: 1150,
      cellWidth: 152,
      cellHeight: 186,
      columns: 4,
      gapX: 14,
      gapY: 18,
      padding: 12,
      emptyText: '仓库空空如也，去商店逛逛吧',
    });
    this.list.node.setPosition(0, -122, 0);

    this.ctx.events.on('inventory.changed', this.onInventoryChanged, this);
    this.node.once(Node.EventType.NODE_DESTROYED, () => this.ctx.events.offTarget(this));
  }

  protected override onOpen(): void {
    this.tabsView?.setActive(this.tabIndex, false);
    this.reload();
  }

  private reload(): void {
    if (!this.list) return;
    this.list.setData(this.entries(), (entry, cell) => this.renderCard(entry, cell));
  }

  /** 数量为 0 的条目不显示（inventory.all() 已过滤）；配置缺失的条目仍占位展示。 */
  private entries(): WarehouseEntry[] {
    const key = WAREHOUSE_TABS[this.tabIndex]?.key ?? 'all';
    return this.ctx.inventory
      .all()
      .map((stack) => ({ id: stack.id, count: stack.count, config: this.ctx.config.item(stack.id) ?? null }))
      .filter((entry) => {
        if (key === 'all') return true;
        const type = entry.config?.type;
        if (key === 'material') return type === 'material';
        // 道具页含消耗品/票券；配置缺失时归入道具便于发现异常。
        return type !== 'material';
      });
  }

  private renderCard(entry: WarehouseEntry, cell: Node): void {
    const name = entry.config?.name ?? entry.id;
    const qColor = qualityColor(entry.config?.quality ?? 1);
    const card = node('card', { parent: cell, size: { width: 148, height: 182 } });
    drawRoundRect(card, 148, 182, Theme.color.panel, 16, qColor, 3);

    const iconNode = node('icon', { parent: card, size: { width: 104, height: 104 }, position: [0, 34] });
    applySprite(iconNode, entry.config?.icon ?? '', {
      size: { width: 104, height: 104 },
      radius: Theme.radius.md,
      color: qColor,
      placeholderText: name ? name.slice(0, 1) : '?',
    });
    label(name, {
      parent: card,
      size: { width: 138, height: 28 },
      position: [0, -32],
      fontSize: 22,
      bold: true,
      align: 'center',
      overflow: 'shrink',
    });
    const badge = node('count', { parent: card, size: { width: 64, height: 30 }, position: [40, -68] });
    drawRoundRect(badge, 64, 30, BADGE_COLOR, 15);
    label(`x${formatNumber(entry.count)}`, {
      parent: badge,
      size: { width: 56, height: 26 },
      fontSize: 20,
      bold: true,
      color: Theme.color.sand,
      align: 'center',
      overflow: 'shrink',
    });

    const buttonComp = card.addComponent(Button);
    buttonComp.transition = Button.Transition.SCALE;
    buttonComp.target = card;
    buttonComp.zoomScale = 0.94;
    buttonComp.duration = 0.08;
    card.on(Button.EventType.CLICK, () => AudioService.playSfx(Theme.assets.sfxClick));
    card.on(Button.EventType.CLICK, () => void ItemDetailPopup.show(this.ctx, entry.id));
  }
}
