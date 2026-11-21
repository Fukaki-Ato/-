/**
 * 熔炉巨兽 · 动件层（docs/scenes/forgeheart-brief.md §4.3/4.6/4.8/4.9/4.11 + §10 预算表）：
 *   bridges   断链吊桥 ×6（§4.6）：跨 11~13m 堤道断口桥接——玄武板桥面（板 2.2×0.5m 三道梯线，
 *             缺板率 12%＝变线提示）+ 青铜吊链 2 根（链节实例化，单环径 0.3m）；2 座半塌
 *             （+x 端垂入岩浆、链垂弧挂熔滴）、4 座可用；链条低频晃 ±1.2° 周期 4s 相邻桥相位错开。
 *   vines     引藤链 ×8（§4.8）：索道桅杆残链跨路悬垂（锚距 23~27m 承 18~26m 链长档，链节实例化，
 *             每 4m 挂青铜吊钩），2 条熔断（断头垂弧挂熔滴）；整链缓摆 ±8° 周期 6~8s 相位错开。
 *   crystals  焰髓晶簇 ×24（§4.9）：退潮渣滩位（座落在渣滩阶地缘，整组 y=岩浆面与 §4.5 同源），
 *             3~5 枚斜生六棱晶柱 + 玄武黑晶座；饱满/采撷过半/仅剩晶座三态 50/30/20；
 *             呼吸 0.3Hz 相位错开（instanceColor 逐帧改写——潮位驱动件只写 y/scale 与
 *             instanceColor 口径 §10），level<0.3 退潮刚出露亮度 +20%。
 *   carts     渣斗车残阵 ×8（§4.11）+ 铸运线双轨：青铜斗车倾翻朝炉心方向、姿态全同侧（证据 4），
 *             完整 3 / 破斗 3 / 熔粘连轨 2，斗内凝渣；纯静态残骸。
 *   clamps    铜卡箍环 ×12（§4.3）：双瓣青铜环抱锻火柱——簇位公式与 salts 同 islands.ts 蜂巢柱阵
 *             逐字复算（卡箍落位即柱位，只箍高处全高柱保「曾经的水线」读法），7 正 / 5 熔垂
 *             （下瓣拉长呈泪滴垂瘤，证据 1）；涨潮段热胀微颤 scaleY 1±0.5%（任务口径；brief §4.3
 *             为 1±0.8%/1.5Hz/level>0.6 门控——门控 1.5Hz 按 brief、幅度按任务收窄），高频件。
 * 预算纪律（titan §4.0 纪律 5 两笔账）：滚动基线＝全部实例每帧 z+=move 重写矩阵；动效改写＝
 *   摆位/热颤重算按 4 帧轮写分桶（低频慢摆 30Hz÷4 观感无差，ribs.ts 同款），吊桥 270 + 引藤/钩
 *   ≈245 + 卡箍 12 ⇒ 每帧改写 ≈132 ≤200；晶簇明暗走 instanceColor 独立小账。每帧零分配。
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { LOOP, WRAP_Z, addInst, rnd, std, writeAll, type Inst, type Placement } from '../sceneryProps.js';
import { P } from './palette.js';
import { level } from './tide.js';
import { applyWorldBend } from '../stormspire/worldBend.js';

const LAVA_Y0 = -6.5, LAVA_RISE = 5.7; // 岩浆面 y = −6.5+5.7·level（§3.5，atmosphere.ts 同值单源）
const COL_BASE = -8.4;                 // 柱基 y（islands.ts 同值——卡箍高度=柱基+柱高复算）

/** 摆动链节：静态参数 + 缓存摆位（y/zOff 只在轮写桶内重算；z 每帧推进回收） */
interface SwingDef {
  x: number; y: number; z: number; rx: number; rz: number; sx: number; sy: number; sz: number;
  y0: number; depth: number; per: number; ph: number; amp: number; zOff: number;
}
interface CrystalDef { x: number; y: number; z: number; rx: number; rz: number; sx: number; sy: number; ph: number }
const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(0, 0, 0, 'YXZ');
const V = new THREE.Vector3(), S = new THREE.Vector3(), TC = new THREE.Color();
/** 自管 compose（零分配，非均匀缩放：链节转姿 / 晶柱细长 / 卡箍热颤 sy） */
function put(mesh: THREE.InstancedMesh, i: number, x: number, y: number, z: number, rx: number, rz: number, sx: number, sy: number, sz: number) {
  E.set(rx, 0, rz); Q.setFromEuler(E);
  V.set(x, y, z); S.set(sx, sy, sz);
  M.compose(V, Q, S);
  mesh.setMatrixAt(i, M);
}

