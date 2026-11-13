/**
 * 失重图书馆 · 书塔层（docs/scenes/library-brief.md §3.2 / §4.2 / §4.3）：
 *   三档书塔 S/M/L ×四态混编（完好 40% / 缺书层 25% / 歪斜层 20% / 断顶塌 15%），46 座实例化：
 *   塔基（石木混合 0.6~1.2m，出挑 0.3）+ 层板（0.12 皮革棕）+ 挑檐（0.08 出挑 0.3 纸灰褐）+
 *   墨渊内腔薄板（缺书层露出）+ 收分（上层 0.82~0.92）+ 双坡顶（跨×0.3 高）或平顶+木质塔尖 + 灯笼。
 *   摊开书岛 ×12（巨型对开本 8~20m，页缘波状位移几何级一次成型，中央书沟，三态：
 *   完好 50% / 半合拢 20% / 页角残缺 30%；下方倒挂书山钟乳 3~6 枚 + 黄铜锚链垂到墨海）。
 *   倒挂书山（塔顶倒悬锥）：完好的 M/L 塔顶 35% 概率悬浮倒锥书山。
 *   书脊本体由 books.ts 铺装；塔位原型两文件逐字同式本地复算（互不 import 保证书塔对位）。
 * 全部 InstancedMesh（9 draw call）+ 确定性 rnd + 每帧零分配 + LOOP/WRAP_Z 回收；不读 sim。
 * 另附反重力天花板跑道（240×8m 静态实例组不回收，见 addCeilingRunway）。
 */
import * as THREE from 'three';
import { LOOP, WRAP_Z, rnd, std } from '../sceneryProps.js';
import { P } from './palette.js';

/** 非均匀缩放摆位（塔件全是长方体/棱柱，欧拉序 YXZ 与 sceneryProps.writeAll 一致） */
interface NPlace { x: number; y: number; z: number; ry: number; sx: number; sy: number; sz: number; rx?: number; rz?: number }

// 每帧零分配：复用一套 Matrix4/Quaternion/Euler/Vector3 暂存（均原地改写）
const M4 = new THREE.Matrix4();
const QT = new THREE.Quaternion();
const EU = new THREE.Euler(0, 0, 0, 'YXZ');
const VV = new THREE.Vector3();
const SS = new THREE.Vector3();

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

/** 摊开书页原型（几何级一次成型：页缘上翘 + 波状位移；原点在书沟中线，页体 x∈[0.35,4.9]，右页直接用、左页 ry=π） */
function makeFolioPage(): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(4.55, 0.16, 6.2, 4, 1, 10);
  g.translate(2.625, 0, 0);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const curl = 0.45 * Math.pow(Math.max(0, (x - 0.35) / 4.55), 2);                    // 页缘上翘
    const wave = Math.sin(z * 1.7 + x * 0.8) * 0.04 + Math.sin(x * 2.3 + z * 1.1) * 0.03; // 页缘波状位移
    pos.setY(i, pos.getY(i) + curl + wave);
  }
  g.computeVertexNormals();
  return g;
}

/* ── 反重力天花板跑道（用户实跑反馈：翻转后脚下没有清晰天花板跑道，读作「画面坏了」）──
 * 周期对齐推导：antigrav fromM 600 / everyM 500，LOOP=240 ⇒ 区起点相位每圈漂移 500−2×240=20m
 * （对齐周期 lcm(500,240)=6000m=25 圈），离散段无法保证每次进区都踩在跑道上 ⇒ 选最省方案：
 * 整条 LOOP 铺满（240×8m 陈纸米加色长条 + 烛光琥珀双边线，y=ceilingH 4.6 本地对表）。
 * 加色+depthWrite false：翻转后从下方读得出纸面跑道，飞行俯视（flight heightM 同为 4.6）也不挡路；
 * 走 addNU 实例化（1+2 例两组）而非散 mesh＝不破「散 mesh 仅 8 件长平面例外」红线；
 * 静态不回收、不进 groups/update（每帧零开销）；towers 不知道 zones/sim（渲染只读红线），
 * 跑道常驻兼作天花板视觉锚点与翻转预告。 */
function addCeilingRunway(scene: THREE.Scene) {
  const Y = 4.6, LEN = 240, Z = -102; // y=obstacles.json antigrav.ceilingH（B-8 地板值）；z 覆盖 +18~-222 整条 LOOP
  const geo = new THREE.PlaneGeometry(1, 1);
  geo.rotateX(-Math.PI / 2); // 几何级转平：实例只写位置+缩放（sx=宽/sz=长），与塔件同式
  const mainMat = new THREE.MeshBasicMaterial({ color: P.cream, transparent: true, opacity: 0.34, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const edgeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(P.amber).multiplyScalar(1.3), transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }); // 琥珀×1.3 过 bloom 阈值（灯笼口径）
  addNU(scene, geo, mainMat, [{ x: 0, y: Y, z: Z, ry: 0, sx: 8, sy: 1, sz: LEN }]); // 陈纸米发光长条（宽 8m 盖三车道）
  addNU(scene, geo, edgeMat, [ // 烛光琥珀双边线（±3.8，微降 0.02 防共面闪争）
    { x: -3.8, y: Y - 0.02, z: Z, ry: 0, sx: 0.4, sy: 1, sz: LEN },
    { x: 3.8, y: Y - 0.02, z: Z, ry: 0, sx: 0.4, sy: 1, sz: LEN },
  ]);
  return { geo, mats: [mainMat, edgeMat] };
}

