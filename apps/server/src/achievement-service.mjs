import { ApiError } from './errors.mjs';

/**
 * 成就后端：run 类进度只来自服务端重放 RunnerSim 的 metrics（finishRun 事务内转发），
 * 不信任客户端上传计数；local 类（charactersUnlocked 等设备本机经济）客户端自记自发，
 * 服务端不参与（游客单机服务定位见 docs/missions-backend.md）。
 * 奖励入 wallets 同一账本、rewardLedgerId 与任务快照一致，客户端按高水位幂等导入零改动。
 */

// source=run 条目可供给的统计全集：任务指标 SUPPORTED_METRICS ∖ charactersPlayed（对成就无意义）
// + jumps/itemOf 显式新增（白名单镜像里没有）。stat 命名与重放 metrics 键逐一同名（技能释放是
// skillCasts 而非 summary 字段 casts），applyRunMetrics 泛化直读 metrics[stat]，零映射。
// 导出供 tests/achievementsConfig.test.mjs 与 schema enum / 客户端双清单做三方漂移比对。
export const RUN_SUPPLIED = new Set([
  'distanceM', 'coins', 'slides', 'jumps', 'itemPickups', 'itemOf',
  'runs', 'skillCasts', 'nearMiss', 'cleanRuns', 'score',
]);
// source=local 条目可用：设备本机自记，服务端不可供给（run 条目误用即「服务端恒 0」的死条目，两向都锁）
export const LOCAL_STATS = new Set(['charactersUnlocked']);
// shard 奖励是「碎片id:正整数」串（与任务奖励同口径）；正数正则本就杜绝零值死条目
const SHARD_RE = /^[a-z][a-z0-9_]*:[1-9]\d*$/;

/** stat 的存储键：itemOf 分道具统计落 itemOf:<itemId>，其余与 stat 同名 */
const statKey = entry => (entry.stat === 'itemOf' ? `itemOf:${entry.statRef}` : entry.stat);

/** 启动即校验（validateMissionConfig 先例）：坏配置让服务起不来，而不是带病运行出死条目。 */
export function validateAchievementsConfig(content) {
  const items = content?.achievements?.items;
  if (items !== undefined && !Array.isArray(items)) throw new Error('achievements.json items 必须是数组');
  const itemIds = new Set((content?.items?.items ?? []).map(item => item.id));
  const seen = new Set();
  for (const entry of items ?? []) {
    const where = `achievements.${entry?.id ?? '(缺 id)'}`;
    if (typeof entry?.id !== 'string' || !entry.id.startsWith('ach_')) throw new Error(`${where}: id 必须是 ach_ 前缀的字符串`);
    if (seen.has(entry.id)) throw new Error(`${where}: id 重复`);
    seen.add(entry.id);
    const supplied = entry.source === 'run' ? RUN_SUPPLIED : entry.source === 'local' ? LOCAL_STATS : null;
    if (!supplied || !supplied.has(entry.stat)) {
      throw new Error(`${where}: source=${String(entry.source)} 的 stat 不在白名单内 -> ${String(entry.stat)}`);
    }
    if (entry.stat === 'itemOf') {
      if (typeof entry.statRef !== 'string' || !itemIds.has(entry.statRef)) {
        throw new Error(`${where}: stat=itemOf 的 statRef 必须是 items 中存在的道具 -> ${String(entry.statRef)}`);
      }
    } else if (entry.statRef !== undefined) {
      throw new Error(`${where}: 仅 stat=itemOf 允许 statRef`);
    }
    if (entry.status !== undefined && !['draft', 'live', 'retired'].includes(entry.status)) {
      throw new Error(`${where}: status 应为 draft|live|retired -> ${String(entry.status)}`);
    }
    if (!Number.isSafeInteger(entry.target) || entry.target <= 0) throw new Error(`${where}: target 必须是正整数`);
    validateReward(where, entry.reward);
  }
}

