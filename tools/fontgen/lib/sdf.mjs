/**
 * sdf.mjs — 由 alpha 位图计算带缓冲的 SDF（signed distance field）。
 * 算法移植自 mapbox/tiny-sdf（MIT License，8SSEDTA / Felzenszwalb 二维 EDT），
 * 因 npm 上 tiny-sdf 仅有依赖浏览器 canvas 的 1.x，故在 Node 侧内置同算法实现。
 *
 * 编码约定（与 assets/fonts/README.md 一致，S4 shader 按此采样）：
 *   v = clamp(0.5 + sd / spread, 0, 1) * 255
 *   sd: 像素到字形边缘的有符号距离（px，正=字形内部，负=外部），|sd| >= spread/2 时饱和。
 *   即：v=127.5(≈128) 恰在边缘；反解 sd = (v/255 - 0.5) * spread。
 */

const INF = 1e20;

/** 一维平方 EDT（Felzenszwalb & Huttenlocher），结果写入 d。 */
function edt1d(grid, offset, stride, length, d, v, z) {
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  for (let q = 1, k = 0; q < length; q++) {
    let s = ((grid[offset + q * stride] + q * q) - (grid[offset + v[k] * stride] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = ((grid[offset + q * stride] + q * q) - (grid[offset + v[k] * stride] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  for (let q = 0, k = 0; q < length; q++) {
    while (z[k + 1] < q) k++;
    d[q] = grid[offset + v[k] * stride] + (q - v[k]) * (q - v[k]);
  }
}

/** 二维平方 EDT，就地写回 grid（值 = 到最近 0 单元的平方距离，上限 INF）。 */
function edt(grid, width, height, d, v, z) {
  for (let x = 0; x < width; x++) {
    edt1d(grid, x, width, height, d, v, z);
    for (let y = 0; y < height; y++) grid[y * width + x] = d[y];
  }
  for (let y = 0; y < height; y++) {
    edt1d(grid, y * width, 1, width, d, v, z);
    for (let x = 0; x < width; x++) grid[y * width + x] = d[x];
  }
}

/**
 * 计算 SDF。alpha: 墨迹位图（width*height，0..255，y 向下）。
 * buffer: 四周外扩像素（应 >= spread/2 + padding）。
 * 返回 {data, width: width+2*buffer, height: height+2*buffer}，值 0..255 按上文约定。
 */
export function computeSDF(alpha, width, height, buffer, spread) {
  const w = width + 2 * buffer, h = height + 2 * buffer;
  const size = w * h;
  const outer = new Float64Array(size);
  const inner = new Float64Array(size);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const a = alpha[y * width + x] / 255;
      const i = (y + buffer) * w + (x + buffer);
      outer[i] = a === 1 ? 0 : a === 0 ? INF : Math.pow(Math.max(0, 0.5 - a), 2);
      inner[i] = a === 1 ? INF : a === 0 ? 0 : Math.pow(Math.max(0, a - 0.5), 2);
    }
  }
  for (let y = 0; y < buffer; y++) { // 缓冲带初始为 INF（外部）
    for (let x = 0; x < w; x++) {
      outer[y * w + x] = INF; inner[y * w + x] = 0;
      outer[(h - 1 - y) * w + x] = INF; inner[(h - 1 - y) * w + x] = 0;
    }
  }
  for (let y = buffer; y < h - buffer; y++) {
    for (let x = 0; x < buffer; x++) {
      outer[y * w + x] = INF; inner[y * w + x] = 0;
      outer[y * w + (w - 1 - x)] = INF; inner[y * w + (w - 1 - x)] = 0;
    }
  }
  const d = new Float64Array(Math.max(w, h));
  const v = new Int32Array(Math.max(w, h));
  const z = new Float64Array(Math.max(w, h) + 1);
  edt(outer, w, h, d, v, z);
  edt(inner, w, h, d, v, z);
  const out = new Uint8ClampedArray(size);
  for (let i = 0; i < size; i++) {
    const sd = Math.sqrt(inner[i]) - Math.sqrt(outer[i]); // 正 = 内部
    const val = 0.5 + sd / spread;
    out[i] = Math.round(255 * (val < 0 ? 0 : val > 1 ? 1 : val));
  }
  return { data: out, width: w, height: h };
}
