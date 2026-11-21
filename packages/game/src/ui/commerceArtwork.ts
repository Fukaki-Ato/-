import { Box, type NinePatchSource, type Widget } from '@tr/framework/ui/index.js';
import type { UiHost } from '@tr/framework/ui/host.js';
import type { GameContent } from '../core/config/configTypes.js';
import { buildLoadout, playableCharacters } from '../core/sim/character.js';
import { coast, text } from './welfareCards.js';

export interface CommerceArtwork {
  portraits?: Partial<Record<string, NinePatchSource>>;
  content?: GameContent;
}

/** Host-owned NoColorSpace UI sources are reused, never cloned or recolored. */
export function characterPortrait(id: string, artwork: CommerceArtwork): Box | undefined {
  const source = artwork.portraits?.[id];
  if (!source) return undefined;
  const width = 64, height = 86;
  const scale = Math.min(width / source.texSize.w, height / source.texSize.h);
  return new Box({ width, height, align: 'center', justify: 'end' }, [
    new Box({ width: source.texSize.w * scale, height: source.texSize.h * scale, background: source }),
  ]);
}

/** Guard buildLoadout's legacy default-character fallback at this exact-id boundary. */
export function characterAbilities(id: string, artwork: CommerceArtwork): Widget[] {
  const content = artwork.content;
  if (!content || !playableCharacters(content).some(character => character.id === id)) return [];
  const load = buildLoadout(content, id), skill = load.skill;
  const lines: Widget[] = [];
  if (skill) {
    lines.push(text(`技能：${skill.label}`, 14, coast.sea), text(skill.desc, 13));
    const trigger = skill.trigger === 'double_tap' ? '双击屏幕触发' : `触发：${skill.trigger}`;
    const gate = skill.chargeSlides > 0 ? `主动下滑 ${skill.chargeSlides} 次` : '开局即可释放';
    lines.push(text(`${trigger} · ${gate} · 冷却 ${skill.cooldownS}s`, 12, coast.muted));
  }
  if (load.talentLabel) lines.push(text(`天赋：${load.talentLabel}`, 14, coast.sea), text(load.talentDesc, 13));
  return lines;
}

/** Configuration swatches, explicitly not a gameplay screenshot. */
export function themePalette(host: UiHost, id: string, artwork: CommerceArtwork): Widget[] {
  const theme = artwork.content?.themes.items?.find(entry => entry.id === id);
  if (!theme) return [];
  const sky = theme.sky as { baseColor?: string } | undefined;
  const fog = theme.fog as { color?: string } | undefined;
  const colors = [sky?.baseColor, fog?.color, theme.groundColor];
  if (!colors.every(color => typeof color === 'string')) return [];
  return [new Box({ direction: 'row', height: 44 }, colors.map(color =>
    new Box({ width: 0, flex: 1, background: host.solidSkin, backgroundColor: color as string }))),
  text('配色预览 · 天空 / 雾 / 地面', 12, coast.muted)];
}
