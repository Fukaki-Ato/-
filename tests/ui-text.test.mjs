/**
 * SDF 文本排版测试（S4 · text/layoutText.ts + text/metrics.ts）。
 * 度量锚定 assets/fonts/README.md §3：k = S/fontSize、pen 原点、bearingY 向上为正、advance 笔进量。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutText, measureText } from '../packages/framework/dist/ui/index.js';
import { loadTestFontSet } from './ui-helpers.mjs';

const font = loadTestFontSet();
const glyph = (ch, atlas = 0) => font.atlases[atlas].glyphs.get(ch.codePointAt(0));

test('单行测量：宽度 = Σadvance×k（k=S/fontSize）', () => {
  const m = measureText(font, 'AB', { fontSizePx: 40 });
  const want = glyph('A').advance + glyph('B').advance; // k=1
  assert.ok(Math.abs(m.w - want) < 1e-6, `${m.w} vs ${want}`);
  const half = measureText(font, 'AB', { fontSizePx: 20 });
  assert.ok(Math.abs(half.w - want / 2) < 1e-6);
});

test('中英混排：latin 走图集0、CJK 走图集1，pen 连续', () => {
  const l = layoutText(font, 'A雷', { fontSizePx: 40 });
  assert.equal(l.quads.length, 2);
  const [qa, qc] = l.quads;
  assert.equal(qa.atlasIndex, 0);
  assert.equal(qc.atlasIndex, 1);
  // 雷 的 pen 在 A 之后：quadX(c) ≈ advance(A) + (bearingX-buffer)*k
  const g = glyph('雷', 1);
  assert.ok(Math.abs(qc.x - (glyph('A').advance + (g.bearingX - font.sdf.buffer))) < 1e-6);
  // quadY = baselineY - (bearingY+buffer)*k；baselineY = leading/2 + ascender（lineHeightMul=1 → leading=0）
  const baseY = font.baseline.ascenderPx;
  assert.ok(Math.abs(qc.y - (baseY - (g.bearingY + font.sdf.buffer))) < 1e-6);
});

test('空格不产四边形但推进 pen；\n 强制换行', () => {
  const l = layoutText(font, 'A B', { fontSizePx: 40 });
  assert.equal(l.quads.length, 2);
  const gb = glyph('B');
  const penB = glyph('A').advance + glyph(' ').advance;
  assert.ok(Math.abs(l.quads[1].x - (penB + (gb.bearingX - font.sdf.buffer))) < 1e-6);
  const two = layoutText(font, 'A\nB', { fontSizePx: 40 });
  assert.equal(two.lineCount, 2);
  assert.ok(two.height > l.height);
});

test('自动折行：空格断行，行宽不超 maxWidth', () => {
  const l = layoutText(font, 'hello world foo bar', { fontSizePx: 20, maxWidthPx: 80 });
  assert.ok(l.lineCount >= 2);
  assert.ok(l.width <= 80 + 1e-6, `width=${l.width}`);
});

test('CJK 逐字可断行；超长单词强断不溢出', () => {
  const cjk = layoutText(font, '雷霆酷跑雷霆酷跑雷霆酷跑', { fontSizePx: 20, maxWidthPx: 60 });
  assert.ok(cjk.lineCount >= 3);
  assert.ok(cjk.width <= 60 + 1e-6);
  const long = layoutText(font, 'Supercalifragilisticexpialidocious', { fontSizePx: 20, maxWidthPx: 60 });
  assert.ok(long.lineCount >= 2);
});

test('对齐：center/right 相对基准产生行偏移', () => {
  const style = { fontSizePx: 20, maxWidthPx: 200 };
  const left = layoutText(font, 'AB\nABCDEFGH', style);
  const center = layoutText(font, 'AB\nABCDEFGH', { ...style, align: 'center' });
  const right = layoutText(font, 'AB\nABCDEFGH', { ...style, align: 'right' });
  const firstQuadX = l => l.quads.find(q => q.y === Math.min(...l.quads.map(x => x.y))).x;
  assert.ok(firstQuadX(center) > firstQuadX(left));
  assert.ok(firstQuadX(right) > firstQuadX(center));
});

test('图集外字符 → 占位方块（tofu），不崩溃且有笔进量', () => {
  const l = layoutText(font, 'A\u{2F801}B', { fontSizePx: 20 }); // U+2F801 不在字符集且字体真缺
  assert.equal(l.tofus.length, 1);
  assert.ok(l.tofus[0].w > 0 && l.tofus[0].h > 0);
  assert.equal(l.quads.length, 2); // A、B 正常
  assert.ok(l.width > 0);
});

test('行高：lineHeightMul 放大行距，height = leading+asc+(n-1)*lineH+desc', () => {
  const s1 = measureText(font, 'A\nB\nC', { fontSizePx: 40, lineHeightMul: 1 });
  const s2 = measureText(font, 'A\nB\nC', { fontSizePx: 40, lineHeightMul: 2 });
  const lineH = font.baseline.lineHeightPx;
  // lineHeightMul=1：leading=0 → height = asc + 2*lineH + desc（精确锚定 README §3 行排版）
  const wantH1 = font.baseline.ascenderPx + 2 * lineH + -font.baseline.descenderPx;
  assert.ok(Math.abs(s1.h - wantH1) < 1e-6, `${s1.h} vs ${wantH1}`);
  assert.ok(s2.h > s1.h + 2 * lineH * 0.9);
});

test('fontSize=0 与非有限 maxWidth 不发散', () => {
  const z = layoutText(font, 'ABC', { fontSizePx: 0 });
  assert.equal(z.width, 0);
  const nan = layoutText(font, 'ABC', { fontSizePx: 20, maxWidthPx: Number.NaN });
  assert.ok(Number.isFinite(nan.width));
});
