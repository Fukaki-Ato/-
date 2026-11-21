/**
 * 熔炉巨兽 · 主地标层（docs/scenes/forgeheart-brief.md §3.4 + §4.1/4.4/4.12 + §8 LOOP 210 段位）：
 *   wall      火山颈内壁：R30 开口大圆管（腔内径 60，§4.1 几何校核口径）BackSide 包裹赛道，
 *             长 260m 盖满视程；玄武黑 + 熔渣褐斑纹/烧结赤竖流痕 DataTexture，运动感由
 *             纹理滚动承担（不需逐段回收，§3.4），远端雾消隐。
 *   helix     螺旋壁架：宽 1.5m 石条带沿壁右旋上升（螺距 12m，实例化石条每 2m 一根 +
 *             每 18m 一根残柱）；φ 恒 = 2π·z/12——240m 循环恰 20 整圈，z 回收时相位跳变 ≡0 无缝。
 *   hearts    炉心 ×2（错位 z −80/−200，x=0 路轴上，tower.ts 同款错 z）：40m 宽/冠高 17m 球冠
 *             玄武壳 + 熔流沟壑炉火橙亮带 + Ø52m 青铜环轨（倾 12°）+ 8 放射断臂（3 条熔断下折
 *             挂泪滴锥）。心跳 = 明暗 2Hz 加拍与潮汐同源（任务口径；§4.1 快层 0.22Hz 幅 ±25% +
 *             慢层随潮位 0→1 抬 30% 的双层结构保留，喷发窗 2Hz——§3.1/§5.3）。
 *             回收带 [−300,−60]：近端在物距 ~69m 半雾处绕回远端——比标准近界（WRAP_Z=12）提前
 *             收线，40m 冠体不冲脸穿相机；末段 15m 向雾色 lerp「烧穿隐去」，回收无跳变；
 *             z=−200 一枚超雾程与 far 160，随回收推进渐次入画（tower 同款生命周期，§4.1）。
 *   valve     哑阀 ×1：嵌壁总阀（阀体 6×6×3 玄武砌体 + 轮径 7m 青铜阀轮 8 辐——4 辐向炉心方向
 *             弯倒 25~40°、弯向一致（证据 2）+ 轮缘缺口 2 处），缝线炉火橙微光缝平时 20% 亮度；
 *             1s 红光预警窗（surgeStart − v·1.0，v 渲染层估速）抬到 55%、喷发段 100% 并 3Hz 闪烁
 *             （§4.4 + §3.1）。**LOOP 210m 段位**（z=−210 → 首圈 210m 照面，450m 第二圈复现同一枚，
 *             §8 环线诚实口径），标准 LOOP/WRAP_Z 回收。
 *   statues   锻像 ×2（哑阀厅段前后各一座，全场景仅此两座 §4.12）：高 ~12m 立像 Lathe 躯干
 *             （statue.ts 配方），右臂前伸指炉心深处（证据 5）、左臂下垂持锤；玄武黑 + 面向炉心侧
 *             烧结赤热熏斑；前像右臂肘下熔断（断臂落像前 6m 渣滩，随潮位 y），后像完整但双腿
 *             下段凝熔壳。z −196/−224 夹住 z −210 哑阀。
 * 取数口径（§3.1）：自累积 distAcc += move 调 tide.level/surgeWindow/surgeStart；岩浆面
 *   y = −6.5+5.7·level 与 atmosphere.ts 同值。纯装饰不读 sim；每帧零分配；发光只用炉火橙。
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { LOOP, WRAP_Z, addInst, rnd, std, writeAll, type Inst, type Placement } from '../sceneryProps.js';
import { P } from './palette.js';
import { level, surgeWindow, surgeStart } from './tide.js';
import { applyWorldBend } from '../stormspire/worldBend.js';

const LAVA_Y0 = -6.5, LAVA_RISE = 5.7;  // 岩浆面 y（atmosphere.ts 同值单源，渣滩断臂随潮用）
const TUBE_R = 30;                      // 内壁半径（腔内径 60，§4.1 校核：环轨 Ø52 < 60 ✓）
const HEART_WRAP = -60;                 // 炉心回收带 [−300,−60] 近界：物距 ~69m 半雾处绕回（§4.1 远场剪影）
const EMBER_C = new THREE.Color(P.ember), FOG_C = new THREE.Color(0x4a3226); // §7.2 雾色=烧穿隐去目标色

const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(0, 0, 0, 'YXZ');
const V = new THREE.Vector3(), S = new THREE.Vector3();
/** 自管 compose（零分配）：rz + 非均匀缩放（壁架条/残柱径向贴壁全靠 rz=−φ） */
function put(mesh: THREE.InstancedMesh, i: number, x: number, y: number, z: number, rz: number, sx: number, sy: number, sz: number) {
  E.set(0, 0, rz); Q.setFromEuler(E);
  V.set(x, y, z); S.set(sx, sy, sz);
  M.compose(V, Q, S);
  mesh.setMatrixAt(i, M);
}

