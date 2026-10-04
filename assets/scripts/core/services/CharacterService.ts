import {
  FailReason,
  type CharacterAttrs,
  type CharacterConfig,
  type CharacterId,
  type CharacterView,
  type Cost,
  type ICharacterService,
  type IConfigService,
  type ICurrencyService,
  type IInventoryService,
  type OpResult,
  type ServiceDeps,
} from '../contracts';
import { toInt } from '../framework/Utils';

const ATTR_KEYS: Array<keyof CharacterAttrs> = ['speed', 'jump', 'magnet', 'coinBonus', 'scoreBonus'];

/** 角色解锁/升级/选择/属性计算。升级费用 = ceil(baseCost * costFactor^(level-1))。 */
export class CharacterService implements ICharacterService {
  private readonly deps: ServiceDeps;
  private readonly config: IConfigService;
  private readonly currency: ICurrencyService;
  private readonly inventory: IInventoryService;

  constructor(
    deps: ServiceDeps,
    config: IConfigService,
    currency: ICurrencyService,
    inventory: IInventoryService,
  ) {
    this.deps = deps;
    this.config = config;
    this.currency = currency;
    this.inventory = inventory;
  }

  list(): CharacterView[] {
    return this.config.allCharacters().map((config) => this.viewOf(config));
  }

  get(id: CharacterId): CharacterView | undefined {
    const config = this.config.character(id);
    return config ? this.viewOf(config) : undefined;
  }

  current(): CharacterView {
    const selected = this.deps.save.characters.selected;
    const view = this.get(selected);
    if (!view) throw new Error(`当前选中角色配置不存在：${selected}`);
    return view;
  }

  unlock(id: CharacterId): OpResult {
    const config = this.config.character(id);
    if (!config) return { ok: false, reason: FailReason.NotFound };
    if (this.isUnlocked(id)) return { ok: true };
    const unlock = config.unlock;
    if (unlock.type === 'condition') {
      // v1 预留：条件解锁暂未实现，由后续版本补充条件判定。
      return { ok: false, reason: FailReason.Locked };
    }
    if (unlock.type === 'currency' || unlock.type === 'item') {
      const spent =
        unlock.type === 'currency'
          ? unlock.cost
            ? this.currency.spend(unlock.cost, `character.unlock.${id}`)
            : { ok: false, reason: FailReason.Locked }
          : this.spendItems(this.itemUnlockCost(config));
      if (!spent.ok) return spent;
    }
    this.deps.save.characters.unlocked.push(id);
    this.deps.save.characters.levels[id] = 1;
    this.emitChanged(id, 'unlock');
    this.deps.markDirty();
    return { ok: true };
  }

  upgrade(id: CharacterId): OpResult {
    const config = this.config.character(id);
    if (!config) return { ok: false, reason: FailReason.NotFound };
    if (!this.isUnlocked(id)) return { ok: false, reason: FailReason.Locked };
    const level = this.levelOf(id);
    if (level >= config.upgrade.maxLevel) return { ok: false, reason: FailReason.MaxLevel };
    const cost = this.costAt(config, level);
    const spent = this.currency.spend(cost, `character.upgrade.${id}`);
    if (!spent.ok) return spent;
    this.deps.save.characters.levels[id] = level + 1;
    this.emitChanged(id, 'upgrade');
    this.deps.markDirty();
    return { ok: true };
  }

  select(id: CharacterId): OpResult {
    const config = this.config.character(id);
    if (!config) return { ok: false, reason: FailReason.NotFound };
    if (!this.isUnlocked(id)) return { ok: false, reason: FailReason.Locked };
    if (this.deps.save.characters.selected === id) return { ok: true };
    this.deps.save.characters.selected = id;
    this.emitChanged(id, 'select');
    this.deps.markDirty();
    return { ok: true };
  }

  attrsOf(id: CharacterId): CharacterAttrs {
    const config = this.config.character(id);
    if (!config) throw new Error(`角色配置不存在：${id}`);
    const level = this.isUnlocked(id) ? this.levelOf(id) : 1;
    return this.attrsAt(config, level);
  }

