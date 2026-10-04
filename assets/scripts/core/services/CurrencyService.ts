import {
  CURRENCY_MAX,
  FailReason,
  type Cost,
  type CurrencyType,
  type ICurrencyService,
  type IInventoryService,
  type ItemId,
  type ItemStack,
  type OpResult,
  type ServiceDeps,
} from '../contracts';
import { clamp, toInt } from '../framework/Utils';

interface NormalizedCost {
  gold: number;
  diamond: number;
  items: ItemStack[];
}

/** 货币读写与消费校验。spend 先全量校验再扣除，保证失败时零变更。 */
export class CurrencyService implements ICurrencyService {
  private readonly deps: ServiceDeps;
  private readonly inventory: IInventoryService;

  constructor(deps: ServiceDeps, inventory: IInventoryService) {
    this.deps = deps;
    this.inventory = inventory;
  }

  get(type: CurrencyType): number {
    const value = this.deps.save.currency[type];
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? toInt(value) : 0;
  }

  canAfford(cost: Cost): boolean {
    const normalized = this.normalizeCost(cost);
    if (!normalized) return false;
    if (this.get('gold') < normalized.gold) return false;
    if (this.get('diamond') < normalized.diamond) return false;
    for (const stack of normalized.items) {
      if (this.inventory.count(stack.id) < stack.count) return false;
    }
    return true;
  }

  add(type: CurrencyType, amount: number, reason: string): void {
    const value = toInt(amount);
    if (!Number.isFinite(amount) || value < 0) {
      if (Number.isFinite(amount) && amount < 0) this.deps.log.warn(`忽略负数货币增加：${type} ${amount}`);
      return;
    }
    if (value === 0) return;
    const before = this.get(type);
    const after = clamp(before + value, 0, CURRENCY_MAX);
    if (after === before) return;
    this.deps.save.currency[type] = after;
    const delta = after - before;
    this.emitChanged(type === 'gold' ? delta : 0, type === 'diamond' ? delta : 0, reason);
    this.deps.markDirty();
  }

  spend(cost: Cost, reason: string): OpResult {
    const normalized = this.normalizeCost(cost);
    if (!normalized) return { ok: false, reason: FailReason.Insufficient };
    if (!this.canAffordNormalized(normalized)) return { ok: false, reason: FailReason.Insufficient };

    for (const stack of normalized.items) {
      const removed = this.inventory.remove(stack.id, stack.count);
      if (!removed.ok) {
        // 单线程下校验已保证成功；若仍失败说明状态被外部破坏，记录告警。
        this.deps.log.warn(`费用扣除异常：道具 ${stack.id} x${stack.count} 移除失败（${removed.reason}）`);
        return { ok: false, reason: removed.reason ?? FailReason.Insufficient };
      }
    }

    let deltaGold = 0;
    let deltaDiamond = 0;
    if (normalized.gold > 0) {
      const before = this.get('gold');
      const after = clamp(before - normalized.gold, 0, CURRENCY_MAX);
      this.deps.save.currency.gold = after;
      deltaGold = after - before;
    }
    if (normalized.diamond > 0) {
      const before = this.get('diamond');
      const after = clamp(before - normalized.diamond, 0, CURRENCY_MAX);
      this.deps.save.currency.diamond = after;
      deltaDiamond = after - before;
    }
    if (deltaGold !== 0 || deltaDiamond !== 0) this.emitChanged(deltaGold, deltaDiamond, reason);
    if (normalized.items.length > 0 || deltaGold !== 0 || deltaDiamond !== 0) this.deps.markDirty();
    return { ok: true };
  }

  private canAffordNormalized(cost: NormalizedCost): boolean {
    if (this.get('gold') < cost.gold) return false;
    if (this.get('diamond') < cost.diamond) return false;
    for (const stack of cost.items) {
      if (this.inventory.count(stack.id) < stack.count) return false;
    }
    return true;
  }

  /** 非有限或负数返回 null；小数截断；items 按 id 合并计数。 */
  private normalizeCost(cost: Cost | null | undefined): NormalizedCost | null {
    if (!cost || typeof cost !== 'object') return null;
    const gold = normalizeAmount(cost.gold);
    const diamond = normalizeAmount(cost.diamond);
    if (gold === null || diamond === null) return null;
    const totals = new Map<ItemId, number>();
    for (const stack of cost.items ?? []) {
      if (!stack || typeof stack.id !== 'string' || stack.id.length === 0) return null;
      const count = normalizeAmount(stack.count);
      if (count === null) return null;
      totals.set(stack.id, (totals.get(stack.id) ?? 0) + count);
    }
    const items: ItemStack[] = [];
    for (const [id, count] of totals) {
      if (count > 0) items.push({ id, count });
    }
    return { gold, diamond, items };
  }

  private emitChanged(deltaGold: number, deltaDiamond: number, reason: string): void {
    this.deps.events.emit('currency.changed', {
      gold: this.get('gold'),
      diamond: this.get('diamond'),
      deltaGold,
      deltaDiamond,
      reason,
    });
  }
}

function normalizeAmount(value: number | undefined): number | null {
  if (value === undefined) return 0;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return toInt(value);
}
