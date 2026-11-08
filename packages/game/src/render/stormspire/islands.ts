/**
 * 天穹雷脊 · 浮空岛链（docs/stormspire-brief.md §3.1/§3.2 + §4.2/4.8/4.10/4.12；
 * 2026-11-11 细节整改：中景建筑化——三段式柱、沉积岩带、垂根、岛顶神龛、瀑布提亮）：
 * 岩体配方 = 倒锥岩体 + 苔灰绿草皮盖 + 底挂钟乳石；八原型混编排满 240m 循环。
 * 呼吸岛：y 做正弦升降（每帧重写矩阵，与 harbor 的全量 writeAll 同一开销口径）。
 * 2026-11-08 细节刻画：瀑布丝带换程序化竖纹（每帧 offset.y 向下滚）+ 落点雾团 ±8% 呼吸；
 * 风剪林脚下草簇、神庙倒地柱头 + 倒伏躯干、踏脚残岛碎石、岛顶神龛条件修复。
 * 2026-11-11 三轮：岛主行/信标/幡改 rhythmZ 疏密节奏取 z（口径见 bridge.ts），完柱/信标/幡杆三档高度错落。
 * 全部 InstancedMesh + 确定性 rnd；不读 sim。
 * 岩体/摆位配方与四原型拆在同目录 islandParts.ts（300 行红线机械拆分，配方逐字搬家）；
 * 本文件只留主装配（排布节奏）/实例化/逐帧回收，材质创建顺序不变。
 */
import * as THREE from 'three';
import {
  LOOP, WRAP_Z, addInst, rnd, std, writeAll,
  type Placement,
} from '../sceneryProps.js';
import { P } from './palette.js';
import { rhythmZ, tierOf } from './bridge.js';
import {
  addChained, addFalls, addGrove, addShrine, addTemple, isle, rockGeo,
  type Built,
} from './islandParts.js';

/**
 * 瀑布丝带程序化竖纹（配方同 trackVisuals.makeGroundTexture：免素材、确定性 hash、可平铺）：
 * 每列一档亮度——少数列是亮水丝、其余是稀薄水幕，沿程微抖出流动的碎感；
 * alpha 只沿 v 向（下落向）变化：底部渐隐溶进落点雾团。
 * ⚠️ 纹理 RGB 恒白、只管明暗与 alpha，色调交回材质色 P.cloud（明暗/色调分离，同 makeGroundTexture）。
 */
