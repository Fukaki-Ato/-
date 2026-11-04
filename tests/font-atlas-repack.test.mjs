import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { repackAtlas } from '../tools/fontgen/repack.mjs';
import { decodeGray8, encodeGray8 } from '../tools/fontgen/lib/png.mjs';

function pixels(image, cell) {
  const out = [];
  for (let y = 0; y < cell.h; y++) {
    const start = (cell.y + y) * image.width + cell.x;
    out.push(...image.data.subarray(start, start + cell.w));
  }
  return out;
}

function fixture() {
  const glyphs = [
    { char: '音', codepoint: 38899, advance: 40, cell: { x: 0, y: 0, w: 3, h: 2 }, uv: {} },
    { char: '♪', codepoint: 9834, advance: 21, fallbackFont: 'fallback.ttf', cell: { x: 0, y: 3, w: 2, h: 3 }, uv: {} },
  ];
  return {
    metrics: { format: 'tr-sdf-atlas/1', atlas: { width: 4, height: 6, channels: 1 }, sdf: { gap: 1 }, glyphs, missing: ['x'] },
    png: encodeGray8(4, 6, Uint8Array.from({ length: 24 }, (_, i) => i * 7)),
  };
}

test('font atlas repack preserves all glyph pixels and non-placement metadata deterministically', () => {
  const input = fixture();
  const snapshot = structuredClone(input.metrics);
  const a = repackAtlas({ ...input, maxWidth: 8 });
  const b = repackAtlas({ ...input, maxWidth: 8 });
  assert.deepEqual(a, b);
  assert.deepEqual(input.metrics, snapshot, 'does not mutate input');
  const source = decodeGray8(input.png), dest = decodeGray8(a.png);
  assert.deepEqual(a.metrics.missing, input.metrics.missing);
  assert.equal(a.metrics.glyphs.length, input.metrics.glyphs.length);
  for (let i = 0; i < a.metrics.glyphs.length; i++) {
    const old = input.metrics.glyphs[i], next = a.metrics.glyphs[i];
    assert.deepEqual(pixels(dest, next.cell), pixels(source, old.cell));
    const { cell: oldCell, uv: oldUv, ...before } = old;
    const { cell, uv, ...after } = next;
    assert.deepEqual(after, before);
    assert.equal(uv.x0, cell.x / dest.width);
    assert.equal(uv.y1, (cell.y + cell.h) / dest.height);
  }
});

test('font atlas repack rejects invalid cells, dimensions and oversized output', () => {
  const input = fixture();
  assert.throws(() => repackAtlas({ ...input, maxWidth: 2 }), /packing width/);
  assert.throws(() => repackAtlas({ ...input, maxWidth: 3, maxDimension: 3 }), /maximum dimension/);
  assert.throws(() => repackAtlas({ ...input, maxWidth: NaN }), /dimension limit/);
  input.metrics.atlas.width++;
  assert.throws(() => repackAtlas(input), /do not match/);
  input.metrics.atlas.width--;
  input.metrics.glyphs[0].cell.x = -1;
  assert.throws(() => repackAtlas(input), /outside source/);
});

test('shipped CJK atlas stays within 4096px and repacks without losing glyph pixels', () => {
  const metrics = JSON.parse(readFileSync(new URL('../assets/fonts/cjk.metrics.json', import.meta.url)));
  const png = readFileSync(new URL('../assets/fonts/cjk.png', import.meta.url));
  const source = decodeGray8(png);
  assert.equal(source.width, metrics.atlas.width);
  assert.equal(source.height, metrics.atlas.height);
  assert.ok(source.width <= 4096 && source.height <= 4096);
  const result = repackAtlas({ metrics, png });
  assert.deepEqual(result.metrics.glyphs.map(g => g.codepoint), metrics.glyphs.map(g => g.codepoint));
  const dest = decodeGray8(result.png);
  for (let i = 0; i < metrics.glyphs.length; i++) {
    assert.deepEqual(pixels(dest, result.metrics.glyphs[i].cell), pixels(source, metrics.glyphs[i].cell));
  }
});
