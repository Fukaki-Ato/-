/**
 * 路灯（雨夜便利店这一景共用一种形式）：便利店门口那种——锥形灯杆 + 顶部一截直臂 + 扁灯头 + 朝下的发光面。
 * 用户 2026-10-13 指定「所有路灯改成便利店旁边的那种形式」，所以跑道边、商铺门前、后巷、广场四处
 * 都走下面这一个 streetLamp，不再各写一套外形。
 * 亮度分配仍是 10-07 定稿那套：灯头亮 + 强晕（halo 1.7），地面光分两层（小亮核 + 大柔光），
 * 光池与光晕都跟着臂尖走 ⇒ 换外形不动光照。
 */
import * as THREE from 'three';
import { C, R90 } from './palette.js';
import type { Diorama } from './kit.js';

/** 灯头中心相对灯杆的偏移（挑臂伸出去多远，光池与光晕就偏多远） */
export const LAMP_REACH = 0.66;
/** 跑道边那盏的灯头高度 */
export const LAMP_Y = 5.66;
const POLE = '#5b6470';

/**
 * 一盏路灯。yaw = 臂朝向（局部）：0 朝 +z、R90 朝 +x、−R90 朝 −x；headY 是灯头中心高，reach 是臂长。
 * 调用方摆地面光时要按同一组数换算，否则会灯在这儿、光在那儿。
 */
export function streetLamp(d: Diorama, x: number, z: number, headY: number, yaw: number, reach: number,
  pole: string, glow: string): void {
  const ax = Math.sin(yaw), az = Math.cos(yaw), hx = x + reach * ax, hz = z + reach * az, poleH = headY - 0.06;
  d.cyl('body', 0.12, 0.16, 0.07, 8, x, 0.035, z, C.lampDark);                          // 底座
  d.cyl('body', 0.055, 0.085, poleH, 8, x, poleH / 2, z, pole);                          // 锥形杆：从粗到细一道收分
  d.cyl('body', 0.075, 0.075, 0.05, 8, x, poleH * 0.45, z, C.shopPipe);                  // 杆箍
  d.box('body', 0.08, 0.08, reach + 0.06, x + ax * reach / 2, headY + 0.07, z + az * reach / 2, pole, { ry: yaw });
  d.box('body', 0.36, 0.05, 0.56, hx, headY + 0.02, hz, C.frame, { ry: yaw });           // 压顶
  d.box('body', 0.32, 0.13, 0.5, hx, headY - 0.05, hz, C.lampDark, { ry: yaw });         // 扁灯头壳体
  d.slab('glow', 0.28, 0.4, hx, headY - 0.12, hz, glow, { ry: yaw });                    // 朝下那条发光面
}

/** 跑道边那一盏（局部坐标：杆底在原点，灯臂朝 +x，与 poolSpot / haloSpot 同一口径） */
export function buildLamp(d: Diorama): void {
  streetLamp(d, 0, 0, LAMP_Y, R90, LAMP_REACH, POLE, '#f2fbff');
}

/** 光池/光晕几何：池子躺平（Spot 只带 ry，倾角只能做进几何），晕片立着朝来路 */
export function poolGeo(size: number): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(size, size);
  g.rotateX(-Math.PI / 2);
  return g;
}
