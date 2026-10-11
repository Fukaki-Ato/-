/**
 * 跑道边的路灯：细高杆 + 下垂弯臂 + 扁灯罩，样式跟便利店的金属件同一套（深炭灰 + 冷白光源）。
 * 走「清新精致」那条线：杆身从底到顶两道收分、三道箍，顶上一颗顶珠一截短尖，
 * 灯臂四段折出一条自然下垂的弧，灯罩薄长、带压顶与下沿圈，底下开一条冷白发光面。
 * 亮度分配刻意做：灯头亮 + 光晕强，地面光池分两层（小亮核 + 大柔光）⇒
 * 夜里看到的是一盏一盏清亮的冷白点，地上摊开一小片渐变，而不是白斑。
 */
import * as THREE from 'three';
import { C } from './palette.js';
import type { Diorama, Spot } from './kit.js';

/** 灯罩中心相对灯杆的局部 x（挑臂伸出去多远，光池与光晕就偏多远） */
export const LAMP_REACH = 0.66;
/** 灯罩中心高度（杆顶 5.62 + 一点点） */
export const LAMP_Y = 5.66;
const POLE_H = 5.5, DARK = '#4a525e', MID = '#5b6470', LITE = '#6d7682';

/** 一盏灯（局部坐标：杆底在原点，灯臂朝 +x 伸出） */
export function buildLamp(d: Diorama): void {
  // 底座两级 + 杆身：从粗到细两道收分，远看是「立起来的」，不是插一根管子
  d.cyl('body', 0.13, 0.17, 0.07, 8, 0, 0.035, 0, '#333a45');
  d.cyl('body', 0.085, 0.115, 0.09, 8, 0, 0.11, 0, DARK);
  d.cyl('body', 0.036, 0.058, POLE_H, 8, 0, POLE_H / 2 + 0.15, 0, MID);
  for (const y of [0.52, 2.4, POLE_H - 0.05]) {                             // 三道箍：细部，也压出分段节奏
    d.cyl('body', y > 4 ? 0.042 : 0.058, y > 4 ? 0.042 : 0.058, 0.045, 8, 0, y, 0, LITE);
  }
  d.blob('body', 0.042, 0.055, 0.042, 0, POLE_H + 0.24, 0, LITE, 0);         // 顶珠
  d.spike('body', 0.022, 0.16, 0, POLE_H + 0.35, 0, LITE, {});               // 顶上短尖

  // 弯臂：四段折出自然下垂的弧（单根直杆太硬，日式灯臂都是弯的）
  const pts: [number, number][] = [[0, POLE_H + 0.06], [0.2, POLE_H + 0.19], [0.42, POLE_H + 0.2], [0.56, POLE_H + 0.13], [LAMP_REACH, LAMP_Y]];
  for (let i = 0; i < pts.length - 1; i++) {
    d.strut('body', pts[i][0], pts[i][1], 0, pts[i + 1][0], pts[i + 1][1], 0, 0.026 - i * 0.003, MID, 5);
  }
  // 灯罩：压顶 + 薄长壳体 + 下沿圈 + 一条冷白发光面，外面再套一对小耳（精致感靠这几个小件）
  d.box('body', 0.52, 0.024, 0.23, LAMP_REACH, LAMP_Y + 0.055, 0, C.frame, { rz: -0.07 });
  d.box('body', 0.48, 0.09, 0.19, LAMP_REACH, LAMP_Y - 0.005, 0, DARK, { rz: -0.07 });
  d.box('body', 0.44, 0.02, 0.155, LAMP_REACH, LAMP_Y - 0.058, 0, '#2b313b', { rz: -0.07 });
  for (const s of [-1, 1]) d.box('body', 0.05, 0.05, 0.02, LAMP_REACH - 0.24, LAMP_Y + 0.02, s * 0.115, LITE, {});
  d.quad('glow', 0.4, 0.125, LAMP_REACH, LAMP_Y - 0.072, 0, '#f2fbff', { rx: Math.PI / 2 });
}

/** 光池/光晕几何：池子躺平（Spot 只带 ry，倾角只能做进几何），晕片立着朝来路 */
export function poolGeo(size: number): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(size, size);
  g.rotateX(-Math.PI / 2);
  return g;
}

/** 灯位 → 光池位（把挑臂那段前伸按灯的朝向旋到世界里；y=0.03 压在车道虚线之上） */
export function poolSpot(s: Spot): Spot {
  const c = Math.cos(s.ry), n = Math.sin(s.ry);
  return { x: s.x + LAMP_REACH * c * s.s, y: 0.03, z: s.z - LAMP_REACH * n * s.s, ry: 0, s: s.s };
}

/** 灯位 → 灯头光晕位（立在灯罩下方一点，朝向跟着灯转，正对来路） */
export function haloSpot(s: Spot): Spot {
  const c = Math.cos(s.ry), n = Math.sin(s.ry);
  return {
    x: s.x + LAMP_REACH * c * s.s, y: (LAMP_Y - 0.08) * s.s, z: s.z - LAMP_REACH * n * s.s, ry: s.ry, s: s.s,
  };
}
