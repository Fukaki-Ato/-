/**
 * 玩家档案数据层（core，纯逻辑：零 three、零 DOM、零 Math.random）
 * 职责：10 位玩家 ID 的生成与持久化、名字、头像序号、改名次数与扣钻规则。
 *
 * 边界说明（重要）：
 * - ID 只保证**本机唯一**。跨玩家的全局唯一要服务端发号，本项目当前没有后端，
 *   所以这里是「首次生成后固定不变」，不做也不可能有跨设备去重。
 * - 名字候选来自 config/game.json params.profile.nameCandidates（脏列回退内置名单）：
 *   本项目无文字输入能力，改名只能从预设名单里点选，本模块只校验约束（非空、不超字数、与当前不同）。
 * - 钻石余额由调用方传入并回写，本模块不碰 DIAMOND_KEY（那是 mainFlow 的键）。
 */
import type { SyncStorage } from '@tr/framework/platform/platformAdapter.js';
import { hashSeed, mulberry32 } from '../rng.js';

export const PLAYER_ID_KEY = 'thunderrun:player-id';
export const PLAYER_NAME_KEY = 'thunderrun:player-name';
export const PLAYER_AVATAR_KEY = 'thunderrun:player-avatar';
export const PLAYER_RENAMES_KEY = 'thunderrun:player-renames';

/** 默认名：档案页在玩家没改过名字时显示它 */
export const DEFAULT_NAME = '小跑者';

/**
 * 预设昵称：本项目没有文字输入能力（页面全是点选交互），改名只能从这份名单里挑。
 * 上限 6 个——档案面板一行放 3 个按钮、两行封顶，再多就顶穿 375px 宽的屏。
 */
export const DEFAULT_NAME_CANDIDATES = ['小跑者', '闪电少年', '海滨酷跑王', '椰子骑士', '风驰电掣', '钻石收藏家'];
export const MAX_NAME_CANDIDATES = 6;

export interface ProfileParams {
  /** 玩家 ID 位数 */
  idDigits: number;
  /** 名字最大汉字数 */
  nameMaxChars: number;
  /** 免费改名次数，用完开始扣钻 */
  freeRenames: number;
  /** 超出免费次数后每次改名的钻石价 */
  renameCostDiamonds: number;
  /** 档案面板占屏幕高度的百分比 */
  panelHeightPct: number;
  /** 面板滑入/滑出时长（毫秒） */
  slideDurationMs: number;
  /** 可点选的昵称名单 */
  nameCandidates: string[];
}

/** 兜底默认值：config/game.json params.profile 缺字段时逐项回退到这里 */
export const DEFAULT_PROFILE_PARAMS: ProfileParams = {
  idDigits: 10, nameMaxChars: 6, freeRenames: 1, renameCostDiamonds: 20,
  panelHeightPct: 55, slideDurationMs: 240, nameCandidates: DEFAULT_NAME_CANDIDATES,
};

/** 名单清洗：非字符串/空串/超长的一律丢掉并去重；整列不可用回退内置名单。
 *  nameMaxChars 压得比内置名还短时名单可能为空——那是配置自相矛盾，面板就不出改名候选，
 *  宁可没有按钮，也不摆一个点了必被判「名字不合规」的假选项。 */
function candidatesFrom(raw: unknown, maxChars: number): string[] {
  const kept: string[] = [];
  for (const v of Array.isArray(raw) ? raw : []) {
    const s = String(v ?? '').trim();
    if (s && s.length <= maxChars && !kept.includes(s)) kept.push(s);
    if (kept.length >= MAX_NAME_CANDIDATES) break;
  }
  return kept.length ? kept : DEFAULT_NAME_CANDIDATES.filter(s => s.length <= maxChars).slice(0, MAX_NAME_CANDIDATES);
}

/** 从 game.json params 取段；脏值（非有限数/越界）逐项回退默认，不把 NaN 带进 UI */
export function profileParamsFrom(raw: unknown): ProfileParams {
  const src = (raw ?? {}) as Record<string, unknown>;
  type NumericKey = Exclude<keyof ProfileParams, 'nameCandidates'>;
  // 只认 number 与「非空数字字符串」（手写 config 常带引号）；null/''/true 之类一律算缺失回默认，
  // 否则 Number(null)=0 会把「没配」当成「配了 0」。
  const num = (key: NumericKey, lo: number, hi: number): number => {
    const v = src[key];
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
    return Number.isFinite(n) && n >= lo && n <= hi ? n : DEFAULT_PROFILE_PARAMS[key];
  };
  const nameMaxChars = num('nameMaxChars', 1, 12);
  return {
    // 位数下限 4：少于 4 位太容易撞号；上限 18：JS 整数安全范围内留足余量
    idDigits: num('idDigits', 4, 18),
    nameMaxChars,
    freeRenames: num('freeRenames', 0, 99),
    renameCostDiamonds: num('renameCostDiamonds', 0, 999999),
    panelHeightPct: num('panelHeightPct', 20, 100),
    slideDurationMs: num('slideDurationMs', 0, 2000),
    nameCandidates: candidatesFrom(src['nameCandidates'], nameMaxChars),
  };
}

