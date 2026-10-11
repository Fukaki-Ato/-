/**
 * 雨夜便利店街角 · 底座 + 街道 + 店体外壳（局部坐标，单位米，正方形底座 10×10）。
 * 坐标约定：底座 x,z ∈ [-5,5]，顶面 y=0；两条马路沿 +X 与 +Z 两条边贴边而过 ⇒ 天然的「街角转折」。
 * 店体在 -X/-Z 那侧，转角处两面大玻璃橱窗朝向跑道，跑者从远处看进来就是「一个摆在底座上的模型」。
 * 自动门门扇、招牌闪、雨、涟漪这些会动的不在这里（见 konbiniProps.ts 的动画层）。
 */
import { C, R90 } from './palette.js';
import { buildBasePlate, buildStreet } from './base.js';
import type { Diorama } from './kit.js';

/** 店体 footprint / 自动门开口（南立面 x 区间）；底座与路缘尺寸见 base.ts */
export const B = { x0: -4.2, x1: 1.8, z0: -3.0, z1: 1.0, h: 3.5 };
export const DOOR = { x0: -0.15, x1: 1.6 };

const CX = (B.x0 + B.x1) / 2, CZ = (B.z0 + B.z1) / 2, BW = B.x1 - B.x0, BD = B.z1 - B.z0;

