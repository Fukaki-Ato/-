/**
 * 成就本地进度（flow 层，宿主中立）：本机 totals 是 run 类成就的离线预览口径 + local 类
 * （角色解锁）的记账处；run 类的权威进度与领取在服务端重放（apps/server/src/achievement-service.mjs），
 * 服务端按 rewardLedgerId 幂等发奖，本文件不参与发奖、也不与服务端互相同步。
 * 存储键独立命名——不占钱包键名空间（RewardWalletStore 只重定向 coins/diamonds/keys/shard:/item: 前缀），
 * JSON 脏值容错归零（missionApiCore 待同步队列同式）。
 */
import type { AchievementEntry, AchievementReward, GameContent } from '../core/config/configTypes.js';
import type { RunnerSim } from '../core/sim/runnerSim.js';
import { unlockedCharacterIds } from './unlock.js';
import { grant, type BuyResult, type EconomyStore } from './localEconomy.js';

export const ACH_STATS_KEY = 'thunderrun:ach-stats-v1';
export const ACH_CLAIMED_KEY = 'thunderrun:ach-claimed-v1';

/** totals 键与 ACH 指标名逐一同名（itemOf 分道具）；summary.casts 在 applyRunDelta 映射进 skillCasts */
export interface AchTotals {
  slides: number; jumps: number; coins: number; itemPickups: number;
  itemOf: Record<string, number>;
  runs: number; distanceM: number; skillCasts: number;
  nearMiss: number; cleanRuns: number; score: number;
  charactersUnlocked: number;
}

/** 生效短局阈值：镜像服务端 mission-service 的解析（0..600，缺省 10）；
 *  差异：服务端允许 options.minRunSeconds 覆盖（测试用 0），客户端只读 config——
 *  显式覆盖的部署两端预览阈值偏移，见 docs/missions-backend.md。 */
export function achievementMinRunSeconds(content: GameContent | null): number {
  const missions = (content?.economy.params?.missions ?? {}) as { minRunSeconds?: unknown };
  const v = Number(missions.minRunSeconds);
  return Number.isFinite(v) && v >= 0 && v <= 600 ? v : 10;
}

function emptyTotals(): AchTotals {
  return {
    slides: 0, jumps: 0, coins: 0, itemPickups: 0, itemOf: {},
    runs: 0, distanceM: 0, skillCasts: 0, nearMiss: 0, cleanRuns: 0, score: 0,
    charactersUnlocked: 0,
  };
}

const num = (v: unknown): number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0 ? v : 0;

function readTotals(storage: EconomyStore): AchTotals {
  try {
    const raw: unknown = JSON.parse(storage.get(ACH_STATS_KEY) ?? '');
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return emptyTotals();
    const r = raw as Record<string, unknown>;
    const itemOf: Record<string, number> = {};
    if (r['itemOf'] && typeof r['itemOf'] === 'object' && !Array.isArray(r['itemOf'])) {
      for (const [k, v] of Object.entries(r['itemOf'] as Record<string, unknown>)) {
        if (/^[a-z][a-z0-9_]*$/.test(k)) itemOf[k] = num(v); // 键即道具 id，脏键直接丢弃
      }
    }
    return {
      slides: num(r['slides']), jumps: num(r['jumps']), coins: num(r['coins']),
      itemPickups: num(r['itemPickups']), itemOf,
      runs: num(r['runs']), distanceM: num(r['distanceM']), skillCasts: num(r['skillCasts']),
      nearMiss: num(r['nearMiss']), cleanRuns: num(r['cleanRuns']), score: num(r['score']),
      charactersUnlocked: num(r['charactersUnlocked']),
    };
  } catch { return emptyTotals(); }
}

function readClaimed(storage: EconomyStore): Set<string> {
  try {
    const raw: unknown = JSON.parse(storage.get(ACH_CLAIMED_KEY) ?? '[]');
    return new Set(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []);
  } catch { return new Set(); }
}

/** reward → grant 入参：空奖励/非正整数/坏 shard 串都返回 null（零值奖励=可领取却发不出的死条目，
 *  config 层已拦，这里对运行时传入的 def 再兜一道）。 */
