/**
 * 白日海景 · 双层简约海景别墅 + 正方形平台底座（局部坐标，底座 9×9，顶面 y=0）。
 * 朝向约定与雨夜那套一致：主玻璃面 +Z 正对来路（跑者先看到它），侧面 -X 朝跑道，
 * 所以左右两侧共用同一份几何，看到的都是「带阳台的那一面」。
 * 结构件：弧形屋顶（横放的半圆柱）、上下两层落地玻璃、露天观景阳台 + 白色栏杆、
 * 庭院露台 + 户外围栏 + 室外阶梯、屋顶平台。室内陈设见 villaIn.ts。
 */
import * as THREE from 'three';
import { P, R90 } from './palette.js';
import type { Diorama } from '../konbini/kit.js';

/** 建筑 footprint 与两层标高（villaIn.ts 与动画层共用） */
export const V = { x0: -3.4, x1: 1.6, z0: -3.6, z1: 0.2, gf: 2.75, uf: 5.05 };
/** 玻璃反光扫过的位置、室内呼吸灯的暖光板位置 */
export const ANCHOR_V = {
  sheen: [{ x: -0.9, y: 1.45, z: V.z1 + 0.06, ry: 0, w: 4.2, h: 2.1 },
    { x: V.x0 - 0.06, y: 1.5, z: -1.7, ry: -R90, w: 3.4, h: 2.1 }],
  breathe: [{ x: -0.9, y: V.gf - 0.32, z: -1.5 }, { x: -0.9, y: V.uf - 0.34, z: -1.5 }],
};
const CX = (V.x0 + V.x1) / 2, CZ = (V.z0 + V.z1) / 2, BW = V.x1 - V.x0, BD = V.z1 - V.z0;

