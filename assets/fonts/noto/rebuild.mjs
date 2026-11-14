/** Reuse the pinned OFL generator, preserving merged coverage and zero-width VS16. */
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,copyFileSync,rmSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {parseArgs} from 'node:util';
import {fileURLToPath} from 'node:url';
import {repoRoot,scanTargets,extractChars,parseCharset,formatCharset} from '../../../tools/fontgen/charset.mjs';
import {generateLicensedAtlases} from '../../../tools/fontgen/licensed.mjs';
import {repackAtlas} from '../../../tools/fontgen/repack.mjs';

export function rebuildMergedFonts({fontPath,outDir}) {
  const root=repoRoot(),fonts=join(root,'assets/fonts');
  const texts=scanTargets(root).map(file=>readFileSync(file,'utf8').split('\n')
    .filter(line=>!/^(<<<<<<<|=======|>>>>>>>)/.test(line)).join('\n'));
  // Retain codepoints only; old atlas pixels/font outlines never enter the OFL generator.
  const legacy=JSON.parse(readFileSync(join(fonts,'cjk.metrics.json'),'utf8'));
  const corpus=[...new Set([...extractChars(texts),...legacy.glyphs.map(g=>g.codepoint),
    ...parseCharset(readFileSync(join(fonts,'charset.txt'),'utf8')),
    ...parseCharset(readFileSync(join(fonts,'noto/charset.txt'),'utf8'))])].sort((a,b)=>a-b);
  const input=mkdtempSync(join(fonts,'.rebuild-input-'));
  try {
    mkdirSync(join(input,'config'));mkdirSync(join(input,'assets/fonts'),{recursive:true});
    writeFileSync(join(input,'config/coverage.json'),formatCharset(corpus.filter(cp=>cp!==0xfe0f)),{flag:'wx'});
    copyFileSync(join(fonts,'NotoSansSC-OFL.txt'),join(input,'assets/fonts/NotoSansSC-OFL.txt'));
    const provenance=generateLicensedAtlases({fontPath,outDir,root:input});
    const metrics=JSON.parse(readFileSync(join(outDir,'cjk.metrics.json'),'utf8'));
    let png=readFileSync(join(outDir,'cjk.png'));
    if(corpus.includes(0xfe0f)) {
      // A presentation selector has no outline or advance; reuse the blank U+3000 cell.
      const space=metrics.glyphs.find(g=>g.codepoint===0x3000);
      metrics.glyphs.push({...structuredClone(space),char:'\ufe0f',codepoint:0xfe0f,advance:0,
        bearingX:0,bearingY:0,inkW:0,inkH:0,defaultIgnorable:true});
      const packed=repackAtlas({metrics,png});png=packed.png;
      writeFileSync(join(outDir,'cjk.metrics.json'),JSON.stringify(packed.metrics,null,2)+'\n');
      writeFileSync(join(outDir,'cjk.png'),png);
      provenance.outputs[1]={name:'cjk',glyphs:packed.metrics.glyphs.length,width:packed.metrics.atlas.width,
        height:packed.metrics.atlas.height,bytes:png.length};
      provenance.defaultIgnorables=[{codepoint:65039,char:'\ufe0f',advance:0,
        note:'Unicode variation selector-16; empty cell, no font outline or geometric mark'}];
    }
    writeFileSync(join(outDir,'charset.txt'),formatCharset(corpus.filter(cp=>cp!==0x20)));
    provenance.rebuild='node assets/fonts/noto/rebuild.mjs --font <documented-Noto.otf> --out <new-directory>';
    provenance.note+=' Merged coverage retains codepoints from both legacy atlases and the previous WX charset; no legacy outlines or pixels. U+FE0F is zero-width with no ink.';
    writeFileSync(join(outDir,'provenance.json'),JSON.stringify(provenance,null,2)+'\n');
    return provenance;
  } finally {rmSync(input,{recursive:true,force:true});}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const {values}=parseArgs({options:{font:{type:'string'},out:{type:'string'}}});
  if(!values.font||!values.out)throw Error('Usage: rebuild.mjs --font <documented-Noto.otf> --out <new-directory>');
  console.log(JSON.stringify(rebuildMergedFonts({fontPath:resolve(values.font),outDir:resolve(values.out)}),null,2));
}