function makeFallTexture(): THREE.DataTexture {
  const N = 64;
  const data = new Uint8Array(N * N * 4);
  const hash = (x: number, y: number) => {
    const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return s - Math.floor(s);
  };
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const v = y / N;
    const col = hash(x, 913);
    const thread = col > 0.6 ? 0.55 + col * 0.45 : 0.16 + col * 0.3;
    const streak = thread + (hash(x >> 1, y >> 3) - 0.5) * 0.22;
    const a = Math.min(1, Math.max(0, streak)) * (0.22 + 0.78 * Math.pow(v, 1.4));
    const i = (y * N + x) * 4;
    data[i] = 255; data[i + 1] = 255; data[i + 2] = 255;
    data[i + 3] = 255 * a;
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

/** 雾团每帧 compose 的复用暂存（零分配；欧拉序与 writeAll 一致） */
const M4 = new THREE.Matrix4();
const QT = new THREE.Quaternion();
const EU = new THREE.Euler(0, 0, 0, 'YXZ');
const VV = new THREE.Vector3();
const SS = new THREE.Vector3();
function composeMist(mesh: THREE.InstancedMesh, i: number, x: number, y: number, z: number, ry: number, s: number) {
  EU.set(0, ry, 0); QT.setFromEuler(EU);
  VV.set(x, y, z); SS.set(s, s, s);
  M4.compose(VV, QT, SS);
  mesh.setMatrixAt(i, M4);
}

export function createIslands(scene: THREE.Scene) {
  const b: Built = {
    scene, insts: [], breathers: [], shrineBody: [], shrineTop: [], shrineTip: [],
    tufts: [], torsos: [], rubbles: [],
  };
  const rocks: Placement[] = [], grasses: Placement[] = [], stals: Placement[] = [];
  const stratas: Placement[] = [], vines: Placement[] = [];
  const ribbons: Placement[] = [], mists: Placement[] = [];
  const beacons: Placement[] = [], beaconTips: Placement[] = [];
  const bannerPoles: Placement[] = [], bannerCloth: Placement[] = [];
  const blades: Placement[] = [];
  const tBase: Placement[] = [], tShaft: Placement[] = [], tCap: Placement[] = [], tBeam: Placement[] = [];

  let salt = 500;
  const put = (x: number, y: number, z: number, s: number, deep: boolean, breathe = 0, rubble = false) => {
    const it = isle({ x, y, z, s, ry: rnd(z | 0, salt) * 6.283 }, salt++, deep);
    rocks.push(it.rock); grasses.push(it.grass);
    for (const st of it.stal) stals.push(st);
    for (const st of it.strata) stratas.push(st);
    for (const v of it.vines) vines.push(v);
    // 呼吸岛：岩体与草盖同相位升降（草盖原是静态摆位，不跟会脱底）；碎石 amp 随岛
    const ph = rnd(z | 0, 9) * 6.283;
    b.breathers.push({ p: it.rock, baseY: y, ph, amp: breathe > 0 ? 1.6 : 0 });
    if (breathe > 0) b.breathers.push({ p: it.grass, baseY: y + 0.06 * s, ph, amp: 1.6 });
    // 踏脚残岛：岛顶两块碎石（随机转角），呼吸岛与岛同升
    if (rubble) {
      for (let k = 0; k < 2; k++) {
        const rp: Placement = {
          x: x + (rnd(z | 0, 51 + k * 9) - 0.5) * 1.5 * s, y: y + 0.34 * s,
          z: z + (rnd(z | 0, 53 + k * 9) - 0.5) * 1.5 * s,
          s: s * (0.25 + rnd(z | 0, 57 + k * 9) * 0.25),
          ry: rnd(z | 0, 59 + k * 9) * 6.283, rz: (rnd(z | 0, 61 + k * 9) - 0.5) * 0.6,
        };
        b.rubbles.push(rp);
        b.breathers.push({ p: rp, baseY: y + 0.34 * s, ph, amp: breathe > 0 ? 1.6 : 0 });
      }
    }
  };

  // 岛屿主行按疏密节奏取 z（密集段 15m 双岛、开阔段 30m 独岛：废墟长廊 ↔ 云海视野交替）
  const mainZs: number[] = [];
  rhythmZ(26, 8, mainZs); // phase 8：与大道柱（0/5）、栏柱灯（3.6）、幡（6.8）错开 base 相位
  for (let i = 0; i < mainZs.length; i++) {
    const z = mainZs[i]! + (rnd(i, 1) - 0.5) * 4;
    const side: -1 | 1 = (i % 2 === 0) ? -1 : 1;
    const x = side * (11 + rnd(z | 0, 3) * 9), y = -4 - rnd(z | 0, 5) * 7, s = 2.2 + rnd(z | 0, 7) * 1.6;
    put(x, y, z, s, true, 0, true);
    const kind = Math.floor(rnd(z | 0, 11) * 5);
    if (kind === 0) addTemple(b, { x, y, z, s, ry: 0 }, tBase, tShaft, tCap, tBeam, b.torsos);
    else if (kind === 1) addChained(b, { x, y, z, s, ry: 0 });
    else if (kind === 2) addGrove(b, { x, y, z, s, ry: 0 });
    else if (kind === 3) { addFalls({ x, y, z, s, ry: 0 }, ribbons, mists); }
    else {
      blades.push({ x: x + s * 0.6, y: y + s * 0.7, z, s: s * 1.1, ry: rnd(z | 0, 13) * 6.283, rz: 1.1 });
    }
    if (kind === 0 || kind === 1) {
      const bt = tierOf(2, rnd(z | 0, 121)); // 信标柱三档参差（0.72/1/1.32），符文晶随杆顶走
      beacons.push({ x: x - side * 1.6, y: y + 0.6 * s, z: z + s * 2.2, s: bt, ry: 0 });
      beaconTips.push({ x: x - side * 1.6, y: y + 0.6 * s + 1.8 * bt + 0.15, z: z + s * 2.2, s: 1, ry: 0 });
    }
    // 踏脚残岛顶加神龛（每六座挑一座，路祭感；节奏排布后 z 不再落 78 的倍数，改按序号挑）
    if (i % 6 === 3) addShrine({ x: x + s * 0.4, y: y + 0.05 * s, z, s: s * 0.5, ry: 0 }, b.shrineBody, b.shrineTop, b.shrineTip);
  }
  // 漂移岛群（呼吸）：三簇小岛贴路两侧错落
  for (let c = 0; c < 3; c++) {
    const cz = -60 - c * 70, side: -1 | 1 = (c % 2 === 0) ? -1 : 1;
    for (let k = 0; k < 4; k++) {
      put(side * (7.5 + rnd(cz + k, 17 + k) * 3), -1.6 - rnd(cz + k, 19) * 1.6 + k * 0.9, cz - k * 9 - rnd(cz, 23) * 4,
        0.9 + rnd(cz + k, 29) * 0.7, false, 1, true);
    }
  }
  // 上方高空层：补纵深
  for (let z = -210; z < 0; z += 34) {
    const side: -1 | 1 = (Math.floor(z / 34) % 2 === 0) ? 1 : -1;
    put(side * (12 + rnd(z | 0, 31) * 10), 6.5 + rnd(z | 0, 33) * 5.5, z, 1.4 + rnd(z | 0, 35) * 1.2, false);
  }
  // 路缘风暴幡（两侧交替，节奏取 z；杆高三档参差，幡布贴杆身随档升降）
  const banZs: number[] = [];
  rhythmZ(22, 6.8, banZs); // phase 6.8：与栏柱灯（3.6）、岛行（8）错开，密集段幡不贴灯
  for (let i = 0; i < banZs.length; i++) {
    const z = banZs[i]! + (rnd(i, 41) - 0.5) * 3;
    const side: -1 | 1 = (i % 2 === 0) ? -1 : 1;
    const bt = tierOf(2, rnd(i, 43));
    bannerPoles.push({ x: side * 5.6, y: 1.5, z, s: bt, ry: 0 });
    bannerCloth.push({ x: side * 5.6, y: 1.5 + 1.1 * bt, z, s: 1, ry: 0 });
    bannerCloth.push({ x: side * 5.6 - side * 0.5, y: 1.5 + 1.1 * bt - 0.45, z, s: 1, ry: 0 });
  }

  // ---- 实例化 ----
  b.insts.push(addInst(scene, rockGeo(true), std(P.stone), rocks.filter((_, i) => i % 2 === 0)));
  b.insts.push(addInst(scene, rockGeo(false), std(P.stone), rocks.filter((_, i) => i % 2 === 1)));
  // 草盖：压扁半球扣在岩顶（读作苔丘，不是棒棒糖）
  const grassGeo = new THREE.SphereGeometry(1, 10, 6);
  grassGeo.scale(1.04, 0.5, 1.04);
  b.insts.push(addInst(scene, grassGeo, std(P.moss), grasses));
  b.insts.push(addInst(scene, new THREE.ConeGeometry(1, 2.4, 6), std(P.stoneDark), stals.map(p => ({ ...p, rx: Math.PI }))));
  // 沉积岩带 + 垂根（中景层次）
  b.insts.push(addInst(scene, new THREE.CylinderGeometry(1, 1, 0.22, 9), std(P.stoneDark), stratas));
  b.insts.push(addInst(scene, new THREE.CylinderGeometry(0.03, 0.05, 1.6, 4), std(P.mossDark), vines));
  // 瀑布：半开圆筒丝带 + 程序化竖纹（update 里 offset.y 向下滚），落点雾团单独持引用（每帧呼吸 compose）
  const fallTex = makeFallTexture();
  const fallMat = new THREE.MeshLambertMaterial({ color: P.cloud, map: fallTex, transparent: true, opacity: 0.65, side: THREE.DoubleSide });
  b.insts.push(addInst(scene, new THREE.CylinderGeometry(1.3, 1.5, 9, 10, 1, true, 0, Math.PI), fallMat, ribbons));
  const mistInst = addInst(scene, new THREE.SphereGeometry(1, 8, 5), std(P.cloud), mists);
  b.insts.push(addInst(scene, new THREE.BoxGeometry(0.16, 1.8, 0.16), std(P.stoneDark), beacons.map(p => ({ ...p, y: p.y + 0.9 * p.s }))));
  b.insts.push(addInst(scene, new THREE.OctahedronGeometry(0.24, 0), new THREE.MeshBasicMaterial({ color: P.gold }), beaconTips));
  b.insts.push(addInst(scene, new THREE.CylinderGeometry(0.05, 0.07, 3.2, 6), std(P.stoneDark), bannerPoles.map(p => ({ ...p, y: p.y + 1.1 * p.s }))));
  b.insts.push(addInst(scene, new THREE.BoxGeometry(0.06, 0.85, 1.5), std(P.storm), bannerCloth.filter((_, i) => i % 2 === 0)));
  b.insts.push(addInst(scene, new THREE.BoxGeometry(0.06, 0.7, 1.1), std(P.storm), bannerCloth.filter((_, i) => i % 2 === 1)));
  b.insts.push(addInst(scene, new THREE.BoxGeometry(0.16, 3.4, 0.5), std(P.verdigris), blades));
  // 神庙三段式柱 + 檐带
  b.insts.push(addInst(scene, new THREE.BoxGeometry(1.0, 0.5, 1.0), std(P.stoneDark), tBase));
  b.insts.push(addInst(scene, new THREE.CylinderGeometry(0.32, 0.4, 6, 8), std(P.stone), tShaft));
  b.insts.push(addInst(scene, new THREE.BoxGeometry(1.05, 0.6, 1.05), std(P.stoneDark), tCap));
  b.insts.push(addInst(scene, new THREE.BoxGeometry(0.7, 0.5, 2.4), std(P.stone), tBeam));
  // 倒伏躯干（斜倚石盒）+ 踏脚碎石（小石盒随机转角）+ 风剪林草簇（小压扁锥）
  b.insts.push(addInst(scene, new THREE.BoxGeometry(1.2, 2.2, 0.8), std(P.stoneDark), b.torsos));
  b.insts.push(addInst(scene, new THREE.BoxGeometry(0.55, 0.38, 0.42), std(P.stoneDark), b.rubbles));
  const tuftGeo = new THREE.ConeGeometry(0.42, 0.5, 5);
  tuftGeo.scale(1, 0.6, 1);
  b.insts.push(addInst(scene, tuftGeo, std(P.mossDark), b.tufts));
  // 神龛
  b.insts.push(addInst(scene, new THREE.BoxGeometry(0.7, 0.6, 0.7), std(P.stoneDark), b.shrineBody));
  b.insts.push(addInst(scene, new THREE.ConeGeometry(0.62, 0.5, 4), std(P.stone), b.shrineTop));
  b.insts.push(addInst(scene, new THREE.OctahedronGeometry(0.1, 0), new THREE.MeshBasicMaterial({ color: P.gold }), b.shrineTip));
  const breathers = b.breathers;

  return {
    update(move: number, t: number) {
      // 瀑布流：offset.y 正向滚 = 纹样向下走（采样 uv+offset，offset 增 ⇒ 花纹下移），随世界速度
      fallTex.offset.y = (fallTex.offset.y + move * 0.05) % 1;
      for (const br of breathers) br.p.y = br.baseY + Math.sin(t * 0.785 + br.ph) * br.amp;
      for (const inst of b.insts) {
        for (const p of inst.items) {
          p.z += move;
          if (p.z > WRAP_Z) p.z -= LOOP;
        }
        writeAll(inst);
      }
      // 雾团：每帧 compose，±8% scale 呼吸、相位互错；回收与静态件同一循环规则
      for (let i = 0; i < mists.length; i++) {
        const mp = mists[i];
        mp.z += move;
        if (mp.z > WRAP_Z) mp.z -= LOOP;
        const sc = mp.s * (1 + Math.sin(t * 0.9 + rnd(i, 7) * 6.283) * 0.08);
        composeMist(mistInst.mesh, i, mp.x, mp.y, mp.z, mp.ry, sc);
      }
      mistInst.mesh.instanceMatrix.needsUpdate = true;
    },
  };
}