  private viewOf(config: CharacterConfig): CharacterView {
    const unlocked = this.isUnlocked(config.id);
    const level = unlocked ? this.levelOf(config.id) : 0;
    const upgradeCost = unlocked && level < config.upgrade.maxLevel ? this.costAt(config, level) : undefined;
    return {
      config,
      unlocked,
      level,
      selected: this.deps.save.characters.selected === config.id,
      attrs: this.attrsAt(config, Math.max(level, 1)),
      unlockCost: this.unlockCostOf(config),
      upgradeCost,
      canUnlock: !unlocked && this.canUnlock(config),
      canUpgrade: unlocked && level < config.upgrade.maxLevel && !!upgradeCost && this.currency.canAfford(upgradeCost),
    };
  }

  private canUnlock(config: CharacterConfig): boolean {
    const unlock = config.unlock;
    if (unlock.type === 'default') return true;
    if (unlock.type === 'currency') return !!unlock.cost && this.currency.canAfford(unlock.cost);
    if (unlock.type === 'item') {
      const cost = this.itemUnlockCost(config);
      return !!cost && this.currency.canAfford(cost);
    }
    return false;
  }

  private unlockCostOf(config: CharacterConfig): Cost | undefined {
    if (config.unlock.type === 'currency') return config.unlock.cost;
    if (config.unlock.type === 'item') return this.itemUnlockCost(config);
    return undefined;
  }

  private itemUnlockCost(config: CharacterConfig): Cost | undefined {
    if (config.unlock.cost?.items?.length) return config.unlock.cost;
    if (config.unlock.itemId) return { items: [{ id: config.unlock.itemId, count: 1 }] };
    return undefined;
  }

  /** 道具费用：先按 id 合并全量校验，再逐个移除；校验通过后单线程内不会半途失败。 */
  private spendItems(cost: Cost | undefined): OpResult {
    const stacks = cost?.items ?? [];
    if (stacks.length === 0) return { ok: false, reason: FailReason.Locked };
    const totals = new Map<string, number>();
    for (const stack of stacks) totals.set(stack.id, (totals.get(stack.id) ?? 0) + stack.count);
    for (const [itemId, count] of totals) {
      if (this.inventory.count(itemId) < count) return { ok: false, reason: FailReason.Insufficient };
    }
    for (const [itemId, count] of totals) {
      const removed = this.inventory.remove(itemId, count);
      if (!removed.ok) {
        this.deps.log.warn(`解锁费用扣除异常：道具 ${itemId} x${count} 移除失败（${removed.reason}）`);
        return removed;
      }
    }
    return { ok: true };
  }

  /** 升到 level+1 所需费用；level 为当前等级。 */
  private costAt(config: CharacterConfig, level: number): Cost {
    const { baseCost, costFactor } = config.upgrade;
    const factor = Math.pow(costFactor, Math.max(0, level - 1));
    const cost: Cost = {};
    if (baseCost.gold !== undefined) cost.gold = Math.ceil(baseCost.gold * factor);
    if (baseCost.diamond !== undefined) cost.diamond = Math.ceil(baseCost.diamond * factor);
    if (baseCost.items?.length) {
      cost.items = baseCost.items.map((stack) => ({ id: stack.id, count: Math.ceil(stack.count * factor) }));
    }
    return cost;
  }

  private attrsAt(config: CharacterConfig, level: number): CharacterAttrs {
    const steps = Math.max(0, level - 1);
    const attrs = {} as CharacterAttrs;
    for (const key of ATTR_KEYS) {
      const growth = config.upgrade.growth[key] ?? 0;
      attrs[key] = Math.max(0, Math.round(config.baseAttr[key] + growth * steps));
    }
    return attrs;
  }

  private isUnlocked(id: CharacterId): boolean {
    return this.deps.save.characters.unlocked.includes(id);
  }

  private levelOf(id: CharacterId): number {
    const level = this.deps.save.characters.levels[id];
    return typeof level === 'number' && Number.isFinite(level) ? Math.max(1, toInt(level)) : 1;
  }

  private emitChanged(id: CharacterId, reason: 'unlock' | 'upgrade' | 'select'): void {
    this.deps.events.emit('character.changed', { id, reason });
  }
}
