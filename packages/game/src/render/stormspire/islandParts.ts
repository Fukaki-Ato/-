/**
 * 天穹雷脊 · 浮空岛八原型的部件配方（自 islands.ts 拆出：300 行红线机械重构，纯剪切搬家，零行为变化）：
 *   rockGeo    岩体几何（倒锥 + 确定性噪声扰形，两档比例）
 *   isle       单块岛的部件摆位（岩体/草盖/钟乳石/沉积岩带/垂根）
 *   addShrine  岛顶小神龛摆位
 *   addTemple / addChained / addGrove / addFalls  中景建筑化四原型（神庙/锚链岛/风剪林/瀑布岛）
 *   Built      原型写入的装配篮（insts/breathers/各类摆位收集数组）
 * 只含配方与摆位推导；createIslands 的主装配/实例化/逐帧回收仍归 islands.ts（材质创建顺序不变）。
 */
import * as THREE from 'three';
import { addInst, rnd, std, type Inst, type Placement } from '../sceneryProps.js';
import { P } from './palette.js';
import { tierOf } from './bridge.js';

/** 岩体（两档比例）：S/M 墩胖，L/XL 更深盘 */
export function rockGeo(deep: boolean): THREE.BufferGeometry {
  const g = deep
    ? new THREE.CylinderGeometry(1, 0.22, 1, 9, 3)
    : new THREE.CylinderGeometry(1, 0.4, 1, 8, 2);
  g.translate(0, -0.5, 0); // 顶面在 y=0，往下长
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const n = Math.sin(x * 2.1 + y * 3.3) * Math.cos(z * 1.7 - y * 2.2) * 0.14;
    pos.setX(i, x * (1 + n)); pos.setZ(i, z * (1 + n));
  }
  g.computeVertexNormals();
  return g;
}

/** 一块岛的部件摆位（岩体/草盖/钟乳石×n/沉积岩带×2/垂根×2） */
export function isle(at: { x: number; y: number; z: number; s: number; ry: number }, salt: number, deep: boolean) {
  const rock: Placement = { ...at };
  const grass: Placement = { ...at, y: at.y + 0.06 * at.s };
  const stal: Placement[] = [], strata: Placement[] = [], vines: Placement[] = [];
  const n = 3 + Math.floor(rnd(at.z | 0, salt) * 4);
  for (let k = 0; k < n; k++) {
    const a = rnd(at.z | 0, salt + k * 3) * 6.283, r = (0.25 + rnd(at.z | 0, salt + k * 5) * 0.5) * at.s;
    stal.push({ x: at.x + Math.cos(a) * r, y: at.y - at.s * (0.55 + rnd(k, salt + 9) * 0.5), z: at.z + Math.sin(a) * r, s: at.s * (0.1 + rnd(k, salt + 13) * 0.16), ry: a });
  }
  // 沉积岩带：微宽于所在深度锥面的深色环带（deep 锥 1→0.22，普通锥 1→0.4）
  const rAt = (k: number) => (deep ? 1 - 0.78 * k : 1 - 0.6 * k) + 0.045;
  for (const k of [0.32, 0.62]) {
    strata.push({ x: at.x, y: at.y - at.s * k, z: at.z, s: at.s * rAt(k), ry: at.ry });
  }
  // 垂根：岩缘垂下的细根须
  for (let k = 0; k < 2; k++) {
    const a = rnd(at.z | 0, salt + 31 + k) * 6.283, r = 0.7 * at.s;
    vines.push({ x: at.x + Math.cos(a) * r, y: at.y - at.s * (0.5 + rnd(k, salt + 37) * 0.3), z: at.z + Math.sin(a) * r, s: at.s * (0.5 + rnd(k, salt + 41) * 0.4), ry: a });
  }
  return { rock, grass, stal, strata, vines };
}

/** 岛顶小神龛：石匣 + 四棱锥顶 + 金尖（驭雷者的路祭） */
export function addShrine(at: Placement, body: Placement[], top: Placement[], tip: Placement[]) {
  body.push({ ...at, y: at.y + 0.3 * at.s, s: at.s });
  top.push({ ...at, y: at.y + 0.78 * at.s, s: at.s });
  tip.push({ ...at, y: at.y + 1.18 * at.s, s: at.s });
}

