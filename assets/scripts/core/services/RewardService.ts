import {
  type ICharacterService,
  type IConfigService,
  type ICurrencyService,
  type IInventoryService,
  type IRewardService,
  type RewardBundle,
  type RewardDisplay,
  type ServiceDeps,
} from '../contracts';
import { toInt } from '../framework/Utils';

export const GOLD_ICON = 'images/ui/icon_gold';
export const DIAMOND_ICON = 'images/ui/icon_diamond';

/** 结构化奖励发放与展示描述。发放幂等由底层服务保证（角色已解锁跳过）。 */
export class RewardService implements IRewardService {
  private readonly deps: ServiceDeps;
  private readonly config: IConfigService;
  private readonly currency: ICurrencyService;
  private readonly inventory: IInventoryService;
  private readonly character: ICharacterService;

  constructor(
    deps: ServiceDeps,
    config: IConfigService,
    currency: ICurrencyService,
    inventory: IInventoryService,
    character: ICharacterService,
  ) {
    this.deps = deps;
    this.config = config;
    this.currency = currency;
    this.inventory = inventory;
    this.character = character;
  }

  grant(reward: RewardBundle, source: string): void {
    if (!reward || typeof reward !== 'object') return;
    if (reward.gold !== undefined) this.currency.add('gold', reward.gold, source);
    if (reward.diamond !== undefined) this.currency.add('diamond', reward.diamond, source);
    for (const stack of reward.items ?? []) {
      if (stack && typeof stack.id === 'string' && stack.id.length > 0) {
        this.inventory.add(stack.id, stack.count);
      }
    }
    for (const id of reward.characters ?? []) {
      if (typeof id !== 'string' || id.length === 0) continue;
      if (this.character.get(id)?.unlocked) continue;
      const result = this.character.unlock(id);
      if (!result.ok) this.deps.log.warn(`奖励发放：角色 ${id} 解锁失败（${result.reason}）`);
    }
  }

  describe(reward: RewardBundle): RewardDisplay[] {
    const displays: RewardDisplay[] = [];
    if (!reward || typeof reward !== 'object') return displays;
    if (reward.gold !== undefined && reward.gold > 0) {
      displays.push({ kind: 'gold', name: '金币', icon: GOLD_ICON, count: toInt(reward.gold) });
    }
    if (reward.diamond !== undefined && reward.diamond > 0) {
      displays.push({ kind: 'diamond', name: '钻石', icon: DIAMOND_ICON, count: toInt(reward.diamond) });
    }
    for (const stack of reward.items ?? []) {
      if (!stack || typeof stack.id !== 'string' || !(stack.count > 0)) continue;
      const item = this.config.item(stack.id);
      displays.push({
        kind: 'item',
        id: stack.id,
        name: item?.name ?? stack.id,
        icon: item?.icon ?? '',
        count: toInt(stack.count),
      });
    }
    for (const id of reward.characters ?? []) {
      if (typeof id !== 'string' || id.length === 0) continue;
      const character = this.config.character(id);
      displays.push({
        kind: 'character',
        id,
        name: character?.name ?? id,
        icon: character?.icon ?? '',
        count: 1,
      });
    }
    return displays;
  }
}
