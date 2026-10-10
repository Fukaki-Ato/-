/**
 * preview.mjs — 图集可读性自查：解码 PNG + metrics.json，把指定字符的 SDF 单元
 * 以 ASCII art 打印到终端（按 v=0.5 阈值化并做灰度渐变）。
 * CLI：node preview.mjs [--atlas assets/fonts/cjk] [--chars 雷霆酷跑] [--level 0.5]
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeGray8 } from './lib/png.mjs';
import { repoRoot } from './charset.mjs';

const RAMP = ' .:-=+*#%@'; // 值越大越“实心”

export function renderCharAscii(atlasPng, metrics, char, level = 0.5, downsample = 2) {
  const g = metrics.glyphs.find((x) => x.char === char);
  if (!g) return null;
  const { x, y, w, h } = g.cell;
  const lines = [];
  for (let py = y; py < y + h; py += downsample) {
    let line = '';
    for (let px = x; px < x + w; px += downsample) {
      const v = atlasPng.data[py * atlasPng.width + px] / 255;
      if (v >= level) line += RAMP[RAMP.length - 1];
      else {
        const idx = Math.floor((v / level) * (RAMP.length - 1));
        line += RAMP[idx];
      }
    }
    lines.push(line);
  }
  return lines.join('\n');
}

export function loadAtlas(basePath) {
  const png = decodeGray8(readFileSync(`${basePath}.png`));
  const metrics = JSON.parse(readFileSync(`${basePath}.metrics.json`, 'utf8'));
  return { png, metrics };
}

function main(argv = process.argv.slice(2)) {
  const arg = (name, def) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : def; };
  const root = repoRoot();
  const base = resolve(root, arg('--atlas', 'assets/fonts/cjk'));
  const chars = [...arg('--chars', '雷霆酷跑')];
  const level = Number(arg('--level', 0.5));
  const { png, metrics } = loadAtlas(base);
  console.log(`# ${base}.png ${png.width}x${png.height}, ${metrics.glyphs.length} glyphs, font=${metrics.font.family}, size=${metrics.sdf.fontSize}, spread=${metrics.sdf.spread}`);
  for (const ch of chars) {
    const art = renderCharAscii(png, metrics, ch, level);
    console.log(`\n===== ${ch} (U+${ch.codePointAt(0).toString(16).toUpperCase()}) =====`);
    console.log(art ?? '(missing: 不在该图集)');
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
