/**
 * 沉眠泰坦 · 解剖地标与随葬器物（docs/scenes/titan-brief.md §4.3/§4.7/§4.8/§4.9/§4.10，z 全按 §3.2 分区）：
 *   arrows   弑神箭 ×24：斜插路缘两侧 55~70°（羽尾朝天参差），杆/三叶镞/尾羽/缠布条/断口暗盖/
 *            入土骨渣环俱全，1/3 断杆只余半截；胸段最密（§3.2）。
 *   circles  葬仪石环 ×5：7~11 块歪斜立石 + 环心叠骨，2 环半塌（立石倒伏）；第 4 座（下标 3）
 *            围颅段 z≈−214，立石让开车道、读作「环颅而立」。
 *   lanterns 魂火灯 ×16：弯骨灯柱（两节折角）+ 悬浮魂火八面体（亡火金）+ 光晕壳 + 柱脚光池；
 *            颈段列队最密（引魂入颅，全程均距 ~15m）；魂火 ±8% 呼吸相位互错 + 每 6~11s 一次
 *            火星爆（确定性相位，landmarks.ts 电弧火花池口径）；3 盏柱折（魂火跌落贴地漂浮）。
 *   hands    掌残段 ×2：颅段路缘两侧半握拳（掌径 7m，掌心朝上向天摊开），五指两节、每掌断失
 *            1 远节；断腕截面 + 暗盖；矩阵呼吸 ±0.1m（连着腕，动得少，§4.10）。
 *   sword    断剑 ×1（§4.9 签名物）：剑尖没入左胸岩体（z≈−64.5、|x|≈14.5），剑身斜出路心、
 *            剑格横跨路面上空（过路心下缘 ~7.7m、剑格底 ~8.7m，均高于 6m 地板——玩家从剑下跑过）；
 *            柄首断失 + 剑身 1/3 崩口 + 入岩碎块（共用骨渣实例）；血槽亡火金纹每 ~15s 一次
 *            微脉冲（0.82→1.12 additive 亮度，确定性相位）。全长 40m 的直译与「剑格净高 6m +
 *            剑尖 |x|=14」几何互斥，按视觉优先取近似，签名读法全部保留。
 * 全部 InstancedMesh + 确定性 rnd + LOOP/WRAP_Z 回收；每帧零分配（compose 预建对象）；
 * 发光只用亡火金；纯视觉件不读 sim（判定归 sim）。
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { LOOP, WRAP_Z, addInst, rnd, std, writeAll, type Inst, type Placement } from '../sceneryProps.js';

/** 本地色表逐值对表 titan/palette.ts（§2 七色 + 派生口径；三文件互不 import，派生 = 调色板内插值不出圈） */
const BONE = 0xd9d2be;      // 骨象牙
const SKIN = 0x8a8271;      // 苍岩肤
const FOGG = 0x46606e;      // 雾灰青
const MOSS = 0x5c7a5e;      // 尸苔绿
const RUST = 0x8a4a32;      // 铁锈红褐
const EMBER = 0xffb454;     // 亡火金：唯一发光色
const SKIN_DARK = 0x6f7470; // 派生：苍岩肤 × 雾灰青（暗盖/关节）

const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler();
const V = new THREE.Vector3(), S = new THREE.Vector3();
/** 逐帧 compose（landmarks.ts 同款）：预建对象，每帧零分配 */
function compose(mesh: THREE.InstancedMesh, i: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, s = 1) {
  E.set(rx, ry, rz, 'YXZ'); Q.setFromEuler(E);
  V.set(x, y, z); S.set(s, s, s);
  M.compose(V, Q, S);
  mesh.setMatrixAt(i, M);
}