export function createProps(scene: THREE.Scene) {
  const insts: Inst[] = [];
  // ---- 断链吊桥 ×6（i=1/4 半塌：+x 端垂入岩浆）：桥面缺板 + 双吊链 + 垂端熔滴
  const planks: Placement[] = [], linkDefs: SwingDef[] = [], drips: Placement[] = [];
  for (let i = 0; i < 6; i++) {
    const z = -30 - i * 37, half = 5.5 + (i % 2) * 1;               // 跨 11~13m
    const droop = i % 3 === 1;
    for (const oz of [-2.7, 0, 2.7]) for (let j = 0; j < 7; j++) {  // 板 2.2(z)×0.5(x) 三道梯线
      const x = -half + 0.75 + j * 1.5;
      if (rnd(i * 21 + j * 3 + oz + 4, 91) < 0.12) continue;        // 缺板率 12%（缺口≈1.5m 步距）
      const tt = droop && x > 0 ? x / half : 0;                     // 半塌：+x 半段下垂
      planks.push({ x, y: 0.1 - tt * tt * 2.2, z: z + oz, s: 1, ry: 0, rz: -tt * 0.85 });
    }
    insts.push(addInst(scene, new THREE.BoxGeometry(1.1, 1.6, 1.1), std(P.basalt),
      [{ x: -3.9, y: 0.8, z, s: 1, ry: 0 }, { x: 3.9, y: 0.8, z, s: 1, ry: 0 }])); // 桥塔锚墩（路缘固定带）
    for (const lz of [-3.5, 3.5]) {                                  // 吊链 ×2
      const n = Math.floor(half * 2 / 0.55);
      for (let k = 0; k <= n; k++) {
        const f = k / n, x = -half + f * half * 2;
        const sag = 0.55 * 4 * f * (1 - f), tt = droop && x > 0 ? x / half : 0;
        const y0 = 1.75 - sag - tt * tt * 2.8;                       // 半塌侧链随桥面下垂弧
        linkDefs.push({
          x, y: y0, z: z + lz, rx: (k % 2) * Math.PI / 2, rz: 0, sx: 1, sy: 1, sz: 1,
          y0, depth: 1.75 - y0, per: 4, ph: i * 1.7, amp: 0.021, zOff: 0, // ±1.2°/4s，相邻桥相位错开
        });
      }
      if (droop) drips.push({ x: half + 0.2, y: -1.75, z: z + lz, s: 1, ry: 0 }); // 垂端凝固熔滴
    }
  }
  insts.push(addInst(scene, new THREE.BoxGeometry(0.52, 0.09, 2.2), std(P.basalt), planks));
  const linkMesh = new THREE.InstancedMesh(new THREE.TorusGeometry(0.15, 0.05, 6, 8), std(P.bronze), linkDefs.length);
  linkMesh.frustumCulled = false;
  scene.add(linkMesh);

  // ---- 引藤链 ×8（i=2/6 熔断，只存半程链节=断头垂弧）：桅杆锚点 + 跨路悬链 + 每 4m 吊钩
  const masts: Placement[] = [], bolts: Placement[] = [], vineDefs: SwingDef[] = [], hookDefs: SwingDef[] = [];
  for (let i = 0; i < 8; i++) {
    const z = -22 - i * 28, cut = i === 2 || i === 6;
    const ax = -(11.5 + rnd(i, 161) * 2), bx = 11.5 + rnd(i, 163) * 2, ay = 9 + rnd(i, 165) * 2.5;
    const sagM = 3.2 + rnd(i, 167) * 0.8, per = 6 + rnd(i, 169) * 2, ph = rnd(i, 171) * 6.283;
    for (const px of [ax, bx]) {
      masts.push({ x: px, y: -2 + ((ay + 2) / 12) * 6, z, s: (ay + 2) / 12, ry: 0 }); // 杆基在岩浆带 y−2
      bolts.push({ x: px, y: ay, z, s: 1, ry: 0 });
    }
    const span = bx - ax, n = Math.floor(span / (cut ? 1.7 : 0.85));
    for (let k = 0; k <= n; k++) {
      const f = (k / n) * (cut ? 0.5 : 1), x = ax + f * span;
      const y0 = ay - sagM * 4 * f * (1 - f) - (cut && f > 0.3 ? (f - 0.3) * 9 : 0);
      const def: SwingDef = {
        x, y: y0, z, rx: (k % 2) * Math.PI / 2, rz: 0, sx: 1, sy: 1, sz: 1,
        y0, depth: ay - y0, per, ph, amp: 0.14, zOff: 0,              // 整链缓摆 ±8°
      };
      vineDefs.push(def);
      if (cut && k === n) drips.push({ x, y: y0 - 0.35, z, s: 1, ry: 0 }); // 断头垂弧挂熔滴
      if (!cut && k > 0 && k % 5 === 0)                              // 每 ~4m（0.85×5≈4.25m）一只吊钩
        hookDefs.push({ ...def, y: y0 - 0.5, y0: y0 - 0.5, depth: ay - y0 + 0.5 });
    }
  }
  const vineMesh = new THREE.InstancedMesh(new THREE.TorusGeometry(0.2, 0.06, 6, 8), std(P.bronze), vineDefs.length);
  const hookGeo = mergeGeometries([
    new THREE.TorusGeometry(0.16, 0.05, 6, 8),
    new THREE.CylinderGeometry(0.045, 0.02, 0.5, 5).translate(0, -0.3, 0),
  ]);
  const hookMesh = new THREE.InstancedMesh(hookGeo, std(P.bronze), hookDefs.length);
  vineMesh.frustumCulled = false; hookMesh.frustumCulled = false;
  scene.add(vineMesh); scene.add(hookMesh);
  const dripGeo = new THREE.ConeGeometry(0.24, 0.55, 6); dripGeo.rotateX(Math.PI);
  insts.push(addInst(scene, dripGeo, std(P.sinter), drips)); // 熔滴=凝固熔渣：热但死烧结赤（§2 纪律）
  insts.push(addInst(scene, new THREE.CylinderGeometry(0.3, 0.42, 12, 7).translate(0, 6, 0), std(P.basalt), masts));
  insts.push(addInst(scene, new THREE.TorusGeometry(0.22, 0.06, 6, 10), std(P.bronze), bolts));

  // ---- 焰髓晶簇 ×24：座在渣滩阶地缘（整组 y 随潮位 mesh 级），呼吸走 instanceColor
  const crystals: CrystalDef[] = [], seats: Placement[] = [];
  for (let k = 0; k < 24; k++) {
    const side = k % 2 === 0 ? -1 : 1;
    const z = -9 - k * 9.7 + (rnd(k, 201) - 0.5) * 4, x = side * (6 + rnd(k, 203) * 4.2);
    const st = rnd(k, 205), n = st < 0.5 ? 4 + Math.floor(rnd(k, 207) * 2) : st < 0.8 ? 2 + Math.floor(rnd(k, 207) * 2) : 0;
    seats.push({ x, y: 0.02, z, s: 1, ry: rnd(k, 209) * 6.283 });
    for (let j = 0; j < n; j++) { // 晶柱长 0.4~1.1m 径 0.08~0.16m，斜生方位随机
      const ci = k * 5 + j, a = rnd(ci, 211) * 6.283, tilt = 0.3 + rnd(ci, 213) * 0.45;
      crystals.push({
        x: x + Math.cos(a) * 0.14, y: 0.12, z: z + Math.sin(a) * 0.14,
        rx: Math.sin(a) * tilt, rz: Math.cos(a) * tilt,
        sx: 0.04 + rnd(ci, 215) * 0.04, sy: 0.4 + rnd(ci, 217) * 0.7, ph: rnd(k, 219) * 6.283,
      });
    }
  }
  const crystalGeo = new THREE.CylinderGeometry(1, 1, 1, 6); crystalGeo.translate(0, 0.5, 0); // 底在原点斜生
  const crystalMat = new THREE.MeshBasicMaterial({ color: P.ember }); applyWorldBend(crystalMat); // 活火唯一发光色
  const crystalMesh = new THREE.InstancedMesh(crystalGeo, crystalMat, crystals.length);
  crystalMesh.frustumCulled = false;
  scene.add(crystalMesh);
  const seatInst = addInst(scene, new THREE.BoxGeometry(0.5, 0.22, 0.5), std(P.basalt), seats);

  // ---- 渣斗车残阵 ×8 + 铸运线双轨（轨沿 z 均匀 240m，不需逐段回收）
  const cartGeo = new THREE.BoxGeometry(1.4, 1.0, 2.2); cartGeo.translate(0, 0.5, 0);
  const domeGeo = new THREE.SphereGeometry(0.62, 8, 6); domeGeo.scale(1, 0.5, 1); domeGeo.translate(0, 0.95, 0);
  const carts: Placement[] = [], domes: Placement[] = [], spills: Placement[] = [], wheels: Placement[] = [];
  for (let i = 0; i < 8; i++) {
    const z = -12 - i * 28.5 + (rnd(i, 221) - 0.5) * 6, x = -(5.6 + rnd(i, 223) * 1.2); // 左侧轨床
    const st = i % 3;                                               // 完整 3 / 破斗 3 / 熔粘 2
    const rz = st === 0 ? -0.32 : st === 1 ? -0.55 : -0.12, sink = st === 2 ? 0.18 : 0;
    carts.push({ x, y: 0.02 + sink, z, s: 1, ry: rnd(i, 225) * 0.3, rz });
    domes.push({ x, y: 0.02 + sink, z, s: st === 2 ? 1.25 : 1, ry: 0, rz });
    if (st === 1) spills.push({ x: x + 1.3, y: 0.16, z: z + 0.6, s: 1, ry: 0 }); // 破斗洒渣
    for (const wx of [-0.62, 0.62]) for (const wz of [-0.8, 0.8])
      wheels.push({ x: x + wx, y: 0.4, z: z + wz + (rnd(i * 4 + wx + wz + 4, 227) - 0.5) * 0.5, s: 1, ry: 0, rz: rnd(i * 4 + wx, 229) < 0.3 ? 0.35 : 0 });
  }
  insts.push(addInst(scene, cartGeo, std(P.bronze), carts));
  insts.push(addInst(scene, domeGeo, std(P.slag), domes));
  insts.push(addInst(scene, new THREE.SphereGeometry(0.5, 8, 6), std(P.slag), spills));
  const wheelGeo = new THREE.CylinderGeometry(0.4, 0.4, 0.16, 10); wheelGeo.rotateZ(Math.PI / 2);
  insts.push(addInst(scene, wheelGeo, std(P.basalt), wheels));
  const railA = new THREE.BoxGeometry(0.09, 0.1, 240); railA.translate(-5.0, 0.07, -108);
  const railB = new THREE.BoxGeometry(0.09, 0.1, 240); railB.translate(-5.9, 0.07, -108);
  scene.add(new THREE.Mesh(mergeGeometries([railA, railB]), std(P.bronze))); // 铸运线双轨：沿 z 均匀 240m，单 mesh 免回收

  // ---- 铜卡箍环 ×12：簇位公式与 salts 同 islands.ts 蜂巢柱阵逐字复算（落位即柱位）
  const clampUp: (SwingDef & { ph: number })[] = [], clampDro: (SwingDef & { ph: number })[] = [];
  for (let c = 0; c < 12; c++) {
    const side = c % 2 === 0 ? -1 : 1;
    const cz = -16 - c * 19.5 + (rnd(c, 71) - 0.5) * 6, cx = side * (12.5 + rnd(c, 73) * 5);
    const n = 4 + Math.floor(rnd(c, 77) * 3);
    for (let k = 0; k < n && clampUp.length + clampDro.length < 12; k++) { // ×12 硬上限（§10 预算）
      const i = c * 6 + k, st = rnd(i, 89), full = 6 + rnd(i, 91) * 12;
      if (st >= 0.4 || full < 11) continue;                          // 只箍全高 ≥11m 锻火柱：箍位 y=柱基+0.72h ≥ −0.48 恒高于高潮岩浆面（§4.3 水线读法；seed 校准恰 12 候选=7 正+5 垂）
      const ang = (k / 6) * 6.283 + rnd(i, 79) * 0.7, rr = 1.1 + rnd(i, 83) * 1.3;
      const ci = clampUp.length + clampDro.length;
      const def: SwingDef & { ph: number } = {
        x: cx + Math.cos(ang) * rr, y: COL_BASE + full * 0.72, z: cz + Math.sin(ang) * rr * 0.8,
        rx: 0, rz: 0, sx: 0.8 + rnd(i, 97) * 0.5, sy: 1, sz: 0.8 + rnd(i, 97) * 0.5,
        y0: COL_BASE + full * 0.72, depth: 0, per: 4, ph: rnd(ci, 181) * 6.283, amp: 0, zOff: 0,
      };
      (ci < 7 ? clampUp : clampDro).push(def);                       // 端正 7 / 熔垂 5
    }
  }
  // 双瓣环直接在终系（环面水平、环孔套竖柱）拼装：上/下半弧 + 接缝螺栓耳；
  // 熔垂瓣在终系向下拉长 20~35% + 泪滴垂瘤锥（先旋转后变形，避免「下垂」被旋转成水平）
  const halfU = new THREE.TorusGeometry(1.0, 0.09, 6, 12, 3.14).rotateX(Math.PI / 2); // 终系 z>0 半弧
  const halfD = new THREE.TorusGeometry(1.0, 0.09, 6, 12, 3.14).rotateZ(Math.PI).rotateX(Math.PI / 2); // z<0 半弧
  const earA = new THREE.BoxGeometry(0.16, 0.1, 0.3); earA.translate(1.08, 0, 0);
  const earB = new THREE.BoxGeometry(0.16, 0.1, 0.3); earB.translate(-1.08, 0, 0);
  const clampGeo = mergeGeometries([halfU, halfD, earA, earB]);
  const droopLow = halfD.clone().scale(1, 1.3, 1).translate(0, -0.12, 0);    // 下瓣拉长 20~35%
  const droopCone = new THREE.ConeGeometry(0.3, 0.5, 6); droopCone.rotateX(Math.PI); droopCone.translate(0, -1.38, 0);
  const droopGeo = mergeGeometries([halfU.clone(), droopLow, droopCone]);
  const clampMesh = new THREE.InstancedMesh(clampGeo, std(P.bronze), clampUp.length);
  const droopMesh = new THREE.InstancedMesh(droopGeo, std(P.bronze), clampDro.length);
  clampMesh.frustumCulled = false; droopMesh.frustumCulled = false;
  scene.add(clampMesh); scene.add(droopMesh);

  const rollLinks = (mesh: THREE.InstancedMesh, defs: SwingDef[], move: number, bucket: number) => {
    for (let i = 0; i < defs.length; i++) {
      const d = defs[i]!; d.z += move; d.z -= Math.ceil((d.z - WRAP_Z) / LOOP) * LOOP;
      if ((i & 3) === bucket) {                                     // 4 帧轮写桶内才重算摆位（§4.0 纪律 5）
        const ang = Math.sin((t0 * Math.PI * 2) / d.per + d.ph) * d.amp;
        d.y = d.y0 - d.depth * (1 - Math.cos(ang));
        d.zOff = -d.depth * Math.sin(ang);
      }
      put(mesh, i, d.x, d.y, d.z + d.zOff, d.rx, d.rz, d.sx, d.sy, d.sz);
    }
    mesh.instanceMatrix.needsUpdate = true;
  };
  const rollClamps = (mesh: THREE.InstancedMesh, defs: (SwingDef & { ph: number })[], move: number, bucket: number, hot: number) => {
    for (let i = 0; i < defs.length; i++) {
      const d = defs[i]!; d.z += move; d.z -= Math.ceil((d.z - WRAP_Z) / LOOP) * LOOP;
      if ((i & 3) === bucket) d.sy = hot > 0.6 ? 1 + Math.sin(t0 * 9.4248 + d.ph) * 0.005 : 1; // 热胀微颤 scaleY ±0.5% @1.5Hz（§4.3 门控）
      put(mesh, i, d.x, d.y, d.z, d.rx, d.rz, d.sx, d.sy, d.sz);
    }
    mesh.instanceMatrix.needsUpdate = true;
  };

  let distAcc = 0, t0 = 0, frameAcc = 0;
  return {
    update(move: number, t: number) {
      t0 = t;
      distAcc += move;                                        // §3.1 取数口径：模块内自累积
      const lvl = level(distAcc), bucket = frameAcc++ & 3;
      const lavaY = LAVA_Y0 + LAVA_RISE * lvl;
      seatInst.mesh.position.y = lavaY;                       // 晶座/晶柱整组随渣滩阶地（§4.5 同源）
      crystalMesh.position.y = lavaY;
      for (let i = 0; i < crystals.length; i++) {             // 呼吸 0.3Hz 相位错开 + 退潮 +20%
        const d = crystals[i]!;
        d.z += move; d.z -= Math.ceil((d.z - WRAP_Z) / LOOP) * LOOP;
        const b = (0.7 + 0.3 * (0.5 + 0.5 * Math.sin(t * 1.885 + d.ph))) * (lvl < 0.3 ? 1.2 : 1);
        TC.setRGB(b, b, b);
        crystalMesh.setColorAt(i, TC);
        put(crystalMesh, i, d.x, d.y, d.z, d.rx, d.rz, d.sx, d.sy, d.sx);
      }
      crystalMesh.instanceMatrix.needsUpdate = true;
      if (crystalMesh.instanceColor) crystalMesh.instanceColor.needsUpdate = true;
      rollLinks(linkMesh, linkDefs, move, bucket);            // 吊桥链晃
      rollLinks(vineMesh, vineDefs, move, bucket);            // 引藤整链缓摆
      rollLinks(hookMesh, hookDefs, move, bucket);            // 吊钩随链
      rollClamps(clampMesh, clampUp, move, bucket, lvl);      // 卡箍热胀微颤（涨潮段激活）
      rollClamps(droopMesh, clampDro, move, bucket, lvl);
      for (const inst of insts) {
        for (const p of inst.items) { p.z += move; p.z -= Math.ceil((p.z - WRAP_Z) / LOOP) * LOOP; }
        writeAll(inst);
      }
    },
  };
}
