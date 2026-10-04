import type { ConfigTableName } from '../contracts';

/**
 * 配置表校验：结构校验（数组表、必填字段、类型、id 唯一）+ 引用校验（道具/角色/增益/metric）。
 * 返回可读错误列表，错误信息包含表名、条目索引/id 与字段名；调用方决定日志与抛错策略。
 */

export type RawConfigs = Record<ConfigTableName, unknown>;

const ITEM_TYPES = new Set(['consumable', 'material', 'ticket']);
const SHOP_TABS = new Set(['gold', 'diamond', 'props', 'special']);
const TASK_TYPES = new Set(['daily', 'weekly']);
const TASK_LINKS = new Set(['run', 'shop', 'character', 'welfare', 'none']);
const TASK_METRICS = new Set([
  'run.count',
  'run.distance',
  'run.score.single',
  'run.coins.total',
  'run.diamonds.total',
  'login.days',
  'shop.buy.count',
  'character.upgrade.count',
]);
const UNLOCK_TYPES = new Set(['default', 'currency', 'item', 'condition']);
const EFFECT_KINDS = new Set(['grant', 'runBuff', 'unlockCharacter']);
const USE_TARGETS = new Set(['menu', 'run']);
const PRICE_CURRENCIES = new Set(['gold', 'diamond', 'CNY']);
const TIME_RE = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/;

type Dict = Record<string, unknown>;

