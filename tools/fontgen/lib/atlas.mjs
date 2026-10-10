/**
 * atlas.mjs — 确定性的货架（shelf）装箱：按输入顺序从左到右排，放不下换行。
 * 输入 cells: [{w,h}]（已含缓冲），gap: 单元之间的透明间隔（防线性过滤/mipmap 渗色）。
 * 返回 {width, height, rects: [{x,y,w,h}]}（与输入同序）。
 */
export function packShelves(cells, maxWidth, gap) {
  const rects = new Array(cells.length);
  let width = 0, shelfY = 0, shelfH = 0, cursorX = 0;
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    if (cursorX > 0 && cursorX + gap + c.w > maxWidth) { // 换行
      shelfY += shelfH + gap;
      shelfH = 0;
      cursorX = 0;
    }
    const x = cursorX === 0 ? 0 : cursorX + gap;
    rects[i] = { x, y: shelfY, w: c.w, h: c.h };
    cursorX = x + c.w;
    if (cursorX > width) width = cursorX;
    if (c.h > shelfH) shelfH = c.h;
  }
  return { width: Math.max(1, width), height: Math.max(1, shelfY + shelfH), rects };
}

/** 把若干灰度单元 blit 进大图（大图初始 0 = 最外层 SDF 值）。 */
export function composeAtlas(width, height, placements) {
  const out = new Uint8Array(width * height);
  for (const { rect, data, dataW } of placements) {
    for (let y = 0; y < rect.h; y++) {
      const dst = (rect.y + y) * width + rect.x;
      out.set(data.subarray(y * dataW, (y + 1) * dataW), dst);
    }
  }
  return out;
}
