/**
 * 主题：配色（对齐 apps/web/style.css 的 docs/05 §2 色彩系统）+ 程序化九宫格皮肤。
 * createTheme() 生成 4 张小 DataTexture（panel/card/button/buttonPrimary），view.dispose 释放。
 */
import type * as THREE from 'three';
import type { Edges } from './types.js';
import { createSkinTexture, mixHex } from './render/skinTexture.js';
import type { NinePatchSource } from './render/ninePatch.js';

export interface ThemeColors {
  bg: string;
  panel: string;
  card: string;
  line: string;
  text: string;
  muted: string;
  neon: string;
  gold: string;
  danger: string;
}

export const defaultThemeColors: ThemeColors = {
  bg: '#0B1226',
  panel: '#141C33',
  card: '#1B2540',
  line: '#2A3A5F',
  text: '#EAF2FF',
  muted: '#93A5C6',
  neon: '#7FD1FF',
  gold: '#FFD84D',
  danger: '#FF8F8F',
};

export interface ThemeSkinSet {
  panel: NinePatchSource;
  card: NinePatchSource;
  button: NinePatchSource;
  buttonPrimary: NinePatchSource;
}

export type SkinKey = keyof ThemeSkinSet;

export interface Theme {
  colors: ThemeColors;
  skins: ThemeSkinSet;
  /** 按压态乘色（材质 color 由白变暗，免换贴图） */
  pressedTint: THREE.ColorRepresentation;
  dispose(): void;
}

function skin(fill: string, border: string | null, radiusPx: number, borderPx: number): { src: NinePatchSource; texture: THREE.Texture } {
  const { texture, insets, sizePx } = createSkinTexture({ fill, border, radiusPx, borderPx, fillAlpha: 1 });
  return { src: { texture, insets: insets as Edges, texSize: { w: sizePx, h: sizePx } }, texture };
}

export function createTheme(colors?: Partial<ThemeColors>): Theme {
  const c: ThemeColors = { ...defaultThemeColors, ...(colors ?? {}) };
  const made = [
    skin(c.panel, c.line, 14, 1),                       // panel
    skin(c.card, c.line, 10, 1),                        // card
    skin(c.card, mixHex(c.line, c.neon, 0.35), 8, 1),   // button
    skin(mixHex(c.neon, c.bg, 0.62), c.neon, 8, 1),     // buttonPrimary（深青底 + 霓虹描边）
  ];
  const skins: ThemeSkinSet = {
    panel: made[0]!.src,
    card: made[1]!.src,
    button: made[2]!.src,
    buttonPrimary: made[3]!.src,
  };
  return {
    colors: c,
    skins,
    pressedTint: '#b8c6d8',
    dispose() {
      for (const m of made) m.texture.dispose();
    },
  };
}
