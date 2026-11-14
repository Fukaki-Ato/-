const { createHash } = require('node:crypto');
const { reject } = require('./run-policy.cjs');
const { publicProfile } = require('./profile.cjs');
const TITLES = {
  mdist: '跑步达到目标距离', mcoin: '收集金币', mslide: '完成滑铲', mruns: '完成对局',
  mskill: '释放技能', mnear: '触发擦身', mnohit: '无受击完成对局', mscore: '达到目标分数',
  wdist: '本周跑步距离', wskill: '本周释放技能', wpickup: '本周拾取道具', wchars: '本周使用不同角色',
};
const METRICS = new Set(['distanceM', 'coins', 'slides', 'runs', 'skillCasts', 'nearMiss',
  'cleanRuns', 'score', 'itemPickups', 'charactersPlayed']);

function validateConfig(economy) {
  const { missions, handbook } = economy.params;
  if (!Number.isFinite(missions?.minRunSeconds) || missions.minRunSeconds < 0 || missions.minRunSeconds > 600
    || missions.daily?.pick !== 3 || missions.weekly?.pick !== 4 || missions.weekly.pool.length !== 4
    || !handbook?.chapters?.length) throw new Error('Invalid welfare configuration');
  for (const tier of ['easy', 'mid', 'hard']) {
    if (!missions.daily.pool.some(item => item.tier === tier)) throw new Error(`Missing daily tier ${tier}`);
  }
  for (const definitions of [missions.daily.pool, missions.weekly.pool, handbook.chapters]) {
    const ids = new Set();
    for (const definition of definitions) {
      if (typeof definition.id !== 'string' || ids.has(definition.id) || !METRICS.has(definition.metric)
        || !Number.isFinite(definition.target) || definition.target <= 0) throw new Error('Invalid welfare definition');
      ids.add(definition.id);
      for (const [kind, amount] of Object.entries(definition.reward)) {
        if (kind === 'shard') {
          if (typeof amount !== 'string' || !/^[a-z][a-z0-9_]*:[1-9]\d*$/.test(amount)
            || !Number.isSafeInteger(Number(amount.split(':')[1]))) throw new Error('Invalid shard reward');
        } else if (!['coin', 'diamond', 'key'].includes(kind) || !Number.isSafeInteger(amount) || amount < 0) {
          throw new Error('Invalid welfare reward');
        }
      }
    }
  }
}

function selectedMissions(playerId, period, periodId, config) {
  if (period === 'weekly') return structuredClone(config.weekly.pool);
  return ['easy', 'mid', 'hard'].map(tier => {
    const candidates = config.daily.pool.filter(item => item.tier === tier);
    const hash = createHash('sha256').update(`${playerId}:${periodId}:${tier}`).digest();
    return structuredClone(candidates[hash.readUInt32BE(0) % candidates.length]);
  });
}

// Copy snapshots and strip SDK metadata on every full-document write path.
function ensureWelfare(profile, runtime, timestamp) {
  const { _id, ...stored } = profile;
  const next = structuredClone(stored), periods = runtime.getMissionPeriods(timestamp);
  const config = runtime.economy.params;
  let changed = !next.welfare;
  next.welfare ??= {};
  for (const period of ['daily', 'weekly']) {
    if (next.welfare[period]?.periodId !== periods[period].periodId) {
      next.welfare[period] = { ...periods[period], definitions: selectedMissions(profile.playerId,
        period, periods[period].periodId, config.missions), progress: {}, claimed: {}, characters: [] };
      changed = true;
    }
  }
  if (!next.welfare.handbook) {
    next.welfare.handbook = { definitions: structuredClone(config.handbook.chapters), progress: {}, claimed: {}, characters: [] };
    changed = true;
  }
  return { profile: next, changed };
}

function touchProfile(profile, timestamp) {
  const revision = profile.revision + 1;
  if (!Number.isSafeInteger(revision)) reject('PROFILE_LIMIT');
  return { ...profile, revision, updatedAt: new Date(timestamp).toISOString() };
}

