/**
 * 配置校验器（core 层，纯函数、零依赖，浏览器与 Node 测试共用）
 * 对应文档：docs/03 §8（校验规则）。是 schema/config.schema.json 的「运行时轻量版」，
 * 只做结构与引用检查，不做全量 JSON Schema（那是 CI 里 ajv 的职责，M2 接入）。
 */
import type { ConfigFile, GameContent, NamedEntry, ObstaclesFile, ParamsFile } from './configTypes.js';
import { isPrimitiveSupported } from '../effects/buffEngine.js';

/** 各文件条目 id 的合法前缀（docs/03 §1.1）；数组表示允许多种 */
const ID_PREFIX: Record<string, string[]> = {
  characters: ['char_', 'skin_'],
  skills: ['skill_', 'talent_'],
  items: ['item_'],
  themes: ['theme_'],
  events: ['event_'],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** 单文件基础校验：信封 + 条目 id 唯一/前缀 + versions 存在 */
export function validateFile(name: string, data: unknown): string[] {
  const errors: string[] = [];
  const file = data as ConfigFile & ParamsFile & Partial<ObstaclesFile>;
  if (!isRecord(file)) return [`${name}: 不是 JSON 对象`];
  if (typeof file.configVersion !== 'string') errors.push(`${name}: 缺少 configVersion`);

  // game / economy：参数集，只查 params 是非空对象；game 额外校验 UI 技术段。
  if (name === 'game' || name === 'economy') {
    if (!isRecord(file.params)) errors.push(`${name}: 缺少 params 对象`);
    else if (name === 'game') errors.push(...validateUiParams(file.params.ui));
    return errors;
  }
  // obstacles：三段结构分别校验
  if (name === 'obstacles') {
    if (!Array.isArray(file.defs)) errors.push('obstacles: 缺少 defs 数组');
    if (!Array.isArray(file.patterns)) errors.push('obstacles: 缺少 patterns 数组');
    if (!Array.isArray(file.difficultyCurve)) errors.push('obstacles: 缺少 difficultyCurve 数组');
    const obsIds = collectIds(file.defs ?? [], 'obs_', errors, 'obstacles.defs');
    for (const pat of file.patterns ?? []) {
      if (!pat.id?.startsWith('pat_')) errors.push(`obstacles.patterns: id 前缀应为 pat_（${pat.id}）`);
      for (const cell of pat.cells ?? []) {
        if (cell.obsRef && !obsIds.has(cell.obsRef)) errors.push(`${pat.id}: obsRef 不存在 -> ${cell.obsRef}`);
      }
    }
    const patIds = new Set((file.patterns ?? []).map(p => p.id));
    for (const curve of file.difficultyCurve ?? []) {
      for (const key of Object.keys(curve.poolWeights ?? {})) {
        if (!patIds.has(key)) errors.push(`difficultyCurve.by=${curve.by}: 模板不存在 -> ${key}`);
      }
    }
    // 闪电圈段（可选）：ref 必须指向 defs；everyM 为正数（缺省=不生成，不算错）
    const zap = (file as { zap?: unknown }).zap;
    if (zap !== undefined) {
      if (!isRecord(zap)) errors.push('obstacles.zap: 应为对象');
      else {
        if (typeof zap.ref !== 'string' || !obsIds.has(zap.ref)) errors.push(`obstacles.zap: ref 不存在 -> ${String(zap.ref)}`);
        if (typeof zap.everyM !== 'number' || !(zap.everyM > 0)) errors.push('obstacles.zap: everyM 应为正数');
      }
    }
    return errors;
  }

  // characters/skills/items/themes/events：标准 items 数组
  if (!Array.isArray(file.items)) { errors.push(`${name}: 缺少 items 数组`); return errors; }
  collectIds(file.items, ID_PREFIX[name] ?? [], errors, name);
  for (const entry of file.items) {
    if (!Array.isArray(entry.versions) || (entry.versions as unknown[]).length === 0) {
      errors.push(`${name}.${entry.id}: 缺少 versions 记录（docs/03 §1.4）`);
    }
  }
  return errors;
}

/** 收集并检查 id：前缀合法 + 不重复。返回 id 集合供引用检查。 */
function collectIds(entries: NamedEntry[], prefix: string | string[], errors: string[], where: string): Set<string> {
  const ids = new Set<string>();
  const prefixes = Array.isArray(prefix) ? prefix : [prefix];
  for (const entry of entries) {
    if (typeof entry.id !== 'string' || entry.id.length === 0) { errors.push(`${where}: 存在无 id 条目`); continue; }
    if (!prefixes.some(p => entry.id.startsWith(p))) errors.push(`${where}: id 前缀应为 ${prefixes.join('/')}（${entry.id}）`);
    if (ids.has(entry.id)) errors.push(`${where}: id 重复 -> ${entry.id}`);
    ids.add(entry.id);
  }
  return ids;
}

/**
 * 跨文件引用检查：所有 *Ref 指向的 id 必须存在（docs/03 §8 规则 3）。
 * 返回错误列表；空数组 = 通过。
 */
export function validateRefs(content: GameContent): string[] {
  const errors: string[] = [];
  const idsOf = (file: ConfigFile): Set<string> => new Set((file.items ?? []).map(i => i.id));
  const chars = idsOf(content.characters);
  const skills = idsOf(content.skills);
  const items = idsOf(content.items);
  const themes = idsOf(content.themes);
  const offers = new Set((((content.economy.params?.shop as { offers?: { id: string }[] } | undefined)?.offers) ?? []).map(o => o.id));
  const shards = new Set((((content.economy.params?.shards ?? []) as { id: string; grants: string }[])).map(s => s.id));

  const need = (owner: string, ref: unknown, pool: Set<string>, label: string) => {
    if (typeof ref === 'string' && ref.length > 0 && !pool.has(ref)) errors.push(`${owner}: ${label} 不存在 -> ${ref}`);
  };

  for (const entry of content.characters.items ?? []) {
    if (entry.id.startsWith('char_')) {
      need(entry.id, entry.skillRef, skills, 'skillRef');
      need(entry.id, entry.talentRef, skills, 'talentRef');
      for (const skin of (entry.skins as string[] | undefined) ?? []) need(entry.id, skin, chars, 'skins[]');
    } else {
      need(entry.id, entry.baseRef, chars, 'baseRef');
    }
  }
  for (const file of [content.items, content.skills]) {
    for (const entry of file.items ?? []) {
      for (const eff of (entry.effects as { primitive?: string }[] | undefined) ?? []) {
        if (typeof eff?.primitive !== 'string') { errors.push(`${entry.id}: effect 缺少 primitive`); continue; }
        // 内容只能由「引擎已注册的原语」组成：新增原语是代码任务（docs/10 §3.1 [PRIMITIVE]）
        if (!isPrimitiveSupported(eff.primitive)) {
          errors.push(`${entry.id}: primitive '${eff.primitive}' 未在 core/effects 注册（需先做代码任务）`);
        }
      }
    }
  }
  for (const ev of content.events.items ?? []) {
    const ov = ev.overrides as { themeRef?: string } | undefined;
    need(ev.id, ov?.themeRef, themes, 'overrides.themeRef');
    for (const extra of (ev.shopExtras as { offerRef: string }[] | undefined) ?? []) need(ev.id, extra.offerRef, offers, 'shopExtras.offerRef');
    const lb = ev.leaderboard as { topReward?: Record<string, string> } | undefined;
    for (const v of Object.values(lb?.topReward ?? {})) if (typeof v === 'string' && v.startsWith('shard_') && !shards.has(v.split(':')[0])) errors.push(`${ev.id}: 奖励碎片不存在 -> ${v}`);
  }
  for (const shard of ((content.economy.params?.shards ?? []) as { id: string; grants: string }[])) {
    need(shard.id, shard.grants, chars, 'shards.grants');
  }
  for (const loot of ((content.economy.params?.lootTables ?? []) as { id: string; entries: { ref: string }[] }[])) {
    for (const e of loot.entries ?? []) {
      const base = e.ref.split(':')[0];
      // coin/key 是货币速记写法；其余必须是道具/角色/碎片 id
      const ok = base === 'coin' || base === 'key' || items.has(base) || chars.has(base) || shards.has(base);
      if (!ok) errors.push(`${loot.id}: 奖池引用不存在 -> ${e.ref}`);
    }
  }
  // dropTable 权重键必须指向 pickup 道具
  for (const key of Object.keys(content.obstacles.dropTable?.weights ?? {})) need('obstacles.dropTable', key, items, 'dropTable.weights');
  return errors;
}

/**
 * 技术段 params.ui（S4 自绘 UI 手感参数，与 packages/ui/src/uiConfig.ts 默认值同源）。
 * 缺省段/字段不报错（运行时按 defaultUiConfig 兜底）；出现即校验类型与范围，防手滑数值进包。
 */
const UI_RULES: { section: string; key: string; min: number; max: number; minOpen: boolean }[] = [
  { section: 'scroll', key: 'frictionPerS', min: 0, max: 60, minOpen: true },
  { section: 'scroll', key: 'minVelocityPxS', min: 0, max: 1000, minOpen: false },
  { section: 'scroll', key: 'flingMaxPxS', min: 0, max: 60000, minOpen: true },
  { section: 'scroll', key: 'overscrollResist', min: 0, max: 1, minOpen: true },
  { section: 'scroll', key: 'bounceStiffness', min: 0, max: 5000, minOpen: true },
  { section: 'scroll', key: 'bounceDamping', min: 0, max: 500, minOpen: true },
  { section: 'scroll', key: 'settleEpsPx', min: 0, max: 10, minOpen: true },
  { section: 'scroll', key: 'settleEpsPxS', min: 0, max: 200, minOpen: true },
  { section: 'press', key: 'slopPx', min: 0, max: 100, minOpen: false },
  { section: 'press', key: 'tapMaxMs', min: 0, max: 5000, minOpen: true },
  { section: 'doubleTap', key: 'windowMs', min: 0, max: 2000, minOpen: true },
  { section: 'doubleTap', key: 'maxDistPx', min: 0, max: 500, minOpen: true },
  { section: 'text', key: 'fontSizePx', min: 4, max: 200, minOpen: false },
  { section: 'text', key: 'lineHeightMul', min: 0.8, max: 4, minOpen: false },
];

export function validateUiParams(ui: unknown): string[] {
  if (ui === undefined) return [];
  if (!isRecord(ui)) return ['game.params.ui: 应为对象（技术段，S4）'];
  const errors: string[] = [];
  const obj = ui as Record<string, unknown>;
  for (const section of ['scroll', 'press', 'doubleTap', 'text']) {
    const sec = obj[section];
    if (sec === undefined) continue;
    if (!isRecord(sec)) { errors.push(`game.params.ui.${section}: 应为对象`); continue; }
  }
  for (const rule of UI_RULES) {
    const sec = obj[rule.section];
    if (!isRecord(sec)) continue;
    const v = sec[rule.key];
    if (v === undefined) continue;
    const where = `game.params.ui.${rule.section}.${rule.key}`;
    if (typeof v !== 'number' || !Number.isFinite(v)) { errors.push(`${where}: 应为有限数值（得到 ${JSON.stringify(v)}）`); continue; }
    const lo = rule.minOpen ? v > rule.min : v >= rule.min;
    if (!lo || v > rule.max) errors.push(`${where}: ${v} 超出范围 ${rule.minOpen ? '(' : '['}${rule.min}, ${rule.max}]`);
  }
  return errors;
}