/** 内壁斑纹：熔渣褐 blob 斑 + 少量烧结赤竖向热熏流痕列（热但死，§2）——整数频率无缝平铺 */
function makeWallTexture(): THREE.DataTexture {
  const N = 128, data = new Uint8Array(N * N * 4);
  const hash = (x: number, y: number) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
  const blob = (x: number, y: number, fx: number, fy: number) =>
    Math.sin(((x / N) * fx + hash(fx, fy)) * 6.2832) * Math.cos(((y / N) * fy + hash(fy, fx)) * 6.2832);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const b = Math.max(0, blob(x, y, 5, 7) * 0.5 + blob(x, y, 11, 3) * 0.5);
    const streak = hash(x, 313) > 0.93 ? 0.45 : 0;             // 少数竖列=烧结赤热熏流痕
    const i = (y * N + x) * 4, t = b * 0.85 + streak;
    data[i] = 30 + (92 - 30) * t; data[i + 1] = 23 + (50 - 23) * t; data[i + 2] = 19 + (40 - 19) * t;
    data[i + 3] = 255;                                          // 玄武黑 → 熔渣褐/烧结赤（不出 7 色）
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true; tex.repeat.set(5, 8.6); tex.needsUpdate = true;
  return tex;
}

export function createLandmarks(scene: THREE.Scene) {
  const insts: Inst[] = [];
  // ---- 内壁圆管：BackSide 单 mesh 静态（管壁沿 z 均匀，纹理滚动承担运动感 §3.4）
  const wallGeo = new THREE.CylinderGeometry(TUBE_R, TUBE_R, 260, 48, 1, true);
  wallGeo.rotateX(Math.PI / 2); // 管轴 = 路轴（z 向）
  const wallTex = makeWallTexture();
  const wallMat = new THREE.MeshLambertMaterial({ color: P.basalt, map: wallTex, side: THREE.BackSide });
  applyWorldBend(wallMat);
  const wall = new THREE.Mesh(wallGeo, wallMat);
  wall.position.set(0, 0, -104); // 覆盖 z −234~+26：fog FAR 120 / camera far 160 全包
  scene.add(wall);

  // ---- 螺旋壁架：石条 120（每 2m）+ 残柱 13（每 18m），φ=2π·z/12 右旋（§3.4）
  const slabGeo = new THREE.BoxGeometry(1, 1, 1);
  const helixSlabs = Array.from({ length: 120 }, (_, i) => ({ z: -228 + i * 2, r: 29.55 + rnd(i, 61) * 0.12, w: 1.4 + rnd(i, 63) * 0.3 }));
  const helixMesh = new THREE.InstancedMesh(slabGeo, std(P.slag), helixSlabs.length);
  const postGeo = new THREE.CylinderGeometry(0.3, 0.36, 3.4, 6);
  const helixPosts = Array.from({ length: 13 }, (_, j) => ({ z: -228 + j * 18 }));
  const postMesh = new THREE.InstancedMesh(postGeo, std(P.basalt), helixPosts.length);
  helixMesh.frustumCulled = false; postMesh.frustumCulled = false; // φ 逐帧重算，剔除交整 Mesh
  scene.add(helixMesh); scene.add(postMesh);

  // ---- 炉心 ×2：球冠壳 + 熔流沟壑亮带 + 锚架（环轨+断臂+泪滴锥合并），几何共用、材质每心独立
  const shellGeo = new THREE.SphereGeometry(20, 20, 10, 0, 6.283, 0, Math.PI / 2);
  shellGeo.scale(1, 0.85, 1); shellGeo.translate(0, -10, 0); // 冠底 y=−10 没入潮面、冠顶 y≈+7（§4.1）
  const glowParts: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 6; k++) { // 熔流沟壑 5~7 条：贴冠裙竖亮带（炉火橙 Basic，心跳调色）
    const a = k * 1.047 + 0.3, g = new THREE.BoxGeometry(0.9, 6, 0.3);
    g.translate(Math.sin(a) * 19.2, -4, Math.cos(a) * 19.2);
    glowParts.push(g);
  }
  const glowGeo = mergeGeometries(glowParts);
  const anchorParts: THREE.BufferGeometry[] = [new THREE.TorusGeometry(26, 0.5, 8, 40, 5.85)]; // 环轨断口缺弧
  for (let k = 0; k < 8; k++) {
    const az = k * 0.785, arm = new THREE.BoxGeometry(0.7, 13, 0.7);
    arm.translate(0, 19, 0); arm.rotateZ(az); // 放射断臂：半径 12.5→25.5
    anchorParts.push(arm);
    if (k === 2 || k === 5 || k === 7) { // 3 条熔断下折：断口垂臂 + 凝固熔滴（泪滴锥，剪影读法同青铜）
      const px = Math.cos(az) * 19.5, py = Math.sin(az) * 19.5;
      const droop = new THREE.CylinderGeometry(0.28, 0.2, 6, 6);
      droop.translate(0, -3, 0); droop.rotateZ(0.55); droop.translate(px, py, 0);
      const tear = new THREE.ConeGeometry(0.34, 0.7, 6);
      tear.rotateX(Math.PI); tear.translate(px + 3.13, py - 5.4, 0);
      anchorParts.push(droop, tear);
    }
  }
  const anchorGeo = mergeGeometries(anchorParts);
  anchorGeo.rotateX(0.21); anchorGeo.translate(0, 2, 0); // 环面倾 12°、环心 y=+2（§4.1）
  const heartZ = [-80, -200]; // 错 z 双心（tower.ts:21-24 手法）；回收带见 HEART_WRAP
  const shellMats: THREE.MeshLambertMaterial[] = [], glowMats: THREE.MeshBasicMaterial[] = [], bronzeMats: THREE.MeshLambertMaterial[] = [];
  const shellMeshes: THREE.Mesh[] = [], glowMeshes: THREE.Mesh[] = [], anchorMeshes: THREE.Mesh[] = [];
  for (let hI = 0; hI < 2; hI++) { // 材质每心独立：末段各自向雾色烧穿隐去（回收无跳变）
    const sm = std(P.basalt), gm = new THREE.MeshBasicMaterial({ color: P.ember }), bm = std(P.bronze);
    applyWorldBend(gm); // 不透明发光核注入 world-bend（veils.ts 口径），与内壁同弯
    shellMats.push(sm); glowMats.push(gm); bronzeMats.push(bm);
    const ms = new THREE.Mesh(shellGeo, sm), mg = new THREE.Mesh(glowGeo, gm), ma = new THREE.Mesh(anchorGeo, bm);
    ms.position.z = mg.position.z = ma.position.z = heartZ[hI]!;
    shellMeshes.push(ms); glowMeshes.push(mg); anchorMeshes.push(ma);
    scene.add(ms); scene.add(mg); scene.add(ma);
  }

  // ---- 哑阀 ×1（z=−210 LOOP 210 段位）：砌体阀体 + 半熔阀轮（4 辐同向弯倒+轮缘缺口 2）+ 光缝
  const valveZ = -210;
  const wheelParts: THREE.BufferGeometry[] = [
    new THREE.TorusGeometry(3.5, 0.25, 8, 20, 2.85),
    new THREE.TorusGeometry(3.5, 0.25, 8, 20, 2.85).rotateZ(3.43), // 轮缘缺口 2 处
  ];
  const hub = new THREE.CylinderGeometry(0.7, 0.8, 0.6, 8); hub.rotateX(Math.PI / 2); hub.translate(0, 0, 2.0);
  const axle = new THREE.CylinderGeometry(0.3, 0.3, 2.4, 8); axle.rotateX(Math.PI / 2); axle.translate(0, 0, 0.7); // 轴杆从阀体通出抵轮盘（§4.4）
  wheelParts.push(hub, axle);
  for (let k = 0; k < 8; k++) { // 8 辐；4 根弯倒 31°：rotateX 先倾（预系 +z→终系 +x=炉心方向）、向热源一致（证据 2）
    const sp = new THREE.BoxGeometry(0.42, 3.5, 0.42);
    sp.translate(0, 1.75, 0);
    if (k % 2 === 1) sp.rotateX(0.55);
    sp.rotateZ(k * 0.785); sp.translate(0, 0, 1.9);
    wheelParts.push(sp);
  }
  const wheelGeo = mergeGeometries(wheelParts); wheelGeo.rotateY(Math.PI / 2); // 轮面⊥路轴，轮盘朝路心
  const seamGeo = mergeGeometries([
    new THREE.BoxGeometry(0.12, 6.14, 0.14).translate(1.55, 0, 3.0),
    new THREE.BoxGeometry(0.12, 6.14, 0.14).translate(1.55, 0, -3.0),
    new THREE.BoxGeometry(0.12, 0.14, 6.14).translate(1.55, 3.0, 0),
    new THREE.BoxGeometry(0.12, 0.14, 6.14).translate(1.55, -3.0, 0),
  ]);
  const seamMat = new THREE.MeshBasicMaterial({ color: P.ember }); applyWorldBend(seamMat);
  const valveBody = new THREE.Mesh(new THREE.BoxGeometry(6, 6, 3), std(P.basalt));
  const valveWheel = new THREE.Mesh(wheelGeo, std(P.bronze));
  const valveSeam = new THREE.Mesh(seamGeo, seamMat);
  valveBody.position.set(-28.3, 2.8, valveZ); // 背面嵌内壁（y2.8 处壁 x≈−29.9）、正面朝路心
  valveWheel.position.set(-26.4, 2.8, valveZ);
  valveSeam.position.set(-28.3, 2.8, valveZ);
  scene.add(valveBody); scene.add(valveWheel); scene.add(valveSeam);

  // ---- 锻像 ×2（ry=π 面朝炉心深处 −z；右臂前伸 local +z → world −z，证据 5）
  const loc = (st: { x: number; z: number }, lx: number, ly: number, lz: number): Placement =>
    ({ x: st.x + lx * -1, y: ly, z: st.z + lz * -1, s: 1, ry: Math.PI }); // ry=π：本地 (lx,lz) 取反搬世界
  const ST = [{ x: -5.6, z: -196 }, { x: 5.6, z: -224 }];
  const lathe = new THREE.LatheGeometry([
    new THREE.Vector2(1.25, 0), new THREE.Vector2(1.0, 2.4), new THREE.Vector2(0.88, 5.2),
    new THREE.Vector2(0.98, 6.6), new THREE.Vector2(0.92, 6.9), new THREE.Vector2(0.48, 7.2), new THREE.Vector2(0.44, 7.6),
  ], 8); lathe.translate(0, 4.2, 0);
  const legL = new THREE.CylinderGeometry(0.34, 0.42, 4.4, 7); legL.translate(-0.5, 2.2, 0);
  const legR = new THREE.CylinderGeometry(0.34, 0.42, 4.4, 7); legR.translate(0.5, 2.2, 0);
  const hip = new THREE.BoxGeometry(1.7, 1.2, 1.1); hip.translate(0, 4.0, 0);
  const head = new THREE.SphereGeometry(0.52, 8, 6); head.scale(1, 1.15, 0.95); head.translate(0, 12.15, 0);
  const larm = new THREE.CylinderGeometry(0.26, 0.3, 2.6, 6); larm.rotateZ(0.1); larm.translate(-1.3, 7.4, 0.1);
  const hHandle = new THREE.BoxGeometry(0.12, 1.3, 0.12); hHandle.rotateZ(0.1); hHandle.translate(-1.55, 5.5, 0.3);
  const hHead = new THREE.BoxGeometry(0.6, 0.3, 0.3); hHead.translate(-1.62, 5.0, 0.3);
  insts.push(addInst(scene, mergeGeometries([lathe, legL, legR, hip, head, larm, hHandle, hHead]), std(P.basalt),
    ST.map(st => loc(st, 0, 0, 0))));
  const upper = new THREE.CylinderGeometry(0.27, 0.32, 2.4, 7); upper.rotateX(Math.PI / 2); upper.translate(1.15, 9.3, 1.3);
  insts.push(addInst(scene, upper, std(P.basalt), [loc(ST[0]!, 0, 0, 0)])); // 前像残存的右上臂（肘下熔断）
  const meltCap = new THREE.SphereGeometry(0.34, 8, 6); meltCap.scale(1, 0.8, 1);
  insts.push(addInst(scene, meltCap, std(P.sinter), [loc(ST[0]!, 1.15, 9.3, 2.55)])); // 断口熔壳帽
  const fore = new THREE.CylinderGeometry(0.22, 0.26, 1.9, 6); fore.rotateX(1.69); fore.translate(1.2, 9.05, 3.2);
  const hand = new THREE.BoxGeometry(0.3, 0.3, 0.3); hand.translate(1.2, 8.85, 4.0);
  const scroll = new THREE.CylinderGeometry(0.17, 0.17, 0.75, 7); scroll.rotateZ(Math.PI / 2); scroll.translate(1.2, 8.8, 4.15);
  insts.push(addInst(scene, mergeGeometries([fore, hand, scroll]), std(P.basalt), [loc(ST[1]!, 0, 0, 0)])); // 后像完整右臂
  const bootL = new THREE.BoxGeometry(0.9, 1.5, 0.95); bootL.translate(-0.5, 0.85, 0);
  const bootR = new THREE.BoxGeometry(0.9, 1.5, 0.95); bootR.translate(0.5, 0.85, 0);
  insts.push(addInst(scene, mergeGeometries([bootL, bootR]), std(P.sinter), [loc(ST[1]!, 0, 0, 0)])); // 后像双腿熔壳
  const p1 = new THREE.BoxGeometry(0.55, 1.5, 0.16); p1.rotateY(0.05); p1.translate(0.3, 8.0, 1.05);
  const p2 = new THREE.BoxGeometry(0.45, 1.2, 0.14); p2.rotateY(-0.1); p2.translate(-0.55, 6.7, 1.1);
  const p3 = new THREE.BoxGeometry(0.5, 1.6, 0.15); p3.rotateY(0.08); p3.translate(0.4, 5.6, 1.12);
  const p4 = new THREE.BoxGeometry(0.4, 1.1, 0.14); p4.rotateY(-0.06); p4.translate(-0.3, 9.4, 0.95);
  insts.push(addInst(scene, mergeGeometries([p1, p2, p3, p4]), std(P.sinter), ST.map(st => loc(st, 0, 0, 0)))); // 热熏斑（面向炉心侧）
  const fFore = new THREE.CylinderGeometry(0.22, 0.26, 1.9, 6); fFore.rotateZ(Math.PI / 2); fFore.translate(0, 0.24, 0);
  const fScroll = new THREE.CylinderGeometry(0.17, 0.17, 0.75, 7); fScroll.rotateZ(0.4); fScroll.translate(1.0, 0.2, 0.1);
  const fallenInst = addInst(scene, mergeGeometries([fFore, fScroll]), std(P.basalt),
    [{ x: -6.8, y: 1.45, z: -202, s: 1, ry: 0.7 }]); // 断臂落像前 6m 渣滩：y 随潮位（update）
  insts.push(fallenInst);

  let distAcc = 0, lastT = 0;
  return {
    update(move: number, t: number) {
      const dt = Math.min(Math.max(t - lastT, 0.001), 0.1); lastT = t;
      distAcc += move;                                        // §3.1 取数口径：模块内自累积
      const lvl = level(distAcc), surge = surgeWindow(distAcc);
      for (const inst of insts) {                             // 锻像组静态回收
        for (const p of inst.items) { p.z += move; p.z -= Math.ceil((p.z - WRAP_Z) / LOOP) * LOOP; }
        writeAll(inst);
      }
      fallenInst.mesh.position.y = LAVA_Y0 + LAVA_RISE * lvl + 1.45; // 断臂贴渣滩阶地顶（§4.5 同源）
      // 螺旋壁架：φ 恒 = 2π·z/12（右旋）；240m 回收恰 20 整圈 ⇒ 相位跳变 ≡0 无缝
      for (let i = 0; i < helixSlabs.length; i++) {
        const d = helixSlabs[i]!; d.z += move; d.z -= Math.ceil((d.z - WRAP_Z) / LOOP) * LOOP;
        const ph = (d.z / 12) * 6.283;
        put(helixMesh, i, Math.sin(ph) * d.r, Math.cos(ph) * d.r, d.z, -ph, d.w, 0.28, 2.3);
      }
      helixMesh.instanceMatrix.needsUpdate = true;
      for (let j = 0; j < helixPosts.length; j++) {
        const d = helixPosts[j]!; d.z += move; d.z -= Math.ceil((d.z - WRAP_Z) / LOOP) * LOOP;
        const ph = (d.z / 12) * 6.283;
        put(postMesh, j, Math.sin(ph) * 28.3, Math.cos(ph) * 28.3, d.z, -ph, 1, 1, 1);
      }
      postMesh.instanceMatrix.needsUpdate = true;
      // 炉心心跳（任务口径 2Hz 加拍与潮汐同源；§4.1 双层：快层 0.22Hz ±25% + 慢层潮位 +30%）
      const hb = (0.9 + 0.3 * lvl) * (1 + 0.25 * Math.sin(t * 1.382))
        + (surge ? 0.45 * (0.5 + 0.5 * Math.sin(t * 12.566)) : 0);
      for (let hI = 0; hI < 2; hI++) {
        const z = heartZ[hI]! + move; heartZ[hI] = z - Math.ceil((z - HEART_WRAP) / LOOP) * LOOP; // 回收带 [−300,−60]，ceil 多重回收扛大步长
        const fz = Math.min(Math.max((heartZ[hI]! + 75) / 15, 0), 1); // 末段 15m 向雾色烧穿隐去
        glowMats[hI]!.color.copy(EMBER_C).multiplyScalar(hb).lerp(FOG_C, fz);
        shellMats[hI]!.color.set(P.basalt).lerp(FOG_C, fz);
        bronzeMats[hI]!.color.set(P.bronze).lerp(FOG_C, fz);
        shellMeshes[hI]!.position.z = glowMeshes[hI]!.position.z = anchorMeshes[hI]!.position.z = heartZ[hI]!;
      }
      // 哑阀：标准 LOOP 回收（z=−210 段位每圈复现，§8）；缝光 = 平时 20% → 预警窗 55% → 喷发 100%+3Hz
      const vz = valveZ + move;
      valveBody.position.z = valveWheel.position.z = valveSeam.position.z = vz - Math.ceil((vz - WRAP_Z) / LOOP) * LOOP;
      const v = Math.min(Math.max(move / dt, 6), 30);         // 渲染层估速（§3.1 预警提前量恒 1.0s）
      const sStart = surgeStart(distAcc), warn = distAcc >= sStart - v && distAcc < sStart;
      let g = surge ? 1 : warn ? 0.55 : 0.2;
      if (surge) g *= 0.55 + 0.45 * Math.abs(Math.sin(t * 18.85)); // 喷发段 3Hz 闪烁（§4.4）
      seamMat.color.copy(EMBER_C).multiplyScalar(g);
      wallTex.offset.y = (wallTex.offset.y - move / 30.2) % 1; // 纹样随世界 +z 流动（offset 增⇒花纹 −v）
    },
  };
}
