/**
 * gen.mjs — SDF 位图字体图集生成器（S12）。
 * 输入：TTF/TTC（自动探测系统字体）+ charset.txt；输出：SDF 图集 PNG（8-bit 灰度）+ metrics.json。
 * 全部运算确定性（无时间戳/随机数；PNG deflate level 9）→ 同输入两次产物字节一致。
 *
 * CLI：
 *   node gen.mjs --preset latin|cjk            # 按预设生成一张（读 assets/fonts/charset.txt）
 *   node gen.mjs --all                          # latin + cjk 两张都生成（npm run gen）
 *   node gen.mjs --font <path> --charset <file> --range ascii|nonascii|all
 *              --out <assets/fonts/latin> --size 40 --spread 8 --padding 2
 *              --max-width 1024 --gap 2 [--probe]
 *   --out 是不带扩展名的基名：产出 <out>.png 与 <out>.metrics.json。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import opentype from 'opentype.js';
import { detectFont, probeAll, dettc, FONT_CANDIDATES, LATIN_CANDIDATES, SYMBOL_CANDIDATES } from './fonts.mjs';
import { rasterizeGlyph } from './lib/raster.mjs';
import { computeSDF } from './lib/sdf.mjs';
import { packShelves, composeAtlas } from './lib/atlas.mjs';
import { encodeGray8 } from './lib/png.mjs';
import { repoRoot, parseCharset, isAsciiPrintable } from './charset.mjs';

export const DEFAULTS = {
  size: 40,        // 源光栅化字号（px）；SDF 可无损放大，缩小略软
  spread: 8,       // SDF 距离场半宽（px）：v=0.5±0.5 覆盖 ±spread/2
  padding: 2,      // 单元额外透明边（px），防相邻字形渗色
  gap: 2,          // 装箱货架/单元间隔（px）
  maxWidth: 1024,  // 图集最大宽度
};

/** buffer = SDF 饱和半径 + padding（每个字形四周外扩像素数）。 */
export const bufferOf = (opts) => Math.ceil(opts.spread / 2) + opts.padding;

function round3(v) { return Math.round(v * 1000) / 1000; }

/**
 * 生成一张图集（纯函数，不落盘）。opts: {font(opentype.Font), fontInfo, codepoints, ...DEFAULTS}
 * 返回 {png: Buffer, metrics: object, atlas: Uint8Array, width, height}。
 */
export function generateAtlas(opts) {
  const o = { ...DEFAULTS, ...opts };
  const { font } = o;
  const buffer = bufferOf(o);
  const scale = o.size / font.unitsPerEm;
  const cells = [], glyphs = [], missing = [], placements = [];

  for (const cp of o.codepoints) {
    const char = String.fromCodePoint(cp);
    let r = rasterizeGlyph(font, char, o.size);
    let fbFile = null;
    if (!r && o.fallback?.font) {
      r = rasterizeGlyph(o.fallback.font, char, o.size);
      fbFile = o.fallback.fontInfo?.file ?? 'fallback';
    }
    if (!r) { missing.push(char); continue; }
    const sdf = r.empty
      ? { data: new Uint8ClampedArray(4 * buffer * buffer), width: 2 * buffer, height: 2 * buffer }
      : computeSDF(r.alpha, r.width, r.height, buffer, o.spread);
    cells.push({ w: sdf.width, h: sdf.height });
    // bbox：pen 原点、y 向上（字体习惯）；由画布系（y 向下、基线 y=0）换算
    glyphs.push({
      char, codepoint: cp,
      advance: round3(r.advance),
      bearingX: round3(r.empty ? 0 : r.left),
      bearingY: round3(r.empty ? 0 : -r.top), // 墨迹顶边相对基线高度（y 向上为正）
      inkW: r.width, inkH: r.height,
      ...(fbFile ? { fallbackFont: fbFile } : {}),
      _sdf: sdf,
    });
  }

  const packed = packShelves(cells, o.maxWidth, o.gap);
  for (let i = 0; i < glyphs.length; i++) {
    const g = glyphs[i], rect = packed.rects[i];
    const sdf = g._sdf; delete g._sdf;
    placements.push({ rect, data: sdf.data, dataW: sdf.width });
    g.cell = { x: rect.x, y: rect.y, w: rect.w, h: rect.h };
    g.uv = {
      x0: round3(rect.x / packed.width), y0: round3(rect.y / packed.height),
      x1: round3((rect.x + rect.w) / packed.width), y1: round3((rect.y + rect.h) / packed.height),
    };
  }

  const atlas = composeAtlas(packed.width, packed.height, placements);
  const ascenderPx = round3(font.ascender * scale);
  const descenderPx = round3(font.descender * scale);
  const metrics = {
    format: 'tr-sdf-atlas/1',
    generator: 'tools/fontgen 0.1.0',
    font: {
      file: o.fontInfo?.file ?? null, family: o.fontInfo?.family ?? null, unitsPerEm: font.unitsPerEm,
      fallback: o.fallback?.fontInfo?.file ?? null,
    },
    sdf: {
      fontSize: o.size, spread: o.spread, padding: o.padding, buffer, gap: o.gap,
      encoding: 'gray8; v=clamp(0.5+sd/spread,0,1); sd px positive inside; sd=(v/255-0.5)*spread',
    },
    atlas: { width: packed.width, height: packed.height, channels: 1 },
    baseline: {
      ascenderPx, descenderPx, lineHeightPx: round3((font.ascender - font.descender) * scale),
      scalePxPerUnit: round3(scale),
      note: '所有 px 值均为 fontSize 下的像素；渲染尺寸 S 时乘 S/fontSize',
    },
    glyphs,
    missing,
  };
  return { png: encodeGray8(packed.width, packed.height, atlas), metrics, atlas, width: packed.width, height: packed.height };
}

