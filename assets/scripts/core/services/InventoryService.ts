import {
  FailReason,
  type IConfigService,
  type IInventoryService,
  type ItemId,
  type ItemStack,
  type ItemUseResult,
  type OpResult,
  type ServiceDeps,
} from '../contracts';
import { toInt } from '../framework/Utils';

/** 道具仓库：增删查与使用。数量统一非负整数化，0 值不对外展示。 */
export class InventoryService implements IInventoryService {
  private readonly deps: ServiceDeps;
  private readonly config: IConfigService;

  constructor(deps: ServiceDeps, config: IConfigService) {
    this.deps = deps;
    this.config = config;
  }

  count(id: ItemId): number {
    const value = this.deps.save.inventory[id];
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? toInt(value) : 0;
  }

  add(id: ItemId, count: number): void {
    const amount = toInt(count);
    if (amount <= 0) {
      if (Number.isFinite(count) && count < 0) this.deps.log.warn(`忽略负数道具增加：${id} x${count}`);
      return;
    }
    const next = this.count(id) + amount;
    this.deps.save.inventory[id] = next;
    this.emitChanged(id, next);
    this.deps.markDirty();
  }

  remove(id: ItemId, count: number): OpResult {
    const amount = toInt(count);
    if (amount < 0) return { ok: false, reason: FailReason.Insufficient };
    if (amount === 0) return { ok: true };
    const have = this.count(id);
    if (have < amount) return { ok: false, reason: FailReason.Insufficient };
    const next = have - amount;
    this.deps.save.inventory[id] = next;
    this.emitChanged(id, next);
    this.deps.markDirty();
    return { ok: true };
  }

  all(): ItemStack[] {
    const stacks: ItemStack[] = [];
    for (const [id, value] of Object.entries(this.deps.save.inventory)) {
      const count = typeof value === 'number' && Number.isFinite(value) ? toInt(value) : 0;
      if (count > 0) stacks.push({ id, count });
    }
    return stacks;
  }

  use(id: ItemId): ItemUseResult {
    const item = this.config.item(id);
    if (!item || !item.useEffect) return { ok: false, reason: FailReason.Unsupported };
    if (this.count(id) < 1) return { ok: false, reason: FailReason.Insufficient };
    this.remove(id, 1);
    return { ok: true, effect: item.useEffect };
  }

  private emitChanged(id: ItemId, count: number): void {
    this.deps.events.emit('inventory.changed', { changed: [{ id, count }] });
  }
}
