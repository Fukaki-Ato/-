import { createHash, randomUUID } from 'node:crypto';
import { getMissionPeriods } from './periods.mjs';
import { ApiError } from './errors.mjs';
import { createRuleset, readReplaySource, readLegacyRuleset, verifyRuleset, readBoundRuleset, loadReplayRuntime, replaySourceHash } from './rules.mjs';
import { canonicalReplayPayload, parseItemsJson } from './run-payload.mjs';
import { DEFAULT_LIMITS } from './limits.mjs';
import { playableCharacters, isCharacterLocked, itemEffects } from '@tr/game/core/sim/character.js';
import { resolveRunThemeId } from '@tr/game/core/sim/themeRules.js';

const SUPPORTED_METRICS = new Set([
  'distanceM', 'coins', 'slides', 'runs', 'skillCasts', 'nearMiss', 'cleanRuns', 'score',
  'itemPickups', 'charactersPlayed',
]);
const TITLES = {
  mdist: '跑步达到目标距离', mcoin: '收集金币', mslide: '完成滑铲', mruns: '完成对局',
  mskill: '释放技能', mnear: '触发擦身', mnohit: '无受击完成对局', mscore: '达到目标分数',
  wdist: '本周跑步距离', wskill: '本周释放技能', wpickup: '本周拾取道具', wchars: '本周使用不同角色',
};
const validCount = value => Number.isFinite(value) && value >= 0;

function validateMissionConfig(missions) {
  const daily = missions?.daily;
  const weekly = missions?.weekly;
  if (!daily || daily.pick !== 3 || !Array.isArray(daily.pool) || !weekly || weekly.pick !== 4 || !Array.isArray(weekly.pool) || weekly.pool.length !== 4) {
    throw new Error('economy.json missions must define daily pick 3 and weekly pick 4');
  }
  for (const tier of ['easy', 'mid', 'hard']) {
    if (!daily.pool.some(mission => mission.tier === tier && mission.metric !== 'cleanRuns')) throw new Error(`daily missions has no ${tier} mission`);
  }
  if (weekly.pool.some(mission => mission.metric === 'cleanRuns')) throw new Error('weekly cleanRuns missions cannot be completed');
  for (const [period, pool] of [['daily', daily.pool], ['weekly', weekly.pool]]) {
    const ids = new Set();
    for (const mission of pool) {
      if (typeof mission.id !== 'string' || ids.has(mission.id) || !SUPPORTED_METRICS.has(mission.metric) || !validCount(mission.target) || mission.target <= 0) {
        throw new Error(`invalid ${period} mission definition: ${mission.id ?? '(missing id)'}`);
      }
      if (!mission.reward || typeof mission.reward !== 'object' || Array.isArray(mission.reward)) throw new Error(`invalid reward for mission ${mission.id}`);
      for (const [kind, value] of Object.entries(mission.reward)) {
        if (kind === 'shard') {
          if (typeof value !== 'string' || !/^[a-z][a-z0-9_]*:[1-9]\d*$/.test(value)) throw new Error(`invalid shard reward for ${mission.id}`);
          // diamond 是钱包通用物品（wallets 表 item 任意键），改名/档案消费它（审查 M4-4：钻石此前零获取渠道）
        } else if (!['coin', 'key', 'diamond'].includes(kind) || !Number.isSafeInteger(value) || value < 0) {
          throw new Error(`invalid ${kind} reward for ${mission.id}`);
        }
      }
      ids.add(mission.id);
    }
  }
}

function stableIndex(userId, periodId, tier, count) {
  const digest = createHash('sha256').update(`${userId}:${periodId}:${tier}`).digest();
  return digest.readUInt32BE(0) % count;
}

function selectedMissions(userId, period, periodId, config) {
  if (period === 'weekly') return config.weekly.pool.map(mission => ({ ...mission, reward: { ...mission.reward } }));
  return ['easy', 'mid', 'hard'].map(tier => {
    const candidates = config.daily.pool.filter(mission => mission.tier === tier && mission.metric !== 'cleanRuns');
    return { ...candidates[stableIndex(userId, periodId, tier, candidates.length)], reward: { ...candidates[stableIndex(userId, periodId, tier, candidates.length)].reward } };
  });
}