export function createTowers(scene: THREE.Scene) {
  const specs = buildTowerSpecs();
  const bases: NPlace[] = [], boards: NPlace[] = [], eaves: NPlace[] = [], backs: NPlace[] = [];
  const gables: NPlace[] = [], flats: NPlace[] = [], fins: NPlace[] = [], lanterns: NPlace[] = [], mounts: NPlace[] = [];
  const covers: NPlace[] = [], guts: NPlace[] = [], folios: NPlace[] = [], stals: NPlace[] = [], links: NPlace[] = [];

  // ---- 塔身四态拼装（层板/挑檐/内腔/屋顶，全部随塔回收）----
  for (let i = 0; i < specs.length; i++) {
    const s = specs[i];
    bases.push({ x: s.x, y: s.bh / 2, z: s.z, ry: 0, sx: s.w0 + 0.6, sy: s.bh, sz: s.d0 + 0.6 }); // 基座出挑 0.3
    let wk = s.w0, dk = s.d0, roofW = s.w0, roofD = s.d0;
    for (let k = 0; k < s.stories; k++) {
      const skew = s.state === 2 && s.dmg === k ? s.skew : 0;       // 歪斜层：整层绕塔心 ±4~7°
      const c = Math.cos(skew), sn = Math.sin(skew);
      boards.push({ x: s.x, y: s.bh + k * s.pitch + 0.06, z: s.z, ry: skew, sx: wk, sy: 0.12, sz: dk }); // 层板
      const ox = s.side * (wk / 2 - 0.06);                          // 内腔薄板在背路一面（缺书层露墨渊）
      backs.push({ x: s.x + ox * c, y: s.bh + k * s.pitch + s.pitch / 2, z: s.z - ox * sn, ry: skew, sx: 0.12, sy: s.pitch - 0.2, sz: dk - 0.2 });
      eaves.push({ x: s.x, y: s.bh + k * s.pitch + 0.9, z: s.z, ry: skew, sx: wk + 0.6, sy: 0.08, sz: dk + 0.6 }); // 挑檐
      roofW = wk; roofD = dk;
      const f = 0.82 + rnd(i, 71 + k) * 0.10;                       // 收分：上层整体缩放 0.82~0.92（与 books 同式）
      wk *= f; dk *= f;
    }
    const topY = s.bh + s.stories * s.pitch;
    const broken = s.state === 3;                                   // 断顶塌：顶斜落 15~25° 挂在檐上
    const tilt = broken ? (rnd(i, 141) < 0.5 ? -1 : 1) * (0.26 + rnd(i, 143) * 0.18) : 0;
    if (s.flat) {
      flats.push({ x: s.x, y: topY + 0.09, z: s.z, ry: 0, rz: tilt, sx: roofW + 0.4, sy: 0.18, sz: roofD + 0.5 });
      fins.push({ x: s.x, y: topY + 0.18 + 0.75, z: s.z, ry: rnd(i, 145) * 6.283, sx: 1, sy: 1, sz: 1 });
    } else {
      // 双坡顶（脊沿 z，坡面朝跑道）：棱柱底 y=0、apex 1.5；顶高 = 跨×0.3
      gables.push({ x: s.x, y: broken ? topY - 0.55 : topY, z: s.z, ry: 0, rz: tilt, sx: (roofW + 0.4) / 1.732, sy: 0.2 * roofW, sz: roofD + 0.5 });
    }
    const roofTop = topY + (s.flat ? 0.18 : 0.3 * roofW);
    for (let j = 0; j < s.lant; j++) {
      lanterns.push({ x: s.x, y: roofTop + 0.24, z: s.z + (j - (s.lant - 1) / 2) * 1.1, ry: 0, sx: 1, sy: 1, sz: 1 });
    }
    if (s.state === 0 && s.tier >= 1 && rnd(i, 83) < 0.35) {        // 倒挂书山：完好 M/L 塔顶倒悬锥
      const cs = 1.1 + rnd(i, 85) * 1.1;
      mounts.push({ x: s.x, y: roofTop + 0.6 + cs, z: s.z, ry: rnd(i, 87) * 6.283, rx: Math.PI, sx: cs, sy: cs, sz: cs });
    }
  }

  // ---- 摊开书岛 ×12（墨海远带 |x| 32~44 浮空，避开书塔带）----
  for (let k = 0; k < 12; k++) {
    const side: -1 | 1 = k % 2 === 0 ? -1 : 1;
    const ix = side * (32 + rnd(k, 301) * 12), iy = 0.8 + rnd(k, 303) * 2.2;
    const iz = -LOOP + 10 + k * 20 + rnd(k, 305) * 6, s = 0.8 + rnd(k, 307) * 1.2; // 跨 8~20m
    const st = rnd(k, 309);                                         // 完好 50% / 半合拢 20% / 页角残缺 30%
    const fold = st < 0.5 ? 0 : st < 0.7 ? 0.52 : -0.15;            // 半合拢右半页上折 30°；残缺＝垂角枯萎
    covers.push({ x: ix, y: iy, z: iz, ry: 0, sx: 10.4 * s, sy: 0.35 * s, sz: 6.8 * s }); // 皮面封底
    guts.push({ x: ix, y: iy - 0.05 * s, z: iz, ry: 0, sx: 0.9 * s, sy: 0.5 * s, sz: 6.6 * s }); // 中央书沟
    folios.push({ x: ix, y: iy + 0.62 * s, z: iz, ry: 0, rz: fold, sx: s, sy: s, sz: s });      // 右页
    folios.push({ x: ix, y: iy + 0.62 * s, z: iz, ry: Math.PI, rz: fold, sx: s, sy: s, sz: s }); // 左页（镜像）
    const nc = 3 + Math.floor(rnd(k, 311) * 4);                     // 倒挂书山钟乳 3~6 枚（锥尖朝下）
    for (let j = 0; j < nc; j++) {
      const cs = (0.5 + rnd(k, 313 + j) * 0.5) * s;
      stals.push({ x: ix + (rnd(k, 317 + j) - 0.5) * 7 * s, y: iy - 0.05 - cs, z: iz + (rnd(k, 319 + j) - 0.5) * 4.5 * s, ry: rnd(k, 321 + j) * 6.283, rx: Math.PI, sx: cs, sy: cs, sz: cs });
    }
    const nch = 1 + Math.floor(rnd(k, 323) * 2);                    // 黄铜锚链 1~2 条垂到墨海
    for (let j = 0; j < nch; j++) {
      const nLink = Math.max(1, Math.round((iy - 0.5) / 0.48));
      for (let q = 0; q < nLink; q++) {
        links.push({ x: ix, y: iy - 0.3 * s - q * 0.48, z: iz + (j === 0 ? -1.8 : 1.8) * s, ry: 0, sx: 1, sy: 1, sz: 1 });
      }
    }
  }

  // ---- 实例化（9 draw call：皮革盒共用几何×材质承担基座/层板/平顶/封底/书沟）----
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const leatherMat = std(P.leather);
  const tanMat = std(P.tan);
  const abyssMat = std(P.abyss);
  const prismGeo = new THREE.CylinderGeometry(1, 1, 1, 3);
  prismGeo.rotateX(-Math.PI / 2); // 轴向转 z、截面立起：apex +y
  prismGeo.translate(0, 0.5, 0);  // 底面归 y=0
  const finGeo = new THREE.ConeGeometry(0.16, 1.5, 5);
  const lanternMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(P.amber).multiplyScalar(1.3) }); // 灯笼 HDR 过 bloom 阈值
  const lanternGeo = new THREE.BoxGeometry(0.22, 0.3, 0.22);
  const folioGeo = makeFolioPage();
  const folioMat = std(P.cream);
  const stalGeo = new THREE.ConeGeometry(1, 2, 6);
  const stalMat = std(P.tan);
  const linkGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.42, 5);
  const linkMat = std(P.leather);
  const parts = [
    addNU(scene, boxGeo, leatherMat, bases), addNU(scene, boxGeo, leatherMat, boards),
    addNU(scene, boxGeo, tanMat, eaves), addNU(scene, boxGeo, abyssMat, backs),
    addNU(scene, prismGeo, leatherMat, gables), addNU(scene, boxGeo, leatherMat, flats),
    addNU(scene, finGeo, leatherMat, fins), addNU(scene, lanternGeo, lanternMat, lanterns),
    addNU(scene, stalGeo, stalMat, mounts), addNU(scene, boxGeo, leatherMat, covers),
    addNU(scene, boxGeo, leatherMat, guts), addNU(scene, folioGeo, folioMat, folios),
    addNU(scene, stalGeo, stalMat, stals), addNU(scene, linkGeo, linkMat, links),
  ];
  const groups = [bases, boards, eaves, backs, gables, flats, fins, lanterns, mounts, covers, guts, folios, stals, links];

  const runway = addCeilingRunway(scene); // B-7 天花板跑道：静态实例组，不进 wrap 回收 groups（见 addCeilingRunway 注释）

  return {
    update(move: number) {
      if (move === 0) return;
      for (let g = 0; g < groups.length; g++) {
        const items = groups[g];
        for (const p of items) {
          p.z += move;
          if (p.z > WRAP_Z) p.z -= LOOP;
        }
        writeNU(parts[g], items);
      }
    },
    dispose() {
      for (const g of [boxGeo, prismGeo, finGeo, lanternGeo, folioGeo, stalGeo, linkGeo, runway.geo]) g.dispose();
      for (const m of [leatherMat, tanMat, abyssMat, lanternMat, folioMat, stalMat, linkMat, ...runway.mats]) m.dispose();
    },
  };
}
