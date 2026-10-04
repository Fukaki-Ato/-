/**
 * S06 经济面板（商店/仓库/角色）共享的展示辅助。
 * 仅做文案与基础绘制，不缓存业务状态、不直接读写存档（数据一律来自 IGameContext 服务）。
 */
import { Color, Graphics, Node } from 'cc';
import type { Cost, CurrencyType, IGameContext, RewardBundle, ShopGoodsConfig } from '../../core/contracts';
import { formatNumber } from '../../core/framework/Utils';
import { Theme } from '../framework/Theme';
import { button } from '../framework/UIKit';

const QUALITY_NAMES: Record<number, string> = {
  1: '普通',
  2: '优秀',
  3: '精良',
  4: '史诗',
  5: '传说',
};

const REASON_TEXT: Record<string, string> = {
  not_found: '内容不存在',
  insufficient: '资源不足',
  sold_out: '已售罄',
  limit: '今日次数已用完',
  locked: '尚未满足条件',
  expired: '已过期',
  already_claimed: '已领取过了',
  unsupported: '当前不可使用',
  max_level: '已满级',
  not_implemented: '暂未开放',
};

export function qualityName(quality: number): string {
  return QUALITY_NAMES[Math.round(quality)] ?? QUALITY_NAMES[1];
}

export function reasonText(reason?: string): string {
  if (!reason) return '操作失败';
  return REASON_TEXT[reason] ?? '操作失败';
}

export function currencyName(type: CurrencyType): string {
  return type === 'gold' ? '金币' : '钻石';
}

export function currencyIcon(type: CurrencyType): string {
  return type === 'gold' ? Theme.assets.iconGold : Theme.assets.iconDiamond;
}

export function currencyColor(type: CurrencyType): Color {
  return type === 'gold' ? Theme.color.gold : Theme.color.diamond;
}

/** 商品价格短文案（不含货币名）：免费 / ¥6.00 / 1000。 */
export function priceShort(price: ShopGoodsConfig['price']): string {
  if (!price) return '免费';
  if (price.currency === 'CNY') return `¥${(price.amount / 100).toFixed(2)}`;
  return formatNumber(price.amount);
}

/** 商品价格完整文案：免费 / ¥6.00 / 1000 金币。 */
export function priceFull(price: ShopGoodsConfig['price']): string {
  if (!price) return '免费';
  if (price.currency === 'CNY') return `¥${(price.amount / 100).toFixed(2)}`;
  return `${formatNumber(price.amount)} ${currencyName(price.currency)}`;
}

export interface CostLine {
  kind: 'gold' | 'diamond' | 'item';
  name: string;
  icon: string;
  count: number;
  itemId?: string;
}

/** 费用拆分为可逐行/拼接渲染的条目（货币在前，道具按配置顺序）。 */
export function costLines(ctx: IGameContext, cost: Cost | undefined): CostLine[] {
  const lines: CostLine[] = [];
  if (!cost) return lines;
  if (cost.gold !== undefined) {
    lines.push({ kind: 'gold', name: '金币', icon: Theme.assets.iconGold, count: cost.gold });
  }
  if (cost.diamond !== undefined) {
    lines.push({ kind: 'diamond', name: '钻石', icon: Theme.assets.iconDiamond, count: cost.diamond });
  }
  for (const stack of cost.items ?? []) {
    if (!stack || !(stack.count > 0)) continue;
    const item = ctx.config.item(stack.id);
    lines.push({ kind: 'item', name: item?.name ?? stack.id, icon: item?.icon ?? '', count: stack.count, itemId: stack.id });
  }
  return lines;
}

export function costLinesText(lines: readonly CostLine[]): string {
  if (lines.length === 0) return '免费';
  return lines
    .map((line) => (line.kind === 'item' ? `${line.name} x${formatNumber(line.count)}` : `${formatNumber(line.count)} ${line.name}`))
    .join(' + ');
}

/** 奖励内容文案：金币 x200、磁铁 x1、角色「月见」。 */
export function gainText(ctx: IGameContext, reward?: RewardBundle): string {
  if (!reward) return '奖励';
  const parts: string[] = [];
  if (reward.gold !== undefined && reward.gold > 0) parts.push(`金币 x${formatNumber(reward.gold)}`);
  if (reward.diamond !== undefined && reward.diamond > 0) parts.push(`钻石 x${formatNumber(reward.diamond)}`);
  for (const stack of reward.items ?? []) {
    if (!stack || !(stack.count > 0)) continue;
    const item = ctx.config.item(stack.id);
    parts.push(`${item?.name ?? stack.id} x${formatNumber(stack.count)}`);
  }
  for (const id of reward.characters ?? []) {
    if (!id) continue;
    parts.push(`角色「${ctx.config.character(id)?.name ?? id}」`);
  }
  return parts.length > 0 ? parts.join('、') : '奖励';
}

/** 面板左上角返回按钮（位置由调用方设置）。 */
export function backButton(parent: Node, onClick: () => void): Node {
  return button({
    parent,
    size: { width: 112, height: 64 },
    text: '返回',
    variant: 'secondary',
    fontSize: Theme.fontSize.small,
    onClick,
  }).node;
}

/** 圆角矩形：可选描边，用于卡片底/品质边框。 */
export function drawRoundRect(
  target: Node,
  width: number,
  height: number,
  color: Color,
  radius: number,
  stroke?: Color,
  lineWidth = 3,
): void {
  const g = target.getComponent(Graphics) ?? target.addComponent(Graphics);
  const r = Math.min(radius, Math.min(width, height) / 2);
  g.fillColor = color;
  g.roundRect(-width / 2, -height / 2, width, height, r);
  g.fill();
  if (stroke) {
    g.strokeColor = stroke;
    g.lineWidth = lineWidth;
    g.roundRect(-width / 2, -height / 2, width, height, r);
    g.stroke();
  }
}
