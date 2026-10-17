/**
 * 雨夜便利店街角 · 街面前带（商铺排与便利店底座之前那一条靠跑道的地面）。
 * 三件事收在这里：① 铺地（人行道面 + 路肩 + 路缘 + 铺装缝 + 排水篦），商铺门前与中间那块空地共用同一套做法，
 * 两块路面才接得连贯；② 贴着跑道那条 2m 宽、平行跑道的小道（亮一档的蓝灰铺面 + 每 0.9m 一道横缝）；
 * ③ 从空地挪到商铺正门前的一巷杂物——杂物占住的位置，小道就断开不铺。
 * 坐标口径与 shopfronts.ts 一致：长轴沿局部 z，临街朝局部 −x，底座顶面 y=0。
 * 10-13 改动：小道原来是片元着色器画鹅卵石，压暗后成一地色斑、和整体夜色不搭 ⇒ 纹理撤掉，只留道。
 */
import { C, R90 } from './palette.js';
import { WALK } from './base.js';
import { streetLamp } from './lamps.js';
import type { Diorama } from './kit.js';

/** 空地的横向尺寸（临街边到楼体）：与商铺排底座同宽，两块路面才接得上 */
const GPZ = 11.9, GPX0 = -7.4, GPX1 = 5.8;
/** 小道中心与宽度（贴着底座临街那一边，2m） */
const BAND_X = -6.2, BAND_W = 2;
/** 杂物在局部 z 上的落点与占位宽度（同时也是小道的断点，一张表管两头） */
const CLUTTER = [{ z: -11.8, w: 3.2 }, { z: -6.3, w: 3.2 }, { z: 0.6, w: 2.8 }, { z: 5.2, w: 1.6 }, { z: 9.6, w: 3.2 }];
/** 巷灯一组数（灯位 + 灯头高 + 臂长）：建模与它脚下那摊暖光都从这儿取，不会两处漂移 */
const ALLEY_LAMP = { x: BAND_X, z: 5.2, y: 3.0, reach: 0.5 };

/**
 * 铺地：人行道（深灰蓝）+ 路肩（再暗一档）+ 路缘石 + 横竖铺装缝 + 三道排水篦。
 * 缝用平躺的 quad 画（4 顶点，比 slab 便宜六倍），整块地靠这几条缝破掉大面积纯色。
 */
export function buildPaving(d: Diorama, x0: number, hz: number): void {
  d.slab('body', -WALK, hz * 2 - 0.1, WALK / 2, 0.015, 0, C.walkBlue);
  d.slab('body', WALK - x0, hz * 2 - 0.1, (x0 + WALK) / 2, 0.012, 0, C.shoulder);
  d.box('body', 0.16, 0.11, hz * 2, WALK, 0.035, 0, C.curbStone);
  for (let i = 0; i < 6; i++) d.quad('body', -WALK - 0.2, 0.05, WALK / 2, 0.05, -hz + 1.9 + i * (hz * 2 - 3.8) / 5, C.walkBlueSeam, { rx: -R90 });
  d.quad('body', 0.05, hz * 2 - 0.4, -1.5, 0.05, 0, C.walkBlueSeam, { rx: -R90 });
  for (let i = 0; i < 3; i++) d.slab('body', 0.34, 0.5, WALK + 0.45, 0.022, -hz + 2.6 + i * (hz * 2 - 5.2) / 2, C.drain);
}

/**
 * 小道：从 z0 铺到 z1，遇到 CLUTTER 占住的位置就断开（用户：已有东西在就跳过不铺，作为区分）。
 * 每 0.9m 一道横缝 ⇒ 读得出是石板铺的，而不是在地上刷了一条亮色。
 */
export function buildPath(d: Diorama, z0: number, z1: number, cut: boolean): void {
  const holes = cut ? CLUTTER.map(c => [c.z - c.w / 2, c.z + c.w / 2]) : [];
  let z = z0;
  while (z < z1 - 0.3) {
    const hit = holes.find(h => z > h[0] - 0.01 && z < h[1]);
    if (hit) { z = hit[1]; continue; }
    let end = z1;
    for (const h of holes) if (h[0] > z && h[0] < end) end = h[0];
    d.slab('body', BAND_W, end - z - 0.06, BAND_X, 0.022, (z + end) / 2, C.path);
    for (let j = Math.ceil(z / 0.9) * 0.9; j < end - 0.25; j += 0.9) {
      d.quad('body', BAND_W - 0.12, 0.06, BAND_X, 0.058, j, C.pathSeam, { rx: -R90 });
    }
    z = end;
  }
}

