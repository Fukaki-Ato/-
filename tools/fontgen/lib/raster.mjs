/**
 * raster.mjs — 把 opentype.js 字形轮廓光栅化为 8-bit alpha 位图（Node 无 canvas 依赖）。
 * 方法：贝塞尔固定细分展平为多边形 → 扫描线 non-zero winding 填充，
 *       y 方向 4x 超采样、x 方向解析覆盖率 → 抗锯齿。纯浮点确定性运算。
 * 坐标系：opentype getPath(x, y=baseline, fontSize) 输出的画布系（y 向下，基线 y=0）。
 */

const QUAD_STEPS = 12;
const CUBIC_STEPS = 16;
const SS = 4; // y 方向超采样次数

/** 展平 path.commands 为闭合轮廓点列（画布系，y 向下）。 */
export function flattenCommands(commands) {
  const contours = [];
  let pts = null, cx = 0, cy = 0;
  const push = (x, y) => {
    const last = pts[pts.length - 1];
    if (!last || last[0] !== x || last[1] !== y) pts.push([x, y]);
  };
  for (const cmd of commands) {
    switch (cmd.type) {
      case 'M':
        if (pts && pts.length > 1) contours.push(pts);
        pts = [[cmd.x, cmd.y]]; cx = cmd.x; cy = cmd.y;
        break;
      case 'L':
        push(cmd.x, cmd.y); cx = cmd.x; cy = cmd.y;
        break;
      case 'Q': {
        const x0 = cx, y0 = cy, x1 = cmd.x1, y1 = cmd.y1, x2 = cmd.x, y2 = cmd.y;
        for (let i = 1; i <= QUAD_STEPS; i++) {
          const t = i / QUAD_STEPS, mt = 1 - t;
          push(mt * mt * x0 + 2 * mt * t * x1 + t * t * x2,
               mt * mt * y0 + 2 * mt * t * y1 + t * t * y2);
        }
        cx = cmd.x; cy = cmd.y;
        break;
      }
      case 'C': {
        const x0 = cx, y0 = cy, x1 = cmd.x1, y1 = cmd.y1, x2 = cmd.x2, y2 = cmd.y2, x3 = cmd.x, y3 = cmd.y;
        for (let i = 1; i <= CUBIC_STEPS; i++) {
          const t = i / CUBIC_STEPS, mt = 1 - t;
          push(mt * mt * mt * x0 + 3 * mt * mt * t * x1 + 3 * mt * t * t * x2 + t * t * t * x3,
               mt * mt * mt * y0 + 3 * mt * mt * t * y1 + 3 * mt * t * t * y2 + t * t * t * y3);
        }
        cx = cmd.x; cy = cmd.y;
        break;
      }
      case 'Z':
        if (pts && pts.length > 1) contours.push(pts);
        pts = null;
        break;
      default:
        break;
    }
  }
  if (pts && pts.length > 1) contours.push(pts);
  return contours;
}

/**
 * 扫描线光栅化。contours: 展平后的轮廓（画布系）；x0/y0: 位图左上角（画布系）。
 * 返回 Uint8ClampedArray(width*height)，0..255 覆盖率 alpha。
 */
export function scanlineFill(contours, x0, y0, width, height) {
  const alpha = new Uint8ClampedArray(width * height);
  if (width <= 0 || height <= 0) return alpha;
  // 预筛每条轮廓的 y 范围，减少逐行遍历
  const ranges = contours.map((pts) => {
    let minY = Infinity, maxY = -Infinity;
    for (const [, py] of pts) { if (py < minY) minY = py; if (py > maxY) maxY = py; }
    return { pts, minY, maxY };
  });
  const xs = [], ws = [];
  for (let py = 0; py < height; py++) {
    const acc = new Float64Array(width); // 每像素覆盖率累计（0..1）
    for (let s = 0; s < SS; s++) {
      const sy = y0 + py + (s + 0.5) / SS;
      // 交点必须跨轮廓合并收集：non-zero winding 依赖外轮廓与孔洞轮廓的权重相消，
      // 逐轮廓独立填充会把孔洞（如 自/回/中 的内腔）一起填实（S12 图集实心块 bug 的根因）。
      xs.length = 0; ws.length = 0;
      for (const { pts, minY, maxY } of ranges) {
        if (sy < minY || sy > maxY) continue;
        const n = pts.length;
        for (let i = 0; i < n; i++) {
          const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % n];
          if (ay === by) continue;
          if ((sy >= ay && sy < by) || (sy >= by && sy < ay)) {
            const t = (sy - ay) / (by - ay);
            xs.push(ax + t * (bx - ax));
            ws.push(by > ay ? 1 : -1); // non-zero winding
          }
        }
      }
      if (!xs.length) continue;
      // 按 x 排序（携带 winding 权重）
      const order = xs.map((v, i) => i).sort((p, q) => xs[p] - xs[q]);
      let wind = 0;
      for (let k = 0; k < order.length; k++) {
        const xe = xs[order[k]];
        if (wind !== 0 && k > 0) fillSpan(acc, xs[order[k - 1]] - x0, xe - x0, 1 / SS);
        wind += ws[order[k]];
      }
    }
    const row = alpha.subarray(py * width, (py + 1) * width);
    for (let px = 0; px < width; px++) row[px] = Math.round(Math.min(1, acc[px]) * 255);
  }
  return alpha;
}

// fillSpan 把 [xa,xb)（位图局部坐标）的覆盖率（含 1/SS 权重）累加进行缓冲。
function fillSpan(acc, xa, xb, weight) {
  if (xb <= xa) return;
  let px = Math.max(0, Math.floor(xa));
  const end = Math.min(acc.length - 1, Math.ceil(xb) - 1);
  for (; px <= end; px++) {
    const cov = Math.min(xb, px + 1) - Math.max(xa, px);
    if (cov > 0) acc[px] += cov * weight;
  }
}

/**
 * 光栅化单个字符。font: opentype.Font；返回
 * {alpha,width,height,left,top,advance,bboxYDown} 或 null（字体缺字形）。
 * left/top: 墨迹位图左上角相对 pen（画布系 y 向下，基线 y=0）。
 */
export function rasterizeGlyph(font, char, fontSize) {
  const glyph = font.charToGlyph(char);
  if (!glyph || glyph.index === 0) return null; // .notdef → 字体无此字形
  const scale = fontSize / font.unitsPerEm;
  const advance = (glyph.advanceWidth ?? font.unitsPerEm * 0.5) * scale;
  const path = glyph.getPath(0, 0, fontSize);
  if (!path.commands.length) return { alpha: new Uint8ClampedArray(0), width: 0, height: 0, left: 0, top: 0, advance, empty: true };
  const bb = path.getBoundingBox();
  const left = Math.floor(bb.x1), top = Math.floor(bb.y1);
  const width = Math.max(1, Math.ceil(bb.x2) - left), height = Math.max(1, Math.ceil(bb.y2) - top);
  const contours = flattenCommands(path.commands);
  const alpha = scanlineFill(contours, left, top, width, height);
  return { alpha, width, height, left, top, advance, bb };
}