export function buildVilla(d: Diorama): void {
  // ---------- 正方形海景平台底座：铺地 + 板缝 + 深色裙边 ----------
  d.box('body', 9, 0.3, 9, 0, -0.15, 0, P.deck);
  d.box('body', 9.08, 0.13, 9.08, 0, -0.36, 0, P.deckEdge);
  for (let i = 0; i < 6; i++) d.slab('body', 0.045, 4.4, -4.2 + i * 1.5, 0.005, 2.2, P.deckSeam);
  d.slab('body', 4.2, 3.6, CX + 0.2, 0.02, 1.9, P.wood);                    // 庭院露台：木地板一块
  for (let i = 0; i < 7; i++) d.slab('body', 4.1, 0.04, CX + 0.2, 0.05, 0.25 + i * 0.5, P.deckSeam);

  // ---------- 两层主体：奶白墙 + 深色框 + 白色腰线 ----------
  for (const y0 of [0, V.gf + 0.2]) {
    const hh = y0 === 0 ? V.gf : V.uf - (V.gf + 0.2);
    d.box('body', 0.14, hh, BD, V.x0, y0 + hh / 2, CZ, P.wall);             // 西墙（实心，室内背景）
    d.box('body', BW, hh, 0.14, CX, y0 + hh / 2, V.z0, P.wall);             // 北墙
    d.box('body', BW, 0.16, 0.16, CX, y0 + hh, CZ, P.beam);                 // 檐口白腰线
  }
  d.box('body', BW + 0.24, 0.22, BD + 0.24, CX, V.gf + 0.1, CZ, P.beam);     // 层间楼板外挑一圈
  d.slab('body', BW + 0.3, BD + 0.3, CX, V.uf + 0.12, CZ, P.wallShade);      // 屋顶板

  // ---------- 大面积落地玻璃：正立面 + 朝跑道侧立面（两层都通高） ----------
  for (const y0 of [0.28, V.gf + 0.32]) {
    const gh = (y0 === 0.28 ? V.gf : V.uf) - y0 - 0.22;
    const cy = y0 + gh / 2;
    d.quad('glass', BW - 0.5, gh, CX, cy, V.z1 + 0.02, P.glass);
    for (let i = 0; i < 4; i++) d.box('body', 0.1, gh, 0.12, V.x0 + 0.35 + i * 1.25, cy, V.z1, P.frame);
    d.box('body', BW - 0.4, 0.09, 0.14, CX, y0 + gh, V.z1, P.frame);
    d.quad('glass', BD - 0.6, gh, V.x0 - 0.02, cy, CZ, P.glass, { ry: -R90 });
    for (let i = 0; i < 3; i++) d.box('body', 0.12, gh, 0.1, V.x0, cy, V.z0 + 0.5 + i * 1.25, P.frame);
  }
  // 落地窗帘（两侧各一幅，室内才有「家」的柔软感）
  for (const s of [-1, 1]) {
    d.box('glow', 0.34, 2.05, 0.08, CX + s * 2.05, 1.42, V.z1 - 0.22, P.curtain);
    d.box('glow', 0.34, 1.9, 0.08, CX + s * 2.05, V.gf + 1.35, V.z1 - 0.22, P.curtain);
  }

  // ---------- 弧形屋檐：横放的半圆柱（三渲二里最干净的柔边屋顶） ----------
  d.add('body', new THREE.CylinderGeometry(1.15, 1.15, BW + 0.5, 14), P.roof, CX, V.uf + 0.62, CZ, { rz: R90 });
  d.box('body', BW + 0.6, 0.1, 0.16, CX, V.uf + 0.2, V.z1 + 0.1, P.roofDark);
  d.box('body', BW + 0.6, 0.1, 0.16, CX, V.uf + 0.2, V.z0 - 0.1, P.roofDark);

  // ---------- 露天观景阳台（二层，绕到侧面）：楼板 + 白栏杆 + 一门 ----------
  d.slab('body', 3.4, 1.3, CX + 0.3, V.gf + 0.16, V.z1 + 0.62, P.wallShade);
  const rail = (x: number, z: number, w: number, dp: number): void => {
    for (let i = 0; i < Math.round(w / 0.26); i++) {
      d.box('body', 0.05, 0.62, 0.05, x - w / 2 + i * 0.26, V.gf + 0.58, z, P.rail);
    }
    d.box('body', w, 0.06, dp, x, V.gf + 0.9, z, P.rail);
    d.box('body', w, 0.04, dp * 0.7, x, V.gf + 0.62, z, P.rail);
  };
  rail(CX + 0.3, V.z1 + 1.24, 3.4, 0.07);
  rail(CX + 2.0, V.z1 + 0.62, 1.24, 0.07);
  d.box('body', 1.0, 2.1, 0.1, CX + 0.4, V.gf + 1.3, V.z1 + 0.02, P.frame);  // 阳台门（深色框玻璃门）
  d.quad('glass', 0.86, 1.85, CX + 0.4, V.gf + 1.28, V.z1 + 0.06, P.glass);

  // ---------- 室外阶梯（露台三级下沉）+ 户外围栏 ----------
  for (let i = 0; i < 3; i++) {
    d.box('body', 1.5, 0.1, 0.34, CX + 1.2, 0.02 - i * 0.09, V.z1 + 1.6 + i * 0.34, P.wallShade);
  }
  for (let i = 0; i < 9; i++) {                                              // 底座外沿一圈矮围栏（正立面留出入口）
    const px = -4.2 + i * 1.05;
    if (px > -1.4 && px < 1.6) continue;
    d.box('body', 0.06, 0.5, 0.06, px, 0.25, 4.3, P.rail);
    d.box('body', 0.06, 0.5, 0.06, 4.3, 0.25, px, P.rail);
  }
  d.box('body', 4.2, 0.05, 0.05, -2.1, 0.46, 4.3, P.rail);
  d.box('body', 4.2, 0.05, 0.05, 2.1, 0.46, 4.3, P.rail);
  d.box('body', 0.05, 0.05, 9, 4.3, 0.46, 0, P.rail);

  // ---------- 屋顶小平台：护栏 + 通风口 + 一丛盆栽 ----------
  for (let i = 0; i < 5; i++) d.box('body', 0.05, 0.42, 0.05, V.x0 + 0.3 + i * 0.55, V.uf + 0.42, V.z0 + 0.4, P.rail);
  d.box('body', 2.3, 0.05, 0.05, V.x0 + 1.4, V.uf + 0.6, V.z0 + 0.4, P.rail);
  d.box('body', 0.55, 0.35, 0.55, V.x1 - 0.6, V.uf + 0.42, V.z0 + 0.8, P.wallShade);
  d.cyl('body', 0.16, 0.19, 0.3, 8, V.x1 - 0.6, V.uf + 0.75, V.z0 + 0.8, P.roofDark);
  d.cyl('body', 0.17, 0.13, 0.22, 8, V.x0 + 0.7, V.uf + 0.42, V.z1 - 0.5, P.pot);
  d.blob('body', 0.24, 0.2, 0.24, V.x0 + 0.7, V.uf + 0.66, V.z1 - 0.5, P.plant, 0);

  // ---------- 露台家具：小圆桌 + 两把椅 + 两盆植物（庭院露台区） ----------
  d.cyl('body', 0.34, 0.34, 0.05, 10, CX - 0.6, 0.42, 1.5, P.beam);
  d.cyl('body', 0.06, 0.09, 0.4, 6, CX - 0.6, 0.2, 1.5, P.woodDark);
  for (const s of [-1, 1]) {
    d.box('body', 0.36, 0.05, 0.36, CX - 0.6 + s * 0.62, 0.24, 1.5, P.wood);
    d.box('body', 0.36, 0.34, 0.05, CX - 0.6 + s * 0.62, 0.42, 1.5 - 0.16, P.wood);
    for (const q of [-0.14, 0.14]) d.box('body', 0.04, 0.24, 0.04, CX - 0.6 + s * 0.62 + q, 0.12, 1.5 + q, P.woodDark);
  }
  for (const s of [-1, 1]) {
    d.cyl('body', 0.19, 0.15, 0.3, 8, CX + 1.5, 0.15, 1.1 + (s + 1) * 0.5, P.pot);
    d.blob('body', 0.26, 0.3, 0.26, CX + 1.5, 0.48, 1.1 + (s + 1) * 0.5, P.plant, 1, { ry: s });
    d.blob('body', 0.18, 0.2, 0.18, CX + 1.5 + s * 0.14, 0.68, 1.1 + (s + 1) * 0.5, P.plant, 0);
  }
}
