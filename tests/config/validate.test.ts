import { describe, expect, it } from 'vitest';
import app from '../../assets/resources/config/app.json';
import items from '../../assets/resources/config/items.json';
import characters from '../../assets/resources/config/characters.json';
import shop from '../../assets/resources/config/shop.json';
import tasks from '../../assets/resources/config/tasks.json';
import achievements from '../../assets/resources/config/achievements.json';
import welfare from '../../assets/resources/config/welfare.json';
import activities from '../../assets/resources/config/activities.json';
import run from '../../assets/resources/config/run.json';
import { validateConfigs, type RawConfigs } from '../../assets/scripts/core/config/validate';

function realTables(): RawConfigs {
  return { app, items, characters, shop, tasks, achievements, welfare, activities, run };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function hasError(errors: string[], table: string, ...fragments: string[]): boolean {
  return errors.some((error) => error.includes(`[${table}]`) && fragments.every((fragment) => error.includes(fragment)));
}

describe('validateConfigs', () => {
  it('官方配置表全部通过校验', () => {
    expect(validateConfigs(realTables())).toEqual([]);
  });

  it('重复 id 报错且包含表名与字段名', () => {
    const tables = realTables();
    const list = clone(tables.items) as Array<Record<string, unknown>>;
    list.push(clone(list[0]));
    tables.items = list;
    const errors = validateConfigs(tables);
    expect(hasError(errors, 'items', 'id', '重复')).toBe(true);
  });

  it('shop.gain 引用不存在的道具时报错（含条目 id 与字段路径）', () => {
    const tables = realTables();
    const list = clone(tables.shop) as Array<Record<string, unknown>>;
    list[1] = { ...list[1], gain: { gold: 1, items: [{ id: 'ghost_item', count: 1 }] } };
    tables.shop = list;
    const errors = validateConfigs(tables);
    expect(hasError(errors, 'shop', 'id=gold_1000', 'gain.items[0].id', 'ghost_item')).toBe(true);
  });

  it('shop.gain 引用不存在的角色时报错', () => {
    const tables = realTables();
    const list = clone(tables.shop) as Array<Record<string, unknown>>;
    list[0] = { ...list[0], gain: { characters: ['ghost_hero'] } };
    tables.shop = list;
    const errors = validateConfigs(tables);
    expect(hasError(errors, 'shop', 'gain.characters[0]', 'ghost_hero')).toBe(true);
  });

  it('角色 unlock 引用不存在的道具时报错', () => {
    const tables = realTables();
    const list = clone(tables.characters) as Array<Record<string, unknown>>;
    list[2] = { ...list[2], unlock: { type: 'item', itemId: 'ghost_shard' } };
    tables.characters = list;
    const errors = validateConfigs(tables);
    expect(hasError(errors, 'characters', 'id=runner_lin', 'unlock.itemId', 'ghost_shard')).toBe(true);
  });

  it('任务/成就 metric 非法时报错', () => {
    const tables = realTables();
    const taskList = clone(tables.tasks) as Array<Record<string, unknown>>;
    taskList[0] = { ...taskList[0], metric: 'run.teleport' };
    tables.tasks = taskList;
    const achievementList = clone(tables.achievements) as Array<Record<string, unknown>>;
    achievementList[0] = { ...achievementList[0], metric: 'bad.metric' };
    tables.achievements = achievementList;
    const errors = validateConfigs(tables);
    expect(hasError(errors, 'tasks', 'metric', 'run.teleport')).toBe(true);
    expect(hasError(errors, 'achievements', 'metric', 'bad.metric')).toBe(true);
  });

  it('items.useEffect 引用不存在的 run 增益时报错', () => {
    const tables = realTables();
    const list = clone(tables.items) as Array<Record<string, unknown>>;
    list[0] = { ...list[0], useEffect: { kind: 'runBuff', buffId: 'ghost_buff' } };
    tables.items = list;
    const errors = validateConfigs(tables);
    expect(hasError(errors, 'items', 'id=magnet', 'useEffect.buffId', 'ghost_buff')).toBe(true);
  });

  it('welfare 签到天数不连续时报错', () => {
    const tables = realTables();
    const config = clone(tables.welfare) as { signIn: { days: Array<{ day: number }> } };
    config.signIn.days[1].day = 5;
    tables.welfare = config;
    const errors = validateConfigs(tables);
    expect(hasError(errors, 'welfare', 'signIn.days[1].day', '连续')).toBe(true);
  });

  it('run 结算数值非正时报错', () => {
    const tables = realTables();
    const list = clone(tables.run) as Array<Record<string, unknown>>;
    list[0] = { ...list[0], settle: { coinsToGold: 0, scoreToGoldDivisor: 10, diamondEveryCoins: 500 } };
    tables.run = list;
    const errors = validateConfigs(tables);
    expect(hasError(errors, 'run', 'settle.coinsToGold', '大于 0')).toBe(true);
  });

  it('CNY 商品缺少 productId 时报错', () => {
    const tables = realTables();
    const list = clone(tables.shop) as Array<Record<string, unknown>>;
    const recharge = { ...list[3] };
    delete recharge.productId;
    list[3] = recharge;
    tables.shop = list;
    const errors = validateConfigs(tables);
    expect(hasError(errors, 'shop', 'id=recharge_6', 'productId')).toBe(true);
  });

  it('活动时间窗非法（结束不晚于开始）时报错', () => {
    const tables = realTables();
    const list = clone(tables.activities) as Array<Record<string, unknown>>;
    list[0] = { ...list[0], endTime: '2026-10-01 00:00' };
    tables.activities = list;
    const errors = validateConfigs(tables);
    expect(hasError(errors, 'activities', 'endTime', '晚于')).toBe(true);
  });

  it('非数组的数组表与非法 app 均能报错', () => {
    const tables = realTables();
    tables.items = { not: 'array' };
    tables.app = null;
    const errors = validateConfigs(tables);
    expect(hasError(errors, 'items', '必须是数组')).toBe(true);
    expect(hasError(errors, 'app', '必须是对象')).toBe(true);
  });
});
