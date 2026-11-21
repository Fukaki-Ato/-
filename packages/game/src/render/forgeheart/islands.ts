/**
 * 熔炉巨兽 · 静态废墟层（docs/scenes/forgeheart-brief.md §3.3 原型 2/3/6/7 + §4.2/4.5/4.7/4.10）：
 *   columns   蜂巢玄武柱：12 簇六棱柱（天然/锻火各半 §1.1，四态 40/25/20/15 §4.2——完好全高/
 *             半高断柱/崩尖柱/倾倒柱），柱基统一 y −8.4 没入岩浆；熔渣褐 instanceColor 微差。
 *   heatBand  热熏带：烧结赤套筒（水线以下段，§4.2）——几何顶端平移到原点、底在 −1，顶端实例
 *             恒 y=0，潮位重写只动 mesh 级 position.y（=岩浆面）与 scale.y（=淹没深），实例矩阵零改写。
 *   terraces  渣滩阶地 ×24（§4.5）：退台三阶（进深 2~4m、高差 0.8m、完整/塌角/滑塌 50/30/20），
 *             整组 y = −6.5+5.7·level（mesh 级）：低潮阶地沉到堤道缘下深处＝渣滩出露，高潮台缘
 *             顶到路缘＝「涨潮漫上堤道边缘」（§3.2）；台缘烧结赤热裂纹随组升降。
 *   chimneys  烟囱竖井 ×10（§4.7）：贴内壁斜出 20~35°，口沿硫壳黄结壳环，3 座拦腰折断（断口烧结赤）。
 *   steles    班次石碑 ×14（§4.10）：高 1.6m 顶斜切 30°，正面 4 长痕+1 短痕一组（潮汐四相+喷发，
 *             浮石灰 Lambert 刻痕底——热但死纪律，不发光）；沿路线推进刻痕渐乱（证据 3）：
 *             前 4 工整 → 中 5 错刻 → 末 5 末行只余起笔。
 *   falls     熔岩跌水 ×3（§3.3 原型 7）：岩壁破口炉火橙丝带（Basic 发光 + 程序化竖纹 UV 下滚，
 *             stormspire islands.ts 瀑布配方），落点岩浆面隆包随潮位 y。
 * 取数口径（§3.1）：本模块自累积 distAcc += move 调 tide.level；岩浆面 y = −6.5+5.7·level
 *   与 atmosphere.ts 同公式同值。纯装饰不读 sim；每帧零分配、确定性 rnd；发光只用炉火橙。
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { LOOP, WRAP_Z, addInst, rnd, std, writeAll, type Inst, type Placement } from '../sceneryProps.js';
import { P } from './palette.js';
import { level } from './tide.js';
import { applyWorldBend } from '../stormspire/worldBend.js';

const LAVA_Y0 = -6.5, LAVA_RISE = 5.7; // 岩浆面 y = −6.5+5.7·level（§3.5，atmosphere.ts 同值单源）
const COL_BASE = -8.4;                 // 柱基统一 y：低潮面下 1.9m 永不露出（柱基没入岩浆 §4.2）
const TUBE_R = 30;                     // 火山颈内壁半径（§3.4，landmarks.ts 同口径）

/** 非均匀缩放实例（柱体 r≠h / 条痕 w≠d）的逐帧 compose 暂存（零分配，veils.ts 口径） */
interface Def { x: number; y: number; z: number; ry: number; rz: number; sx: number; sy: number; sz: number; rx?: number }
const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(0, 0, 0, 'YXZ');
const V = new THREE.Vector3(), S = new THREE.Vector3(), TC = new THREE.Color();
function put(mesh: THREE.InstancedMesh, i: number, d: Def) {
  E.set(d.rx ?? 0, d.ry, d.rz); Q.setFromEuler(E);
  V.set(d.x, d.y, d.z); S.set(d.sx, d.sy, d.sz);
  M.compose(V, Q, S);
  mesh.setMatrixAt(i, M);
}