function rewardToGive(reward: AchievementReward): { item: string; n: number }[] | null {
  if (!reward || typeof reward !== 'object' || Array.isArray(reward)) return null;
  const give: { item: string; n: number }[] = [];
  for (const [kind, value] of Object.entries(reward)) {
    if (kind === 'shard') {
      if (typeof value !== 'string' || !/^[a-z][a-z0-9_]*:[1-9]\d*$/.test(value)) return null;
      const [item, n] = value.split(':');
      give.push({ item, n: Number(n) });
    } else if (kind === 'coin' || kind === 'key' || kind === 'diamond') {
      if (!Number.isSafeInteger(value) || (value as number) <= 0) return null;
      give.push({ item: kind, n: value as number });
    } else return null;
  }
  return give.length ? give : null;
}

export interface AchievementTracker {
  /** 一局收口入账（仅死亡且时长达标的局；调用方=mainFlow.trackAchievements 的 finish 函数）。
   *  score 取 MAX（单局最佳口径，与服务端 bestStat 一致），其余累加；casts→skillCasts 映射。 */
  applyRunDelta(summary: ReturnType<RunnerSim['summary']>, missionStats: { slides: number; jumps: number; itemPickups: number }, pickupsById: Record<string, number>): void;
  /** 角色解锁落盘：以 thunderrun:unlocks 为准取 MAX 自愈（覆盖存量解锁与重复回调） */
  applyCharacterUnlock(): void;
  totals(): AchTotals;
  claimedIds(): ReadonlySet<string>;
  /** local 条目领取：先自行校验奖励全为正整数再走本机经济发货（run 条目由服务端发放，此处拒绝） */
  claimLocal(def: AchievementEntry): BuyResult;
}

export function createAchievementTracker(storage: EconomyStore): AchievementTracker {
  /** 读即对账：charactersUnlocked 以解锁集合为准取 MAX——成就上线前已解锁角色的玩家即见正确进度 */
  const read = (): AchTotals => {
    const totals = readTotals(storage);
    const unlocked = unlockedCharacterIds(storage).size;
    if (unlocked > totals.charactersUnlocked) totals.charactersUnlocked = unlocked;
    return totals;
  };
  const write = (totals: AchTotals): void => { storage.set(ACH_STATS_KEY, JSON.stringify(totals)); };
  return {
    applyRunDelta(summary, missionStats, pickupsById) {
      const t = read();
      t.slides += Math.max(0, missionStats.slides);
      t.jumps += Math.max(0, missionStats.jumps);
      t.itemPickups += Math.max(0, missionStats.itemPickups);
      t.coins += Math.max(0, summary.coins);
      t.distanceM += Math.max(0, Math.floor(summary.distance)); // 每局取整（预览口径，服务端按 REAL 累计）
      t.runs += 1;
      t.skillCasts += Math.max(0, summary.casts); // summary 字段名 casts ↔ 指标名 skillCasts（runnerSim 字段不动，此处唯一映射点）
      t.nearMiss += Math.max(0, summary.nearMiss);
      t.cleanRuns += summary.hits === 0 ? 1 : 0;
      t.score = Math.max(t.score, summary.score);
      for (const [id, n] of Object.entries(pickupsById)) {
        if (n > 0) t.itemOf[id] = (t.itemOf[id] ?? 0) + n;
      }
      write(t);
    },
    applyCharacterUnlock() { write(read()); },
    totals: read,
    claimedIds: () => readClaimed(storage),
    claimLocal(def) {
      if (def.source !== 'local') return { ok: false, message: '该成就奖励由服务器发放，请联网领取' };
      if (readClaimed(storage).has(def.id)) return { ok: false, message: '已领取过该奖励' };
      const give = rewardToGive(def.reward);
      if (!give) return { ok: false, message: '奖励配置无效，暂时不能领取' };
      grant(storage, give);
      storage.set(ACH_CLAIMED_KEY, JSON.stringify([...readClaimed(storage), def.id]));
      return { ok: true, message: '成就奖励已存入本机钱包' };
    },
  };
}