export function buildStoreShell(d: Diorama): void {
  // ---------- 正方形底座 + 街角两条路（与小花园共用同一套基座，风格一致且省内存） ----------
  buildBasePlate(d);
  buildStreet(d);

  // ---------- 店体四面薄墙（不能是实心块，否则看不见店内） ----------
  d.box('body', BW, B.h, 0.14, CX, B.h / 2, B.z0, C.wall);                       // 北墙（店内背景）
  d.box('body', 0.14, B.h, BD, B.x0, B.h / 2, CZ, C.wall);                       // 西墙
  // 南/东立面：下墙裙 + 上带 + 窗间柱，中间留给玻璃
  for (const s of [0, 1]) {
    const y0 = 0.46, y1 = 2.52;
    if (s === 0) {
      d.box('body', BW, y0, 0.16, CX, y0 / 2, B.z1, C.wallShade);
      d.box('body', BW, 0.12, 0.18, CX, y0 + 0.06, B.z1, C.band1);
      d.box('body', BW, B.h - y1, 0.16, CX, (y1 + B.h) / 2, B.z1, C.wall);
      for (let i = 0; i < 4; i++) d.box('body', 0.13, y1 - y0, 0.2, -4.0 + i * 1.28, (y0 + y1) / 2, B.z1, C.frame);
      for (let i = 0; i < 3; i++) d.quad('glass', 1.15, y1 - y0, -3.36 + i * 1.28, (y0 + y1) / 2, B.z1 + 0.02, C.glass);
    } else {
      d.box('body', 0.16, y0, BD, B.x1, y0 / 2, CZ, C.wallShade);
      d.box('body', 0.18, 0.12, BD, B.x1, y0 + 0.06, CZ, C.band2);
      d.box('body', 0.16, B.h - y1, BD, B.x1, (y1 + B.h) / 2, CZ, C.wall);
      for (let i = 0; i < 4; i++) d.box('body', 0.2, y1 - y0, 0.13, B.x1, (y0 + y1) / 2, -2.6 + i * 1.2, C.frame);
      for (let i = 0; i < 3; i++) d.quad('glass', 1.1, y1 - y0, B.x1 + 0.02, (y0 + y1) / 2, -2.0 + i * 1.2, C.glass, { ry: R90 });
    }
  }
  // 室内侧墙面/地面走 glow（自发光）：夜里从外面看才是「灯全开的店内」
  d.quad('glow', BW - 0.2, B.h - 0.5, CX, 1.75, B.z0 + 0.09, '#c9d4de');
  d.quad('glow', BD - 0.2, B.h - 0.5, B.x0 + 0.09, 1.75, CZ, '#bfcadb', { ry: R90 });

  // ---------- 屋顶：楼板 + 女儿墙 + 空调冷凝机组 + 排气管 ----------
  d.slab('body', BW + 0.4, BD + 0.4, CX, B.h + 0.06, CZ, C.roof);
  // 屋顶一圈轮廓灯：掠射角看过来时店体是一大块暗墙，这条亮边把「方盒子是栋店」读出来
  for (const [w, dd, x, z] of [[BW + 0.44, 0.1, CX, B.z0 - 0.14], [BW + 0.44, 0.1, CX, B.z1 + 0.14], [0.1, BD + 0.44, B.x0 - 0.14, CZ], [0.1, BD + 0.44, B.x1 + 0.14, CZ]] as const) {
    d.slab('glow', w, dd, x, B.h + 0.16, z, '#4d5568');
  }
  for (const [w, dd, x, z] of [[BW + 0.4, 0.12, CX, B.z0 - 0.14], [BW + 0.4, 0.12, CX, B.z1 + 0.14], [0.12, BD + 0.4, B.x0 - 0.14, CZ], [0.12, BD + 0.4, B.x1 + 0.14, CZ]] as const) {
    d.box('body', w, 0.34, dd, x, B.h + 0.23, z, C.wallShade);
  }
  d.box('body', 1.5, 0.62, 0.9, CX - 1.1, B.h + 0.45, CZ - 0.6, C.metal);
  d.cyl('body', 0.3, 0.3, 0.08, 10, CX - 1.1, B.h + 0.78, CZ - 0.6, C.frame, { rx: R90 });
  d.box('body', 0.7, 0.5, 0.7, CX + 1.4, B.h + 0.4, CZ + 0.8, C.metal);
  d.cyl('body', 0.09, 0.09, 0.9, 6, B.x0 + 0.9, B.h + 0.6, B.z0 + 0.4, C.metal);

  // ---------- 屋檐雨棚（两面）+ 招牌带 + 三角色灯 + 转角侧招 ----------
  for (const s of [0, 1]) {
    const c = s === 0 ? C.band1 : C.band2;
    if (s === 0) {
      d.box('body', BW + 0.2, 0.1, 1.05, CX, 2.78, B.z1 + 0.55, c);
      d.box('body', BW + 0.2, 0.16, 0.07, CX, 2.7, B.z1 + 1.06, C.frame);
      for (let i = 0; i < 6; i++) d.box('body', 0.42, 0.1, 0.06, -3.9 + i * 1.1, 2.67, B.z1 + 1.07, i % 2 ? C.wall : c);
      for (let i = 0; i < 4; i++) d.strut('body', -3.6 + i * 1.7, 2.72, B.z1 + 0.1, -3.6 + i * 1.7, 1.9, B.z1 + 1.0, 0.03, C.metal);
    } else {
      d.box('body', 1.05, 0.1, BD + 0.2, B.x1 + 0.55, 2.78, CZ, c);
      d.box('body', 0.07, 0.16, BD + 0.2, B.x1 + 1.06, 2.7, CZ, C.frame);
    }
  }
  // 招牌带压在雨棚上方：暗框 + 底光面（闪烁由动画层叠加）+ 三色圆（店招记忆点）
  d.box('body', BW + 0.1, 0.68, 0.2, CX, 3.3, B.z1 + 0.02, C.frame);
  d.quad('glow', BW - 0.15, 0.5, CX, 3.3, B.z1 + 0.14, '#6a5c44');            // 底光压暗，闪烁由动画层加上去
  for (let i = 0; i < 3; i++) {
    d.cyl('glow', 0.17, 0.17, 0.06, 12, -1.0 + i * 0.62, 3.3, B.z1 + 0.16, [C.neonA, C.neonB, C.neonC][i], { rx: R90 });
  }
  d.box('body', 0.2, 0.62, BD - 0.6, B.x1 + 0.06, 3.3, CZ, C.frame);
  d.quad('glow', BD - 0.8, 0.46, B.x1 + 0.18, 3.3, CZ, '#ffe9c4', { ry: R90 });
  d.box('body', 0.16, 1.0, 0.16, B.x1 + 0.1, 3.15, B.z1 + 0.1, C.frame);        // 转角立柱招
  d.quad('glow', 0.5, 0.8, B.x1 + 0.19, 3.15, B.z1 + 0.1, C.neonA, { ry: R90 });

  // ---------- 入口：门框 + 门槛 + 地垫 ----------
  const dw = DOOR.x1 - DOOR.x0, dcx = (DOOR.x0 + DOOR.x1) / 2;
  d.box('body', 0.16, 2.5, 0.22, DOOR.x0 - 0.08, 1.25, B.z1, C.frame);
  d.box('body', 0.16, 2.5, 0.22, DOOR.x1 + 0.08, 1.25, B.z1, C.frame);
  d.box('body', dw + 0.4, 0.24, 0.24, dcx, 2.4, B.z1, C.frame);
  d.box('body', dw + 0.3, 0.05, 0.3, dcx, 0.03, B.z1 + 0.05, C.metal);
  d.slab('body', 1.9, 0.95, dcx, 0.02, B.z1 + 0.62, C.dark);                     // 门口地垫
  d.slab('glow', 1.6, 0.66, dcx, 0.026, B.z1 + 0.62, '#4a5364');
  // 店头灯光洒在湿人行道上：酷跑的机位是俯视，地面这摊暖光才是「店在这里」的头号线索
  d.quad('glow', 5.2, 1.7, CX + 0.3, 0.045, B.z1 + 1.5, '#6a5730', { rx: -R90 });
  d.quad('glow', 2.0, 1.0, dcx, 0.05, B.z1 + 1.15, '#8a713c', { rx: -R90 });
  for (let i = 0; i < 3; i++) {                                                  // 霓虹在车行道上的三道倒影
    d.quad('glow', 0.34, 1.5, -2.2 + i * 1.6, 0.048, 3.9, ['#24505e', '#4a2f42', '#4d4224'][i], { rx: -R90 });
  }
  // 无障碍/导视盲道（黄色导视条从店门口铺到人行道边）
  for (let i = 0; i < 5; i++) d.slab('body', 0.5, 0.34, dcx, 0.028, B.z1 + 1.3 + i * 0.42, '#d8c25a');

  // ---------- 后巷：邻居楼 + 巷子地面 + 壁灯 + 纸箱 ----------
  d.box('body', 6.2, 4.3, 1.1, -1.9, 2.15, -4.55, C.farB);
  d.slab('body', 6.2, 0.9, -1.9, 4.34, -4.55, C.roof);
  for (let i = 0; i < 4; i++) d.quad('glow', 0.6, 0.55, -3.9 + i * 1.5, 2.2 + (i % 2) * 1.2, -3.99, i % 3 ? C.farWin : '#8fd4ff');
  d.slab('body', 2.6, 1.5, B.x0 + 1.3, 0.02, -3.5, C.roadDark);                  // 巷子里的地面
  d.box('body', 0.55, 0.5, 0.55, B.x0 + 0.7, 0.25, -3.6, C.wood);                // 纸箱两只
  d.box('body', 0.45, 0.4, 0.45, B.x0 + 1.4, 0.2, -3.3, C.wood);
  d.quad('glow', 0.26, 0.34, B.x0 + 2.0, 2.3, -3.97, C.warmMid);                 // 巷口壁灯
  d.cyl('body', 0.03, 0.03, 0.4, 6, B.x0 + 2.0, 2.05, -3.85, C.frame, { rx: 0.4 });
}