/** 跌水竖纹：RGB 恒白只管明暗、色调交回材质色（stormspire islands.makeFallTexture 同配方） */
function makeFallTexture(): THREE.DataTexture {
  const N = 64, data = new Uint8Array(N * N * 4);
  const hash = (x: number, y: number) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const col = hash(x, 913), v = y / N;
    const thread = col > 0.55 ? 0.6 + col * 0.4 : 0.14 + col * 0.3; // 少数列=亮熔流丝，其余稀薄熔幕
    const a = Math.min(1, Math.max(0, thread + (hash(x >> 1, y >> 3) - 0.5) * 0.2)) * (0.3 + 0.7 * Math.pow(v, 1.3));
    const i = (y * N + x) * 4;
    data[i] = 255; data[i + 1] = 255; data[i + 2] = 255; data[i + 3] = 255 * a; // 底部渐隐溶进隆包
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true; tex.needsUpdate = true;
  return tex;
}

export function createIslands(scene: THREE.Scene) {
  const insts: Inst[] = [];
  // ---- 蜂巢柱阵：12 簇沿 LOOP 均布（§3.3 原型 2 ×8 权重的视觉底）；簇内六方位密排 4~6 根。
  //      摆位/四态全部按 (簇 c, 簇内序 k) 取 rnd——props.ts 卡箍抱柱按同式同盐复算柱位（§4.3）。
  const colsNat: Def[] = [], colsCut: Def[] = [], caps: Def[] = [], band: Def[] = [];
  for (let c = 0; c < 12; c++) {
    const side = c % 2 === 0 ? -1 : 1;
    const cz = -16 - c * 19.5 + (rnd(c, 71) - 0.5) * 6, cx = side * (12.5 + rnd(c, 73) * 5);
    const n = 4 + Math.floor(rnd(c, 77) * 3);
    for (let k = 0; k < n; k++) {
      const i = c * 6 + k;
      const ang = (k / 6) * 6.283 + rnd(i, 79) * 0.7, rr = 1.1 + rnd(i, 83) * 1.3;
      const x = cx + Math.cos(ang) * rr, z = cz + Math.sin(ang) * rr * 0.8;
      const st = rnd(i, 89), full = 6 + rnd(i, 91) * 12;                 // 全高 6~18m
      const cut = (i & 1) === 0;                                          // 一半切平加载（锻火柱）
      const h = st < 0.4 ? full : st < 0.65 ? 4 + rnd(i, 93) * 4 : st < 0.85 ? full * 0.66 : full * 0.8;
      const rz = st >= 0.85 ? 0.26 : 0;                                   // 倾倒柱 15° 斜插渣滩
      const r = 0.6 + rnd(i, 97) * 0.6;                                   // 径 1.2~2.4m
      const col: Def = { x, y: COL_BASE + Math.cos(rz) * h / 2, z, ry: rnd(i, 101) * 6.283, rz, sx: r, sy: h, sz: r };
      (cut ? colsCut : colsNat).push(col);                                // 预先分桶，逐帧零分配
      // 断口暗盖：天然柱断口参差 / 半高断柱 / 崩尖柱（斜切盖）；锻火完好柱顶面切平无盖
      if (!cut || st >= 0.4) caps.push({
        x, y: COL_BASE + Math.cos(rz) * h + 0.05, z, ry: rnd(i, 103) * 0.4,
        rz: rz + (st >= 0.65 && st < 0.85 ? 0.35 : st >= 0.4 ? 0.14 : 0.05),
        sx: r * 0.94, sy: 0.14, sz: r * 0.94,
      });
      band.push({ x, y: 0, z, ry: 0, rz, sx: r * 1.06, sy: 1, sz: r * 1.06 }); // 热熏带顶端实例恒 y=0
    }
  }
  const colGeo = new THREE.CylinderGeometry(1, 1, 1, 6);
  const mkCols = (defs: Def[]) => {
    const mesh = new THREE.InstancedMesh(colGeo, std(0xffffff), defs.length);
    const basalt = new THREE.Color(P.basalt), slag = new THREE.Color(P.slag);
    for (let i = 0; i < defs.length; i++) { // 熔渣褐 instanceColor 微差（§4.2 tint 口径）
      TC.copy(basalt).lerp(slag, rnd(i, 105) * (defs === colsCut ? 0.85 : 0.5))
        .multiplyScalar(0.85 + rnd(i, 107) * 0.3);
      mesh.setColorAt(i, TC);
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.frustumCulled = false; // 逐帧 compose + 潮位 mesh 级缩放，剔除交给整 Mesh 常显（veils.ts 口径）
    scene.add(mesh);
    return mesh;
  };
  const colNat = mkCols(colsNat), colCut = mkCols(colsCut);
  const capGeo = new THREE.CylinderGeometry(1, 0.82, 1, 6);
  const capMesh = new THREE.InstancedMesh(capGeo, std(P.slagDark), caps.length);
  const bandGeo = new THREE.CylinderGeometry(1, 1, 1, 6); bandGeo.translate(0, -0.5, 0); // 顶在原点、向下 1
  const bandMesh = new THREE.InstancedMesh(bandGeo, std(P.sinter), band.length);
  bandMesh.frustumCulled = false; // scale.y 随潮位 1.9~7.5m 变化，包围球不做剔除
  scene.add(capMesh); scene.add(bandMesh);

  // ---- 渣滩阶地 ×24：三阶退台（台缘向路缘爬升），整组 y=岩浆面（潮位 mesh 级驱动，§4.5）；
  //      低潮整组沉到 −6.5＝堤道缘下露出渣滩立面，高潮台缘顶到路缘＝岩浆漫缘读法（§3.2）
  const slabs: Def[] = [], cracks: Placement[] = [];
  for (let k = 0; k < 24; k++) {
    const side = k % 2 === 0 ? -1 : 1;
    const z = -8 - k * 9.8 + (rnd(k, 111) - 0.5) * 4, w = 3 + rnd(k, 113) * 2; // 台宽 3~5m
    const st = rnd(k, 117);                                                    // 完整/塌角/滑塌 50/30/20
    const sink = st > 0.8 ? 1.4 : 0, tilt = st > 0.8 ? 0.22 : st > 0.5 ? 0.09 : 0;
    for (let t = 0; t < 3; t++) {
      const xi = side * (5.7 + t * 2.3 + (rnd(k * 3 + t, 119) - 0.5) * 0.8), d = 2 + rnd(k * 3 + t, 121) * 2;
      slabs.push({ x: xi, y: 1.0 - t * 0.8 - sink, z, ry: 0, rz: tilt * side, sx: d, sy: 0.8, sz: w });
      cracks.push({ x: xi, y: 1.43 - t * 0.8 - sink, z, s: Math.max(0.9, w * 0.5), ry: 0, rz: 0 }); // 台缘热裂纹
    }
  }
  const slabMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), std(0xffffff), slabs.length);
  {
    const slag = new THREE.Color(P.slag), pumice = new THREE.Color(P.pumice);
    for (let i = 0; i < slabs.length; i++) { // 熔渣褐 + 浮石灰灰烬覆层斑（§4.5 instanceColor）
      TC.copy(slag).lerp(pumice, rnd(i, 123) * 0.35).multiplyScalar(0.8 + rnd(i, 125) * 0.3);
      slabMesh.setColorAt(i, TC);
    }
    if (slabMesh.instanceColor) slabMesh.instanceColor.needsUpdate = true;
  }
  slabMesh.frustumCulled = false;
  scene.add(slabMesh);
  const crackGeo = new THREE.BoxGeometry(0.34, 0.06, 1);
  const crackInst = addInst(scene, crackGeo, std(P.sinter), cracks); // mesh.position.y 随潮位（update）
  insts.push(crackInst);

  // ---- 烟囱竖井 ×10：贴内壁（R30）斜出 20~35°，口沿硫壳黄结壳环；k%5==2 三座拦腰折断（§4.7）
  const chim: Def[] = [], rims: Def[] = [], brks: Def[] = [];
  for (let k = 0; k < 10; k++) {
    const side = k % 2 === 0 ? -1 : 1;
    const z = -20 - k * 22 + (rnd(k, 131) - 0.5) * 8;
    const psi = side * (0.96 + rnd(k, 133) * 0.85);          // 方位角 55°~104°：内壁侧带
    const broken = k % 5 === 2, h = (5 + rnd(k, 137) * 4) * (broken ? 0.55 : 1);
    const lean = 0.35 + rnd(k, 139) * 0.26, r = 0.6 + rnd(k, 141) * 0.4;
    const rc = TUBE_R - 0.6 - h / 2;                          // 柱心半径：基端嵌壁、沿轴伸出 h/2
    chim.push({ x: Math.sin(psi) * rc, y: Math.cos(psi) * rc, z, ry: 0, rz: -psi + Math.PI, rx: lean, sx: r, sy: h, sz: r });
    const rt = TUBE_R - 0.6 - h * 0.92;                       // 口沿：轴端半径（顺 lean 抬出）
    rims.push({ x: Math.sin(psi) * rt, y: Math.cos(psi) * rt, z: z + h * 0.3, ry: 0, rz: -psi + Math.PI, rx: lean, sx: r * 1.16, sy: 0.24, sz: r * 1.16 });
    if (broken) {                                             // 断口内壁烧结赤盖
      const rb = TUBE_R - 0.6 - h * 0.45;
      brks.push({ x: Math.sin(psi) * rb, y: Math.cos(psi) * rb, z: z + h * 0.15, ry: 0, rz: -psi + Math.PI, rx: lean, sx: r * 0.9, sy: 0.18, sz: r * 0.9 });
    }
  }
  const chimMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1.12, 1, 9), std(P.basalt), chim.length);
  const rimMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 9), std(P.sulfur), rims.length);
  const brkMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 0.85, 1, 9), std(P.sinter), brks.length);
  scene.add(chimMesh); scene.add(rimMesh); scene.add(brkMesh);

  // ---- 班次石碑 ×14：碑体+斜切顶帽（addInst 静态回收）+ 刻痕条（非均匀，自管 compose）。
  //      刻度沿路线推进渐乱：k0-3 工整 → k4-8 错刻 → k9-13 末行只余起笔（证据 3，§4.10）
  const steles: Placement[] = [], marks: Def[] = [];
  const MARK_W = [0.34, 0.34, 0.34, 0.34, 0.18]; // 4 长痕 + 1 短痕（喷发）一组
  for (let k = 0; k < 14; k++) {
    const side = k % 2 === 0 ? -1 : 1;
    const z = -8 - k * 16.5, x = side * 5.1, ry = side > 0 ? -Math.PI / 2 : Math.PI / 2; // 碑面朝路心
    steles.push({ x, y: 0.8, z, s: 1, ry });
    const messy = k >= 4 && k < 9, stub = k >= 9;
    for (let rI = 0; rI < 5; rI++) {
      const wI = stub && rI === 4 ? 0.08 : MARK_W[rI]!;  // 末 5 座末行只余起笔
      const zo = stub && rI === 4 ? -0.13 + wI / 2 : (messy ? (rnd(k * 5 + rI, 143) - 0.5) * 0.08 : 0);
      marks.push({
        x: x - side * 0.095, y: 1.18 - rI * 0.26 + (messy ? (rnd(k * 5 + rI, 145) - 0.5) * 0.03 : 0),
        z: z + zo, ry, rz: messy ? (rnd(k * 5 + rI, 147) - 0.5) * 0.14 : 0,
        sx: 0.02, sy: 0.05, sz: wI,
      });
    }
  }
  const steleBody = new THREE.BoxGeometry(0.5, 1.6, 0.16);
  const steleCap = new THREE.BoxGeometry(0.56, 0.1, 0.2); steleCap.rotateX(0.52); steleCap.translate(0, 1.62, 0);
  insts.push(addInst(scene, mergeGeometries([steleBody, steleCap]), std(P.basalt), steles)); // 碑体+顶斜切 30° 帽一体（省一条 draw call）
  const markMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), std(P.pumice), marks.length);
  markMesh.frustumCulled = false;
  scene.add(markMesh);

  // ---- 熔岩跌水 ×3：破口丝带（自管 compose 非均匀）+ 落点隆包（addInst，mesh y 随潮位）
  const falls: Def[] = [], boils: Placement[] = [];
  for (let k = 0; k < 3; k++) {
    const side = k % 2 === 0 ? -1 : 1;
    const z = -60 - k * 72, w = 3 + rnd(k, 151) * 3; // 宽 3~6m
    falls.push({ x: side * 25.8, y: 7.5, z, ry: side > 0 ? Math.PI : 0, rz: 0, rx: 0.06, sx: w / 2, sy: 16, sz: w / 2 });
    boils.push({ x: side * 24.6, y: 0, z, s: w * 0.8, ry: 0 });
  }
  const fallTex = makeFallTexture();
  const fallMat = new THREE.MeshBasicMaterial({ color: P.ember, map: fallTex, transparent: true, opacity: 0.9, side: THREE.DoubleSide });
  const fallGeo = new THREE.CylinderGeometry(1, 1.12, 1, 10, 1, true, 0, Math.PI);
  fallGeo.translate(0, -0.5, 0); // 顶在原点向下挂：破口 y7.5 → 底 −8.5 恒没入岩浆
  const fallMesh = new THREE.InstancedMesh(fallGeo, fallMat, falls.length);
  fallMesh.frustumCulled = false;
  scene.add(fallMesh);
  const boilGeo = new THREE.SphereGeometry(1, 10, 6); boilGeo.scale(1, 0.32, 1);
  const boilMat = new THREE.MeshBasicMaterial({ color: P.ember }); applyWorldBend(boilMat); // 岩浆隆包=活火
  const boilInst = addInst(scene, boilGeo, boilMat, boils);
  insts.push(boilInst);

  // 自管实例逐帧回收（z 推进 + compose；滚动基线账，veils.ts 两笔账口径）
  const roll = (mesh: THREE.InstancedMesh, defs: Def[], move: number) => {
    for (let i = 0; i < defs.length; i++) { const d = defs[i]!; d.z += move; d.z -= Math.ceil((d.z - WRAP_Z) / LOOP) * LOOP; put(mesh, i, d); }
    mesh.instanceMatrix.needsUpdate = true;
  };

  let distAcc = 0;
  return {
    update(move: number, t: number) {
      void t; // 跌水 UV 滚动用 move（随世界流速），潮位纯函数用 distAcc——t 预留（接口一致）
      distAcc += move;                                        // §3.1 取数口径：模块内自累积
      const lavaY = LAVA_Y0 + LAVA_RISE * level(distAcc);     // 岩浆面 y（与 atmosphere.ts 同源）
      bandMesh.position.y = lavaY;                            // 热熏带顶恒贴岩浆面（§4.2 潮位重写）
      bandMesh.scale.y = Math.max(0.2, lavaY - COL_BASE);     // 淹没深 = 岩浆面 − 柱基
      slabMesh.position.y = lavaY;                            // 渣滩阶地整组随潮（§4.5）
      crackInst.mesh.position.y = lavaY;                      // 台缘热裂纹随组升降
      boilInst.mesh.position.y = lavaY;                       // 跌水落点隆包贴岩浆面（原型 7）
      fallTex.offset.y = (fallTex.offset.y + move * 0.033) % 1; // UV 下滚=熔流下行（offset 增⇒花纹 −v，stormspire islands.ts 口径）
      roll(colNat, colsNat, move);
      roll(colCut, colsCut, move);
      roll(capMesh, caps, move); roll(bandMesh, band, move);
      roll(slabMesh, slabs, move); roll(chimMesh, chim, move);
      roll(rimMesh, rims, move); roll(brkMesh, brks, move);
      roll(markMesh, marks, move); roll(fallMesh, falls, move);
      for (const inst of insts) {                             // addInst 静态件（石碑/顶帽/裂纹/隆包）
        for (const p of inst.items) { p.z += move; p.z -= Math.ceil((p.z - WRAP_Z) / LOOP) * LOOP; }
        writeAll(inst);
      }
    },
  };
}
