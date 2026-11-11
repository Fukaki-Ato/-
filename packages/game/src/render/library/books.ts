/**
 * 失重图书馆 · 书册层（docs/scenes/library-brief.md §3.3 / §9）：
 *   单册配方：盒体宽 0.12~0.24 × 高 0.28~0.42 × 深 0.16~0.28 独立随机（禁等比缩放同款书）；
 *   书脊三 batch（§9：受光 Lambert ×2 + 标签 Basic ×1）——书页块（陈纸米 Lambert）/ 书脊片
 *   （instanceColor 五色：陈纸米/纸灰褐/皮革棕/蜡封红 8%/墨青）/ 脊上标签条（30%，蜡封红或烛光琥珀 Basic）；
 *   书页侧三面强制陈纸米、脊色 ≠ 页色，侧看才读得出「这是一本书」。
 *   铺装：塔身藏书（逐层书脊排 + 40% 层顶平放堆，缺书层整层抽走露出墨渊内腔）+ 书海散书
 *   （墨面漂书 70 册）+ 塔脚倒伏书堆（30% 塔，4~8 册错缝叠）。
 *   塔位原型与 towers.ts 逐字同式本地复算（两文件互不 import 的铁律下保证书塔对位）。
 * 全部 InstancedMesh（3 draw call）+ 确定性 rnd（../sceneryProps.js）+ 每帧零分配 + LOOP/WRAP_Z 回收。
 */
import * as THREE from 'three';
import { LOOP, WRAP_Z, rnd, std } from '../sceneryProps.js';
import { P } from './palette.js';

/** 非均匀缩放摆位（书是长方体，禁止等比缩放；欧拉序 YXZ 与 sceneryProps.writeAll 一致） */
interface NPlace { x: number; y: number; z: number; ry: number; sx: number; sy: number; sz: number; rx?: number; rz?: number }

// 每帧零分配：复用一套 Matrix4/Quaternion/Euler/Vector3/Color 暂存（均原地改写）
const M4 = new THREE.Matrix4();
const QT = new THREE.Quaternion();
const EU = new THREE.Euler(0, 0, 0, 'YXZ');
const VV = new THREE.Vector3();
const SS = new THREE.Vector3();
const C = new THREE.Color();

/** 非均匀版 writeAll：实例矩阵原地改写，零分配 */
function writeNU(mesh: THREE.InstancedMesh, items: NPlace[]) {
  for (let i = 0; i < items.length; i++) {
    const p = items[i];
    EU.set(p.rx ?? 0, p.ry, p.rz ?? 0); QT.setFromEuler(EU);
    VV.set(p.x, p.y, p.z); SS.set(p.sx, p.sy, p.sz);
    M4.compose(VV, QT, SS);
    mesh.setMatrixAt(i, M4);
  }
  mesh.instanceMatrix.needsUpdate = true;
}
function addNU(scene: THREE.Scene, geo: THREE.BufferGeometry, mat: THREE.Material, items: NPlace[]) {
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, items.length));
  scene.add(mesh);
  writeNU(mesh, items);
  return mesh;
}
/** 绕 y 轴旋转向量（歪斜层：整层书脊排绕塔心转 skew，与 towers.ts 层板同式） */
function rotY(dx: number, dz: number, c: number, s: number): [number, number] {
  return [dx * c + dz * s, -dx * s + dz * c];
}

/* ── 塔位原型（books/towers 双文件逐字同式本地复算，两文件互不 import 的铁律下保证书塔对位）──
 * 46 座 = mid 排 31（S/M 混编）+ far 排 15（全 L）；四态按 brief §3.2：完整 40% / 缺书层 25% / 歪斜层 20% / 断顶塌 15%。 */
interface TowerSpec {
  x: number; z: number; side: number;        // 塔心 x/z 与朝路侧符号（书脊一律朝跑道）
  tier: 0 | 1 | 2;                           // 0=S（6~10m，1~2 层）1=M（12~20m，3~5 层）2=L（24~40m，6~8 层）
  stories: number; pitch: number;            // 层数 / 层距
  w0: number; d0: number; bh: number;        // 底层面宽（跨跑道向）/ 进深（沿跑道向）/ 基座高 0.6~1.2
  state: number; dmg: number; skew: number;  // 四态 / 损伤层号 / 歪斜层弧度（±4~7°）
  flat: boolean; lant: number;               // 平顶真（否则双坡顶）/ 顶部灯笼数（L 2~4，S/M 0~2）
}
const TIER = [
  { w: 2.6, dw: 0.8, d: 2.2, dd: 0.6, p: 2.8, dp: 0.4, s: 1, ds: 1, x: 9.0, dx: 4.0 }, // S
  { w: 3.6, dw: 1.0, d: 2.8, dd: 0.8, p: 3.0, dp: 0.3, s: 3, ds: 2, x: 9.0, dx: 4.0 }, // M
  { w: 5.0, dw: 2.0, d: 3.6, dd: 1.0, p: 3.6, dp: 0.5, s: 6, ds: 2, x: 18.0, dx: 10 }, // L
] as const;

