/**
 * 文本排版（纯逻辑，可 node 单测）：中英文混排、换行（\n + 自动折行）、对齐。
 * 输出每字形四边形（README §3 的 UI 屏幕系公式已在此算好，渲染层直接上传顶点）。
 * 折行规则：空格与 CJK 字符（cp≥0x2E80）后均可断行；超长单词强断；行首空格不占位。
 */
import type { FontSet, SdfGlyph } from './metrics.js';
import { fallbackAdvance } from './metrics.js';

export type TextAlign = 'left' | 'center' | 'right';

export interface TextStyle {
  fontSizePx: number;
  /** 行高倍数（乘 baseline.lineHeightPx*k），默认 1 */
  lineHeightMul?: number;
  /** 行内对齐（相对 maxWidthPx 或最宽行），默认 left */
  align?: TextAlign;
  /** 折行宽度；缺省不折行（仍处理 \n） */
  maxWidthPx?: number;
}

/** 已定位的字形四边形（UI 屏幕系：x 右、y 下、原点在文本块左上角） */
export interface PlacedQuad {
  atlasIndex: number;
  x: number;
  y: number;
  w: number;
  h: number;
  uv: { x0: number; y0: number; x1: number; y1: number };
}

/** 缺字占位方块 */
export interface TofuRect { x: number; y: number; w: number; h: number }

export interface TextLayout {
  quads: PlacedQuad[];
  tofus: TofuRect[];
  /** 文本块宽（最宽行；≤ maxWidthPx，除强断长词） */
  width: number;
  /** 文本块高（行数 × 行高） */
  height: number;
  lineCount: number;
}

interface Item {
  cp: number;
  glyph: SdfGlyph | undefined;
  atlasIndex: number;
  w: number;
  space: boolean;
  /** 本字符之后允许断行（CJK / 空格） */
  breakAfter: boolean;
}

function toItems(font: FontSet, text: string, k: number, fontSizePx: number): Item[] {
  const items: Item[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    const found = font.lookup(cp);
    const w = found ? found.glyph.advance * k : fallbackAdvance(cp, fontSizePx);
    const space = cp === 32;
    items.push({
      cp, glyph: found?.glyph, atlasIndex: found?.atlasIndex ?? -1, w, space,
      breakAfter: space || cp >= 0x2e80,
    });
  }
  return items;
}

/** 贪心折行：返回各行（Item 数组），行首/行尾空格已剔除 */
function wrapLines(items: Item[], maxWidth: number | undefined): Item[][] {
  const paragraphs: Item[][] = [];
  let cur: Item[] = [];
  for (const it of items) {
    if (it.cp === 10) { paragraphs.push(cur); cur = []; continue; }
    cur.push(it);
  }
  paragraphs.push(cur);

  const lines: Item[][] = [];
  for (const para of paragraphs) {
    let line: Item[] = [];
    let lineW = 0;
    let lastBreak = -1; // line 中「其后可断」的下标
    const flush = () => {
      while (line.length && line[line.length - 1]!.space) { line.pop(); }
      lines.push(line);
      line = []; lineW = 0; lastBreak = -1;
    };
    for (const it of para) {
      if (maxWidth !== undefined && lineW + it.w > maxWidth && line.length > 0 && !it.space) {
        if (lastBreak >= 0) {
          // 在最后一个断点处折行（断点若是空格则丢弃它）
          const head = line.slice(0, lastBreak + 1);
          const tail = line.slice(lastBreak + 1);
          line = head;
          flush();
          for (const t of tail) { line.push(t); lineW += t.w; if (t.breakAfter) lastBreak = line.length - 1; }
          while (line.length && line[0]!.space) { line.shift(); lineW = line.reduce((s, x) => s + x.w, 0); }
        } else {
          flush(); // 无断点（超长单词）：强断
        }
      }
      line.push(it);
      lineW += it.w;
      if (it.breakAfter) lastBreak = line.length - 1;
    }
    flush();
  }
  // 行尾空格不计入宽度：flush 已 pop；空段落产生空行（保留，撑行高）
  return lines;
}

function lineWidth(line: Item[]): number {
  let w = 0;
  for (const it of line) w += it.w;
  return w;
}

export function layoutText(font: FontSet, text: string, style: TextStyle): TextLayout {
  const S = Math.max(0, style.fontSizePx);
  const k = S / font.sdf.fontSize;
  const buffer = font.sdf.buffer;
  const lineH = font.baseline.lineHeightPx * k * Math.max(0.1, style.lineHeightMul ?? 1);
  const asc = font.baseline.ascenderPx * k;
  const desc = -font.baseline.descenderPx * k; // descenderPx 为负 → 正值深度
  const leading = Math.max(0, lineH - font.baseline.lineHeightPx * k);

  const lines = wrapLines(toItems(font, text, k, S), style.maxWidthPx);
  const naturalW = lines.reduce((m, l) => Math.max(m, lineWidth(l)), 0);
  const basis = style.maxWidthPx !== undefined ? Math.max(style.maxWidthPx, 0) : naturalW;
  const align = style.align ?? 'left';

  const quads: PlacedQuad[] = [];
  const tofus: TofuRect[] = [];
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li]!;
    const w = lineWidth(line);
    const dx = align === 'center' ? (basis - w) / 2 : align === 'right' ? basis - w : 0;
    const baselineY = leading / 2 + asc + li * lineH;
    let penX = dx;
    for (const it of line) {
      const g = it.glyph;
      if (!g) {
        // 图集外字符：占位方块（README §6——不崩溃）
        tofus.push({ x: penX + it.w * 0.1, y: baselineY - S * 0.78, w: it.w * 0.8, h: S * 0.7 });
      } else if (g.inkW > 0 || g.inkH > 0) {
        quads.push({
          atlasIndex: it.atlasIndex,
          x: penX + (g.bearingX - buffer) * k,
          y: baselineY - (g.bearingY + buffer) * k,
          w: g.cell.w * k,
          h: g.cell.h * k,
          uv: g.uv,
        });
      }
      penX += it.w;
    }
  }
  const height = lines.length === 0 ? 0 : leading + asc + (lines.length - 1) * lineH + desc;
  return { quads, tofus, width: naturalW, height, lineCount: lines.length };
}

/** 布局用测量（Label.node() 的 content 尺寸）：只取宽高，不保留四边形 */
export function measureText(font: FontSet, text: string, style: TextStyle): { w: number; h: number } {
  const l = layoutText(font, text, style);
  return { w: l.width, h: l.height };
}
