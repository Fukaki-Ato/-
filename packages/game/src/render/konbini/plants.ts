/**
 * 会生长的东西（树 / 灌木 / 草 / 花）——小花园专用，全部由「多面圆团 + 三棱尖叶 + 扁球花瓣」拼，不用一个方块。
 * 三渲二里最忌光滑球和正方体：前者像塑料，后者像箱子。二十面体团块带硬面折光（受光一团、背光一团），
 * 正好是动画里叶丛的画法；再在剪影边缘插几片尖叶把轮廓打碎，远看就是「一丛一丛」而不是一坨。
 * 顶点预算：树冠这类大团块用二十面体（60/240 顶点，折光好看），花瓣叶片这类十几厘米的小件一律用
 * 4×2 段扁球（15 顶点）——花草要密植，单价不压下来整条侧景就吃内存（kit.Diorama.oval 的注释）。
 * 每个函数都吃一个 seed，用确定性伪随机决定歪向与色差 ⇒ 同一座花园复制 N 次也不会有两处一模一样。
 */
import { C } from './palette.js';
import { rnd, type Diorama } from './kit.js';

const BARK = ['#6b4f34', '#5c452e', '#7a5a3c'];
const DEEP = [C.greenDark, '#2f4c37', '#3a5c40'];
const LITE = [C.leaf, '#74b168', '#8dc27a'];

/** 一棵树：锥台干 + 树皮纵纹 + 根部四爪 + 5~6 团叶（下深上浅）+ 边缘碎叶破轮廓 */
export function tree(d: Diorama, x: number, z: number, h: number, seed: number): void {
  const lean = (rnd(seed, 3) - 0.5) * 0.14;
  d.cyl('body', h * 0.045, h * 0.075, h * 0.6, 7, x, h * 0.3, z, BARK[seed % 3], { rz: lean });
  for (let i = 0; i < 3; i++) {                                            // 树皮纵纹：三条深色薄板贴干上
    const a = rnd(seed * 7 + i, 11) * Math.PI * 2;
    d.strut('body', x + Math.cos(a) * h * 0.055, h * 0.08, z + Math.sin(a) * h * 0.055,
      x + Math.cos(a) * h * 0.05 + lean * h * 0.5, h * 0.52, z + Math.sin(a) * h * 0.05, 0.012, '#4a3826', 4);
  }
  for (let i = 0; i < 4; i++) {                                            // 根部隆起（树抓地的感觉）
    const a = (i / 4) * Math.PI * 2 + rnd(seed + i, 13);
    d.spike('body', h * 0.035, h * 0.13, x + Math.cos(a) * h * 0.06, h * 0.05, z + Math.sin(a) * h * 0.06,
      BARK[seed % 3], { rz: 1.15, ry: -a });
  }
  const cy = h * 0.72, cr = h * 0.36;
  for (let i = 0; i < 5; i++) {                                            // 主叶团：下深上浅，压出体积
    const a = (i / 5) * Math.PI * 2 + rnd(seed * 3 + i, 17) * 0.9;
    const r = cr * (0.62 + rnd(seed + i, 19) * 0.5);
    const dy = (rnd(seed + i, 23) - 0.42) * cr * 1.1;
    d.blob('body', r, r * 0.86, r, x + Math.cos(a) * cr * 0.62, cy + dy, z + Math.sin(a) * cr * 0.62,
      dy > 0 ? LITE[(seed + i) % 3] : DEEP[(seed + i) % 3], i === 0 ? 1 : 0, { ry: a });
  }
  d.blob('body', cr * 0.9, cr * 0.72, cr * 0.9, x, cy + cr * 0.55, z, LITE[seed % 3], 1, { ry: seed });
  for (let i = 0; i < 6; i++) {                                            // 剪影边缘碎叶，把圆球轮廓打碎
    const a = (i / 6) * Math.PI * 2 + rnd(seed * 5 + i, 29);
    d.spike('body', cr * 0.16, cr * 0.5, x + Math.cos(a) * cr * 1.05, cy + Math.sin(a * 1.7) * cr * 0.5,
      z + Math.sin(a) * cr * 1.05, LITE[(seed + i) % 3], { rz: -1.4, ry: -a });
  }
}

