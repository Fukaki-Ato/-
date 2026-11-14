/**
 * 配置数据结构的类型定义（core 层）
 * 对应文档：docs/03（数据配置规范）。这里只声明 M0 用到的字段，
 * 校验逻辑在 configValidator.ts；后续里程碑按需补全类型即可。
 */

/** 多语言文本：{ "zh-CN": "...", "en-US": "..." } */
export type I18n = Record<string, string>;

/** 带 id 的通用条目（characters/skills/items/themes/events 等文件的数组元素） */
export interface NamedEntry extends Record<string, unknown> {
  id: string;
  name?: I18n;
  status?: 'draft' | 'live' | 'retired';
}

/** 单个配置文件的外层信封 */
export interface ConfigFile<TItems = NamedEntry[]> {
  configVersion: string;
  minEngineVersion?: string;
  updatedAt?: string;
  items?: TItems;
}

/** game.json / economy.json 是参数集而不是条目数组 */
export interface ParamsFile {
  configVersion: string;
  params: Record<string, unknown>;
}

/** obstacles.json 特殊：defs + patterns + difficultyCurve + dropTable */
export interface ObstaclesFile {
  configVersion: string;
  defs: NamedEntry[];
  patterns: Array<{ id: string; minDifficulty: number; weight: number; lengthSegments: number;
    cells: Array<{ segment: number; lane: number; offsetM: number; obsRef?: string; coins?: number; surface?: string; pickupRef?: string }>;
    guarantee?: { safeLanePattern: number[] } }>;
  difficultyCurve: Array<{ by: number; poolWeights: Record<string, number>; coinDensity: number; pickupRate: number }>;
  dropTable: { pickupBoxRatePerSeg: number; weights: Record<string, number> };
}

/**
 * 成就 stat 全集（achievements.json）。stat 命名与任务指标同源（mission 重放 metrics 键，
 * 如技能释放是 skillCasts 而非 sim.summary() 的 casts），服务端 applyRunMetrics 泛化直读零映射。
 */
/** source=run 条目可用：服务端重放可供给（SUPPORTED_METRICS ∖ charactersPlayed + jumps/itemOf 显式新增） */
export const ACH_RUN_STATS = ['distanceM', 'coins', 'slides', 'jumps', 'itemPickups', 'itemOf', 'runs', 'skillCasts', 'nearMiss', 'cleanRuns', 'score'] as const;
/** source=local 条目可用：设备本机自记，服务端不可验证（run 条目禁用，标错即服务端恒 0 的死条目） */
export const ACH_LOCAL_STATS = ['charactersUnlocked'] as const;

export type AchievementStat = (typeof ACH_RUN_STATS)[number] | (typeof ACH_LOCAL_STATS)[number];
export type AchievementSource = 'run' | 'local';
export type AchievementTier = 'bronze' | 'silver' | 'gold';
export type AchievementGroup = 'run' | 'skill' | 'collect' | 'chars';

/** 成就奖励：货币为正整数（零值奖励=可领取却发不出的死条目）；shard 为「存在的碎片id:正整数」 */
export interface AchievementReward {
  coin?: number;
  key?: number;
  diamond?: number;
  shard?: string;
}

/** 单条成就（achievements.json items 元素）；stat=itemOf 时 statRef 指向目标道具 id */
export interface AchievementEntry extends Record<string, unknown> {
  id: string;
  versions: unknown[];
  name: I18n;
  desc: I18n;
  stat: AchievementStat;
  statRef?: string;
  target: number;
  tier: AchievementTier;
  source: AchievementSource;
  group: AchievementGroup;
  reward: AchievementReward;
  /** 生命周期（与 NamedEntry.status 同枚举）：draft/retired 不进页面不可领（achievementLive） */
  status?: 'draft' | 'live' | 'retired';
}

/** 加载完成后拼给业务层的「全量内容」 */
export interface GameContent {
  game: ParamsFile;
  characters: ConfigFile;
  skills: ConfigFile;
  items: ConfigFile;
  obstacles: ObstaclesFile;
  themes: ConfigFile;
  events: ConfigFile;
  economy: ParamsFile;
  /** 运行时仍按 CONTENT_NAMES 要求文件齐备（configLoader 缺文件即 report.ok=false），可选仅为兼容旧构造点 */
  achievements?: ConfigFile<AchievementEntry[]>;
}

export type ContentName = keyof GameContent;

/** 每个文件在内容包里的名字与「条目所在处」的取法（校验与引用检查共用） */
export const CONTENT_NAMES: ContentName[] = ['game', 'characters', 'skills', 'items', 'obstacles', 'themes', 'events', 'economy', 'achievements'];
