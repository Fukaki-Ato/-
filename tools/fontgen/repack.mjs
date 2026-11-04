/** Repack an existing grayscale atlas without rasterizing or changing glyph pixels.
 * Usage (repo root): node tools/fontgen/repack.mjs assets/fonts/cjk 2048
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packShelves } from './lib/atlas.mjs';
import { decodeGray8, encodeGray8 } from './lib/png.mjs';

export function repackAtlas({ metrics, png, maxWidth = 2048, maxDimension = 4096 }) {
  if (!Number.isInteger(maxWidth) || maxWidth < 1 || !Number.isInteger(maxDimension)
    || maxDimension < 1 || maxWidth > maxDimension) throw new Error('Invalid atlas dimension limit');
  const source = decodeGray8(png);
  if (source.width !== metrics.atlas.width || source.height !== metrics.atlas.height) {
    throw new Error('PNG dimensions do not match atlas metrics');
  }
  const gap = metrics.sdf.gap ?? 2;
  if (!Number.isInteger(gap) || gap < 0) throw new Error('Invalid atlas gap');
  for (const { cell: c } of metrics.glyphs) {
    if (![c.x, c.y, c.w, c.h].every(Number.isInteger) || c.x < 0 || c.y < 0
      || c.w < 1 || c.h < 1 || c.x + c.w > source.width || c.y + c.h > source.height) {
      throw new Error('Glyph cell outside source atlas');
    }
    if (c.w > maxWidth) throw new Error('Glyph cell exceeds packing width');
  }
  const packed = packShelves(metrics.glyphs.map(g => g.cell), maxWidth, gap);
  if (packed.height > maxDimension) throw new Error('Repacked atlas exceeds maximum dimension');
  const data = new Uint8Array(packed.width * packed.height);
  const result = structuredClone(metrics);
  result.atlas.width = packed.width;
  result.atlas.height = packed.height;
  for (let i = 0; i < result.glyphs.length; i++) {
    const old = metrics.glyphs[i].cell;
    const cell = packed.rects[i];
    for (let y = 0; y < old.h; y++) {
      const start = (old.y + y) * source.width + old.x;
      data.set(source.data.subarray(start, start + old.w), (cell.y + y) * packed.width + cell.x);
    }
    result.glyphs[i].cell = cell;
    result.glyphs[i].uv = {
      x0: cell.x / packed.width, y0: cell.y / packed.height,
      x1: (cell.x + cell.w) / packed.width, y1: (cell.y + cell.h) / packed.height,
    };
  }
  return { metrics: result, png: encodeGray8(packed.width, packed.height, data) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const base = process.argv[2];
  if (!base) throw new Error('Usage: node tools/fontgen/repack.mjs <atlas path without extension> [max width]');
  const result = repackAtlas({
    metrics: JSON.parse(readFileSync(`${base}.metrics.json`, 'utf8')),
    png: readFileSync(`${base}.png`),
    maxWidth: Number(process.argv[3] ?? 2048),
  });
  writeFileSync(`${base}.png`, result.png);
  writeFileSync(`${base}.metrics.json`, `${JSON.stringify(result.metrics, null, 2)}\n`);
  console.log(`Repacked ${result.metrics.glyphs.length} glyphs: ${result.metrics.atlas.width}x${result.metrics.atlas.height}`);
}
