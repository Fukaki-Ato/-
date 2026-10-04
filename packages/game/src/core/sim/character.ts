/**
 * 角色装配（docs/09 T2.4；设计见 docs/01 §6、docs/03 §4.1-4.2）
 * 职责：把 characters.json 的一行变成 sim 能用的「装备包」：
 *   主动技能（冷却/积攒门槛/原语组合）+ 被动天赋（开局施加的原语）。
 * 铁律：本文件不出现任何角色专属分支——换角色或调技能只改 JSON（C3）。
 */
import type { EffectParams, StackRule } from '../effects/buffEngine.js';
import type { GameContent, NamedEntry } from '../config/configTypes.js';

/** 一条待施加的原语 */
export interface EffectSpec {
  primitive: string;
  params: EffectParams;
  /** HUD 显示名：道具名或技能名（文本来自配置，不硬编码） */
  label: string;
  stackRule: StackRule;
}

/** 主动技能（含冷却与释放门槛） */
export interface ActiveSkill {
  id: string;
  label: string;
  desc: string;
  cooldownS: number;
  /**
   * 释放门槛：需要累计多少次主动下滑（skills.json charge.slides）。
   * 0 = 无积攒门槛，只看冷却（开局第 0 秒即可释放）。
   */
  chargeSlides: number;
  /** 释放方式（skills.json trigger，如 double_tap） */
  trigger: string;
  effects: EffectSpec[];
}

/** 一个角色的完整装配结果 */
export interface Loadout {
  charId: string;
  name: string;
  tagline: string;
  tint: string;
  rarity: string;
  skill: ActiveSkill | null;
  passive: EffectSpec[];
  /** 被动天赋文案（菜单展示） */
  talentLabel: string;
  talentDesc: string;
  /** 渲染装配（docs/05 §3、§4.4）：默认皮肤的配色与模型缩放，改 JSON 即换外观 */
  skinId: string;
  bodyTint: string;
  emissive: string;
  modelScale: number;
}

/** 可出战角色 = char_ 前缀且 status=live */
export function playableCharacters(content: GameContent): NamedEntry[] {
  return (content.characters.items ?? []).filter(c => String(c.id).startsWith('char_') && c.status !== 'draft' && c.status !== 'retired');
}

const text = (v: unknown, dflt = ''): string => {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object') {
    const o = v as Record<string, string>;
    return o['zh-CN'] ?? o['en-US'] ?? dflt;
  }
  return dflt;
};

const number = (v: unknown, dflt: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : dflt);

/**
 * 把一条 skills/items 的 effects 数组翻译成引擎可施加的规格。
 * permanent=true 时丢掉 durationS：被动天赋是「整局常驻」（配置里写 3600 秒只是占位，
 * 让 HUD 显示「3595s」很怪，且整局时长上限远小于 1 小时）。
 */
function toSpecs(entry: NamedEntry | undefined, fallbackRule: StackRule, permanent = false): EffectSpec[] {
  const list = (entry?.['effects'] as Array<Record<string, unknown>> | undefined) ?? [];
  const label = text(entry?.name);
  return list
    .filter(e => typeof e['primitive'] === 'string')
    .map(e => {
      const { primitive, durationS, ...rest } = e;
      void durationS;
      return {
        primitive: primitive as string,
        params: (permanent ? rest : { durationS, ...rest }) as EffectParams,
        label, stackRule: fallbackRule,
      };
    });
}

function findEntry(content: GameContent, ref: unknown): NamedEntry | undefined {
  if (typeof ref !== 'string' || !ref) return undefined;
  const inSkills = (content.skills.items ?? []).find(s => s.id === ref);
  return inSkills ?? (content.characters.items ?? []).find(c => c.id === ref);
}

/**
 * 装配角色。找不到 id 时返回空装备（默认手感），绝不抛错——
 * 启动路径上任何配置问题都应在 configValidator 里先被报出来。
 */
export function buildLoadout(content: GameContent, charId: string): Loadout {
  const chars = playableCharacters(content);
  const c = chars.find(x => x.id === charId) ?? chars[0];
  const base: Loadout = {
    charId: c?.id ?? '', name: text(c?.name, '跑者'), tagline: text(c?.tagline),
    tint: text(c?.tint, '#7FD1FF'), rarity: String(c?.rarity ?? 'R'),
    skill: null, passive: [], talentLabel: '', talentDesc: '',
    skinId: '', bodyTint: text(c?.tint, '#7FD1FF'), emissive: text(c?.tint, '#7FD1FF'), modelScale: 1,
  };
  if (!c) return base;

  // 渲染装配：默认皮肤（skins[0]）的 materialOverrides 决定体色与发光色，model.scale 决定体量
  const model = (c['model'] ?? {}) as Record<string, unknown>;
  if (typeof model.scale === 'number' && model.scale > 0) base.modelScale = model.scale;
  const skinId = (((c.skins as string[] | undefined) ?? [])[0]) ?? '';
  const skin = (content.characters.items ?? []).find(x => x.id === skinId);
  const overrides = (skin?.materialOverrides ?? {}) as Record<string, unknown>;
  base.skinId = skinId;
  base.bodyTint = text(overrides.bodyTint, base.tint);
  base.emissive = text(overrides.emissive, base.tint);

  const skillEntry = findEntry(content, c.skillRef);
  if (skillEntry && skillEntry['kind'] === 'active') {
    const charge = (skillEntry['charge'] ?? {}) as Record<string, unknown>;
    base.skill = {
      id: skillEntry.id,
      label: text(skillEntry.name, skillEntry.id),
      desc: text(skillEntry.desc),
      cooldownS: Math.max(0, number(skillEntry['cooldownS'], 18)),
      // 仅支持下滑积攒（slides）；配置写了别的 mode 就退回「只看冷却」
      chargeSlides: charge['type'] === 'slideCount' ? Math.max(0, Math.round(number(charge['slides'], 0))) : 0,
      trigger: String(skillEntry['trigger'] ?? 'double_tap'),
      effects: toSpecs(skillEntry, 'refresh'),
    };
  }

  const talentEntry = findEntry(content, c.talentRef);
  if (talentEntry && talentEntry['kind'] === 'passive') {
    base.passive = toSpecs(talentEntry, 'refresh', true);
    base.talentLabel = text(talentEntry.name, talentEntry.id);
    base.talentDesc = text(talentEntry['desc']);
  }
  return base;
}

/** 道具拾取 → 原语规格（stackRule 取 items.json 的声明） */
export function itemEffects(content: GameContent, itemId: string): EffectSpec[] {
  const it = (content.items.items ?? []).find(x => x.id === itemId);
  if (!it) return [];
  const rule = String(it['stackRule'] ?? 'refresh') as StackRule;
  return toSpecs(it, rule === 'stack' || rule === 'replace' ? rule : 'refresh');
}
