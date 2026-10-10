/**
 * supplement.mjs — 只补缺字的图集补充（现有字形逐字节不动）。
 *
 * 背景：assets/fonts 的图集按「入库即入字符集」由 gen.mjs 全量重建，正式重建流程需要
 * C:/Windows/Fonts 的微软雅黑（见 assets/fonts/README.md）。云环境没有该字体时，若新增
 * 文案已入库（charset.txt 已更新）但图集缺字，用本脚本以指定字体补入缺失字形：
 *   - 现有图集像素与字形条目保持不变（uv 因图集高度变化按比例重算，采样位置不变）；
 *   - 新字形带 fallbackFont 标记并写入 metrics.supplement；之后在 Windows 按 README
 *     全量重建（node charset.mjs && node gen.mjs --preset cjk）会自然覆盖本补充。
 *
 * CLI:
 *   node supplement.mjs --font <fallback.ttf|ttc> [--face 0] [--atlas assets/fonts/cjk]
 *        [--charset assets/fonts/charset.txt] [--size 40] [--spread 8] [--padding 2]
 *        [--max-width 1024] [--gap 2] [--label "Noto Sans CJK SC"]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import opentype from 'opentype.js';
import { decodeGray8, encodeGray8 } from './lib/png.mjs';
import { packShelves } from './lib/atlas.mjs';
import { rasterizeGlyph } from './lib/raster.mjs';
import { computeSDF } from './lib/sdf.mjs';
import { dettc } from './fonts.mjs';
import { repoRoot, parseCharset, isAsciiPrintable } from './charset.mjs';

const DEFAULTS = { size: 40, spread: 8, padding: 2, gap: 2, maxWidth: 1024 };
const round3 = (v) => Math.round(v * 1000) / 1000;

/** 纯函数：把缺失字形补进图集。返回 {added, metrics, png, width, height}。 */
export function supplementAtlas(opts) {
  const o = { ...DEFAULTS, ...opts };
  const { metrics, font, fontInfo, codepoints } = o;
  const buffer = Math.ceil(o.spread / 2) + o.padding;
  const img = decodeGray8(o.png);
  if (img.width !== metrics.atlas.width || img.height !== metrics.atlas.height) {
    throw new Error(`supplement: PNG ${img.width}x${img.height} 与 metrics ${metrics.atlas.width}x${metrics.atlas.height} 不一致`);
  }
  const existing = new Set(metrics.glyphs.map((g) => g.codepoint));
  const missing = codepoints.filter((cp) => !existing.has(cp));
  const newGlyphs = [];
  const cells = [];
  const skipped = [];
  for (const cp of missing) {
    const char = String.fromCodePoint(cp);
    const r = rasterizeGlyph(font, char, o.size);
    if (!r) { skipped.push(char); continue; }
    const sdf = r.empty
      ? { data: new Uint8ClampedArray(4 * buffer * buffer), width: 2 * buffer, height: 2 * buffer }
      : computeSDF(r.alpha, r.width, r.height, buffer, o.spread);
    cells.push({ w: sdf.width, h: sdf.height });
    newGlyphs.push({
      char, codepoint: cp,
      advance: round3(r.advance),
      bearingX: round3(r.empty ? 0 : r.left),
      bearingY: round3(r.empty ? 0 : -r.top),
      inkW: r.width, inkH: r.height,
      fallbackFont: o.label ?? fontInfo.file,
      _sdf: sdf,
    });
  }
  if (!newGlyphs.length) return { added: 0, skipped, metrics, png: o.png, width: img.width, height: img.height };

  const packed = packShelves(cells, o.maxWidth, o.gap);
  const offsetY = img.height + o.gap;
  const newHeight = offsetY + packed.height;
  const out = new Uint8Array(img.width * newHeight);
  for (let y = 0; y < img.height; y++) out.set(img.data.subarray(y * img.width, (y + 1) * img.width), y * img.width);
  for (let i = 0; i < newGlyphs.length; i++) {
    const rect = packed.rects[i], sdf = newGlyphs[i]._sdf;
    for (let y = 0; y < rect.h; y++) {
      out.set(sdf.data.subarray(y * sdf.width, (y + 1) * sdf.width), (offsetY + rect.y + y) * img.width + rect.x);
    }
    newGlyphs[i].cell = { x: rect.x, y: offsetY + rect.y, w: rect.w, h: rect.h };
    delete newGlyphs[i]._sdf;
  }
  const uvOf = (cell) => ({
    x0: round3(cell.x / img.width), y0: round3(cell.y / newHeight),
    x1: round3((cell.x + cell.w) / img.width), y1: round3((cell.y + cell.h) / newHeight),
  });
  // 旧字形 uv 因高度变化重算（采样像素位置不变）
  const glyphs = metrics.glyphs.map((g) => ({ ...g, uv: uvOf(g.cell) }));
  for (const g of newGlyphs) glyphs.push({ ...g, uv: uvOf(g.cell) });
  const next = {
    ...metrics,
    atlas: { ...metrics.atlas, height: newHeight },
    glyphs,
    missing: [],
    supplement: {
      font: fontInfo.file, family: fontInfo.family, face: o.face ?? 0,
      added: newGlyphs.length, skipped,
      note: '仅补缺字（fallbackFont 来源）；Windows 微软雅黑全量重建会覆盖',
    },
  };
  return { added: newGlyphs.length, skipped, metrics: next, png: encodeGray8(img.width, newHeight, out), width: img.width, height: newHeight };
}

function main(argv = process.argv.slice(2)) {
  const root = repoRoot();
  const arg = (name, def) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : def; };
  const fontPath = arg('--font');
  if (!fontPath) {
    console.error('usage: node supplement.mjs --font <ttf|ttc> [--face 0] [--atlas assets/fonts/cjk] [--label "..."]');
    process.exit(2);
  }
  const atlasBase = join(root, arg('--atlas', join('assets', 'fonts', 'cjk')));
  const charsetPath = arg('--charset', join(root, 'assets', 'fonts', 'charset.txt'));
  const face = Number(arg('--face', '0'));
  const raw = readFileSync(fontPath);
  const buf = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
  const font = opentype.parse(dettc(buf, face));
  const fontInfo = { file: fontPath, family: font.names?.fontFamily?.en ?? fontPath };
  const metrics = JSON.parse(readFileSync(`${atlasBase}.metrics.json`, 'utf8'));
  const png = readFileSync(`${atlasBase}.png`);
  const codepoints = parseCharset(readFileSync(charsetPath, 'utf8')).filter((cp) => !isAsciiPrintable(cp));
  const res = supplementAtlas({ metrics, png, font, fontInfo, codepoints, face, label: arg('--label', `${fontInfo.family}#${face}`) });
  if (!res.added) { console.log('supplement: 无缺字，未改动'); return; }
  writeFileSync(`${atlasBase}.png`, res.png);
  writeFileSync(`${atlasBase}.metrics.json`, JSON.stringify(res.metrics, null, 2) + '\n');
  console.log(`supplement: +${res.added} 字形${res.skipped.length ? `（字体缺 ${res.skipped.join('')}）` : ''} -> ${atlasBase}.png ${res.width}x${res.height} (${(res.png.length / 1024).toFixed(1)} KB)`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
