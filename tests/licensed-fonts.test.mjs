import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { collectCharset } from '../tools/fontgen/charset.mjs';
import { decodeGray8 } from '../tools/fontgen/lib/png.mjs';
import { copyWxFontAssets } from '../tools/wx-assets.mjs';
import { createFontAtlas, createFontSet, layoutText } from '../packages/framework/dist/ui/index.js';

const directory='assets/fonts/noto';
const metrics=['latin','cjk'].map(name=>JSON.parse(readFileSync(`${directory}/${name}.metrics.json`,'utf8')));
const provenance=JSON.parse(readFileSync(`${directory}/provenance.json`,'utf8'));

test('licensed runtime atlas covers the current source corpus using only Noto OFL and original geometric marks',()=>{
  const fonts=createFontSet(metrics.map(m=>createFontAtlas(m)));
  assert.equal(provenance.license,'SIL OFL 1.1');
  assert.equal(provenance.sourceSha256,'2c76254f6fc379fddfce0a7e84fb5385bb135d3e399294f6eeb6680d0365b74b');
  assert.match(provenance.copyright,/Adobe/);
  assert.match(readFileSync(`${directory}/NotoSansSC-OFL.txt`,'utf8'),/SIL OPEN FONT LICENSE Version 1\.1/);
  const missing=collectCharset().filter(cp=>!fonts.lookup(cp));assert.deepEqual(missing,[]);
  const fallback=metrics.flatMap(m=>m.glyphs).filter(g=>g.fallbackFont);
  assert.deepEqual(fallback.map(g=>g.char).sort(),['ϟ','⁻','⚑','✔','✦','❤'].sort());
  assert.ok(fallback.every(g=>g.fallbackFont==='project-original-geometric-marks'));
  assert.ok(metrics.every(m=>m.font.file==='NotoSansCJKsc-Regular.otf'&&m.font.fallback==='project-original-geometric-marks'&&m.missing.length===0));
  const text=layoutText(fonts,'雷霆酷跑 · 1,234,567 ❤ ✔ ✦',{fontSizePx:20,maxWidthPx:280});
  assert.equal(text.tofus.length,0);assert.ok(text.width<=280);
});

test('actual PNG/SDF cells use pixel-accurate UVs and stay within a 2K texture on each axis',()=>{
  for(const [i,name] of ['latin','cjk'].entries()){
    const m=metrics[i],png=decodeGray8(readFileSync(`${directory}/${name}.png`));
    assert.equal(png.width,m.atlas.width);assert.equal(png.height,m.atlas.height);
    assert.ok(png.width<=2048&&png.height<=2048);
    assert.equal(m.baseline.lineHeightPx,40);assert.equal(m.sdf.fontSize,40);
    for(const glyph of m.glyphs){
      const r=glyph.cell;assert.ok(r.x>=0&&r.y>=0&&r.x+r.w<=png.width&&r.y+r.h<=png.height);
      for(const [actual,expected] of [[glyph.uv.x0*png.width,r.x],[glyph.uv.y0*png.height,r.y],
        [glyph.uv.x1*png.width,r.x+r.w],[glyph.uv.y1*png.height,r.y+r.h]])assert.ok(Math.abs(actual-expected)<1e-9,glyph.char);
      if(glyph.fallbackFont){
        let ink=0;for(let y=r.y;y<r.y+r.h;y++)for(let x=r.x;x<r.x+r.w;x++)if(png.data[y*png.width+x]>128)ink++;
        assert.ok(ink>10,`${glyph.char}: original mark contains real ink, not a missing-glyph square`);
      }
    }
  }
});

test('WX font packaging contains the checked new pair plus provenance/OFL and excludes old mixed-source atlases',()=>{
  const base=join(tmpdir(),'opencode');mkdirSync(base,{recursive:true});
  const temp=mkdtempSync(join(base,'wx-licensed-fonts-'));
  try{
    const result=copyWxFontAssets(process.cwd(),temp),names=['latin.png','latin.metrics.json','cjk.png','cjk.metrics.json','NotoSansSC-OFL.txt','provenance.json'];
    assert.equal(result.files,names.length);
    assert.deepEqual(readdirSync(join(temp,directory)).sort(),names.sort());
    for(const name of names)assert.deepEqual(readFileSync(join(temp,directory,name)),readFileSync(join(directory,name)));
    assert.ok(existsSync('assets/fonts/cjk.png'),'legacy source remains for the existing Web path');
    assert.ok(!existsSync(join(temp,'assets/fonts/cjk.png')));
    assert.ok(!existsSync(join(temp,directory,'NotoSansCJKsc-Regular.otf')),'the 16MB source font is not a runtime dependency');
  }finally{rmSync(temp,{recursive:true,force:true});}
});
