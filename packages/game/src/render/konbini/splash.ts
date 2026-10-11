/**
 * 近处雨点落地的溅射粒子：每一朵水花都跟着**它自己那滴雨**——
 * 一根雨丝落到地面的那一瞬间，才在该点炸开 7 颗小水珠，0.26 秒内飞散消失。
 * 所以雨点和特效是同一个周期算出来的同一条时间线，不是各放各的假特效。
 * 全程无状态：位置由 (t, 周期, 相位) 直接算，切后台再回来也不会错乱。
 */
import * as THREE from 'three';
import { Layer, rnd } from './kit.js';

const PER = 9;         // 每朵水花的飞溅粒子数
const LIFE = 0.34;     // 水花寿命（秒）：还是「啪一下」，但留够一眼看得清的时间
const FALL = 0.5;      // 一个周期里，前 50% 用来落雨丝，剩下的时间放溅射

/** 一个溅射点：x/z 在世界里跟着跑道后退，p=这一滴雨的间隔，ph=相位（错开才不像齐步走） */
export interface Site { x: number; z: number; p: number; ph: number }

export function makeSites(n: number, loop: number): Site[] {
  return Array.from({ length: n }, (_, i) => ({
    x: -7.4 + rnd(i, 91) * 14.8,
    z: -loop + rnd(i, 97) * loop,
    p: 0.5 + rnd(i, 101) * 0.62,
    ph: rnd(i, 103) * 3.7,
  }));
}

/**
 * @param wrap 把 z 折回循环区间的函数（与整条侧景同一个周期，保证雨点跟着路面一起后退）
 */
export function createSplash(scene: THREE.Scene, sites: Site[], wrap: (z: number) => number): { update(move: number, t: number): void } {
  const tmp = new THREE.Color();
  const fade = (i: number, t: number): number => {
    const s = sites[(i / PER) | 0];
    const tau = ((t + s.ph) % s.p) - s.p * FALL;
    return tau < 0 || tau > LIFE ? -1 : tau;
  };
  // 落地的雨丝：与溅射同一个 tau，落到 y=0 的当帧正好接上炸开
  const drop = new Layer(scene, new THREE.PlaneGeometry(0.032, 0.62), new THREE.MeshBasicMaterial({
    color: '#d8ecff', transparent: true, opacity: 0.8, fog: false, blending: THREE.AdditiveBlending, depthWrite: false,
  }), sites.length, (i, t, out) => {
    const s = sites[i], tau = ((t + s.ph) % s.p);
    const k = tau / (s.p * FALL);
    const live = k >= 0 && k <= 1;
    out.x = s.x; out.y = live ? 1.95 * (1 - k) : -99; out.z = s.z; out.ry = 0; out.s = live ? 1 : 0;
  });
  // 水珠：向外抛 + 重力回落，越飞越小越暗
  const parts = new Layer(scene, new THREE.IcosahedronGeometry(0.048, 0), new THREE.MeshBasicMaterial({
    color: '#eaf6ff', transparent: true, opacity: 0.95, fog: false, blending: THREE.AdditiveBlending, depthWrite: false,
  }), sites.length * PER, (i, t, out) => {
    const si = (i / PER) | 0, k = i % PER, s = sites[si], tau = fade(i, t);
    if (tau < 0) { out.x = s.x; out.y = -99; out.z = s.z; out.ry = 0; out.s = 0; return; }
    const a = (k / PER) * Math.PI * 2 + rnd(k * 5 + si, 7);
    const v = 0.66 + rnd(k * 3 + si, 11) * 0.72;
    const life = 1 - tau / LIFE;
    out.x = s.x + Math.cos(a) * v * tau;
    out.z = s.z + Math.sin(a) * v * tau * 0.62;
    out.y = 0.04 + 1.5 * tau - 4.2 * tau * tau;
    out.ry = 0; out.s = life * (0.75 + rnd(k, si + 3) * 0.8);
    parts.tint(i, tmp.setScalar(life * life));
  });
  return {
    update(move: number, t: number): void {
      for (const s of sites) s.z = wrap(s.z + move);
      drop.update(t); parts.update(t); parts.flushColors();
    },
  };
}
