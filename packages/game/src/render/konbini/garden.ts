/**
 * 有围栏的小花园 —— 摆在两家便利店之间的路段，与街角同一块正方形底座、同一套色。
 * 讲究「层次清晰」：后层高绿篱压住背景，中层两三棵树定体量，前层花池与草丛出细节，
 * 围栏/柱灯/长椅在最外圈收边。树和草全部由 plants.ts 的圆团与尖叶拼，没有一块方糖。
 * 远景楼群也放这里：它负责补住地平线，让「远方刚出现时慢慢淡出」有东西可淡。
 */
import { C, R90 } from './palette.js';
import { buildBasePlate } from './base.js';
import { flowerCup, flowerDaisy, flowerMeadow, flowerRound, grassTuft, shrub, tree } from './plants.js';
import { rnd, type Diorama } from './kit.js';

const FX0 = -4.1, FX1 = 2.1, FZ0 = -3.5, FZ1 = 1.5;                       // 围栏矩形
const PETAL = [C.flower, C.flower2, '#ff9a76', '#c86fd0', '#ffd9e2', '#ff7fa8'];

/** 小花园（底座 + 围栏 + 花为主角的四层植被 + 步道 + 柱灯长椅） */
export function buildGarden(d: Diorama): void {
  buildBasePlate(d);
  const cx = (FX0 + FX1) / 2, cz = (FZ0 + FZ1) / 2;

  // ---------- 草地打底：深底 + 两层浅绿压出起伏（草皮本身不铺花，交给下面几段花带） ----------
  d.slab('body', FX1 - FX0 - 0.1, FZ1 - FZ0 - 0.1, cx, 0.03, cz, '#2c4632');
  d.blob('body', 2.6, 0.16, 1.9, cx - 0.6, 0.06, cz - 0.7, '#33512f', 0);
  d.blob('body', 2.1, 0.14, 1.6, cx + 1.2, 0.05, cz + 0.8, '#3a5c38', 0);

  // ---------- 花带：最靠近跑道的那一圈花最密最大（画面里占比最高），往里渐稀 ----------
  flowerMeadow(d, FX0 + 0.25, FZ1 - 1.05, 5.9, 0.62, 17, 5, 1);            // 前排密植，一朵挨一朵
  flowerMeadow(d, FX0 + 0.4, FZ0 + 1.5, 5.2, 1.5, 16, 40, 2);              // 中段半密
  flowerMeadow(d, FX0 + 0.6, FZ0 + 0.35, 4.8, 0.5, 8, 70, 1);              // 绿篱根下再压一条花色
  for (let i = 0; i < 5; i++) {                                            // 入口两侧各摆一盆（盆栽也是日式街角的味道）
    const px = cx + 0.55 + (i % 2 ? 0.5 : -0.5), pz = FZ1 - 0.15 - i * 0.28;
    d.cyl('body', 0.11, 0.085, 0.15, 8, px, 0.075, pz, '#a8794f');
    d.slab('body', 0.24, 0.24, px, 0.16, pz, '#8d6a45');
    flowerRound(d, px, pz, 0.2, PETAL[i % PETAL.length], 300 + i, 0.19);
  }

  // ---------- 后层：高绿篱压背景 + 矮墙 + 墙后探出来的树头 ----------
  for (let i = 0; i < 6; i++) shrub(d, FX0 + 0.35 + i * 1.12, FZ0 + 0.5, 0.52 + rnd(i, 21) * 0.12, 60 + i);
  d.box('body', 9.4, 1.1, 0.3, 0, 0.55, -4.6, '#8a8378');
  d.slab('body', 9.5, 0.16, 0, 1.14, -4.6, '#6e675d');
  for (let i = 0; i < 4; i++) {
    d.blob('body', 0.85, 0.5, 0.7, -3.4 + i * 2.3, 1.5, -4.9, i % 2 ? '#33512f' : C.greenDark, 0, { ry: i * 0.7 });
  }

  // ---------- 中层：两棵树定体量（往后靠，别挡住前面的花），中间留一棵小苗 ----------
  tree(d, FX0 + 0.85, FZ0 + 1.35, 2.7, 3);
  tree(d, FX1 - 0.85, FZ0 + 2.1, 2.1, 8);
  tree(d, cx + 1.5, cz - 0.6, 1.15, 14);
  shrub(d, FX0 + 2.4, cz + 0.9, 0.4, 21);

  // ---------- 前层：两座抬高的花池，一池一种主打色，密到看不见土 ----------
  // 池子里不塞草：草叶一散就把花挡没了。改成三排纯花、后高前矮（每朵都露得出来），
  // 只在池外两角留一小撮草收边。
  for (let k = 0; k < 2; k++) {
    const bx = FX0 + 1.25 + k * 3.2, bz = FZ1 - 1.62;
    d.box('body', 1.55, 0.26, 1.0, bx, 0.15, bz, C.wood);
    d.box('body', 1.67, 0.07, 1.12, bx, 0.3, bz, '#8d6a45');                 // 池沿压一道亮边
    d.slab('body', 1.42, 0.88, bx, 0.34, bz, '#3d2f22');                     // 湿土
    for (let i = 0; i < 12; i++) {
      const row = Math.floor(i / 4);                                         // 0=后排（离镜头远，留高）
      const px = bx - 0.6 + (i % 4) * 0.4 + rnd(k * 13 + i, 31) * 0.12;
      const pz = bz - 0.3 + row * 0.3 + rnd(k * 13 + i, 37) * 0.08;
      const c = PETAL[(k * 3 + i) % PETAL.length], fh = 0.3 - row * 0.055 + rnd(k + i, 43) * 0.05;
      const m = (i + k) % 3, soil = 0.37;                                   // 茎从土面起，不是从底座地面起
      if (m === 0) flowerRound(d, px, pz, fh, c, 500 + k * 17 + i, soil);
      else if (m === 1) flowerDaisy(d, px, pz, fh * 0.92, c, 500 + k * 17 + i, soil);
      else flowerCup(d, px, pz, fh * 0.88, c, 500 + k * 17 + i, soil);
    }
    grassTuft(d, bx - 0.86, bz + 0.52, 0.1, 500 + k);                        // 池角两小撮，只负责收边
    grassTuft(d, bx + 0.86, bz + 0.52, 0.09, 512 + k);
  }

  // ---------- 步道：不规则石板从入口往里铺，缝里长草 ----------
  for (let i = 0; i < 5; i++) {
    const px = cx + 0.5 + (rnd(i, 51) - 0.5) * 0.22, pz = FZ1 - 0.35 - i * 0.86;
    d.blob('body', 0.44, 0.045, 0.34, px, 0.05, pz, '#9a9484', 0, { ry: rnd(i, 53) * 0.7 });
    grassTuft(d, px - 0.42, pz + 0.1, 0.12, 130 + i);
  }

  // ---------- 围栏：立柱 + 两道横杆 + 尖头，临街那面留入口 ----------
  const post = (x: number, z: number): void => {
    d.box('body', 0.085, 0.86, 0.085, x, 0.43, z, '#e6e2d6');
    d.spike('body', 0.062, 0.1, x, 0.91, z, '#d9d3c4', { });
  };
  for (let i = 0; i <= 8; i++) {
    const p = FX0 + (i / 8) * (FX1 - FX0);
    if (i < 3 || i > 5) post(p, FZ1);
    post(p, FZ0);
  }
  for (let i = 0; i <= 7; i++) {
    const p = FZ0 + (i / 7) * (FZ1 - FZ0);
    post(FX0, p); post(FX1, p);
  }
  for (const y of [0.7, 0.32]) {
    d.box('body', FX1 - FX0, 0.055, 0.055, cx, y, FZ1, '#dcd7c9');
    d.box('body', FX1 - FX0, 0.055, 0.055, cx, y, FZ0, '#dcd7c9');
    d.box('body', 0.055, 0.055, FZ1 - FZ0, FX0, y, cz, '#dcd7c9');
    d.box('body', 0.055, 0.055, FZ1 - FZ0, FX1, y, cz, '#dcd7c9');
  }

  // ---------- 长椅、公告牌、四盏柱灯（柱灯顶亮 + 地上一小圈暖光） ----------
  for (let i = 0; i < 2; i++) {
    const x = cx - 1.7, z = cz - 1.0 + i * 1.95;
    d.box('body', 1.28, 0.07, 0.42, x, 0.46, z, C.wood);
    d.box('body', 1.28, 0.07, 0.1, x, 0.5, z - 0.18, '#8d6a45');
    d.box('body', 1.28, 0.36, 0.06, x, 0.68, z - 0.2, C.wood);
    for (const s of [-0.54, 0.54]) {
      d.box('body', 0.06, 0.44, 0.06, x + s, 0.22, z + 0.15, '#5a6068');
      d.box('body', 0.06, 0.44, 0.06, x + s, 0.22, z - 0.15, '#5a6068');
    }
  }
  d.box('body', 0.9, 1.2, 0.1, FX1 - 0.35, 1.1, FZ1 - 0.45, C.frame, { ry: -0.3 });
  d.quad('glow', 0.72, 0.9, FX1 - 0.31, 1.15, FZ1 - 0.42, C.coolWhite, { ry: -0.3 });
  for (let i = 0; i < 4; i++) {
    const x = FX0 + 0.55 + (i % 2) * 5.2, z = FZ0 + 0.9 + Math.floor(i / 2) * 3.3;
    d.cyl('body', 0.05, 0.062, 0.72, 6, x, 0.36, z, '#4c535e');
    d.box('body', 0.17, 0.05, 0.17, x, 0.75, z, '#3d434c');
    d.blob('body', 0.085, 0.075, 0.085, x, 0.7, z, C.warm, 0);
    d.quad('glow', 0.9, 0.9, x, 0.045, z, '#4a4231', { rx: -R90 });
  }
  for (const [x, z, len] of [[0.6, 2.6, 1.6], [-2.6, 2.4, 1.2], [3.9, -1.4, 2.2]] as const) {
    d.quad('glow', 0.42, len, x, 0.05, z, '#3d4658', { rx: -R90 });
  }
}

