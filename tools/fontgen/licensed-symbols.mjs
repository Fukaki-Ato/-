// Six generic UI marks, hand-authored here; no system-font outlines or external artwork.
import opentype from 'opentype.js';

export const ORIGINAL_SYMBOLS = ['ϟ', '⁻', '⚑', '✔', '✦', '❤'];

export function originalSymbolsFont() {
  const glyphs = [new opentype.Glyph({ name: '.notdef', advanceWidth: 600, path: new opentype.Path() })];
  const polygon = points => {
    const p = new opentype.Path(); p.moveTo(...points[0]);
    for (const point of points.slice(1)) p.lineTo(...point);
    p.close(); return p;
  };
  const shapes = [
    polygon([[480,840],[120,390],[350,390],[220,0],[700,500],[450,500]]),
    polygon([[80,610],[480,610],[480,675],[80,675]]),
    polygon([[160,0],[160,840],[235,840],[235,790],[740,790],[570,600],[740,400],[235,400],[235,0]]),
    polygon([[100,380],[205,480],[360,310],[670,760],[780,680],[380,90]]),
    polygon([[450,870],[560,545],[865,435],[560,325],[450,0],[340,325],[35,435],[340,545]]),
    (()=>{ const p=new opentype.Path(); p.moveTo(450,40);
      p.curveTo(330,180,65,350,65,585);p.curveTo(65,840,335,915,450,710);
      p.curveTo(565,915,835,840,835,585);p.curveTo(835,350,570,180,450,40);p.close();return p; })(),
  ];
  for(let i=0;i<ORIGINAL_SYMBOLS.length;i++)glyphs.push(new opentype.Glyph({
    index:i+1,
    name:`original-ui-${ORIGINAL_SYMBOLS[i].codePointAt(0).toString(16)}`, unicode:ORIGINAL_SYMBOLS[i].codePointAt(0),
    advanceWidth:i===1?560:900,path:shapes[i],
  }));
  return new opentype.Font({familyName:'Thunder UI Geometric Marks',styleName:'Regular',unitsPerEm:1000,
    ascender:880,descender:-120,glyphs});
}