function missionView(definition, progress, claimed) {
  const current = Number(progress[definition.id] ?? 0);
  const safeProgress = Math.min(definition.target, Number.isFinite(current) ? current : 0);
  return {
    id: definition.id,
    title: typeof definition.title === 'string' ? definition.title : (TITLES[definition.id] ?? definition.id),
    metric: definition.metric,
    target: definition.target,
    progress: Math.round(safeProgress * 100) / 100,
    reward: { ...definition.reward },
    claimed: claimed[definition.id] === true,
  };
}

function updatePeriodProgress(store, userId, period, periodId, metrics, charactersPlayed = 0) {
  const data = store.getPeriod(userId, period, periodId);
  for (const definition of data.definitions) {
    const previous = Number(data.progress[definition.id] ?? 0);
    let delta = metrics[definition.metric] ?? 0;
    if (definition.metric === 'charactersPlayed') delta = charactersPlayed;
    if (definition.type === 'bestScore' || definition.metric === 'charactersPlayed') {
      data.progress[definition.id] = Math.max(previous, delta);
    } else {
      data.progress[definition.id] = previous + delta;
    }
  }
  store.saveProgress(userId, period, periodId, data.progress);
}

export class MissionService {
  constructor({ store, content, now = Date.now, limits = {}, minRunSeconds, replaySource, legacyRuleset, trustedReplayRuntimeHashes = [] }) {
    this.store = store;
    this.content = content;
    this.now = now;
    this.limits = { ...DEFAULT_LIMITS, ...limits };
    this.activeReplays = 0;
    const config = content.economy?.params?.missions;
    validateMissionConfig(config);
    const configuredMinimum = minRunSeconds ?? config.minRunSeconds ?? 10;
    if (!Number.isFinite(configuredMinimum) || configuredMinimum < 0 || configuredMinimum > 600) throw new Error('missions.minRunSeconds must be between 0 and 600');
    this.minRunSeconds = configuredMinimum;
    this.replaySource = replaySource ?? readReplaySource();
    const baseline = legacyRuleset ?? readLegacyRuleset();
    verifyRuleset(baseline);
    if (!Array.isArray(trustedReplayRuntimeHashes) || trustedReplayRuntimeHashes.some(hash => typeof hash !== 'string' || !/^[0-9a-f]{64}$/i.test(hash))) {
      throw new Error('trusted replay runtime hashes must be SHA-256 hex strings');
    }
    this.trustedRuntimeHashes = new Set([replaySourceHash(this.replaySource), replaySourceHash(baseline.definition.runtimeSource),
      ...trustedReplayRuntimeHashes.map(hash => hash.toLowerCase())]);
    this.captureRules();
    this.legacyBinding = this.store.adoptLegacyRules(baseline);
  }

  captureRules() {
    const current = createRuleset({ content: this.content, minRunSeconds: this.minRunSeconds,
      limits: this.limits, runtimeSource: this.replaySource });
    this.store.addRuleset(current);
    return this.rulesId = current.id;
  }

  ensurePeriod(userId, period, periodId) {
    const config = this.content.economy.params.missions;
    const selected = selectedMissions(userId, period, periodId, config);
    let current = this.store.ensurePeriod(userId, period, periodId, selected);
    // 只迁移未领取的旧任务，保留其 ID/奖励；新指标不能继承旧指标进度。
    // 比较交换兼容 claim 的外层事务，也不会覆盖其他连接刚保存的进度。
    for (let attempt = 0; attempt < 3; attempt++) {
      const progress = { ...current.progress };
      let changed = false;
      const definitions = current.definitions.map(definition => {
        if (definition.metric !== 'cleanRuns' || current.claimed[definition.id] === true
          || Number(current.progress[definition.id] ?? 0) >= definition.target) return definition;
        const replacement = selected.find(mission => mission.tier === definition.tier);
        if (!replacement) throw new Error('no achievable replacement for legacy cleanRuns mission');
        changed = true;
        progress[definition.id] = 0;
        return { ...definition, metric: replacement.metric, type: replacement.type, target: replacement.target,
          title: replacement.title ?? TITLES[replacement.id] ?? replacement.id };
      });
      if (!changed) return current;
      if (this.store.replacePeriod(userId, period, periodId, current, definitions, progress)) {
        return { ...current, definitions, progress };
      }
      current = this.store.getPeriod(userId, period, periodId);
    }
    throw new ApiError(409, '任务状态正在更新，请稍后重试');
  }

