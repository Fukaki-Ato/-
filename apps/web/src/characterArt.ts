/**
 * 角色选择页头像/形象模块（通用新建角色入口）。
 * 目标：新增角色只改 config/characters.json + 模型资源，不再回来改选角页的映射表。
 * 解析顺序（高优先级在前）：
 *   1) 历史 sprite sheet 已收录的角色：逐字保留原有 cell，避免现有 5 个角色外观变化；
 *   2) 其余角色：按 config 的 tint + 中文首字生成通用形象，保证新角色合入即可见。
 */
import runnerSheet from './assets/character-select/runners-sheet-centered.png';

export type CharacterArtKind = 'sheet' | 'generated';

export interface CharacterArtInput {
  charId: string;
  name: string;
  tint: string;
}

export interface CharacterArt {
  kind: CharacterArtKind;
  /** sprite sheet 背景定位（kind=sheet） */
  position?: [string, string];
  /** 通用形象的首字（kind=generated） */
  initial: string;
  tint: string;
}

/** 历史 sprite sheet 的 3×2 cell；仅覆盖已有外观，新角色不要求继续往里加图。 */
const SHEET_CELLS: Record<string, [string, string]> = {
  char_volt: ['0%', '0%'],
  char_ama: ['50%', '0%'],
  char_kaze: ['100%', '0%'],
  char_rina: ['0%', '100%'],
  char_bolt: ['50%', '100%'],
};

function firstGlyph(name: string): string {
  const trimmed = [...String(name ?? '')].filter(ch => ch.trim().length > 0);
  return trimmed[0] ?? '跑';
}

/** 纯函数：任何角色 id 都能得到形象来源，缺图不抛错、不白屏。 */
export function getCharacterArt(input: CharacterArtInput): CharacterArt {
  const tint = /^#[0-9A-Fa-f]{6}$/.test(input.tint) ? input.tint : '#7FD1FF';
  return {
    kind: SHEET_CELLS[input.charId] ? 'sheet' : 'generated',
    position: SHEET_CELLS[input.charId],
    initial: firstGlyph(input.name),
    tint,
  };
}

function sdf(tag: keyof HTMLElementTagNameMap, text: string, className: string, color: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  node.style.color = color;
  return node;
}

/** 把形象刷到一个已存在的 DOM 节点（英雄大图 / 名卡小图复用）。 */
export function applyCharacterArt(el: HTMLElement, art: CharacterArt): void {
  el.style.setProperty('--char-tint', art.tint);
  el.classList.toggle('is-sheet-art', art.kind === 'sheet');
  el.classList.toggle('is-generic-art', art.kind !== 'sheet');
  if (art.kind === 'sheet' && art.position) {
    el.style.backgroundImage = `url("${runnerSheet}")`;
    el.style.backgroundPosition = `${art.position[0]} ${art.position[1]}`;
    el.replaceChildren();
    return;
  }
  el.style.backgroundImage = '';
  el.replaceChildren(sdf('span', art.initial, 'select-portrait-initial', '#fff8e5'));
}

/** 创建角色形象节点；className 由选角页传入（hero / roster card 同一套逻辑）。 */
export function createCharacterPortrait(input: CharacterArtInput, className: string): HTMLDivElement {
  const portrait = document.createElement('div');
  portrait.className = className;
  portrait.setAttribute('aria-hidden', 'true');
  applyCharacterArt(portrait, getCharacterArt(input));
  return portrait;
}