/** 远景楼群：三栋一组，两侧都开灯（左右两侧共用同一份几何，只是摆的位置不同） */
export function buildFarBlocks(d: Diorama): void {
  const H = [9.5, 14.0, 7.2], W = [3.4, 2.6, 3.0];
  for (let i = 0; i < 3; i++) {
    const x = -4.2 + i * 4.0, h = H[i];
    d.box('body', W[i], h, 3.2, x, h / 2, 0, i === 1 ? C.farA : C.farB);
    d.box('body', W[i] + 0.16, 0.2, 3.36, x, h + 0.1, 0, '#1a2030');
    d.box('body', 0.5, 1.1, 0.5, x - W[i] / 2 + 0.4, h + 0.6, 0.6, '#242c3c');
    for (let k = 0; k < 4; k++) for (let j = 0; j < 3; j++) {
      const c = j === 1 && k === 2 ? C.farNeon : C.farWin;
      d.quad('glow', 0.42, 0.5, x - W[i] / 2 - 0.02, 1.5 + k * 1.9, -0.9 + j * 0.9, (k + j) % 3 ? c : '#2b3444', { ry: -R90 });
      d.quad('glow', 0.42, 0.5, x + W[i] / 2 + 0.02, 1.5 + k * 1.9, -0.9 + j * 0.9, (k + j + i) % 3 ? c : '#2b3444', { ry: R90 });
    }
    if (i === 1) {                                                           // 中间那栋挂一条竖霓虹
      d.box('body', 0.16, 4.2, 0.16, x + W[i] / 2 + 0.1, 6.4, -1.0, '#242c3c');
      d.quad('glow', 0.3, 3.6, x + W[i] / 2 + 0.2, 6.4, -1.0, C.neonB, { ry: R90 });
    }
  }
}