export interface Built {
  scene: THREE.Scene;
  insts: Inst[];
  /** 呼吸升降件：amp=1.6 随岛起伏，amp=0 恒高（静态岛碎石复用同一管线） */
  breathers: { p: Placement; baseY: number; ph: number; amp: number }[];
  shrineBody: Placement[]; shrineTop: Placement[]; shrineTip: Placement[];
  tufts: Placement[];
  torsos: Placement[];
  rubbles: Placement[];
}

/** 原型：神庙岛（阶梯基座 + 三段式柱廊残阵 + 檐带 + 断拱 + 倒地柱头/倒伏躯干） */
export function addTemple(b: Built, at: Placement,
  tBase: Placement[], tShaft: Placement[], tCap: Placement[], tBeam: Placement[], torsos: Placement[]) {
  const { scene } = b;
  const s = at.s;
  for (let k = 0; k < 3; k++) {
    b.insts.push(addInst(scene, new THREE.BoxGeometry(6.4 - k * 1.4, 0.5, 4.6 - k * 1.1), std(P.stone),
      [{ ...at, y: at.y + (0.25 + k * 0.5) * s }]));
  }
  // 三段式柱四态混编（完好/断头/倒鼓/倾斜），相邻完柱之间补檐带
  const placed: { x: number; z: number; full: boolean; tier?: number }[] = [];
  for (let c = 0; c < 4; c++) {
    const cx = at.x + (c - 1.5) * 1.5 * s, cz = at.z + 1.4 * s;
    const st = rnd(at.z | 0, 40 + c);
    const base = { x: cx, y: at.y + 1.5 * s, z: cz, s, ry: 0 };
    tBase.push(base);
    if (st < 0.4) {
      // 完柱三档高度错落（0.72/1/1.32），相邻柱（c 奇偶）档位倾向交错，柱头随档缩放
      const tier = tierOf(c % 2, rnd(at.z | 0, 141 + c));
      tShaft.push({ ...base, y: base.y + 3.1 * s * tier, s: s * tier });
      tCap.push({ ...base, y: base.y + 6.0 * s * tier, s: s * tier });
      placed.push({ x: cx, z: cz, full: true, tier });
    } else if (st < 0.65) {
      tShaft.push({ ...base, y: base.y + 1.6 * s, s: s * 0.5 });
      placed.push({ x: cx, z: cz, full: false });
    } else if (st < 0.85) {
      // 倒地断鼓两节
      tBeam.push({ x: cx + 0.5 * s, y: at.y + 1.62 * s, z: cz + 0.3 * s, s: s * 0.5, ry: 0.4, rz: 0 });
      tBeam.push({ x: cx - 0.4 * s, y: at.y + 1.54 * s, z: cz + 0.6 * s, s: s * 0.45, ry: 1.2, rz: 0 });
      placed.push({ x: cx, z: cz, full: false });
    } else {
      tShaft.push({ ...base, y: base.y + 3.0 * s, s, rz: 0.1 });
      placed.push({ x: cx, z: cz, full: false });
    }
  }
  // 檐带：相邻两根完柱之间架一道（档位不同时搭在较矮柱头顶上，读作残段）
  for (let i = 0; i < placed.length - 1; i++) {
    if (placed[i]!.full && placed[i + 1]!.full) {
      tBeam.push({ x: (placed[i]!.x + placed[i + 1]!.x) / 2, y: at.y + (6.3 * Math.min(placed[i]!.tier ?? 1, placed[i + 1]!.tier ?? 1) + 1.3) * s, z: (placed[i]!.z + placed[i + 1]!.z) / 2, s, ry: 0, rz: 0 });
    }
  }
  // 断拱（半塌：一道竖直残段 + 斜落块）
  b.insts.push(addInst(scene, new THREE.BoxGeometry(0.7, 2.6, 0.7), std(P.stoneDark),
    [{ ...at, x: at.x - 2.6 * s, y: at.y + 2.7 * s, rz: 0.1 }]));
  // 倒地柱头块：台面上 1~2 块歪斜废料（复用柱头盒几何，滚落在柱列外侧）
  const nf = 1 + Math.floor(rnd(at.z | 0, 91) * 2);
  for (let k = 0; k < nf; k++) {
    tCap.push({
      x: at.x + (2.1 + rnd(at.z | 0, 93 + k * 5) * 1.2) * s, y: at.y + 1.88 * s,
      z: at.z - (0.6 + rnd(at.z | 0, 95 + k * 5) * 1.4) * s,
      s, ry: rnd(at.z | 0, 97 + k) * 6.283, rz: 0.45 + rnd(at.z | 0, 99 + k) * 0.45,
    });
  }
  // 倒伏躯干：1.2×2.2×0.8 石盒斜倚 15°，倾倒向统一 +x（同 §1.2 暴风掀倒方向）
  torsos.push({ x: at.x + 2.0 * s, y: at.y + 2.56 * s, z: at.z + 1.4 * s, s, ry: (rnd(at.z | 0, 103) - 0.5) * 0.5, rz: -0.26 });
}