function loadCharsetFile(path) {
  return parseCharset(readFileSync(path, 'utf8'));
}

/** 加载字体源：fontArg='auto' 时按候选顺序探测系统字体。返回 {font, fontInfo} 或 null。 */
export function loadFontSource(fontArg = 'auto', hint = 'cjk') {
  if (fontArg && fontArg !== 'auto') {
    const raw = readFileSync(fontArg);
    const buf = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
    return { font: opentype.parse(dettc(buf)), fontInfo: { file: fontArg, family: fontArg } };
  }
  const found = detectFont(opentype, hint === 'latin' ? LATIN_CANDIDATES : FONT_CANDIDATES);
  if (!found) return null;
  return { font: found.font, fontInfo: { file: found.file, family: found.family } };
}

function pickFont(fontArg, hint) {
  const src = loadFontSource(fontArg, hint);
  if (!src) throw new Error('gen: no usable system font found (tried ' + FONT_CANDIDATES.map((c) => c.file).join(', ') + ')');
  return src;
}

export function main(argv = process.argv.slice(2)) {
  const root = repoRoot();
  const arg = (name, def = undefined) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : def;
  }
  if (argv.includes('--probe')) {
    for (const p of probeAll(opentype)) console.log(`${p.file}\t${p.exists ? 'exists' : 'missing'}\t${p.loaded ? 'loaded ' + (p.family ?? '') : p.error ?? ''}`);
    return;
  }
  const charsetPath = arg('--charset', join(root, 'assets/fonts/charset.txt'));
  const allCps = loadCharsetFile(charsetPath);
  const jobs = [];
  const mk = (presetName, range, outDef, fontHint) => ({ presetName, range, out: argv.includes('--all') ? outDef : arg('--out', outDef), fontHint });
  if (argv.includes('--all')) {
    jobs.push(mk('latin', 'ascii', join(root, 'assets/fonts/latin'), 'latin'));
    jobs.push(mk('cjk', 'nonascii', join(root, 'assets/fonts/cjk'), 'cjk'));
  } else {
    const preset = arg('--preset');
    if (preset === 'latin') jobs.push(mk('latin', 'ascii', join(root, 'assets/fonts/latin'), 'latin'));
    else if (preset === 'cjk') jobs.push(mk('cjk', 'nonascii', join(root, 'assets/fonts/cjk'), 'cjk'));
    else jobs.push({ presetName: 'custom', range: arg('--range', 'all'), out: arg('--out') ?? join(root, 'assets/fonts/atlas'), fontHint: 'cjk' });
  }
  const opts = {
    size: Number(arg('--size', DEFAULTS.size)),
    spread: Number(arg('--spread', DEFAULTS.spread)),
    padding: Number(arg('--padding', DEFAULTS.padding)),
    gap: Number(arg('--gap', DEFAULTS.gap)),
    maxWidth: Number(arg('--max-width', DEFAULTS.maxWidth)),
  };
  const fontArg = arg('--font', 'auto');
  const fb = argv.includes('--no-fallback') ? null : detectFont(opentype, SYMBOL_CANDIDATES);
  const fallback = fb ? { font: fb.font, fontInfo: { file: fb.file, family: fb.family } } : null;
  for (const job of jobs) {
    const { font, fontInfo } = pickFont(fontArg, job.fontHint);
    const cps = allCps.filter((cp) =>
      job.range === 'ascii' ? isAsciiPrintable(cp) : job.range === 'nonascii' ? !isAsciiPrintable(cp) : true);
    const t0 = Date.now();
    const { png, metrics } = generateAtlas({ ...opts, font, fontInfo, fallback, codepoints: cps });
    mkdirSync(dirname(job.out), { recursive: true });
    writeFileSync(`${job.out}.png`, png);
    writeFileSync(`${job.out}.metrics.json`, JSON.stringify(metrics, null, 2) + '\n');
    console.log(`${job.presetName}: ${cps.length} chars (${metrics.glyphs.length} glyphs, missing ${metrics.missing.length}: ${metrics.missing.join('') || '-'}) ` +
      `font=${fontInfo.family} atlas=${metrics.atlas.width}x${metrics.atlas.height} size=${opts.size} spread=${opts.spread} pad=${opts.padding} ` +
      `-> ${job.out}.png (${(png.length / 1024).toFixed(1)} KB) + .metrics.json [${Date.now() - t0} ms]`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
