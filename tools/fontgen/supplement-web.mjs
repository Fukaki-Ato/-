/** Supplement the existing variable Web font without replacing its authored weights. */
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import opentype from 'opentype.js';
import { parseCharset } from './charset.mjs';

const { values } = parseArgs({ options: { font: { type: 'string' }, out: { type: 'string' } } });
if (!values.font || !values.out) throw new Error('Usage: supplement-web.mjs --font <documented-Noto.otf> --out <new-file.otf>');
const root = fileURLToPath(new URL('../../', import.meta.url));
const bytes = readFileSync(values.font);
const provenance = JSON.parse(readFileSync(join(root, 'assets/fonts/noto/provenance.json'), 'utf8'));
if (createHash('sha256').update(bytes).digest('hex') !== provenance.sourceSha256) throw new Error('Noto source SHA does not match provenance');
const source = opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
const ranges = execFileSync('fc-query', ['--format=%{charset}', join(root, 'apps/web/src/assets/mobile-ui/thunder-sans.woff2')], { encoding: 'utf8' })
  .trim().split(/\s+/).map(range => range.split('-').map(value => Number.parseInt(value, 16)));
const covered = cp => ranges.some(([start, end = start]) => cp >= start && cp <= end);
const points = parseCharset(readFileSync(join(root, 'assets/fonts/charset.txt'), 'utf8'))
  .filter(cp => !covered(cp) && source.charToGlyphIndex(String.fromCodePoint(cp)) !== 0);
const glyphs = [new opentype.Glyph({ name: '.notdef', advanceWidth: source.glyphs.get(0).advanceWidth, path: source.glyphs.get(0).path })];
for (const cp of points) {
  const glyph = source.charToGlyph(String.fromCodePoint(cp));
  glyphs.push(new opentype.Glyph({ name: `uni${cp.toString(16)}`, unicode: cp, advanceWidth: glyph.advanceWidth, path: glyph.path }));
}
const font = new opentype.Font({ familyName: 'Thunder CJK Supplement', styleName: 'Regular', unitsPerEm: source.unitsPerEm,
  ascender: source.ascender, descender: source.descender, glyphs });
font.names.copyright = source.names.copyright;
font.names.license = { en: 'Derived from Noto Sans CJK SC Regular, Copyright 2014-2021 Adobe. Licensed under SIL OFL 1.1; see assets/fonts/noto/NotoSansSC-OFL.txt.' };
const output = Buffer.from(font.toArrayBuffer());
writeFileSync(resolve(values.out), output, { flag: 'wx' });
console.log(JSON.stringify({ glyphs: points.length, bytes: output.length, codepoints: points }, null, 2));