/** 原型：锚链岛（锚塔 + 垂链进云海） */
export function addChained(b: Built, at: Placement) {
  const { scene } = b;
  const s = at.s;
  b.insts.push(addInst(scene, new THREE.CylinderGeometry(0.5, 0.9, 4.4, 6), std(P.stoneDark),
    [{ ...at, y: at.y + 2.2 * s }]));
  b.insts.push(addInst(scene, new THREE.CylinderGeometry(0.66, 0.5, 0.5, 6), std(P.verdigris),
    [{ ...at, y: at.y + 4.6 * s }]));
  const links: Placement[] = [];
  for (let k = 0; k < 6; k++) links.push({ ...at, y: at.y - (0.3 + k * 0.55) * s, s: s * 0.5, ry: k * 0.5 });
  b.insts.push(addInst(scene, new THREE.TorusGeometry(0.3, 0.09, 6, 10), std(P.stoneDark),
    links.map(p => ({ ...p, rx: Math.PI / 2 }))));
  b.insts.push(addInst(scene, new THREE.SphereGeometry(0.4, 8, 6), std(P.verdigris),
    [{ ...at, y: at.y - 3.9 * s, s: s * 0.7 }]));
}

/** 原型：风剪林岛（顺风 45° 弯折的枯树 + 树脚下 2~3 丛草簇） */
export function addGrove(b: Built, at: Placement) {
  const { scene } = b;
  const s = at.s, salt = at.z | 0;
  const trunks: Placement[] = [], crowns: Placement[] = [];
  const n = 3 + Math.floor(rnd(salt, 71) * 3);
  for (let k = 0; k < n; k++) {
    const a = rnd(salt, 73 + k) * 6.283, r = rnd(salt, 79 + k) * 1.8 * s;
    const x = at.x + Math.cos(a) * r, z = at.z + Math.sin(a) * r;
    trunks.push({ x, y: at.y + 0.9 * s, z, s: s * 0.8, ry: 0, rz: 0.8 });
    crowns.push({ x: x + 1.1 * s, y: at.y + 1.6 * s, z, s: s * 0.55, ry: 0, rz: 0.8 });
    // 草簇：树脚下 2~3 丛小压扁锥（贴草丘坡面，被风梳过的苔草）
    const tn = 2 + Math.floor(rnd(salt, 83 + k) * 2);
    for (let g = 0; g < tn; g++) {
      b.tufts.push({
        x: x + (rnd(salt, 85 + k * 7 + g) - 0.5) * 1.7 * s, y: at.y + (0.18 + rnd(salt, 91 + k) * 0.22) * s,
        z: z + (rnd(salt, 89 + k * 7 + g) - 0.5) * 1.7 * s,
        s: s * (0.3 + rnd(salt, 93 + k * 7 + g) * 0.3), ry: rnd(salt, 97 + k + g) * 6.283,
      });
    }
  }
  b.insts.push(addInst(scene, new THREE.CylinderGeometry(0.07, 0.13, 2.2, 5), std(0x6b5a45), trunks));
  b.insts.push(addInst(scene, new THREE.ConeGeometry(0.55, 1.3, 6), std(P.mossDark), crowns));
}

/** 原型：瀑布岛（岛缘丝带 + 落点雾团） */
export function addFalls(at: Placement, ribbons: Placement[], mists: Placement[]) {
  const s = at.s;
  ribbons.push({ x: at.x + 1.4 * s, y: at.y - 3.6 * s, z: at.z + 0.6 * s, s, ry: 0.3 });
  mists.push({ x: at.x + 1.7 * s, y: at.y - 7.4 * s, z: at.z + 0.8 * s, s: s * 1.15, ry: 0 });
}