/** 一丛草：7~9 片三棱尖叶朝外歪开，深浅两色，每四片挑一片抽穗 ⇒ 草的纹理 */
export function grassTuft(d: Diorama, x: number, z: number, h: number, seed: number): void {
  const n = 7 + (seed % 3);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rnd(seed * 11 + i, 31) * 0.8;
    const tilt = 0.18 + rnd(seed + i, 37) * 0.62;
    const len = h * (0.6 + rnd(seed + i, 41) * 0.55);
    const ox = Math.cos(a) * len * 0.1, oz = Math.sin(a) * len * 0.1;
    d.spike('body', len * 0.075, len, x + ox, len / 2, z + oz,
      i % 3 === 0 ? LITE[(seed + i) % 3] : DEEP[(seed + i * 2) % 3], { rz: tilt, ry: -a });
    if (i % 4 === 0) {                                                      // 抽穗：尖端顶一粒浅色小穗
      d.oval('body', len * 0.05, len * 0.17, len * 0.05, x + ox * 1.6, len * (1 - tilt * 0.3) + len * 0.12,
        z + oz * 1.6, '#cfc79a', { rz: tilt, ry: -a });
    }
  }
}

/**
 * 花茎（两段、带一点弯）+ 两片对生叶（扁球压平 + 一条深色叶脉）。
 * base = 茎的起点高度：种在花池/花盆里时要填土面高度，否则整朵会陷进底座只露个花瓣。
 */
function stemLeaf(d: Diorama, x: number, z: number, h: number, seed: number, base: number): [number, number] {
  const bx = x + (rnd(seed, 43) - 0.5) * 0.04, bz = z + (rnd(seed, 47) - 0.5) * 0.04;
  d.strut('body', x, base, z, (x + bx) / 2, base + h * 0.55, (z + bz) / 2, 0.010, '#4e7a4a', 4);
  d.strut('body', (x + bx) / 2, base + h * 0.55, (z + bz) / 2, bx, base + h, bz, 0.009, '#57875a', 4);
  for (const s of [-1, 1]) {
    const a = (s > 0 ? 0.9 : -2.1) + rnd(seed, 59) * 0.4;
    const ly = base + h * (s > 0 ? 0.46 : 0.62), lx = x + Math.cos(a) * 0.045, lz = z + Math.sin(a) * 0.045;
    d.oval('body', 0.052, 0.013, 0.031, lx, ly, lz, s > 0 ? C.leaf : C.green, { ry: -a, rz: 0.24 * s });
    d.box('body', 0.05, 0.006, 0.006, lx, ly + 0.011, lz, '#2f4c37', { ry: -a });   // 叶脉
  }
  return [bx, bz];
}

/**
 * 五瓣圆花（波斯菊/樱花那一类，日式动画里出镜率最高的剪影）：
 * 五片扁球压出的花瓣向外微张、隔瓣换深浅色拉层次，花心一坨 + 三点花粉。
 * 花瓣与花心走 glow 自发光桶 ⇒ 夜里整朵自己带亮，茎叶留在受光桶压暗，花就从草地里跳出来了。
 */
export function flowerRound(d: Diorama, x: number, z: number, h: number, petal: string, seed: number, base = 0): void {
  const [bx, bz] = stemLeaf(d, x, z, h, seed, base);
  const pr = h * 0.28, hy = base + h;
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + rnd(seed + i, 53) * 0.22;
    d.oval('glow', pr * 1.2, pr * 0.3, pr * 0.9, bx + Math.cos(a) * pr * 0.95, hy + 0.006, bz + Math.sin(a) * pr * 0.95,
      i % 2 ? petal : C.wall, { ry: -a, rz: 0.3 });
  }
  d.oval('glow', pr * 0.44, pr * 0.34, pr * 0.44, bx, hy + 0.014, bz, C.warmMid, { ry: seed });
  for (let i = 0; i < 3; i++) {                                            // 花粉点：三粒小椭圆贴在花心边上
    const a = (i / 3) * Math.PI * 2 + seed;
    d.oval('glow', 0.011, 0.011, 0.011, bx + Math.cos(a) * pr * 0.34, hy + 0.032, bz + Math.sin(a) * pr * 0.34, C.warm, {});
  }
}