/** 光池贴图：64² 径向渐变（bridge.ts makePoolTexture 口径）：RGB 恒白乘材质色，明暗走 alpha */
function makePoolTexture(): THREE.DataTexture {
  const N = 64, data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const dx = (x + 0.5) / N - 0.5, dy = (y + 0.5) / N - 0.5;
    const a = Math.pow(1 - Math.min(1, Math.sqrt(dx * dx + dy * dy) * 2), 1.8);
    const i = (y * N + x) * 4;
    data[i] = 255; data[i + 1] = 255; data[i + 2] = 255; data[i + 3] = 255 * a;
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

export function createRelics(scene: THREE.Scene) {
  const insts: Inst[] = [];

  // ---- 弑神箭 ×24（§4.3）----
  const ARROWS = 24;
  // 分区手排 z（§3.2 胸段最密）：胸 10 / 肋 6 / 颈+颅 8；(−5~−9, −58~−66) 一带避开断剑入岩锥
  const arrowZ = [-10, -19, -28, -37, -46, -55, -63, -71, -79, -86, -94, -103, -112, -121, -130, -140,
    -150, -158, -166, -174, -182, -190, -204, -220];
  const shaftGeo = new THREE.CylinderGeometry(0.14, 0.2, 5, 6); shaftGeo.translate(0, 3.0, 0); // 杆（锥度 0.14→0.2，占 0.5~5.5）
  const tipGeo = mergeGeometries([0, 1, 2].map(k => {           // 三叶青铜镞（尖朝下入土，出土即见镞叶）
    const g = new THREE.ConeGeometry(0.16, 0.5, 4);
    g.scale(1, 1, 0.35); g.rotateZ(Math.PI); g.translate(0.13, 0.25, 0); g.rotateY(k * 2.094);
    return g;
  }));
  const fletchGeo = mergeGeometries([0, 1, 2].map(k => {        // 尾端三片羽环（薄板 0.3×0.5，朝天参差靠 ry/rx）
    const g = new THREE.BoxGeometry(0.02, 0.5, 0.3);
    g.translate(0.24, 5.05, 0); g.rotateY(k * 2.094);
    return g;
  }));
  const clothGeo = new THREE.TorusGeometry(0.26, 0.06, 5, 10);  // 缠布条（尸苔绿，杆中段一圈）
  clothGeo.rotateX(Math.PI / 2); clothGeo.translate(0, 3.0, 0);
  const capGeo = new THREE.CylinderGeometry(0.15, 0.18, 0.14, 6); capGeo.translate(0, 2.475, 0); // 断口暗盖（=0.45 断位）
  const rubbleGeo = new THREE.BoxGeometry(0.24, 0.12, 0.17);    // 碎骨/骨渣（箭环 / 环心叠骨 / 剑冢碎块共用）
  const shafts: Placement[] = [], tips: Placement[] = [], fletchs: Placement[] = [], cloths: Placement[] = [],
    caps: Placement[] = [], rubble: Placement[] = [];
  for (let i = 0; i < ARROWS; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const x = side * (3 + rnd(i, 45) * 5);                      // 路缘 |x| 3~8（§4.3）
    const z = arrowZ[i] + (rnd(i, 46) - 0.5) * 3;
    const s = 0.8 + rnd(i, 47) * 0.6;                           // 全长 4~7m
    const broken = rnd(i, 41) < 0.34;                           // 1/3 断杆只余半截（salt 实测 7/24）
    const p: Placement = { x, y: -0.25, z, s, ry: (rnd(i, 49) - 0.5) * 0.8, rx: (rnd(i, 50) - 0.5) * 0.24,
      rz: -side * (0.35 + rnd(i, 48) * 0.26) };                 // 55~70° 入地（自竖直倾 20~35°），羽尾朝天
    shafts.push({ ...p, s: broken ? s * 0.45 : s });
    tips.push({ ...p });
    cloths.push({ ...p, s: broken ? s * 0.45 : s });            // 断杆布条随半截
    if (broken) caps.push({ ...p }); else fletchs.push({ ...p });
    for (let k = 0; k < 2; k++) rubble.push({                   // 入土碎裂骨渣环 ×2（§4.3）
      x: x + (rnd(i * 2 + k, 51) - 0.5) * 1.2, y: 0.06, z: z + (rnd(i * 2 + k, 52) - 0.5) * 1.2,
      s: 0.7 + rnd(i * 2 + k, 53) * 0.8, ry: rnd(i * 2 + k, 54) * 6.28 });
  }
  for (let k = 0; k < 4; k++) rubble.push({                     // 断剑入岩碎块 ×4（§4.9，共用骨渣实例）
    x: -13.2 + (rnd(k, 171) - 0.5) * 3.4, y: 0.07, z: -63.2 + (rnd(k, 172) - 0.5) * 2.6,
    s: 1 + rnd(k, 173) * 1.6, ry: rnd(k, 174) * 6.28 });
  insts.push(addInst(scene, shaftGeo, std(RUST), shafts));
  insts.push(addInst(scene, tipGeo, std(FOGG), tips));
  insts.push(addInst(scene, fletchGeo, std(BONE), fletchs));
  insts.push(addInst(scene, clothGeo, std(MOSS), cloths));
  insts.push(addInst(scene, capGeo, std(SKIN_DARK), caps));
  insts.push(addInst(scene, rubbleGeo, std(BONE), rubble));

  // ---- 葬仪石环 ×5（§4.8）----
  const ringZ = [-36, -78, -128, -214, -170];                   // 下标 3 = 第 4 座：围颅段 z≈−214（§3.2）
  const stoneGeo = new THREE.BoxGeometry(0.5, 1.2, 0.35); stoneGeo.translate(0, 0.6, 0); // 高 0.8~1.6（s 0.67~1.33）
  const stones: Placement[] = [], ringMoss: Placement[] = [];
  for (let r = 0; r < 5; r++) {
    const skullRing = r === 3;
    const cx = skullRing ? 0 : (r % 2 === 0 ? -1 : 1) * (6.5 + rnd(r, 155) * 2); // 围颅环骑路心，其余路侧
    const rad = skullRing ? 4.1 : 2.8 + rnd(r, 156) * 1.2;     // 直径 5.6~8 / 围颅 8.2
    const half = rnd(r, 151) < 0.4;                            // 2 环半塌（salt 实测下标 2/3）
    const nSt = skullRing ? 11 : 9;                            // 立石 7~11 块
    for (let k = 0; k < nSt; k++) {
      const a = (k / nSt) * 6.283 + rnd(r * 11 + k, 157) * 0.5;
      const sx = cx + Math.cos(a) * rad, sz = ringZ[r] + Math.sin(a) * rad;
      if (skullRing && Math.abs(sx) < 2.5) continue;           // 围颅环：立石让开车道
      const s = 0.67 + rnd(r * 11 + k, 158) * 0.66;
      const fallen = half && k % 4 === 2;                      // 半塌环：倒伏 2~3 块
      stones.push(fallen
        ? { x: sx, y: 0.05, z: sz, s, ry: a, rx: 1.45 }        // 倒伏指向环外
        : { x: sx, y: 0, z: sz, s, ry: a, rz: (rnd(r * 11 + k, 159) - 0.5) * 0.3 }); // 歪斜不一
      if (!fallen && k % 2 === 0) ringMoss.push({ x: sx, y: 1.1 * s, z: sz, s: 1, ry: a }); // 苔覆
    }
    for (let k = 0; k < 3; k++) rubble.push({                  // 环心叠骨 ×3（§4.8，共用碎骨网格）
      x: cx + (rnd(r * 3 + k, 161) - 0.5) * 1.0, y: 0.07, z: ringZ[r] + (rnd(r * 3 + k, 162) - 0.5) * 1.0,
      s: 0.8 + rnd(r * 3 + k, 163) * 0.9, ry: rnd(r * 3 + k, 164) * 6.28 });
  }
  insts.push(addInst(scene, stoneGeo, std(FOGG), stones));
  insts.push(addInst(scene, new THREE.BoxGeometry(0.56, 0.12, 0.4), std(MOSS), ringMoss));

  // ---- 魂火灯 ×16（§4.7）----
  // z 手排落实「颈段列队最密（引魂入颅）」：胸 4 / 肋 3 / 颈 7（~7m 等距列队）/ 颅 2，全程均距 ~15m
  const lampZ = [-16, -38, -60, -82, -102, -124, -142, -152, -159, -166, -173, -180, -187, -194, -208, -230];
  const LAMPS = 16;
  const poleLow = new THREE.CylinderGeometry(0.09, 0.13, 1.25, 6); poleLow.translate(0, 0.62, 0);
  const poleUp = new THREE.CylinderGeometry(0.06, 0.09, 1.1, 6); poleUp.rotateZ(0.22); poleUp.translate(0.1, 1.72, 0);
  const poleGeo = mergeGeometries([poleLow, poleUp]);           // 弯骨灯柱（两节折角，高 ~2.3m）
  const poles: Placement[] = [], pools: Placement[] = [];
  const flames: { x: number; y: number; z: number; ph: number }[] = [];
  for (let i = 0; i < LAMPS; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const flip = side < 0 ? -1 : 1;                             // 灯柱折角朝路心（ry π 镜像 → 灯头 x 反号）
    const x = side * (4.6 + rnd(i, 135) * 1.2), z = lampZ[i] + (rnd(i, 136) - 0.5) * 2;
    const broken = rnd(i, 133) < 0.19;                          // 3 盏柱折（salt 实测 3）
    poles.push({ x, y: 0, z, s: 1, ry: side < 0 ? Math.PI : 0, rz: broken ? flip * 0.55 : 0 });
    const fx = broken ? x + flip * 1.5 : x + flip * 0.34;       // 柱折：魂火跌落贴地漂浮（§4.7）
    const fy = broken ? 0.3 : 2.62;
    flames.push({ x: fx, y: fy, z, ph: rnd(i, 139) * 6.283 });  // 呼吸相位互错
    pools.push({ x: fx, y: 0.03, z, s: 1, ry: 0 });             // 柱脚光池随魂火位
  }
  insts.push(addInst(scene, poleGeo, std(BONE), poles));
  const poolGeo = new THREE.PlaneGeometry(3.2, 3.2); poolGeo.rotateX(-Math.PI / 2);
  const poolTex = makePoolTexture();
  const poolMat = new THREE.MeshBasicMaterial({ color: EMBER, map: poolTex, transparent: true, opacity: 0.15,
    blending: THREE.AdditiveBlending, depthWrite: false });
  insts.push(addInst(scene, poolGeo, poolMat, pools));
  const emberMat = new THREE.MeshBasicMaterial({ color: EMBER });
  const flameMesh = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.22, 0), emberMat, LAMPS);
  const shellMesh = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.42, 0),
    new THREE.MeshBasicMaterial({ color: EMBER, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false }), LAMPS);
  const sparkMesh = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.1, 0), emberMat, LAMPS);
  scene.add(flameMesh); scene.add(shellMesh); scene.add(sparkMesh);

  // ---- 掌残段 ×2（§4.10）----
  const HANDS = [{ x: -7.3, z: -206, ry: Math.PI / 2 }, { x: 7.3, z: -222, ry: -Math.PI / 2 }]; // 指朝路心斜倚
  const palmGeo = (() => {                                      // 掌体烘合：压扁掌 + 腕桩（§4.0 纪律 2）
    const palm = new THREE.SphereGeometry(3.5, 10, 8); palm.scale(1.15, 0.5, 1.05);          // 掌径 ~7m
    const stub = new THREE.CylinderGeometry(1.7, 2.1, 2.4, 7); stub.rotateZ(Math.PI / 2); stub.translate(-4.7, 0.1, 0);
    return mergeGeometries([palm, stub]);
  })();
  const capWristGeo = new THREE.CylinderGeometry(1.78, 1.78, 0.18, 9);                          // 断腕暗盖
  capWristGeo.rotateZ(Math.PI / 2); capWristGeo.translate(-5.95, 0.1, 0);
  const phalGeo = new THREE.CylinderGeometry(0.3, 0.4, 1.9, 6); phalGeo.translate(0, 0.95, 0);  // 指节（基在原点）
  const palmItems: Placement[] = [], capItems: Placement[] = [], phalItems: Placement[] = [];
  const handBreath: { p: Placement; baseY: number; ph: number }[] = [];
  HANDS.forEach((H, hI) => {
    const c = Math.cos(H.ry), sn = Math.sin(H.ry);
    const loc = (lx: number, ly: number, lz: number): Placement =>
      ({ x: H.x + lx * c + lz * sn, y: ly, z: H.z - lx * sn + lz * c, s: 1, ry: H.ry });
    const ph = rnd(hI, 191) * 6.283;                            // 同掌同相位（一尸一息，§3.3）
    const palm = { ...loc(0, 1.2, 0), rx: 0.12 };
    palmItems.push(palm); handBreath.push({ p: palm, baseY: 1.2, ph });
    const cap = { ...loc(-5.95, 1.3, 0), rx: 0.12 };
    capItems.push(cap); handBreath.push({ p: cap, baseY: 1.3, ph });
    for (let f = 0; f < 5; f++) {
      const fx = -2.8 + f * 1.4;
      const prox = { ...loc(fx, 1.75, 2.5), s: 1.1, rx: -0.55, rz: (rnd(hI * 5 + f, 193) - 0.5) * 0.25 };
      phalItems.push(prox); handBreath.push({ p: prox, baseY: 1.75, ph });
      if ((hI === 0 && f === 4) || (hI === 1 && f === 1)) continue; // 每掌断失 1 远节（×10 节 − 2）
      const dist = { ...loc(fx * 1.1, 2.6, 1.9), s: 0.85, rx: -1.2, rz: (rnd(hI * 5 + f, 195) - 0.5) * 0.25 };
      phalItems.push(dist); handBreath.push({ p: dist, baseY: 2.6, ph });
    }
  });
  const palmInst = addInst(scene, palmGeo, std(SKIN), palmItems);
  const capInst = addInst(scene, capWristGeo, std(SKIN_DARK), capItems);
  const phalInst = addInst(scene, phalGeo, std(SKIN), phalItems);
  const handInsts = [palmInst, capInst, phalInst];

  // ---- 断剑 ×1（§4.9 签名物）----
  // 局部 +Y = 剑尖→柄；尖端锚 (−14.5, −3.2, −64.5)，rx 0.29 / rz −0.894 → 轴向 ≈ (0.78, 0.60, 0.18)
  const SWORD: Placement = { x: -14.5, y: -3.2, z: -64.5, s: 1, ry: 0, rx: 0.29, rz: -0.894 };
  const bladeGeo = (() => {                                     // 剑身（四棱锥度截面 × 非均匀压扁）+ 剑柄烘合
    const blade = new THREE.CylinderGeometry(0.28, 0.85, 20, 4);
    blade.scale(2.9, 1, 0.16); blade.translate(0, 10, 0);       // 剑宽 4.9→1.6 / 厚 0.27，出土 ~20m
    const grip = new THREE.CylinderGeometry(0.3, 0.36, 3.2, 6); grip.translate(0, 21.6, 0);
    return mergeGeometries([blade, grip]);
  })();
  const rustGeo = (() => {                                      // 剑格（宽 6m）+ 剑身锈斑 ×2（30% 面积），同材质烘合
    const guard = new THREE.BoxGeometry(6, 0.55, 1.3); guard.translate(0, 20.4, 0);
    const p1 = new THREE.BoxGeometry(1.6, 3.4, 0.06); p1.translate(-0.7, 5.5, 0.17);
    const p2 = new THREE.BoxGeometry(1.4, 2.6, 0.06); p2.translate(0.9, 13.5, -0.17);
    return mergeGeometries([guard, p1, p2]);
  })();
  const runeGeo = new THREE.BoxGeometry(0.1, 15, 0.05); runeGeo.translate(0, 11.5, 0.19); // 血槽金纹（迎玩家面）
  const darkGeo = (() => {                                      // 崩口豁口楔（剑身 1/3 段）+ 柄首断口暗盖
    const nick = new THREE.BoxGeometry(0.6, 1.4, 0.44); nick.rotateZ(0.55); nick.translate(-1.9, 7, 0);
    const cap = new THREE.CylinderGeometry(0.34, 0.3, 0.14, 6); cap.translate(0, 23.27, 0);
    return mergeGeometries([nick, cap]);
  })();
  insts.push(addInst(scene, bladeGeo, std(FOGG), [SWORD]));
  insts.push(addInst(scene, rustGeo, std(RUST), [SWORD]));
  const runeMat = new THREE.MeshBasicMaterial({ color: EMBER, transparent: true, opacity: 0.82,
    blending: THREE.AdditiveBlending, depthWrite: false });
  insts.push(addInst(scene, runeGeo, runeMat, [SWORD]));
  insts.push(addInst(scene, darkGeo, std(0x151c2c), [SWORD]));  // 烬空暮蓝：断口最暗部（零纯黑口径）

  return {
    update(move: number, t: number) {
      // 静态件回收（箭 / 石环 / 苔 / 灯柱 / 光池 / 断剑）
      for (const inst of insts) {
        for (const p of inst.items) {
          p.z += move;
          p.z -= Math.ceil((p.z - WRAP_Z) / LOOP) * LOOP;
        }
        writeAll(inst);
      }
      // 魂火 ±8% 呼吸（相位互错）+ 火星爆：6~11s 确定性相位，窗 0.07s ≈ 2~3 帧（landmarks 电弧口径）
      for (let i = 0; i < LAMPS; i++) {
        const f = flames[i];
        f.z += move; f.z -= Math.ceil((f.z - WRAP_Z) / LOOP) * LOOP;
        const sc = 1 + Math.sin(t * 1.1 + f.ph) * 0.08;
        const fy = f.y + Math.sin(t * 0.9 + f.ph) * 0.12;       // 悬浮微浮沉
        compose(flameMesh, i, f.x, fy, f.z, t * 0.7 + f.ph, f.ph, 0, sc);
        compose(shellMesh, i, f.x, fy, f.z, t * 0.7 + f.ph, f.ph, 0, sc);
        const per = 6 + rnd(i, 141) * 5, ev = (t + rnd(i, 142) * per) / per, frac = ev - Math.floor(ev);
        if (frac > 0.07) compose(sparkMesh, i, 0, -60, 0, 0, 0, 0, 0.0001);
        else {
          const a = rnd(Math.floor(ev), 143 + i * 7) * 6.283;   // 方位角由事件序号确定性取样
          compose(sparkMesh, i, f.x + Math.cos(a) * 0.3, fy + 0.28, f.z + Math.sin(a) * 0.3, a, 0, a, 1.25 - frac * 3);
        }
      }
      flameMesh.instanceMatrix.needsUpdate = true;
      shellMesh.instanceMatrix.needsUpdate = true;
      sparkMesh.instanceMatrix.needsUpdate = true;
      // 掌残段：回收 + 矩阵呼吸 ±0.1m（掌/腕盖/指节同掌同相位）
      for (const inst of handInsts) {
        for (const p of inst.items) {
          p.z += move;
          p.z -= Math.ceil((p.z - WRAP_Z) / LOOP) * LOOP;
        }
      }
      for (const br of handBreath) br.p.y = br.baseY + Math.sin(t * 0.6283 + br.ph) * 0.1;
      for (const inst of handInsts) writeAll(inst);
      // 血槽金纹微脉冲：每 ~15s 一次，0.82→1.12 additive 亮度（确定性相位，§4.9）
      const ev2 = (t + 4) / 15, fr2 = ev2 - Math.floor(ev2);
      runeMat.opacity = 0.82 + 0.3 * Math.max(0, 1 - fr2 * 8);
    },
    // dispose 清单：本模块新增的贴图/材质资源（bridge.ts 同口径）
    dispose() {
      poolGeo.dispose(); poolMat.dispose(); poolTex.dispose(); runeMat.dispose();
    },
  };
}
