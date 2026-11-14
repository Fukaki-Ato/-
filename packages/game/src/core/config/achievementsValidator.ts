/**
 * 成就条目校验（achievements.json 专属规则，被 configValidator 调用）。
 * stat 白名单与 configTypes 的 ACH_RUN_STATS/ACH_LOCAL_STATS 同源；schema/config.schema.json
 * $defs.achievement 的 stat enum 是同一全集的另一份拷贝，服务端 achievement-service.mjs 的
 * RUN_SUPPLIED/LOCAL_STATS 是第三份，漂移由 tests/achievementsConfig.test.mjs 三方比对兜底。
 */
import { ACH_LOCAL_STATS, ACH_RUN_STATS } from './configTypes.js';
import type { AchievementEntry, AchievementReward } from './configTypes.js';

const TIERS = ['bronze', 'silver', 'gold'];
const GROUPS = ['run', 'skill', 'collect', 'chars'];
const STATUSES = ['draft', 'live', 'retired'];
const REWARD_KEYS = ['coin', 'key', 'diamond', 'shard'];
/** 「存在的碎片id:正整数」，与 economy.params.shards 消费侧（growth.shards）同口径 */
const SHARD_RE = /^[a-z][a-z0-9_]*:[1-9]\d*$/;

/** 生效口径（与 items 的 canUseEquippedItem 同款）：draft/retired 不进页面不可领；缺 status 按 live 兼容旧配置 */
export function achievementLive(entry: AchievementEntry): boolean {
  return entry.status !== 'draft' && entry.status !== 'retired';
}

/** 单条成就的结构校验（不依赖其他文件）；引用存在性在 validateAchievementRefs */
export function validateAchievementEntry(entry: AchievementEntry): string[] {
  const errors: string[] = [];
  const where = `achievements.${entry.id}`;
  if (![...ACH_RUN_STATS, ...ACH_LOCAL_STATS].includes(entry.stat)) {
    errors.push(`${where}: 未知 stat -> ${String(entry.stat)}`);
  }
  // source/stat 兼容：run 条目的统计必须服务端可供给，local 条目豁免 run 白名单（本机经济）
  if (entry.source === 'run' && !(ACH_RUN_STATS as readonly string[]).includes(entry.stat)) {
    errors.push(`${where}: source=run 的 stat 服务端不可供给 -> ${String(entry.stat)}`);
  }
  if (!TIERS.includes(entry.tier)) errors.push(`${where}: tier 应为 ${TIERS.join('|')}（${String(entry.tier)}）`);
  if (!GROUPS.includes(entry.group)) errors.push(`${where}: group 应为 ${GROUPS.join('|')}（${String(entry.group)}）`);
  if (entry.status !== undefined && !(STATUSES as string[]).includes(entry.status)) {
    errors.push(`${where}: status 应为 ${STATUSES.join('|')}（${String(entry.status)}）`);
  }
  if (!Number.isSafeInteger(entry.target) || entry.target <= 0) {
    errors.push(`${where}: target 应为正整数（${String(entry.target)}）`);
  }
  // statRef 仅 itemOf 使用：itemOf 缺引用无法分道具统计，非 itemOf 带引用是笔误
  if (entry.stat === 'itemOf') {
    if (typeof entry.statRef !== 'string' || entry.statRef.length === 0) {
      errors.push(`${where}: stat=itemOf 缺少 statRef`);
    }
  } else if (entry.statRef !== undefined) {
    errors.push(`${where}: 仅 stat=itemOf 允许 statRef（${String(entry.stat)}）`);
  }
  errors.push(...validateReward(where, entry.reward));
  return errors;
}

/** 奖励校验：非空、货币为正整数、shard 为「碎片id:正整数」串（零值奖励会产生发不出的死条目） */
function validateReward(where: string, reward: AchievementReward): string[] {
  if (!reward || typeof reward !== 'object' || Array.isArray(reward)) {
    return [`${where}: reward 应为非空对象`];
  }
  const errors: string[] = [];
  const keys = Object.keys(reward);
  if (keys.length === 0) errors.push(`${where}: reward 应为非空对象`);
  for (const key of keys) {
    if (!REWARD_KEYS.includes(key)) {
      errors.push(`${where}: reward 不支持的键 -> ${key}`);
      continue;
    }
    if (key === 'shard') {
      if (typeof reward.shard !== 'string' || !SHARD_RE.test(reward.shard)) {
        errors.push(`${where}: reward.shard 应为「碎片id:正整数」-> ${String(reward.shard)}`);
      }
    } else {
      const n = reward[key as 'coin' | 'key' | 'diamond'];
      if (!Number.isSafeInteger(n) || (n as number) <= 0) errors.push(`${where}: reward.${key} 应为正整数（${String(n)}）`);
    }
  }
  return errors;
}

/** 跨文件引用（validateRefs 调用）：itemOf.statRef → items；reward.shard → economy shards */
export function validateAchievementRefs(entries: AchievementEntry[], itemIds: Set<string>, shardIds: Set<string>): string[] {
  const errors: string[] = [];
  for (const entry of entries) {
    if (entry.stat === 'itemOf' && typeof entry.statRef === 'string' && !itemIds.has(entry.statRef)) {
      errors.push(`${entry.id}: statRef 道具不存在 -> ${entry.statRef}`);
    }
    const shard = (entry.reward as AchievementReward | undefined)?.shard;
    if (typeof shard === 'string' && !shardIds.has(shard.split(':')[0])) {
      errors.push(`${entry.id}: 奖励碎片不存在 -> ${shard}`);
    }
  }
  return errors;
}