/** 雏菊/玛格丽特那一类细瓣花：10~12 片尖细花瓣放射铺开 + 一枚深色花盘（同样走 glow 桶） */
export function flowerDaisy(d: Diorama, x: number, z: number, h: number, petal: string, seed: number, base = 0): void {
  const [bx, bz] = stemLeaf(d, x, z, h, seed, base);
  const len = h * 0.56, n = 10 + (seed % 3), hy = base + h;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rnd(seed + i, 61) * 0.16;
    d.spike('glow', len * 0.11, len, bx + Math.cos(a) * len * 0.46, hy + 0.004 - len * 0.03, bz + Math.sin(a) * len * 0.46,
      i % 2 ? petal : C.coolWhite, { rz: -1.5, ry: -a });
  }
  d.oval('glow', len * 0.19, len * 0.13, len * 0.19, bx, hy + 0.014, bz, seed % 2 ? '#f0c14e' : '#e88a4f', { ry: seed });
}

/** 郁金香/风信子那一类杯状花：三片竖立花瓣抱起来，中间一片内侧浅色（走 glow 桶，夜里就是一小杯光） */
export function flowerCup(d: Diorama, x: number, z: number, h: number, petal: string, seed: number, base = 0): void {
  const [bx, bz] = stemLeaf(d, x, z, h, seed, base);
  const r = h * 0.24, hy = base + h;
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + rnd(seed + i, 67);
    d.oval('glow', r * 0.82, r * 1.5, r * 0.64, bx + Math.cos(a) * r * 0.42, hy + r * 0.52, bz + Math.sin(a) * r * 0.42,
      i === 1 ? C.wall : petal, { ry: -a, rz: -0.16 });
  }
  d.oval('glow', r * 0.3, r * 0.44, r * 0.3, bx, hy + r * 0.78, bz, '#f5e6a8', { ry: seed });
}

/** 一丛灌木 / 绿篱：压扁的叶团叠两三朵 + 底下压一层深绿坐住重量 + 前面几根草 */
export function shrub(d: Diorama, x: number, z: number, r: number, seed: number): void {
  d.oval('body', r, r * 0.5, r * 0.86, x, r * 0.34, z, '#24382a', { ry: seed });
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + rnd(seed * 13 + i, 59);
    const rr = r * (0.58 + rnd(seed + i, 61) * 0.4);
    d.blob('body', rr, rr * 0.66, rr, x + Math.cos(a) * r * 0.36, r * 0.5 + i * r * 0.12,
      z + Math.sin(a) * r * 0.36, i === 2 ? LITE[(seed + i) % 3] : DEEP[(seed + i) % 3], i === 2 ? 1 : 0, { ry: a });
  }
  for (let i = 0; i < 3; i++) grassTuft(d, x - r * 0.7 + i * r * 0.7, z + r * 0.55, r * 0.42, seed * 5 + i);
}

/** 一段花草地：草丛打底，每 `every` 丛里种一朵花（三种花轮换），铺出「花比草还多」的画面 */
export function flowerMeadow(d: Diorama, x0: number, z0: number, w: number, dep: number, n: number, seed: number, every = 2): void {
  const petals = [C.flower, C.flower2, '#ff9a76', '#c86fd0', '#ffd9e2', '#ff7fa8', '#fff0f4'];
  for (let i = 0; i < n; i++) {
    const px = x0 + rnd(seed * 3 + i, 67) * w, pz = z0 + rnd(seed * 3 + i, 71) * dep;
    const hh = 0.13 + rnd(seed + i, 73) * 0.13;
    grassTuft(d, px, pz, hh, seed * 17 + i);
    if (i % every !== 0) continue;
    const c = petals[(seed + i * 3) % petals.length], fh = 0.2 + rnd(seed + i, 79) * 0.1;
    const k = (seed + i) % 3;
    if (k === 0) flowerRound(d, px + 0.05, pz - 0.04, fh, c, seed * 7 + i);
    else if (k === 1) flowerDaisy(d, px - 0.04, pz + 0.05, fh * 0.9, c, seed * 7 + i);
    else flowerCup(d, px + 0.03, pz + 0.03, fh * 0.85, c, seed * 7 + i);
  }
}
