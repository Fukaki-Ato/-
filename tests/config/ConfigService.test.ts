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
import type { AppConfig, IConfigSource } from '../../assets/scripts/core/contracts';
import { validateConfigs, type RawConfigs } from '../../assets/scripts/core/config/validate';
import { ConfigService } from '../../assets/scripts/core/services/ConfigService';
import { createFakeLogger } from '../helpers';
import { makeTables } from '../services/fixtures';

function realTables(): RawConfigs {
  return { app, items, characters, shop, tasks, achievements, welfare, activities, run };
}

function fakeSource(tables: RawConfigs): IConfigSource {
  return { load: async (name) => tables[name] };
}

describe('ConfigService', () => {
  it('加载官方配置表并构建索引', async () => {
    const service = new ConfigService({ source: fakeSource(realTables()), log: createFakeLogger() });
    expect(service.ready).toBe(false);
    await service.loadAll();
    expect(service.ready).toBe(true);

    expect(service.app().debug).toBe(true);
    expect(service.app().cloudEnvId).toBe('');
    expect(service.item('magnet')?.name).toBe('磁铁');
    expect(service.item('ghost')).toBeUndefined();
    expect(service.allItems()).toHaveLength(5);
    expect(service.allCharacters()).toHaveLength(3);
    expect(service.character('runner_moon')?.unlock.type).toBe('currency');

    expect(service.goodsByTab('gold').map((goods) => goods.id)).toEqual(['free_gold_ad', 'gold_1000', 'gold_6000']);
    expect(service.goodsByTab('diamond')).toHaveLength(3);
    expect(service.goodsByTab('props')).toHaveLength(4);
    expect(service.goodsByTab('special')).toHaveLength(3);
    expect(service.goods('recharge_6')?.productId).toBe('ltkp.diamond.60');

    expect(service.tasksByType('daily')).toHaveLength(6);
    expect(service.tasksByType('weekly')).toHaveLength(3);
    expect(service.tasksByType('daily')[0].id).toBe('daily.run3');
    expect(service.task('weekly.score4000')?.metric).toBe('run.score.single');
    expect(service.allAchievements()).toHaveLength(6);
    expect(service.allAchievements()[0].id).toBe('ach.run10');
    expect(service.welfare().signIn.days).toHaveLength(7);
    expect(service.welfare().dailyFreeAd?.reward.gold).toBe(100);
    expect(service.allActivities().map((activity) => activity.id)).toEqual(['act_login', 'act_sprint', 'act_summer']);
    expect(service.activity('act_summer')?.enabled).toBe(true);
    expect(service.run('classic').settle).toEqual({ coinsToGold: 1, scoreToGoldDivisor: 10, diamondEveryCoins: 500 });
    expect(service.allRuns()).toHaveLength(1);
    expect(() => service.run('ghost')).toThrow('未找到跑酷模式配置：ghost');
  });

  it('未加载时查询接口抛出明确错误', () => {
    const service = new ConfigService({ source: fakeSource(realTables()), log: createFakeLogger() });
    expect(service.ready).toBe(false);
    expect(() => service.item('magnet')).toThrow('配置尚未加载');
    expect(() => service.app()).toThrow('配置尚未加载');
    expect(() => service.run('classic')).toThrow('配置尚未加载');
  });

  it('debug=true 时打印全部错误并抛出第一个', async () => {
    const tables = makeTables() as unknown as Record<string, unknown>;
    const itemList = [...(tables.items as unknown[])];
    itemList.push(JSON.parse(JSON.stringify(itemList[0])) as unknown);
    tables.items = itemList;
    (tables.app as AppConfig).debug = true;
    const expected = validateConfigs(tables as RawConfigs);
    expect(expected.length).toBeGreaterThan(0);

    const log = createFakeLogger();
    const service = new ConfigService({ source: fakeSource(tables as RawConfigs), log });
    await expect(service.loadAll()).rejects.toThrow('配置校验失败');
    const errors = log.calls.filter((call) => call.level === 'error');
    expect(errors).toHaveLength(expected.length);
    expect(errors[0].msg).toContain(expected[0]);
  });

  it('debug=false 时仍抛错但不打印错误日志', async () => {
    const tables = makeTables() as unknown as Record<string, unknown>;
    const shopList = [...(tables.shop as unknown[])];
    shopList[0] = { ...(shopList[0] as Record<string, unknown>), gain: { items: [{ id: 'ghost', count: 1 }] } };
    tables.shop = shopList;
    const log = createFakeLogger();
    const service = new ConfigService({ source: fakeSource(tables as RawConfigs), log });
    await expect(service.loadAll()).rejects.toThrow('配置校验失败');
    expect(log.calls.filter((call) => call.level === 'error')).toHaveLength(0);
  });
});
