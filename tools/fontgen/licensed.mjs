/** Explicit OFL font + original UI marks, no automatic system-font fallback or old atlas inputs. */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { collectCharset, formatCharset, isAsciiPrintable, repoRoot } from './charset.mjs';
import { generateAtlas, loadFontSource } from './gen.mjs';
import { originalSymbolsFont, ORIGINAL_SYMBOLS } from './licensed-symbols.mjs';

const SOURCE_SHA256='2c76254f6fc379fddfce0a7e84fb5385bb135d3e399294f6eeb6680d0365b74b';
const SOURCE_URL='https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf';

export function generateLicensedAtlases({fontPath,outDir,root=repoRoot()}) {
  const source=readFileSync(fontPath),sha256=createHash('sha256').update(source).digest('hex');
  if(sha256!==SOURCE_SHA256)throw Error('Font input differs from the documented OFL source');
  if(existsSync(outDir)&&readdirSync(outDir).length)throw Error('Output must be a new or empty task-owned directory');
  const {font}=loadFontSource(fontPath),codepoints=collectCharset(root),symbols=originalSymbolsFont();
  const license=readFileSync(join(root,'assets/fonts/NotoSansSC-OFL.txt'));
  const result=[];
  for(const [name,select] of [['latin',isAsciiPrintable],['cjk',cp=>!isAsciiPrintable(cp)]]) {
    const data=generateAtlas({font,fontInfo:{file:'NotoSansCJKsc-Regular.otf',family:'Noto Sans CJK SC'},
      fallback:{font:symbols,fontInfo:{file:'project-original-geometric-marks'}},
      codepoints:codepoints.filter(select),size:40,spread:8,padding:2,gap:2,maxWidth:2048});
    if(data.metrics.missing.length)throw Error(`Unsupported ${name} characters: ${data.metrics.missing.join('')}`);
    const {metrics}=data;
    // Use the font's typographic (rather than pan-CJK hhea safety) line metrics for UI layout.
    metrics.baseline={ascenderPx:font.tables.os2.sTypoAscender*.04,descenderPx:font.tables.os2.sTypoDescender*.04,
      lineHeightPx:(font.tables.os2.sTypoAscender-font.tables.os2.sTypoDescender)*.04,
      scalePxPerUnit:.04,note:'Source OS/2 typo metrics, same 40px baseline for Latin and CJK'};
    // A 3-decimal UV can shift a 2K atlas by 1–2px. Preserve actual cell-edge ratios.
    for(const glyph of metrics.glyphs){const r=glyph.cell;glyph.uv={x0:r.x/data.width,y0:r.y/data.height,
      x1:(r.x+r.w)/data.width,y1:(r.y+r.h)/data.height};}
    metrics.generator='tools/fontgen/licensed.mjs (Noto OFL + original geometric marks)';
    result.push({name,...data});
  }
  mkdirSync(outDir,{recursive:true});
  writeFileSync(join(outDir,'charset.txt'),formatCharset(codepoints),{flag:'wx'});
  writeFileSync(join(outDir,'NotoSansSC-OFL.txt'),license,{flag:'wx'});
  for(const data of result){
    writeFileSync(join(outDir,`${data.name}.png`),data.png,{flag:'wx'});
    writeFileSync(join(outDir,`${data.name}.metrics.json`),JSON.stringify(data.metrics,null,2)+'\n',{flag:'wx'});
  }
  const provenance={source:'Noto Sans CJK SC Regular',sourceUrl:SOURCE_URL,sourceSha256:sha256,license:'SIL OFL 1.1',
    copyright:font.names.copyright.en,sourceModified:false,originalGeometricMarks:ORIGINAL_SYMBOLS,
    rebuild:'node tools/fontgen/licensed.mjs --font <documented-Noto.otf> --out <new-directory>',
    outputs:result.map(d=>({name:d.name,glyphs:d.metrics.glyphs.length,width:d.width,height:d.height,bytes:d.png.length})),
    note:'Old atlases and Microsoft/Segoe fonts are not inputs. Source font itself is not distributed.'};
  writeFileSync(join(outDir,'provenance.json'),JSON.stringify(provenance,null,2)+'\n',{flag:'wx'});
  return provenance;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const {values}=parseArgs({options:{font:{type:'string'},out:{type:'string'}}});
  if(!values.font||!values.out)throw Error('Usage: licensed.mjs --font <documented-Noto.otf> --out <new-directory>');
  console.log(JSON.stringify(generateLicensedAtlases({fontPath:resolve(values.font),outDir:resolve(values.out)}),null,2));
}