function missionView(definition, state) {
  return { id: definition.id, title: definition.title ?? TITLES[definition.id] ?? definition.id,
    metric: definition.metric, target: definition.target,
    progress: Math.round(Math.min(definition.target, state.progress[definition.id] ?? 0) * 100) / 100,
    reward: { ...definition.reward }, claimed: state.claimed[definition.id] === true };
}

function welfareView(profile, runtime, timestamp) {
  const { daily, weekly, handbook } = profile.welfare;
  const group = state => ({ periodId: state.periodId, resetsAt: state.resetsAt,
    missions: state.definitions.map(definition => missionView(definition, state)) });
  return { profile: publicProfile(profile), serverTime: timestamp,
    minRunSeconds: runtime.economy.params.missions.minRunSeconds,
    daily: group(daily), weekly: group(weekly),
    handbook: handbook.definitions.map((definition, index) => ({ ...missionView(definition, handbook),
      description: definition.description, unlocked: index === 0
        || handbook.claimed[handbook.definitions[index - 1].id] === true })) };
}

function advance(state, metrics, charId) {
  const characterTarget = Math.max(0, ...state.definitions
    .filter(item => item.metric === 'charactersPlayed').map(item => item.target));
  if (characterTarget && charId && !state.characters.includes(charId) && state.characters.length < characterTarget) {
    state.characters.push(charId);
  }
  for (const definition of state.definitions) {
    const previous = state.progress[definition.id] ?? 0;
    const value = definition.metric === 'charactersPlayed' ? state.characters.length : metrics[definition.metric];
    state.progress[definition.id] = Math.min(definition.target,
      definition.type === 'bestScore' || definition.metric === 'score' || definition.metric === 'charactersPlayed'
        ? Math.max(previous, value) : previous + value);
  }
}

function recordWelfareRun(profile, run, result, runtime, timestamp) {
  const next = ensureWelfare(profile, runtime, timestamp).profile;
  if (!(result.elapsedSeconds + 1e-9 >= runtime.economy.params.missions.minRunSeconds)) return next;
  const { summary, missionStats } = result;
  const metrics = { distanceM: summary.distance, coins: summary.coins, runs: 1,
    slides: missionStats?.slides ?? 0, skillCasts: summary.casts, nearMiss: summary.nearMiss,
    cleanRuns: summary.hits === 0 ? 1 : 0, score: summary.score, itemPickups: missionStats?.itemPickups ?? 0 };
  for (const period of ['daily', 'weekly']) {
    const group = next.welfare[period];
    if (run[`${period}Id`] === group.periodId) advance(group, metrics, run.charId);
  }
  advance(next.welfare.handbook, metrics, run.charId);
  return next;
}

function grantReward(profile, reward) {
  for (const [kind, value] of Object.entries(reward)) {
    const [item, amount] = kind === 'shard' ? value.split(':') : [kind, value];
    const target = ['coin', 'diamond'].includes(item) ? profile.wallet : profile.inventory.items;
    const total = (target[item] ?? 0) + Number(amount);
    if (!Number.isSafeInteger(total) || total < 0) reject('PROFILE_LIMIT');
    target[item] = total;
  }
}

function claimWelfare(profile, event) {
  let state, definition;
  if (event.action === 'mission.claim') {
    state = profile.welfare[event.period];
    if (state.periodId !== event.periodId) reject('PERIOD_EXPIRED');
    definition = state.definitions.find(item => item.id === event.missionId);
  } else {
    state = profile.welfare.handbook;
    const index = state.definitions.findIndex(item => item.id === event.chapterId);
    definition = state.definitions[index];
    if (index > 0 && !state.claimed[state.definitions[index - 1].id]) reject('CHAPTER_LOCKED');
  }
  if (!definition) reject('REWARD_UNAVAILABLE');
  if (state.claimed[definition.id]) return false;
  if ((state.progress[definition.id] ?? 0) < definition.target) reject('REWARD_NOT_READY');
  grantReward(profile, definition.reward);
  state.claimed[definition.id] = true;
  return true;
}

module.exports = { validateConfig, selectedMissions, ensureWelfare, touchProfile, welfareView,
  recordWelfareRun, claimWelfare };