export interface PlayerProfile {
  id: string;
  name: string;
  avatar: number;
  renames: number;
}

/** 正整数读法：脏值/缺失回退 0（与 mainFlow.readCount 同口径） */
function readCount(storage: SyncStorage, key: string): number {
  const n = Number(storage.get(key) ?? '0');
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * 生成 idDigits 位十进制 ID（首位非 0，保证位数稳定）。
 * 随机源走 core/rng 的 mulberry32（core 禁 Math.random）；熵来自调用方给的 seedText，
 * 生产用时间戳，测试注入固定串即可复现。
 */
export function generatePlayerId(seedText: string, digits: number): string {
  const rand = mulberry32(hashSeed(seedText));
  let out = String(1 + Math.floor(rand() * 9));
  for (let i = 1; i < digits; i++) out += String(Math.floor(rand() * 10));
  return out;
}

/** 读档案；ID 缺失或脏（位数不对/含非数字）时重新生成并落盘，之后永不再变 */
export function loadProfile(storage: SyncStorage, p: ProfileParams, entropy = Date.now()): PlayerProfile {
  const rawId = storage.get(PLAYER_ID_KEY);
  const idOk = typeof rawId === 'string' && new RegExp(`^[1-9]\\d{${p.idDigits - 1}}$`).test(rawId);
  let id = idOk ? rawId as string : '';
  if (!id) {
    // 熵里带上一次读到的脏值：同一毫秒内重复调用也不会生成同一个 ID
    id = generatePlayerId(`${entropy}-${rawId ?? 'new'}`, p.idDigits);
    storage.set(PLAYER_ID_KEY, id);
  }
  const rawAv = Number(storage.get(PLAYER_AVATAR_KEY) ?? '0');
  return {
    id,
    name: storage.get(PLAYER_NAME_KEY) || DEFAULT_NAME,
    avatar: Number.isFinite(rawAv) && rawAv >= 0 ? Math.floor(rawAv) : 0,
    renames: readCount(storage, PLAYER_RENAMES_KEY),
  };
}

export function saveProfile(storage: SyncStorage, prof: PlayerProfile): void {
  storage.set(PLAYER_ID_KEY, prof.id);
  storage.set(PLAYER_NAME_KEY, prof.name);
  storage.set(PLAYER_AVATAR_KEY, String(prof.avatar));
  storage.set(PLAYER_RENAMES_KEY, String(prof.renames));
}

/** 换头像：越界序号一律忽略（返回原档案），调用方据此判断是否要刷新 */
export function withAvatar(prof: PlayerProfile, index: number, count: number): PlayerProfile {
  if (!Number.isInteger(index) || index < 0 || index >= count || index === prof.avatar) return prof;
  return { ...prof, avatar: index };
}

export type RenameFail = 'invalid' | 'same' | 'need-diamonds';

export type RenameResult =
  | { ok: true; profile: PlayerProfile; cost: number; diamondsLeft: number }
  | { ok: false; reason: RenameFail; cost: number; diamonds: number };

/**
 * 改名规则：免费次数用完开始扣钻；钱不够直接失败且**不扣费、不计数**。
 * 顺序不能换 —— 先判合法性再判钱，否则非法名字会把「钻石不足」的错误提示顶掉。
 */
export function tryRename(prof: PlayerProfile, p: ProfileParams, name: string, diamonds: number): RenameResult {
  const trimmed = (name ?? '').trim();
  if (!trimmed || trimmed.length > p.nameMaxChars) return { ok: false, reason: 'invalid', cost: 0, diamonds };
  if (trimmed === prof.name) return { ok: false, reason: 'same', cost: 0, diamonds };
  const free = prof.renames < p.freeRenames;
  const cost = free ? 0 : p.renameCostDiamonds;
  if (diamonds < cost) return { ok: false, reason: 'need-diamonds', cost, diamonds };
  return {
    ok: true,
    profile: { ...prof, name: trimmed, renames: prof.renames + 1 },
    cost,
    diamondsLeft: diamonds - cost,
  };
}
