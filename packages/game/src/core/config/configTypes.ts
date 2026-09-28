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
}

export type ContentName = keyof GameContent;

/** 每个文件在内容包里的名字与「条目所在处」的取法（校验与引用检查共用） */
export const CONTENT_NAMES: ContentName[] = ['game', 'characters', 'skills', 'items', 'obstacles', 'themes', 'events', 'economy'];