function buildTowerSpecs(): TowerSpec[] {
  const slots: { z: number; side: -1 | 1; tier: 0 | 1 | 2 }[] = [];
  for (const side of [-1, 1] as const) {
    for (let z = -LOOP + (side < 0 ? 4 : 12); z < WRAP_Z; z += 16) {
      slots.push({ z, side, tier: rnd(slots.length, 11) < 0.4 ? 0 : 1 }); // mid 排每 16m
    }
    for (let z = -LOOP + (side < 0 ? 9 : 26); z < WRAP_Z; z += 34) {
      slots.push({ z, side, tier: 2 });                                   // far 排每 34m
    }
  }
  return slots.map((sl, i) => {
    const T = TIER[sl.tier];
    const stories = T.s + Math.floor(rnd(i, 31) * (T.ds + 1));
    const st = rnd(i, 37);
    return {
      x: sl.side * (T.x + rnd(i, 61) * T.dx),
      z: sl.z + (rnd(i, 67) - 0.5) * 3,
      side: sl.side, tier: sl.tier,
      w0: T.w + rnd(i, 21) * T.dw,
      d0: T.d + rnd(i, 23) * T.dd,
      bh: 0.6 + rnd(i, 73) * 0.6,
      pitch: T.p + rnd(i, 29) * T.dp,
      stories,
      state: st < 0.4 ? 0 : st < 0.65 ? 1 : st < 0.85 ? 2 : 3,
      dmg: Math.floor(rnd(i, 41) * stories),
      skew: (rnd(i, 43) < 0.5 ? -1 : 1) * (0.07 + rnd(i, 47) * 0.05),
      flat: rnd(i, 53) < 0.4,
      lant: sl.tier === 2 ? 2 + Math.floor(rnd(i, 59) * 3) : Math.floor(rnd(i, 59) * 3),
    };
  });
}

/** 装帧色五色（§3.3）：蜡封红 8% 做视觉节奏点 */
const spinePick = (cp: number) => cp < 0.08 ? P.wax : cp < 0.38 ? P.cream : cp < 0.62 ? P.tan : cp < 0.84 ? P.leather : P.teal;

/** 塔身藏书：逐层书脊排（立放为主 8% 斜倚、15% 空槽）+ 40% 层顶平放堆；缺书层整层抽走 */
function fillTower(i: number, s: TowerSpec, pages: NPlace[], spines: NPlace[], labels: NPlace[], spineCols: number[], labelCols: number[]) {
  let wk = s.w0, dk = s.d0, bi = 0; // bi=书册序号（rnd 种子基数）
  for (let k = 0; k < s.stories; k++) {
    const boardTop = s.bh + k * s.pitch + 0.12;
    const skew = s.state === 2 && s.dmg === k ? s.skew : 0;       // 歪斜层：整层绕塔心转 ±4~7°
    const c = Math.cos(skew), sn = Math.sin(skew);
    if (s.state !== 1 || s.dmg !== k) {                           // 缺书层：整层书脊被抽走（露出墨渊内腔）
      const rowLen = dk - 1.0, zEnd = s.z + rowLen / 2;
      for (let zc = s.z - rowLen / 2; zc < zEnd; bi++) {
        const t = 0.13 + rnd(bi, 3) * 0.12;                       // 厚（沿跑道）
        const h = 0.28 + rnd(bi, 5) * 0.14;                       // 高
        const d = 0.16 + rnd(bi, 7) * 0.12;                       // 深（跨跑道）
        const lean = rnd(bi, 13) < 0.08 ? (rnd(bi, 15) < 0.5 ? -1 : 1) * 0.21 : 0; // 8% 斜倚 ±12°
        const [dx, dz] = rotY(-s.side * (wk / 2 - 0.28), zc + t / 2 - s.z, c, sn);
        const bx = s.x + dx, bz = s.z + dz, by = boardTop + h / 2;
        pages.push({ x: bx, y: by, z: bz, ry: skew, rx: lean, sx: d, sy: h, sz: t }); // 书页块（三面陈纸米）
        const so = rotY(-s.side * (d / 2 + 0.01), 0, c, sn);      // 书脊片贴朝路一面（脊色 ≠ 页色）
        spines.push({ x: bx + so[0], y: by, z: bz + so[1], ry: skew, rx: lean, sx: 0.02, sy: h * 0.94, sz: t * 0.92 });
        spineCols.push(spinePick(rnd(bi, 9)));
        if (rnd(bi, 23) < 0.3) {                                  // 30% 脊上短标签条（蜡封红/烛光琥珀）
          const lo = rotY(-s.side * (d / 2 + 0.022), 0, c, sn);
          labels.push({ x: bx + lo[0], y: by - h * 0.24, z: bz + lo[1], ry: skew, rx: lean, sx: 0.012, sy: h * 0.2, sz: t * 0.5 });
          labelCols.push(rnd(bi, 25) < 0.65 ? P.wax : P.amber);
        }
        zc += t + (rnd(bi, 17) < 0.15 ? 0.2 + rnd(bi, 19) * 0.2 : 0.02); // 空槽 0.2~0.4m＝被取走的书
      }
      if (rnd(i, 91 + k) < 0.4) {                                 // 40% 层顶平放堆（错缝 2~3 册，整册读脊色）
        const n = 2 + Math.floor(rnd(i, 93 + k) * 2);
        for (let j = 0; j < n; j++, bi++) {
          spines.push({
            x: s.x - s.side * (wk / 2 - 0.3) + (rnd(bi, 33) - 0.5) * 0.2,
            y: boardTop + 0.46 + j * 0.135,
            z: s.z + (rnd(bi, 35) - 0.5) * Math.max(0.4, dk - 1.4),
            ry: (rnd(bi, 37) - 0.5) * 0.5,
            sx: 0.18 + rnd(bi, 39) * 0.06, sy: 0.11 + rnd(bi, 41) * 0.04, sz: 0.26 + rnd(bi, 43) * 0.1,
          });
          spineCols.push(spinePick(rnd(bi, 45)));
        }
      }
    }
    const f = 0.82 + rnd(i, 71 + k) * 0.10;                       // 收分：上层整体缩放 0.82~0.92（与 towers 同式）
    wk *= f; dk *= f;
  }
}