  snapshot(userId) {
    const serverTime = this.now();
    const periods = getMissionPeriods(serverTime);
    const makeGroup = period => {
      const current = this.ensurePeriod(userId, period, periods[period].periodId);
      return {
        periodId: periods[period].periodId,
        resetsAt: periods[period].resetsAt,
        missions: current.definitions.map(definition => missionView(definition, current.progress, current.claimed)),
      };
    };
    // wallet 是本账本累计已领任务奖励，不是扣除本机消费后的可用余额。
    // 非秘密的持久标识供客户端按账本幂等导入；身份认证仍要求原始会话 cookie。
    return { serverTime, rewardLedgerId: userId, daily: makeGroup('daily'), weekly: makeGroup('weekly'), wallet: this.store.getWallet(userId) };
  }

  /** 装备道具校验（开局注入，重放必须同清单复现）：存在且有 effects、去重、上限 3 */
  validateItems(items) {
    if (items === undefined) return [];
    if (!Array.isArray(items) || items.length > 3) throw new ApiError(400, 'items 必须是不超过 3 个的道具数组');
    const seen = new Set();
    for (const id of items) {
      if (typeof id !== 'string' || seen.has(id)) throw new ApiError(400, 'items 含无效或重复道具');
      seen.add(id);
      if (itemEffects(this.content, id).length === 0) throw new ApiError(400, '未知道具: ' + String(id).slice(0, 32));
    }
    return [...seen];
  }

  startRun(userId, { seed, charId, items, themeId }) {
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new ApiError(400, 'seed 必须是 32 位无符号整数');
    const equip = this.validateItems(items);
    if (typeof charId !== 'string' || charId.length > 96) throw new ApiError(400, 'charId 必须是有效角色 ID');
    if (charId && !playableCharacters(this.content).some(character => character.id === charId && !isCharacterLocked(character))) {
      throw new ApiError(400, '所选角色不存在或不可使用');
    }
    if (themeId !== undefined && (typeof themeId !== 'string' || !(this.content.themes.items ?? [])
      .some(theme => theme.id === themeId && ['live', 'draft'].includes(theme.status)))) throw new ApiError(400, '所选主题不存在或不可使用');
    const startedAt = this.now();
    const periods = getMissionPeriods(startedAt);
    this.ensurePeriod(userId, 'daily', periods.daily.periodId);
    this.ensurePeriod(userId, 'weekly', periods.weekly.periodId);
    // 已过期票据不能结算，也不能继续占用开局名额；不依赖后台清理时机。
    if (this.store.countOpenRuns(userId, startedAt - this.limits.runTicketTtlMs) >= (this.limits.openRunsPerUser ?? 4)) {
      throw new ApiError(429, '已有过多进行中的跑酷记录，请先完成或等待过期');
    }
    const id = randomUUID();
    const rulesId = this.captureRules();
    this.store.createRun({ id, userId, startedAt, dailyId: periods.daily.periodId, weeklyId: periods.weekly.periodId,
      seed, charId, items: equip, themeId: resolveRunThemeId(this.content, themeId), rulesId });
    return { runId: id };
  }

