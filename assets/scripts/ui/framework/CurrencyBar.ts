import { Color, isValid, Label, Node } from 'cc';
import type { IGameContext } from '../../core/contracts';
import { formatNumber } from '../../core/framework/Utils';
import { applySprite } from './Assets';
import { Theme } from './Theme';
import { Toast } from './Toast';
import { button, label, node } from './UIKit';

export interface CurrencyBarOptions {
  goldPlus?: () => void;
  diamondPlus?: () => void;
  showPlus?: boolean;
  width?: number;
}

/** 金币/钻石显示条：订阅 currency.changed 实时刷新，数字走 formatNumber。 */
export class CurrencyBar {
  readonly node: Node;

  private readonly ctx: IGameContext;
  private readonly goldLabel: Label;
  private readonly diamondLabel: Label;
  private readonly onCurrencyChanged = (): void => this.refresh();

  constructor(parent: Node, ctx: IGameContext, opts: CurrencyBarOptions = {}) {
    this.ctx = ctx;
    const width = opts.width ?? 440;
    const height = 60;
    this.node = node('CurrencyBar', { parent, size: { width, height } });

    const group = (centerX: number, icon: string, fallback: Color, plus?: () => void): Label => {
      const iconNode = node('icon', { parent: this.node, size: { width: 42, height: 42 }, position: [centerX - 68, 0] });
      applySprite(iconNode, icon, { size: { width: 42, height: 42 }, radius: Theme.radius.sm, color: fallback });
      const text = label('0', {
        parent: this.node,
        size: { width: 108, height },
        position: [centerX + 2, 0],
        fontSize: Theme.fontSize.small,
        align: 'left',
        overflow: 'shrink',
      }).getComponent(Label)!;
      if (opts.showPlus !== false) {
        button({
          parent: this.node,
          size: { width: 44, height: 44 },
          position: [centerX + 74, 0],
          variant: 'green',
          text: '+',
          fontSize: 34,
          onClick: plus ?? (() => Toast.show('商店开发中')),
        });
      }
      return text;
    };

    this.goldLabel = group(-110, Theme.assets.iconGold, Theme.color.gold, opts.goldPlus);
    this.diamondLabel = group(110, Theme.assets.iconDiamond, Theme.color.diamond, opts.diamondPlus);
    ctx.events.on('currency.changed', this.onCurrencyChanged, this);
    this.node.once(Node.EventType.NODE_DESTROYED, () => {
      ctx.events.offTarget(this);
    });
    this.refresh();
  }

  refresh(): void {
    const gold = this.ctx.currency.get('gold');
    const diamond = this.ctx.currency.get('diamond');
    if (isValid(this.goldLabel.node)) this.goldLabel.string = formatNumber(gold);
    if (isValid(this.diamondLabel.node)) this.diamondLabel.string = formatNumber(diamond);
  }
}
