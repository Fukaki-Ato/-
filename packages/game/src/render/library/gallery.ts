/**
 * 失重图书馆 · 近景长廊（docs/scenes/library-brief.md §3.4 near / §4.6 / §4.8 / §4.9）：
 *   readingRow 阅览长桌排：桌面 3.6×1.2×0.08m、高 0.75m 四腿，沿 |x|=5.2 吃 rhythmZ 疏密
 *   （48 张 ≥24 地板）；四态：完好 55% / 桌面倾斜 8° 20% / 缺一腿 15% / 整桌倒扣 10%；
 *   桌面一盏铜灯（烛光琥珀 HDR 灯头）+ 1~2 本摊开的书（两块斜面页）。
 *   lamps 灯柱信标 ×16：高 3.6m 铜杆 + 琥珀灯头（Basic ×1.3 过 bloom 阈值 0.82）+ 正下方光池，
 *   rhythmZ(15) 相位错开 ⇒ 240m 每 ~15m 一根（240÷16 校正口径）。
 *   scatter 散书：路缘带 |x| 4.8~5.8 每 1.5m 每侧 30% 命中，三态 平躺/斜倚/开面朝上（≈96 册地板）。
 *   parapet 书脊矮栏：|x|=4.62 每 0.36m 一册立脊（12% 缺损 + 歪斜，同 bridge.ts 栏石做法）。
 *   pool 光池：64² 径向渐变 DataTexture + additive，opacity 0.15（抄 bridge.ts 配方）。
 * rhythmZ 密疏排布：240m 切 8 段（每段 30m），下标偶段密集（间距 ×0.7）偶段开阔（×1.45），
 *   各元素类错开 phase——口径本地抄 stormspire/bridge.ts（不 import stormspire）。
 * 全部 InstancedMesh（7 draw call）+ 确定性 rnd + 每帧零分配 + LOOP/WRAP_Z 回收；不读 sim。
 */
import * as THREE from 'three';
import { LOOP, WRAP_Z, addInst, rnd, std, writeAll, type Inst, type Placement } from '../sceneryProps.js';
import { P } from './palette.js';

/** 沿 z 疏密节奏取点（本地抄 bridge.ts 口径）：240m 循环切 8 段（每段 30m），下标偶段密集 ×0.7、
 *  开阔段 ×1.45，段内按 round(30/步距) 等分铺点；结果覆盖一整圈 [-LOOP, WRAP_Z) */
function rhythmZ(every: number, phase: number, out: number[]): void {
  for (let seg = 0; seg < 8; seg++) {
    const n = Math.max(1, Math.round(30 / (every * (seg % 2 === 0 ? 0.7 : 1.45))));
    const step = 30 / n;
    for (let k = 0; k < n; k++) {
      let z = -LOOP + seg * 30 + phase + k * step;
      while (z >= WRAP_Z) z -= LOOP;
      while (z < -LOOP) z += LOOP;
      out.push(z);
    }
  }
}