function isDict(value: unknown): value is Dict {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStr(value: unknown): value is string {
  return typeof value === 'string';
}

function isNonEmptyStr(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isFiniteNum(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonNegNum(value: unknown): value is number {
  return isFiniteNum(value) && value >= 0;
}

function isPosNum(value: unknown): value is number {
  return isFiniteNum(value) && value > 0;
}

function isNonNegInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isPosInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isQuality(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 5;
}

/** 解析 `YYYY-MM-DD HH:mm`（本地时间）；非法日期返回 null。 */
function parseLocalTime(text: unknown): number | null {
  if (!isStr(text)) return null;
  const match = TIME_RE.exec(text);
  if (!match) return null;
  const [, y, mo, d, h, mi] = match;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  const date = new Date(year, month - 1, day, Number(h), Number(mi));
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date.getTime();
}

export function validateConfigs(tables: RawConfigs): string[] {
  const errors: string[] = [];
  const itemIds = new Set<string>();
  const characterIds = new Set<string>();
  const runBuffIds = new Set<string>();

  const fail = (table: string, entry: string, field: string, message: string): void => {
    errors.push(`[${table}] ${entry}${field ? ` 字段 "${field}"` : ''}：${message}`);
  };
  const label = (index: number, id?: string): string => `第 ${index + 1} 条${id ? `（id=${id}）` : ''}`;

  const arrayOf = (table: ConfigTableName): unknown[] | null => {
    const raw = tables[table];
    if (!Array.isArray(raw)) {
      fail(table, '根节点', '', '必须是数组');
      return null;
    }
    return raw;
  };

  const requireString = (table: string, entry: string, field: string, value: unknown, allowEmpty = false): void => {
    const ok = allowEmpty ? isStr(value) : isNonEmptyStr(value);
    if (!ok) fail(table, entry, field, allowEmpty ? '必须是字符串' : '必填且必须是非空字符串');
  };

  const requireNumber = (table: string, entry: string, field: string, value: unknown, positive = false): void => {
    const ok = positive ? isPosNum(value) : isNonNegNum(value);
    if (!ok) fail(table, entry, field, positive ? '必须是大于 0 的数字' : '必须是非负数字');
  };

  /** 费用结构校验；requireAny=true 时至少要有一种费用。 */
  const checkCostShape = (table: string, entry: string, field: string, value: unknown, requireAny: boolean): void => {
    if (!isDict(value)) {
      fail(table, entry, field, '必须是对象');
      return;
    }
    let any = false;
    for (const currency of ['gold', 'diamond'] as const) {
      if (value[currency] !== undefined) {
        any = true;
        requireNumber(table, entry, `${field}.${currency}`, value[currency]);
      }
    }
    if (value.items !== undefined) {
      if (!Array.isArray(value.items)) {
        fail(table, entry, `${field}.items`, '必须是数组');
      } else {
        if (value.items.length > 0) any = true;
        value.items.forEach((stack, i) => {
          if (!isDict(stack)) {
            fail(table, entry, `${field}.items[${i}]`, '必须是对象');
            return;
          }
          requireString(table, entry, `${field}.items[${i}].id`, stack.id);
          if (!isPosInt(stack.count)) fail(table, entry, `${field}.items[${i}].count`, '必须是正整数');
        });
      }
    }
    if (requireAny && !any) fail(table, entry, field, '至少需要一种费用（gold/diamond/items）');
  };

  /** 奖励结构校验（引用存在性在第二阶段的 checkRewardRefs 中做）。 */
  const checkRewardShape = (table: string, entry: string, field: string, value: unknown): void => {
    if (!isDict(value)) {
      fail(table, entry, field, '必须是对象');
      return;
    }
    if (value.gold !== undefined) requireNumber(table, entry, `${field}.gold`, value.gold);
    if (value.diamond !== undefined) requireNumber(table, entry, `${field}.diamond`, value.diamond);
    if (value.items !== undefined) {
      if (!Array.isArray(value.items)) {
        fail(table, entry, `${field}.items`, '必须是数组');
      } else {
        value.items.forEach((stack, i) => {
          if (!isDict(stack)) {
            fail(table, entry, `${field}.items[${i}]`, '必须是对象');
            return;
          }
          requireString(table, entry, `${field}.items[${i}].id`, stack.id);
          if (!isPosInt(stack.count)) fail(table, entry, `${field}.items[${i}].count`, '必须是正整数');
        });
      }
    }
    if (value.characters !== undefined) {
      if (!Array.isArray(value.characters)) {
        fail(table, entry, `${field}.characters`, '必须是数组');
      } else {
        value.characters.forEach((id, i) => requireString(table, entry, `${field}.characters[${i}]`, id));
      }
    }
  };

  const checkRewardRefs = (table: string, entry: string, field: string, value: unknown): void => {
    if (!isDict(value)) return;
    if (Array.isArray(value.items)) {
      value.items.forEach((stack, i) => {
        if (isDict(stack) && isNonEmptyStr(stack.id) && !itemIds.has(stack.id)) {
          fail(table, entry, `${field}.items[${i}].id`, `引用了不存在的道具 "${stack.id}"`);
        }
      });
    }
    if (Array.isArray(value.characters)) {
      value.characters.forEach((id, i) => {
        if (isNonEmptyStr(id) && !characterIds.has(id)) {
          fail(table, entry, `${field}.characters[${i}]`, `引用了不存在的角色 "${id}"`);
        }
      });
    }
  };

  const checkCostItemRefs = (table: string, entry: string, field: string, value: unknown): void => {
    if (!isDict(value) || !Array.isArray(value.items)) return;
    value.items.forEach((stack, i) => {
      if (isDict(stack) && isNonEmptyStr(stack.id) && !itemIds.has(stack.id)) {
        fail(table, entry, `${field}.items[${i}].id`, `引用了不存在的道具 "${stack.id}"`);
      }
    });
  };

  // -------------------------------------------------------------------------
  // 结构校验
  // -------------------------------------------------------------------------

  if (!isDict(tables.app)) {
    fail('app', '根对象', '', '必须是对象');
  } else {
    const app = tables.app;
    requireString('app', '根对象', 'version', app.version);
    requireString('app', '根对象', 'cloudEnvId', app.cloudEnvId, true);
    if (typeof app.dailyResetHour !== 'number' || !Number.isInteger(app.dailyResetHour) || app.dailyResetHour < 0 || app.dailyResetHour > 23) {
      fail('app', '根对象', 'dailyResetHour', '必须是 0–23 的整数');
    }
    if (typeof app.weeklyResetWeekday !== 'number' || !Number.isInteger(app.weeklyResetWeekday) || app.weeklyResetWeekday < 1 || app.weeklyResetWeekday > 7) {
      fail('app', '根对象', 'weeklyResetWeekday', '必须是 1–7 的整数');
    }
    if (typeof app.debug !== 'boolean') fail('app', '根对象', 'debug', '必须是布尔值');
    requireString('app', '根对象', 'privacyPolicy', app.privacyPolicy);
    requireString('app', '根对象', 'userAgreement', app.userAgreement);
    if (!isDict(app.contact)) {
      fail('app', '根对象', 'contact', '必须是对象');
    } else {
      for (const key of ['qq', 'wechat', 'email'] as const) {
        if (app.contact[key] !== undefined && !isStr(app.contact[key])) {
          fail('app', '根对象', `contact.${key}`, '必须是字符串');
        }
      }
    }
  }

  const rawItems = arrayOf('items');
  if (rawItems) {
    rawItems.forEach((entry, index) => {
      if (!isDict(entry)) {
        fail('items', label(index), '', '必须是对象');
        return;
      }
      const id = isNonEmptyStr(entry.id) ? entry.id : undefined;
      if (!id) fail('items', label(index), 'id', '必填且必须是非空字符串');
      else if (itemIds.has(id)) fail('items', label(index, id), 'id', '与前面的条目重复');
      else itemIds.add(id);
      const entryLabel = label(index, id);
      requireString('items', entryLabel, 'name', entry.name);
      requireString('items', entryLabel, 'desc', entry.desc);
      requireString('items', entryLabel, 'icon', entry.icon);
      if (!ITEM_TYPES.has(entry.type as string)) {
        fail('items', entryLabel, 'type', `必须是 ${[...ITEM_TYPES].join('/')} 之一`);
      }
      if (!isQuality(entry.quality)) fail('items', entryLabel, 'quality', '必须是 1–5 的整数');
      if (typeof entry.stackable !== 'boolean') fail('items', entryLabel, 'stackable', '必须是布尔值');
      if (entry.useEffect !== undefined) {
        if (!isDict(entry.useEffect)) {
          fail('items', entryLabel, 'useEffect', '必须是对象');
        } else {
          const kind = entry.useEffect.kind;
          if (!EFFECT_KINDS.has(kind as string)) {
            fail('items', entryLabel, 'useEffect.kind', '必须是 grant/runBuff/unlockCharacter 之一');
          } else if (kind === 'grant') {
            checkRewardShape('items', entryLabel, 'useEffect.reward', entry.useEffect.reward);
          } else if (kind === 'runBuff' && !isNonEmptyStr(entry.useEffect.buffId)) {
            fail('items', entryLabel, 'useEffect.buffId', '必填且必须是非空字符串');
          } else if (kind === 'unlockCharacter' && !isNonEmptyStr(entry.useEffect.id)) {
            fail('items', entryLabel, 'useEffect.id', '必填且必须是非空字符串');
          }
        }
      }
      if (entry.useTargets !== undefined) {
        if (!Array.isArray(entry.useTargets)) {
          fail('items', entryLabel, 'useTargets', '必须是数组');
        } else {
          entry.useTargets.forEach((target, i) => {
            if (!USE_TARGETS.has(target as string)) {
              fail('items', entryLabel, `useTargets[${i}]`, '必须是 menu/run 之一');
            }
          });
        }
      }
    });
  }

  const rawCharacters = arrayOf('characters');
  if (rawCharacters) {
    rawCharacters.forEach((entry, index) => {
      if (!isDict(entry)) {
        fail('characters', label(index), '', '必须是对象');
        return;
      }
      const id = isNonEmptyStr(entry.id) ? entry.id : undefined;
      if (!id) fail('characters', label(index), 'id', '必填且必须是非空字符串');
      else if (characterIds.has(id)) fail('characters', label(index, id), 'id', '与前面的条目重复');
      else characterIds.add(id);
      const entryLabel = label(index, id);
      for (const field of ['name', 'desc', 'icon', 'preview'] as const) {
        requireString('characters', entryLabel, field, entry[field]);
      }
      if (!isQuality(entry.quality)) fail('characters', entryLabel, 'quality', '必须是 1–5 的整数');
      if (!isDict(entry.unlock)) {
        fail('characters', entryLabel, 'unlock', '必须是对象');
      } else {
        const type = entry.unlock.type;
        if (!UNLOCK_TYPES.has(type as string)) {
          fail('characters', entryLabel, 'unlock.type', '必须是 default/currency/item/condition 之一');
        } else if (type === 'currency') {
          checkCostShape('characters', entryLabel, 'unlock.cost', entry.unlock.cost, true);
        } else if (type === 'item') {
          if (!isNonEmptyStr(entry.unlock.itemId) && !isDict(entry.unlock.cost)) {
            fail('characters', entryLabel, 'unlock.itemId', 'item 解锁必须提供 itemId 或 cost.items');
          } else if (isDict(entry.unlock.cost)) {
            checkCostShape('characters', entryLabel, 'unlock.cost', entry.unlock.cost, true);
          }
        } else if (type === 'condition' && !isNonEmptyStr(entry.unlock.condition)) {
          fail('characters', entryLabel, 'unlock.condition', 'condition 解锁必须提供条件描述字符串');
        }
      }
      if (!isDict(entry.baseAttr)) {
        fail('characters', entryLabel, 'baseAttr', '必须是对象');
      } else {
        for (const attr of ['speed', 'jump', 'magnet', 'coinBonus', 'scoreBonus'] as const) {
          requireNumber('characters', entryLabel, `baseAttr.${attr}`, entry.baseAttr[attr]);
        }
      }
      if (!isDict(entry.upgrade)) {
        fail('characters', entryLabel, 'upgrade', '必须是对象');
      } else {
        if (!isPosInt(entry.upgrade.maxLevel)) fail('characters', entryLabel, 'upgrade.maxLevel', '必须是正整数');
        checkCostShape('characters', entryLabel, 'upgrade.baseCost', entry.upgrade.baseCost, true);
        if (!isPosNum(entry.upgrade.costFactor)) fail('characters', entryLabel, 'upgrade.costFactor', '必须是大于 0 的数字');
        if (!isDict(entry.upgrade.growth)) {
          fail('characters', entryLabel, 'upgrade.growth', '必须是对象');
        } else {
          for (const attr of ['speed', 'jump', 'magnet', 'coinBonus', 'scoreBonus'] as const) {
            if (entry.upgrade.growth[attr] !== undefined) {
              if (!isFiniteNum(entry.upgrade.growth[attr])) {
                fail('characters', entryLabel, `upgrade.growth.${attr}`, '必须是数字');
              }
            }
          }
        }
      }
    });
  }

  const rawShop = arrayOf('shop');
  if (rawShop) {
    const goodsIds = new Set<string>();
    rawShop.forEach((entry, index) => {
      if (!isDict(entry)) {
        fail('shop', label(index), '', '必须是对象');
        return;
      }
      const id = isNonEmptyStr(entry.id) ? entry.id : undefined;
      if (!id) fail('shop', label(index), 'id', '必填且必须是非空字符串');
      else if (goodsIds.has(id)) fail('shop', label(index, id), 'id', '与前面的条目重复');
      else goodsIds.add(id);
      const entryLabel = label(index, id);
      if (!SHOP_TABS.has(entry.tab as string)) fail('shop', entryLabel, 'tab', '必须是 gold/diamond/props/special 之一');
      for (const field of ['name', 'desc', 'icon'] as const) requireString('shop', entryLabel, field, entry[field]);
      if (!isFiniteNum(entry.order)) fail('shop', entryLabel, 'order', '必须是数字');
      if (entry.dailyLimit !== undefined && !isPosInt(entry.dailyLimit)) fail('shop', entryLabel, 'dailyLimit', '必须是正整数');
      if (entry.viaAd !== undefined && typeof entry.viaAd !== 'boolean') fail('shop', entryLabel, 'viaAd', '必须是布尔值');
      if (entry.iosVisible !== undefined && typeof entry.iosVisible !== 'boolean') fail('shop', entryLabel, 'iosVisible', '必须是布尔值');
      if (entry.tag !== undefined && !isStr(entry.tag)) fail('shop', entryLabel, 'tag', '必须是字符串');
      if (entry.price === null) {
        if (entry.viaAd !== true) {
          // 免费非广告商品允许，但不算错误
        }
      } else if (!isDict(entry.price)) {
        fail('shop', entryLabel, 'price', '必须是 null 或价格对象');
      } else {
        if (!PRICE_CURRENCIES.has(entry.price.currency as string)) {
          fail('shop', entryLabel, 'price.currency', '必须是 gold/diamond/CNY 之一');
        }
        if (!isPosInt(entry.price.amount)) fail('shop', entryLabel, 'price.amount', '必须是正整数（CNY 单位为分）');
        if (entry.price.currency === 'CNY' && !isNonEmptyStr(entry.productId)) {
          fail('shop', entryLabel, 'productId', 'CNY 商品必须提供非空 productId');
        }
        if (entry.viaAd === true) fail('shop', entryLabel, 'viaAd', '广告免费商品的 price 必须为 null');
      }
      checkRewardShape('shop', entryLabel, 'gain', entry.gain);
    });
  }

  const rawTasks = arrayOf('tasks');
  if (rawTasks) {
    const taskIds = new Set<string>();
    rawTasks.forEach((entry, index) => {
      if (!isDict(entry)) {
        fail('tasks', label(index), '', '必须是对象');
        return;
      }
      const id = isNonEmptyStr(entry.id) ? entry.id : undefined;
      if (!id) fail('tasks', label(index), 'id', '必填且必须是非空字符串');
      else if (taskIds.has(id)) fail('tasks', label(index, id), 'id', '与前面的条目重复');
      else taskIds.add(id);
      const entryLabel = label(index, id);
      for (const field of ['name', 'desc'] as const) requireString('tasks', entryLabel, field, entry[field]);
      if (!TASK_TYPES.has(entry.type as string)) fail('tasks', entryLabel, 'type', '必须是 daily/weekly 之一');
      if (!TASK_METRICS.has(entry.metric as string)) {
        fail('tasks', entryLabel, 'metric', `不是合法的任务指标 "${String(entry.metric)}"`);
      }
      requireNumber('tasks', entryLabel, 'target', entry.target, true);
      checkRewardShape('tasks', entryLabel, 'reward', entry.reward);
      if (entry.link !== undefined && !TASK_LINKS.has(entry.link as string)) {
        fail('tasks', entryLabel, 'link', '必须是 run/shop/character/welfare/none 之一');
      }
      if (!isFiniteNum(entry.order)) fail('tasks', entryLabel, 'order', '必须是数字');
    });
  }

  const rawAchievements = arrayOf('achievements');
  if (rawAchievements) {
    const achievementIds = new Set<string>();
    rawAchievements.forEach((entry, index) => {
      if (!isDict(entry)) {
        fail('achievements', label(index), '', '必须是对象');
        return;
      }
      const id = isNonEmptyStr(entry.id) ? entry.id : undefined;
      if (!id) fail('achievements', label(index), 'id', '必填且必须是非空字符串');
      else if (achievementIds.has(id)) fail('achievements', label(index, id), 'id', '与前面的条目重复');
      else achievementIds.add(id);
      const entryLabel = label(index, id);
      for (const field of ['name', 'desc'] as const) requireString('achievements', entryLabel, field, entry[field]);
      if (!TASK_METRICS.has(entry.metric as string)) {
        fail('achievements', entryLabel, 'metric', `不是合法的任务指标 "${String(entry.metric)}"`);
      }
      requireNumber('achievements', entryLabel, 'target', entry.target, true);
      checkRewardShape('achievements', entryLabel, 'reward', entry.reward);
      if (!isFiniteNum(entry.order)) fail('achievements', entryLabel, 'order', '必须是数字');
    });
  }

  const welfare = tables.welfare;
  if (!isDict(welfare)) {
    fail('welfare', '根对象', '', '必须是对象');
  } else {
    const signIn = welfare.signIn;
    if (!isDict(signIn)) {
      fail('welfare', '根对象', 'signIn', '必须是对象');
    } else if (!Array.isArray(signIn.days) || signIn.days.length === 0) {
      fail('welfare', '根对象', 'signIn.days', '必须是非空数组');
    } else {
      signIn.days.forEach((day, index) => {
        if (!isDict(day)) {
          fail('welfare', `第 ${index + 1} 天`, `signIn.days[${index}]`, '必须是对象');
          return;
        }
        if (typeof day.day !== 'number' || day.day !== index + 1) {
          fail('welfare', `第 ${index + 1} 天`, `signIn.days[${index}].day`, `必须是从 1 连续递增的整数（应为 ${index + 1}）`);
        }
        checkRewardShape('welfare', `第 ${index + 1} 天`, `signIn.days[${index}].reward`, day.reward);
      });
    }
    if (welfare.dailyFreeAd !== null) {
      if (!isDict(welfare.dailyFreeAd)) {
        fail('welfare', '根对象', 'dailyFreeAd', '必须是 null 或对象');
      } else {
        checkRewardShape('welfare', '根对象', 'dailyFreeAd.reward', welfare.dailyFreeAd.reward);
      }
    }
  }

  const rawActivities = arrayOf('activities');
  if (rawActivities) {
    const activityIds = new Set<string>();
    rawActivities.forEach((entry, index) => {
      if (!isDict(entry)) {
        fail('activities', label(index), '', '必须是对象');
        return;
      }
      const id = isNonEmptyStr(entry.id) ? entry.id : undefined;
      if (!id) fail('activities', label(index), 'id', '必填且必须是非空字符串');
      else if (activityIds.has(id)) fail('activities', label(index, id), 'id', '与前面的条目重复');
      else activityIds.add(id);
      const entryLabel = label(index, id);
      for (const field of ['name', 'desc', 'banner', 'icon', 'ruleText'] as const) {
        requireString('activities', entryLabel, field, entry[field]);
      }
      const start = parseLocalTime(entry.startTime);
      const end = parseLocalTime(entry.endTime);
      if (start === null) fail('activities', entryLabel, 'startTime', '必须是 YYYY-MM-DD HH:mm 格式的合法本地时间');
      if (end === null) fail('activities', entryLabel, 'endTime', '必须是 YYYY-MM-DD HH:mm 格式的合法本地时间');
      if (start !== null && end !== null && end <= start) {
        fail('activities', entryLabel, 'endTime', '必须晚于 startTime');
      }
      if (!TASK_METRICS.has(entry.metric as string)) {
        fail('activities', entryLabel, 'metric', `不是合法的任务指标 "${String(entry.metric)}"`);
      }
      if (!Array.isArray(entry.milestones) || entry.milestones.length === 0) {
        fail('activities', entryLabel, 'milestones', '必须是非空数组');
      } else {
        let prev = 0;
        entry.milestones.forEach((milestone, i) => {
          if (!isDict(milestone)) {
            fail('activities', entryLabel, `milestones[${i}]`, '必须是对象');
            return;
          }
          if (!isPosNum(milestone.target)) {
            fail('activities', entryLabel, `milestones[${i}].target`, '必须是大于 0 的数字');
          } else if (milestone.target <= prev) {
            fail('activities', entryLabel, `milestones[${i}].target`, '必须严格递增');
          } else {
            prev = milestone.target;
          }
          checkRewardShape('activities', entryLabel, `milestones[${i}].reward`, milestone.reward);
        });
      }
      if (!isFiniteNum(entry.order)) fail('activities', entryLabel, 'order', '必须是数字');
      if (typeof entry.enabled !== 'boolean') fail('activities', entryLabel, 'enabled', '必须是布尔值');
    });
  }

  const rawRuns = arrayOf('run');
  if (rawRuns) {
    const modes = new Set<string>();
    rawRuns.forEach((entry, index) => {
      if (!isDict(entry)) {
        fail('run', label(index), '', '必须是对象');
        return;
      }
      const mode = isNonEmptyStr(entry.mode) ? entry.mode : undefined;
      if (!mode) fail('run', label(index), 'mode', '必填且必须是非空字符串');
      else if (modes.has(mode)) fail('run', label(index, mode), 'mode', '与前面的条目重复');
      else modes.add(mode);
      const entryLabel = label(index, mode);
      requireString('run', entryLabel, 'name', entry.name);
      if (!isDict(entry.settle)) {
        fail('run', entryLabel, 'settle', '必须是对象');
      } else {
        for (const field of ['coinsToGold', 'scoreToGoldDivisor', 'diamondEveryCoins'] as const) {
          requireNumber('run', entryLabel, `settle.${field}`, entry.settle[field], true);
        }
      }
      if (!isDict(entry.revive)) {
        fail('run', entryLabel, 'revive', '必须是对象');
      } else if (!isNonNegInt(entry.revive.adPerRun)) {
        fail('run', entryLabel, 'revive.adPerRun', '必须是非负整数');
      }
      if (!isDict(entry.buffs)) {
        fail('run', entryLabel, 'buffs', '必须是对象');
      } else {
        for (const [buffId, buff] of Object.entries(entry.buffs)) {
          if (!buffId) fail('run', entryLabel, 'buffs', '增益键不能为空');
          if (!isDict(buff)) {
            fail('run', entryLabel, `buffs.${buffId}`, '必须是对象');
            continue;
          }
          runBuffIds.add(buffId);
          requireString('run', entryLabel, `buffs.${buffId}.name`, buff.name);
          requireString('run', entryLabel, `buffs.${buffId}.desc`, buff.desc);
          if (buff.durationSec !== undefined && !isPosNum(buff.durationSec)) {
            fail('run', entryLabel, `buffs.${buffId}.durationSec`, '必须是大于 0 的数字');
          }
          if (buff.count !== undefined && !isPosInt(buff.count)) {
            fail('run', entryLabel, `buffs.${buffId}.count`, '必须是正整数');
          }
        }
      }
    });
  }

  // -------------------------------------------------------------------------
  // 引用校验
  // -------------------------------------------------------------------------

  if (rawItems) {
    rawItems.forEach((entry, index) => {
      if (!isDict(entry) || !isNonEmptyStr(entry.id)) return;
      const entryLabel = label(index, entry.id);
      const effect = entry.useEffect;
      if (!isDict(effect)) return;
      if (effect.kind === 'grant') {
        checkRewardRefs('items', entryLabel, 'useEffect.reward', effect.reward);
      } else if (effect.kind === 'runBuff' && isNonEmptyStr(effect.buffId) && !runBuffIds.has(effect.buffId)) {
        fail('items', entryLabel, 'useEffect.buffId', `引用了 run 表中不存在的增益 "${effect.buffId}"`);
      } else if (effect.kind === 'unlockCharacter' && isNonEmptyStr(effect.id) && !characterIds.has(effect.id)) {
        fail('items', entryLabel, 'useEffect.id', `引用了不存在的角色 "${effect.id}"`);
      }
    });
  }

  if (rawCharacters) {
    rawCharacters.forEach((entry, index) => {
      if (!isDict(entry) || !isNonEmptyStr(entry.id)) return;
      const entryLabel = label(index, entry.id);
      const unlock = entry.unlock;
      if (isDict(unlock)) {
        checkCostItemRefs('characters', entryLabel, 'unlock.cost', unlock.cost);
        if (unlock.type === 'item' && isNonEmptyStr(unlock.itemId) && !itemIds.has(unlock.itemId)) {
          fail('characters', entryLabel, 'unlock.itemId', `引用了不存在的道具 "${unlock.itemId}"`);
        }
      }
      if (isDict(entry.upgrade)) {
        checkCostItemRefs('characters', entryLabel, 'upgrade.baseCost', entry.upgrade.baseCost);
      }
    });
  }

  if (rawShop) {
    rawShop.forEach((entry, index) => {
      if (!isDict(entry) || !isNonEmptyStr(entry.id)) return;
      checkRewardRefs('shop', label(index, entry.id), 'gain', entry.gain);
    });
  }

  if (rawTasks) {
    rawTasks.forEach((entry, index) => {
      if (!isDict(entry) || !isNonEmptyStr(entry.id)) return;
      checkRewardRefs('tasks', label(index, entry.id), 'reward', entry.reward);
    });
  }

  if (rawAchievements) {
    rawAchievements.forEach((entry, index) => {
      if (!isDict(entry) || !isNonEmptyStr(entry.id)) return;
      checkRewardRefs('achievements', label(index, entry.id), 'reward', entry.reward);
    });
  }

  if (isDict(welfare) && isDict(welfare.signIn) && Array.isArray(welfare.signIn.days)) {
    welfare.signIn.days.forEach((day, index) => {
      if (!isDict(day)) return;
      checkRewardRefs('welfare', `第 ${index + 1} 天`, `signIn.days[${index}].reward`, day.reward);
    });
  }
  if (isDict(welfare) && isDict(welfare.dailyFreeAd)) {
    checkRewardRefs('welfare', '根对象', 'dailyFreeAd.reward', welfare.dailyFreeAd.reward);
  }

  if (rawActivities) {
    rawActivities.forEach((entry, index) => {
      if (!isDict(entry)) return;
      const activityId = entry.id;
      if (!isNonEmptyStr(activityId) || !Array.isArray(entry.milestones)) return;
      entry.milestones.forEach((milestone, i) => {
        if (!isDict(milestone)) return;
        checkRewardRefs('activities', label(index, activityId), `milestones[${i}].reward`, milestone.reward);
      });
    });
  }

  return errors;
}
