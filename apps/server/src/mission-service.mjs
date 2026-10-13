import { createHash, randomUUID } from 'node:crypto';
import { getMissionPeriods } from './periods.mjs';
import { ApiError } from './errors.mjs';
import { replayRun, STEP_DT } from './replay.mjs';
import { DEFAULT_LIMITS } from './limits.mjs';
import { playableCharacters, isCharacterLocked } from '@tr/game/core/sim/character.js';

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
    if (!daily.pool.some(mission => mission.tier === tier)) throw new Error(`daily missions has no ${tier} mission`);
  }
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
        } else if (!['coin', 'key'].includes(kind) || !Number.isSafeInteger(value) || value < 0) {
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
    const candidates = config.daily.pool.filter(mission => mission.tier === tier);
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
  constructor({ store, content, now = Date.now, limits = {}, minRunSeconds }) {
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
  }

  ensurePeriod(userId, period, periodId) {
    const config = this.content.economy.params.missions;
    return this.store.ensurePeriod(userId, period, periodId, selectedMissions(userId, period, periodId, config));
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
    return { serverTime, daily: makeGroup('daily'), weekly: makeGroup('weekly'), wallet: this.store.getWallet(userId) };
  }

  startRun(userId, { seed, charId }) {
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new ApiError(400, 'seed 必须是 32 位无符号整数');
    if (typeof charId !== 'string' || charId.length > 96) throw new ApiError(400, 'charId 必须是有效角色 ID');
    if (charId && !playableCharacters(this.content).some(character => character.id === charId && !isCharacterLocked(character))) {
      throw new ApiError(400, '所选角色不存在或不可使用');
    }
    const startedAt = this.now();
    const periods = getMissionPeriods(startedAt);
    this.ensurePeriod(userId, 'daily', periods.daily.periodId);
    this.ensurePeriod(userId, 'weekly', periods.weekly.periodId);
    const id = randomUUID();
    this.store.createRun({ id, userId, startedAt, dailyId: periods.daily.periodId, weeklyId: periods.weekly.periodId, seed, charId });
    return { runId: id };
  }

  async finishRun(userId, runId, { frames, actions }) {
    if (!Number.isInteger(frames) || frames <= 0 || frames > this.limits.maxFrames) {
      throw new ApiError(400, `frames 必须是 1 到 ${this.limits.maxFrames} 的整数`);
    }
    if (!Array.isArray(actions) || actions.length > this.limits.maxActions) throw new ApiError(400, 'actions 数量超出限制');
    let previousFrame = -1;
    for (const action of actions) {
      if (!action || typeof action !== 'object' || Array.isArray(action) || Object.keys(action).some(key => !['frame', 'action'].includes(key)) || !Number.isInteger(action.frame) || action.frame < 0 || action.frame >= frames || action.frame < previousFrame || !['laneL', 'laneR', 'jump', 'slide', 'skill'].includes(action.action)) {
        throw new ApiError(400, 'actions 必须按帧排序，且包含有效 frame/action');
      }
      previousFrame = action.frame;
    }
    const canonicalPayload = JSON.stringify({ frames, actions: actions.map(({ frame, action }) => ({ frame, action })) });
    const payloadHash = createHash('sha256').update(canonicalPayload).digest('hex');
    const run = this.store.getRun(runId, userId);
    if (!run) throw new ApiError(404, '找不到这场跑酷记录');
    if (run.status === 'finished') {
      if (run.payload_hash !== payloadHash) throw new ApiError(409, '这场记录已结算，不能更换回放内容');
      return this.snapshot(userId);
    }

    const startedAt = Number(run.started_at);
    const finishStartedAt = this.now();
    const elapsedMs = finishStartedAt - startedAt;
    if (elapsedMs < 0 || elapsedMs > this.limits.runTicketTtlMs) throw new ApiError(410, '跑酷记录已过期，请重新开始');
    const minimumElapsed = Math.max(0, frames * STEP_DT * 1000 - this.limits.replayTimeAllowanceMs);
    if (elapsedMs < minimumElapsed) throw new ApiError(425, '结算时间过快，请稍后重试');

    if (this.activeReplays >= this.limits.maxConcurrentReplays) throw new ApiError(429, '结算繁忙，请稍后重试');
    this.activeReplays++;
    let replay;
    try { replay = await replayRun(this.content, run, frames, actions); }
    finally { this.activeReplays--; }
    if (replay.frames !== frames) throw new ApiError(400, '回放包含死亡后的额外帧，请按死亡帧结束');
    const validRun = replay.elapsedSeconds + 1e-9 >= this.minRunSeconds;
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
        if (run.daily_id === current.daily.periodId) updatePeriodProgress(this.store, userId, 'daily', current.daily.periodId, metrics);
        if (run.weekly_id === current.weekly.periodId) {
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