/** 光池贴图：64² 径向渐变，中心亮边缘透明；RGB 恒白乘材质色，明暗走 alpha（同 bridge.ts 分离法） */
function makePoolTexture(): THREE.DataTexture {
  const N = 64;
  const data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const dx = (x + 0.5) / N - 0.5, dy = (y + 0.5) / N - 0.5;
    const a = Math.pow(1 - Math.min(1, Math.sqrt(dx * dx + dy * dy) * 2), 1.8);
    const i = (y * N + x) * 4;
    data[i] = 255; data[i + 1] = 255; data[i + 2] = 255; data[i + 3] = 255 * a;
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/** 装帧色五色（§3.3 权重：蜡封红做节奏点） */
const bookColor = (r: number) => r < 0.3 ? P.cream : r < 0.55 ? P.tan : r < 0.78 ? P.leather : r < 0.86 ? P.wax : P.teal;

export function createGallery(scene: THREE.Scene) {
  const insts: Inst[] = [];
  const tops: Placement[] = [], rods: Placement[] = [], poles: Placement[] = [], heads: Placement[] = [];
  const ramps: Placement[] = [], books: Placement[] = [], pools: Placement[] = [];
  const bookCols: number[] = [];

  // ---- 阅览长桌排（rhythmZ(11) ⇒ 48 张，两侧交替；四态损毁混编）----
  const tableZs: number[] = [];
  rhythmZ(11, 0, tableZs);
  for (let i = 0; i < tableZs.length; i++) {
    const side: -1 | 1 = i % 2 === 0 ? -1 : 1;
    const tx = side * (5.2 + (rnd(i, 601) - 0.5) * 0.6), tz = tableZs[i] + (rnd(i, 603) - 0.5) * 2.4;
    const st = rnd(i, 605);
    const state = st < 0.55 ? 0 : st < 0.75 ? 1 : st < 0.9 ? 2 : 3; // 完好/倾斜/缺一腿/倒扣
    const tilt = state === 1 ? (rnd(i, 607) < 0.5 ? -1 : 1) * 0.14 : 0;
    tops.push({ x: tx, y: state === 3 ? 0.05 : 0.71, z: tz, s: 1, ry: 0, rz: state === 3 ? Math.PI : tilt });
    for (let j = 0; j < 4; j++) {
      if (state === 2 && j === Math.floor(rnd(i, 609) * 4)) continue; // 缺一腿
      rods.push({ x: tx + (j % 2 === 0 ? -0.42 : 0.42), y: state === 3 ? 0.455 : 0.375, z: tz + (j < 2 ? -1.5 : 1.5), s: 1, ry: 0 });
    }
    if (state !== 3) {
      rods.push({ x: tx, y: 0.75 + 0.23, z: tz, s: 0.62, ry: 0 });                   // 铜灯杆（短杆同 rod 几何）
      heads.push({ x: tx, y: 0.75 + 0.5, z: tz, s: 0.09, ry: 0 });                   // 琥珀灯头（HDR）
      pools.push({ x: tx, y: 0.03, z: tz, s: 1, ry: 0 });                            // 灯下路面光池
      const nBook = 1 + Math.floor(rnd(i, 611) * 2);                                 // 桌上 1~2 本摊开的书
      for (let j = 0; j < nBook; j++) {
        const by = 0.81, bz = tz + (rnd(i, 613 + j) - 0.5) * 1.6;
        ramps.push({ x: tx - 0.19, y: by, z: bz, s: 1, ry: 0, rz: 0.42 });           // 左斜面页
        ramps.push({ x: tx + 0.19, y: by, z: bz, s: 1, ry: 0, rz: -0.42 });          // 右斜面页
      }
    }
  }

  // ---- 灯柱信标 ×16（rhythmZ(15) 相位与长桌错开；杆/灯头/光池三件套）----
  const lampZs: number[] = [];
  rhythmZ(15, 7.5, lampZs);
  for (let i = 0; i < lampZs.length; i++) {
    const side: -1 | 1 = i % 2 === 0 ? -1 : 1;
    const x = side * 5.6, z = lampZs[i] + (rnd(i, 621) - 0.5) * 2;
    poles.push({ x, y: 1.8, z, s: 1, ry: 0 });
    heads.push({ x, y: 3.75, z, s: 0.17, ry: 0 });
    pools.push({ x, y: 0.03, z, s: 1.4, ry: 0 });
  }

  // ---- 散书（路缘带每 1.5m 每侧 30% 命中，三态：平躺/斜倚/开面朝上）----
  let si = 0;
  for (const side of [-1, 1] as const) {
    for (let z = -LOOP + 0.75; z < WRAP_Z; z += 1.5, si++) {
      if (rnd(si, 401) >= 0.3) continue;
      const x = side * (4.8 + rnd(si, 405) * 1.0);
      const st = rnd(si, 407);
      if (st < 0.4) {                                                               // 平躺
        books.push({ x, y: 0.09, z: z + (rnd(si, 409) - 0.5) * 0.8, s: 0.9, ry: rnd(si, 411) * 6.283, rx: Math.PI / 2 });
        bookCols.push(bookColor(rnd(si, 413)));
      } else if (st < 0.75) {                                                       // 斜倚
        books.push({ x, y: 0.2, z: z + (rnd(si, 409) - 0.5) * 0.8, s: 0.9, ry: rnd(si, 415) * 6.283, rz: (rnd(si, 417) < 0.5 ? -1 : 1) * 0.4 });
        bookCols.push(bookColor(rnd(si, 419)));
      } else {                                                                      // 开面朝上（两页三角板，铰缝随 ry 同转）
        const bz = z + (rnd(si, 409) - 0.5) * 0.8, bry = rnd(si, 421) * 6.283;
        const c = Math.cos(bry), sn = Math.sin(bry);
        ramps.push({ x: x - 0.16 * c, y: 0.06, z: bz + 0.16 * sn, s: 0.8, ry: bry, rz: 0.42 });
        ramps.push({ x: x + 0.16 * c, y: 0.06, z: bz - 0.16 * sn, s: 0.8, ry: bry, rz: -0.42 });
      }
    }
  }

  // ---- 书脊矮栏（|x|=4.62 每 0.36m 一册立脊，12% 缺损 + 10% 歪斜）----
  let pi = 0;
  for (const side of [-1, 1] as const) {
    for (let z = -LOOP; z < WRAP_Z; z += 0.36, pi++) {
      if (rnd(pi, 501) < 0.12) continue;                                            // 缺口：被抽走的书
      books.push({ x: side * 4.62, y: 0.22, z: z + (rnd(pi, 503) - 0.5) * 0.1, s: 1.1, ry: 0, rz: rnd(pi, 505) < 0.1 ? (rnd(pi, 507) < 0.5 ? -1 : 1) * 0.06 : 0 });
      bookCols.push(bookColor(rnd(pi, 509)));
    }
  }

  // ---- 实例化（7 draw call）----
  insts.push(addInst(scene, new THREE.BoxGeometry(1.2, 0.08, 3.6), std(P.leather), tops));
  insts.push(addInst(scene, new THREE.CylinderGeometry(0.05, 0.065, 0.75, 6), std(P.leather), rods));
  insts.push(addInst(scene, new THREE.CylinderGeometry(0.06, 0.09, 3.6, 6), std(P.leather), poles));
  const headMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(P.amber).multiplyScalar(1.3) }); // HDR 过 bloom 阈值
  insts.push(addInst(scene, new THREE.OctahedronGeometry(1, 0), headMat, heads));
  insts.push(addInst(scene, new THREE.BoxGeometry(0.44, 0.02, 0.32), std(P.cream), ramps));
  const bookMat = std(0xffffff); // 基色白 × instanceColor 五色（散书 + 书栏共用）
  const bookInst = addInst(scene, new THREE.BoxGeometry(0.22, 0.4, 0.17), bookMat, books);
  insts.push(bookInst);
  const C = new THREE.Color();
  for (let i = 0; i < bookCols.length; i++) bookInst.mesh.setColorAt(i, C.setHex(bookCols[i]));
  if (bookInst.mesh.instanceColor) bookInst.mesh.instanceColor.needsUpdate = true;
  const poolGeo = new THREE.PlaneGeometry(3.2, 3.2);
  poolGeo.rotateX(-Math.PI / 2);
  const poolTex = makePoolTexture();
  const poolMat = new THREE.MeshBasicMaterial({ color: P.amber, map: poolTex, transparent: true, opacity: 0.15, blending: THREE.AdditiveBlending, depthWrite: false });
  insts.push(addInst(scene, poolGeo, poolMat, pools));

  // dispose 清单：光池与琥珀灯头资源（几何/材质/贴图），随主题卸载
  const disposables: { dispose(): void }[] = [poolGeo, poolMat, poolTex, headMat, bookInst.mesh.geometry, bookMat];

  return {
    update(move: number) {
      if (move === 0) return;
      for (const inst of insts) {
        for (const p of inst.items) {
          p.z += move;
          if (p.z > WRAP_Z) p.z -= LOOP;
        }
        writeAll(inst);
      }
    },
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}