/** 奖励校验收紧为正整数且非空（任务侧 ≥0 口径在此不用：零值奖励=可领取却发不出的死条目） */
function validateReward(where, reward) {
  if (!reward || typeof reward !== 'object' || Array.isArray(reward) || Object.keys(reward).length === 0) {
    throw new Error(`${where}: reward 必须是非空对象`);
  }
  for (const [kind, value] of Object.entries(reward)) {
    if (kind === 'shard') {
      if (typeof value !== 'string' || !SHARD_RE.test(value)) throw new Error(`${where}: reward.shard 应为「碎片id:正整数」`);
    } else if (!['coin', 'key', 'diamond'].includes(kind) || !Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`${where}: reward.${kind} 必须是正整数`);
    }
  }
}

export class AchievementService {
  constructor({ store, content, now = Date.now }) {
    this.store = store;
    this.now = now;
    validateAchievementsConfig(content);
    // 只管理 source==='run' 且生效的条目：local 类无服务端进度也无账本，快照不含、claim 按 404 拒绝；
    // draft/retired 是下线口径（与 items 的 availability 同款，缺 status 按 live）——不进快照、
    // 不建写入器（无 live 条目共用的 stat 即停止累计）、claim 按 404 拒绝
    this.entries = (content?.achievements?.items ?? [])
      .filter(entry => entry.source === 'run' && entry.status !== 'draft' && entry.status !== 'retired');
    this.byId = new Map(this.entries.map(entry => [entry.id, entry]));
    // 按 (stat,statRef) 去重出写入器：同 stat 的多档成就共享一次 upsert；score 是单局最佳走 MAX
    this.writers = new Map();
    for (const entry of this.entries) {
      const key = statKey(entry);
      if (!this.writers.has(key)) this.writers.set(key, { stat: entry.stat, statRef: entry.statRef, best: entry.stat === 'score' });
    }
  }

  /** 局内指标入账。由 finishRun 在其事务内调用：本方法不得自开事务（BEGIN IMMEDIATE 不可嵌套）。 */
  applyRunMetrics(userId, metrics) {
    for (const [key, writer] of this.writers) {
      const delta = writer.stat === 'itemOf' ? metrics?.itemPickupsById?.[writer.statRef] : metrics?.[writer.stat];
      // 防伪口径：脏值（负数/非有限）直接丢弃——stats 表 CHECK(value>=0) 不收，也不能毒化终身进度
      if (!Number.isFinite(delta) || delta < 0) continue;
      if (writer.best) this.store.bestStat(userId, key, delta);
      else this.store.addStat(userId, key, delta);
    }
  }

  /** 快照形状与任务快照对齐：rewardLedgerId 同一持久身份、wallet 同一账本（不是可用余额）。 */
  snapshot(userId) {
    const stats = this.store.achievementStats(userId);
    const claimed = this.store.achievementClaims(userId);
    return {
      serverTime: this.now(),
      rewardLedgerId: userId,
      achievements: this.entries.map(entry => {
        const progress = Math.min(entry.target, Number(stats[statKey(entry)] ?? 0));
        return {
          id: entry.id, name: { ...entry.name }, desc: { ...entry.desc },
          stat: entry.stat, target: entry.target, tier: entry.tier, group: entry.group,
          reward: { ...entry.reward },
          progress: Math.round(progress * 100) / 100,
          claimed: claimed.has(entry.id),
        };
      }),
      wallet: this.store.getWallet(userId),
    };
  }

  /** 领取（mission claim 同款事务形状）：定义存在→已领幂等跳过→进度达标（409）→记领→逐条入账。 */
  claim(userId, { achievementId }) {
    if (typeof achievementId !== 'string') throw new ApiError(400, '领取请求必须包含有效的 achievementId');
    const entry = this.byId.get(achievementId);
    if (!entry) throw new ApiError(404, '找不到该成就');
    this.store.transaction(() => {
      if (this.store.achievementClaims(userId).has(achievementId)) return;
      if (Number(this.store.achievementStats(userId)[statKey(entry)] ?? 0) < entry.target) {
        throw new ApiError(409, '成就尚未达成，暂时不能领取奖励');
      }
      this.store.addClaim(userId, achievementId, this.now());
      for (const [kind, value] of Object.entries(entry.reward)) {
        if (kind === 'shard') {
          const [item, amount] = value.split(':');
          this.store.addWallet(userId, item, Number(amount));
        } else {
          this.store.addWallet(userId, kind, value);
        }
      }
    });
    return this.snapshot(userId);
  }
}