  async finishRun(userId, runId, { frames, actions }) {
    const run = this.store.getRun(runId, userId);
    if (!run) throw new ApiError(404, '找不到这场跑酷记录');
    // Finished legacy rows need only their stored payload hash, not a reconstructable old engine.
    const definition = run.status === 'finished' ? null : readBoundRuleset(this.store, run.rules_id);
    const canonicalPayload = canonicalReplayPayload(frames, actions, definition);
    const payloadHash = createHash('sha256').update(canonicalPayload).digest('hex');
    if (run.status === 'finished') {
      if (run.payload_hash !== payloadHash) throw new ApiError(409, '这场记录已结算，不能更换回放内容');
      return this.snapshot(userId);
    }

    const startedAt = Number(run.started_at);
    const finishStartedAt = this.now();
    const elapsedMs = finishStartedAt - startedAt;
    if (elapsedMs < 0 || elapsedMs > this.limits.runTicketTtlMs) throw new ApiError(410, '跑酷记录已过期，请重新开始');

    if (this.activeReplays >= this.limits.maxConcurrentReplays) throw new ApiError(429, '结算繁忙，请稍后重试');
    this.activeReplays++;
    let replay;
    try {
      const runtime = await loadReplayRuntime(definition, this.trustedRuntimeHashes);
      const minimumElapsed = Math.max(0, frames * runtime.STEP_DT * 1000 - this.limits.replayTimeAllowanceMs);
      if (elapsedMs < minimumElapsed) throw new ApiError(425, '结算时间过快，请稍后重试');
      replay = await runtime.replayRun(definition.content, run, frames, actions, this.limits.replayWallClockMs, parseItemsJson(run.items_json));
    }
    catch (error) {
      // 墙钟超时：run 保持 open 可重试；不是客户端的 payload 问题，返回 408 而非 4xx 语义混淆
      if (error?.code === 'REPLAY_TIMEOUT') throw new ApiError(408, '回放超时，请稍后重试');
      throw error;
    }
    finally { this.activeReplays--; }
    if (replay.frames !== frames) throw new ApiError(400, '回放包含死亡后的额外帧，请按死亡帧结束');
    // 与排行榜 replay-worker 同口径：有效局必须以死亡帧收尾（endless runner 只有一种终局）。
    // 不校验 alive 时，脚本可提交任意 ≥minRunSeconds 的存活截断局刷 mruns/mnohit（审查 S-1）。
    const validRun = replay.elapsedSeconds + 1e-9 >= definition.minRunSeconds && replay.summary.alive === false;
    const finishedAt = this.now();
    const metrics = {
      distanceM: replay.summary.distance, coins: replay.summary.coins,
      slides: validCount(replay.missionStats?.slides) ? replay.missionStats.slides : 0,
      runs: 1, skillCasts: replay.summary.casts, nearMiss: replay.summary.nearMiss,
      cleanRuns: replay.summary.hits === 0 ? 1 : 0, score: replay.summary.score,
      itemPickups: validCount(replay.missionStats?.itemPickups) ? replay.missionStats.itemPickups : 0,
    };
    this.store.transaction(() => {
      const latest = this.store.getRun(runId, userId);
      if (latest?.status === 'finished' && latest.payload_hash === payloadHash) return;
      if (!latest || latest.status !== 'open') throw new ApiError(409, '跑酷记录已被处理');
      if (validRun) {
        const current = getMissionPeriods(finishedAt);
        if (run.daily_id === current.daily.periodId) {
          this.ensurePeriod(userId, 'daily', current.daily.periodId);
          updatePeriodProgress(this.store, userId, 'daily', current.daily.periodId, metrics);
        }
        if (run.weekly_id === current.weekly.periodId) {
          this.ensurePeriod(userId, 'weekly', current.weekly.periodId);
          const playedCount = replay.summary.charId ? this.store.addWeeklyCharacter(userId, current.weekly.periodId, replay.summary.charId) : 0;
          updatePeriodProgress(this.store, userId, 'weekly', current.weekly.periodId, metrics, playedCount);
        }
      }
      if (this.store.markRunFinished(runId, finishedAt, payloadHash, validRun) !== 1) throw new ApiError(409, '跑酷记录已被处理');
    });
    return this.snapshot(userId);
  }

  claim(userId, { period, periodId, missionId }) {
    if (!['daily', 'weekly'].includes(period) || typeof periodId !== 'string' || typeof missionId !== 'string') {
      throw new ApiError(400, '领取请求必须包含有效的 period、periodId 与 missionId');
    }
    const now = this.now();
    const current = getMissionPeriods(now);
    if (periodId !== current[period].periodId) throw new ApiError(409, '任务周期已刷新，请领取当前周期任务');
    this.store.transaction(() => {
      const missions = this.ensurePeriod(userId, period, periodId);
      const definition = missions.definitions.find(item => item.id === missionId);
      if (!definition) throw new ApiError(404, '找不到该任务');
      if (missions.claimed[missionId] === true) return;
      if (Number(missions.progress[missionId] ?? 0) < definition.target) throw new ApiError(409, '任务尚未完成，暂时不能领取奖励');
      missions.claimed[missionId] = true;
      this.store.saveClaimed(userId, period, periodId, missions.claimed);
      for (const [kind, value] of Object.entries(definition.reward)) {
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