export function createBooks(scene: THREE.Scene) {
  const specs = buildTowerSpecs();
  const pages: NPlace[] = [], spines: NPlace[] = [], labels: NPlace[] = [];
  const spineCols: number[] = [], labelCols: number[] = [];
  for (let i = 0; i < specs.length; i++) fillTower(i, specs[i], pages, spines, labels, spineCols, labelCols);

  // 塔脚倒伏书堆（§4.9：30% 塔，4~8 册错缝叠，塌落证据链）
  for (let i = 0; i < specs.length; i++) {
    const s = specs[i];
    if (rnd(i, 101) >= 0.3) continue;
    const px = s.x - s.side * (s.w0 / 2 + 0.5), pz = s.z + (rnd(i, 105) - 0.5) * 1.6;
    const n = 4 + Math.floor(rnd(i, 103) * 5);
    for (let j = 0; j < n; j++) {
      spines.push({
        x: px + (rnd(i, 107 + j) - 0.5) * 0.16, y: 0.08 + j * 0.13, z: pz + (rnd(i, 113 + j) - 0.5) * 0.2,
        ry: (rnd(i, 119 + j) - 0.5) * 0.6, rz: (rnd(i, 127 + j) - 0.5) * 0.1,
        sx: 0.18 + rnd(i, 131 + j) * 0.06, sy: 0.11 + rnd(i, 137 + j) * 0.04, sz: 0.26 + rnd(i, 139 + j) * 0.1,
      });
      spineCols.push(spinePick(rnd(i, 149 + j)));
    }
  }
  // 书海散书（70 册漂在墨面：平躺微倾，随世界回收）
  for (let i = 0; i < 70; i++) {
    spines.push({
      x: (i % 2 === 0 ? -1 : 1) * (5.2 + rnd(i, 201) * 10.5), y: 0.04, z: -LOOP + rnd(i, 203) * (LOOP + WRAP_Z),
      ry: rnd(i, 205) * 6.283, rx: (rnd(i, 207) - 0.5) * 0.3,
      sx: 0.16 + rnd(i, 209) * 0.08, sy: 0.1 + rnd(i, 211) * 0.05, sz: 0.26 + rnd(i, 213) * 0.1,
    });
    spineCols.push(spinePick(rnd(i, 215)));
  }

  // ---- 实例化（三 batch：书页 Lambert / 书脊 Lambert+instanceColor / 标签 Basic+instanceColor）----
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const pageMat = std(P.cream);
  const spineMat = std(0xffffff); // 基色白 × instanceColor 五色
  const labelMat = new THREE.MeshBasicMaterial({ color: 0xffffff }); // 烛光琥珀为唯一发光色的 Basic 用法
  const pageMesh = addNU(scene, boxGeo, pageMat, pages);
  const spineMesh = addNU(scene, boxGeo, spineMat, spines);
  const labelMesh = addNU(scene, boxGeo, labelMat, labels);
  for (let i = 0; i < spineCols.length; i++) spineMesh.setColorAt(i, C.setHex(spineCols[i]));
  if (spineMesh.instanceColor) spineMesh.instanceColor.needsUpdate = true;
  for (let i = 0; i < labelCols.length; i++) labelMesh.setColorAt(i, C.setHex(labelCols[i]));
  if (labelMesh.instanceColor) labelMesh.instanceColor.needsUpdate = true;

  const batches = [
    { mesh: pageMesh, items: pages },
    { mesh: spineMesh, items: spines },
    { mesh: labelMesh, items: labels },
  ];
  return {
    update(move: number) {
      if (move === 0) return;
      for (const b of batches) {
        for (const p of b.items) {
          p.z += move;
          if (p.z > WRAP_Z) p.z -= LOOP;
        }
        writeNU(b.mesh, b.items);
      }
    },
    dispose() { boxGeo.dispose(); pageMat.dispose(); spineMat.dispose(); labelMat.dispose(); },
  };
}