/** 便利店与商铺排之间那条约 24m 的空地：只铺路面（与商铺门前同一套），杂物已挪到商铺正门前 */
export function buildGapPave(d: Diorama): void {
  const cx = (GPX0 + GPX1) / 2;
  d.box('body', GPX1 - GPX0, 0.34, GPZ * 2, cx, -0.17, 0, C.plate);
  d.box('body', GPX1 - GPX0 + 0.04, 0.14, GPZ * 2 + 0.04, cx, -0.39, 0, C.plateEdge);
  buildPaving(d, GPX0, GPZ);
  buildPath(d, -GPZ + 0.5, GPZ - 0.5, false);
  for (const [px, pz, pw, pd, c] of [
    [-2.6, -6.2, 1.6, 3.2, C.wetWarm], [-3.1, 2.4, 1.3, 2.6, C.wetNeon], [-1.8, 8.4, 1.5, 3, C.wetCool],
  ] as const) d.quad('glow', pw, pd, px, 0.048, pz, c, { rx: -R90 });
}

/** 一段铁丝网围栏（立柱 + 两道横杆） */
function fenceRun(d: Diorama, x: number, z0: number, z1: number): void {
  for (const z of [z0, (z0 + z1) / 2, z1]) d.box('body', 0.09, 1.15, 0.09, x, 0.58, z, C.lampGrey);
  for (const y of [1.1, 0.62]) d.box('body', 0.05, 0.05, z1 - z0, x, y, (z0 + z1) / 2, C.lampDark);
}

/**
 * 一巷杂物（从便利店与商铺之间的空地挪到商铺正门前）：垃圾箱、木箱托盘、圆桶、围栏、一盏短杆巷灯。
 * 全部落在小道那 2m 之内 ⇒ 道到这儿就断开，读起来是「门前堆了一巷东西」。
 */
export function buildFrontClutter(d: Diorama): void {
  const bx = BAND_X;
  d.box('body', 1.5, 1.05, 2.1, bx, 0.53, -11.8, C.binDark);
  d.box('body', 1.58, 0.12, 2.18, bx, 1.11, -11.8, C.lampDark);
  d.blob('body', 0.34, 0.24, 0.34, bx - 1.1, 0.24, -10.7, '#3b424c', 0);
  d.blob('body', 0.3, 0.22, 0.3, bx + 1.05, 0.22, -12.6, '#39404a', 0);

  d.box('body', 0.9, 0.72, 1.15, bx + 0.1, 0.36, -6.9, C.wood);
  d.box('body', 0.72, 0.56, 0.9, bx + 0.1, 0.98, -6.5, C.wood);
  d.box('body', 0.62, 0.5, 0.8, bx - 0.95, 0.25, -5.8, C.wood);
  d.slab('body', 1.3, 0.9, bx + 0.1, 0.06, -5.2, '#6b5a3f');

  for (const [bz, ox] of [[0.2, -0.5], [1.3, 0.6]] as const) {
    d.cyl('body', 0.27, 0.23, 0.82, 6, bx + ox, 0.41, bz, C.binDark);
    d.cyl('body', 0.29, 0.29, 0.07, 6, bx + ox, 0.85, bz, C.lampDark);
  }
  fenceRun(d, bx, 1.9, 3.4);
  fenceRun(d, bx, 10.4, 12.2);
  d.blob('body', 0.32, 0.24, 0.32, bx + 0.9, 0.24, 9.4, '#3b424c', 0);

  streetLamp(d, ALLEY_LAMP.x, ALLEY_LAMP.z, ALLEY_LAMP.y, -R90, ALLEY_LAMP.reach, C.lampGrey, C.warmPool);   // 短杆巷灯（统一形式）
  d.strut('body', bx - 0.5, 3.0, 5.2, -0.2, 3.42, 5.2, 0.022, '#1e232c', 5);              // 一根电线搭到屋檐
  d.quad('glow', 3.2, 3.2, bx - 0.5, 0.055, 5.2, C.wetWarm, { rx: -R90 });                 // 灯下那摊暖光
  for (const [pz, pw, c] of [[-8.6, 1.6, C.wetWarm], [4.2, 1.4, C.wetCool], [12.2, 1.5, C.wetNeon]] as const) {
    d.quad('glow', pw, 2.4, bx, 0.056, pz, c, { rx: -R90 });                              // 道上的积水
  }
}
