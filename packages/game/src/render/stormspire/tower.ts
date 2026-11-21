/**
 * 天穹雷脊 · 雷脊塔（自 landmarks.ts 拆出：300 行红线机械重构，纯剪切搬家，零行为变化）：
 *   八角收分塔身 ×2（两侧错 z）+ 塔顶劈断残茬 + 竖向熔金灼痕（闪电路径）+ 三道残缺阳台环；
 *   细节层：8 角凹槽棱线（随收分内倾）、3 层窗/铭文龛带、阳台栏杆柱、塔基碎砖；
 *   锚缆 ×6：塔身斜拉下探，每帧 compose 做微风摆（rz 基础角 ±0.03 sin，相位互错），
 *   塔端铜绿套环箍缆；塔顶信标（悬浮金八面体 + 光晕壳，公转 + 呼吸）；
 *   悬浮塔尖碎块 3 片（绕塔顶公转 + 自旋）与塔基碎砖 4 块/塔（同几何同网格省一条 draw call）。
 * 贴壁定位全靠 surfR（八角塔身某方位角的贴壁半径）；塔件自己的 LOOP/WRAP_Z 静态回收、
 * zShift 回收与 fragBase/compose 助手自含。环/摆链/风车/结晶仍在 landmarks.ts；
 * createLandmarks 先建塔再建其余，网格/材质创建顺序与拆分前一致。
 */
import * as THREE from 'three';
import { LOOP, WRAP_Z, addInst, rnd, std, writeAll, type Inst, type Placement } from '../sceneryProps.js';
import { P } from './palette.js';

const gold = () => new THREE.MeshBasicMaterial({ color: P.gold });

export function createTower(scene: THREE.Scene) {
  const insts: Inst[] = [];

  // ---- 雷脊塔 ×2（错 z 循环）----
  const towerAt: Placement[] = [
    { x: -30, y: -6, z: -70, s: 1, ry: 0.4 },
    { x: 32, y: -6, z: -185, s: 1.12, ry: 0.9 },
  ];
  const TOWER_H = 58;
  insts.push(addInst(scene, new THREE.CylinderGeometry(2.4, 6.5, TOWER_H, 8), std(P.stone),
    towerAt.map(p => ({ ...p, y: p.y + (TOWER_H / 2) * p.s }))));
  // 塔身凹槽读法：叠一圈略瘦的深色八角柱当竖槽阴影
  insts.push(addInst(scene, new THREE.CylinderGeometry(2.1, 5.6, TOWER_H * 0.96, 8), std(P.stoneDark),
    towerAt.map(p => ({ ...p, y: p.y + (TOWER_H / 2) * p.s, s: p.s }))));
  // 劈断残茬：顶部三块参差斜切柱
  insts.push(addInst(scene, new THREE.CylinderGeometry(1.1, 2.2, 3.2, 8), std(P.stoneDark),
    towerAt.flatMap(p => [
      { ...p, x: p.x + 0.8 * p.s, y: p.y + (TOWER_H + 1.2) * p.s, s: p.s, rz: 0.14 },
      { ...p, x: p.x - 1.0 * p.s, y: p.y + (TOWER_H + 0.6) * p.s, s: p.s * 0.8, rz: -0.2 },
    ])));
  // 灼痕：塔身竖向熔金纹（闪电路径），每塔四条、随高度收进
  insts.push(addInst(scene, new THREE.BoxGeometry(0.26, TOWER_H * 0.8, 0.26), gold(),
    towerAt.flatMap((p, ti) => [0.9, 2.3, 3.9, 5.2].map(a => ({
      ...p,
      x: p.x + Math.cos(a + ti) * (3.4 - (TOWER_H * 0.12) * 0.04) * p.s,
      z: p.z + Math.sin(a + ti) * 3.4 * p.s,
      y: p.y + TOWER_H * 0.45 * p.s, s: 1, ry: 0,
    })))));
  // 外挑阳台残环 ×3（半径逐级收小、始终探出塔身）：缺口感 = 开口圆筒
  for (const [k, r] of [[0.3, 5.9], [0.55, 4.8], [0.8, 3.7]] as const) {
    insts.push(addInst(scene, new THREE.CylinderGeometry(r, r, 0.6, 8, 1, true), std(P.stoneDark),
      towerAt.map(p => ({ ...p, y: p.y + TOWER_H * k * p.s, s: p.s }))));
  }
  // 八角塔身在某方位角的贴壁半径：顶点=r、侧面中线=r·cos(π/8)（棱线/龛/柱/套环贴壁定位全靠它）
  const surfR = (ry: number, az: number, r: number) => {
    let d = (az - ry - Math.PI / 8) % (Math.PI / 4);
    if (d < 0) d += Math.PI / 4;
    if (d > Math.PI / 8) d -= Math.PI / 4;
    return (r * Math.cos(Math.PI / 8)) / Math.cos(d);
  };
  // 8 角竖向凹槽棱线：深色细条贴顶点线，rx = 收分坡度角（顶随塔身内收，不悬空）
  const taper = Math.atan((6.5 - 2.4) / TOWER_H);
  insts.push(addInst(scene, new THREE.BoxGeometry(0.34, TOWER_H + 0.5, 0.34), std(P.stoneDark),
    towerAt.flatMap(p => [0, 1, 2, 3, 4, 5, 6, 7].map(k => {
      const a = p.ry + (k * Math.PI) / 4, rMid = 4.45; // 半程半径 = (底6.5+顶2.4)/2
      return {
        x: p.x + Math.sin(a) * rMid * p.s, y: p.y + (TOWER_H / 2) * p.s, z: p.z + Math.cos(a) * rMid * p.s,
        s: p.s, ry: a, rx: -taper,
      };
    }))));
  // 3 层窗/铭文龛带：每层 8 龛贴八角侧面中线，盒心内收 0.04 让龛口凸出壁面 0.03（读作内凹不穿模）
  insts.push(addInst(scene, new THREE.BoxGeometry(0.3, 0.7, 0.14), std(P.stoneDark),
    towerAt.flatMap((p, ti) => [0.18, 0.42, 0.68].flatMap((hk, li) =>
      [0, 1, 2, 3, 4, 5, 6, 7].map(k => {
        const a = p.ry + Math.PI / 8 + (k * Math.PI) / 4;
        const rr = surfR(p.ry, a, 6.5 - 4.1 * hk) - 0.04;
        return {
          x: p.x + Math.sin(a) * rr * p.s, y: p.y + TOWER_H * hk * p.s, z: p.z + Math.cos(a) * rr * p.s,
          s: p.s * (0.8 + rnd(k + li * 8 + ti * 16, 121) * 0.4), ry: a,
        };
      })))));
  // 阳台栏杆柱：每环外缘一圈 10 根，高度参差读作残损
  insts.push(addInst(scene, new THREE.CylinderGeometry(0.05, 0.065, 0.8, 5), std(P.stoneDark),
    towerAt.flatMap((p, ti) => [[0.3, 5.9], [0.55, 4.8], [0.8, 3.7]].flatMap(([hk, r], li) =>
      Array.from({ length: 10 }, (_, j) => {
        const a = p.ry + (j * Math.PI) / 5 + li * 0.31, rr = surfR(p.ry, a, r);
        return {
          x: p.x + Math.sin(a) * rr * p.s, y: p.y + (TOWER_H * hk + 0.7) * p.s, z: p.z + Math.cos(a) * rr * p.s,
          s: p.s * (0.85 + rnd(j + li * 10 + ti * 20, 131) * 0.3), ry: a,
        };
      })))));
  // 锚缆 ×6：从塔身上段沿方位斜拉下探（原静态版没转角且锚点埋在塔身里，改每帧 compose 修形）
  const cableGeo = new THREE.BoxGeometry(0.09, 30, 0.09);
  const CABLE_TILT = 0.62;
  const cableDef = towerAt.flatMap((p, ti) => [0.4, 2.5, 4.4].map((a, k) => {
    const ryC = a + ti * 0.7, az = Math.PI / 2 + ryC; // 缆的水平方位与斜拉方向一致
    const rSurf = surfR(p.ry, az, 6.5 - 4.1 * 0.8);
    const ax = p.x + Math.sin(az) * rSurf * p.s, ay = p.y + TOWER_H * 0.8 * p.s, azr = p.z + Math.cos(az) * rSurf * p.s;
    return {
      // 中心 = 塔端锚点沿下垂方向走半长
      x: ax + Math.cos(ryC) * Math.sin(CABLE_TILT) * 15 * p.s,
      y: ay - Math.cos(CABLE_TILT) * 15 * p.s,
      z: azr - Math.sin(ryC) * Math.sin(CABLE_TILT) * 15 * p.s,
      ry: ryC, s: p.s, ph: rnd(ti * 3 + k, 81) * 6.283,
    };
  }));
  const cables = new THREE.InstancedMesh(cableGeo, std(P.stoneDark), cableDef.length);
  scene.add(cables);
  // 塔端铜绿套环：贴塔壁箍住缆端（静态，缆在环内微风摆）
  insts.push(addInst(scene, new THREE.TorusGeometry(0.17, 0.055, 6, 10), std(P.verdigris),
    towerAt.flatMap((p, ti) => [0.4, 2.5, 4.4].map(a => {
      const ryC = a + ti * 0.7, az = Math.PI / 2 + ryC;
      const rr = surfR(p.ry, az, 6.5 - 4.1 * 0.8) + 0.06;
      return {
        x: p.x + Math.sin(az) * rr * p.s, y: p.y + TOWER_H * 0.8 * p.s, z: p.z + Math.cos(az) * rr * p.s,
        s: p.s, ry: ryC - Math.PI / 2, rx: CABLE_TILT - Math.PI / 2, // 环孔对准缆轴（rx 让孔随缆倾斜）
      };
    }))));
  // 塔顶信标：断茬上方悬浮金八面体 + 光晕壳（动画件，update 里公转）
  const beaconGeo = new THREE.OctahedronGeometry(0.9, 0), beaconShell = new THREE.OctahedronGeometry(1.5, 0);
  const beacons = new THREE.InstancedMesh(beaconGeo, gold(), towerAt.length);
  const beaconGlows = new THREE.InstancedMesh(beaconShell,
    new THREE.MeshBasicMaterial({ color: P.gold, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending }), towerAt.length);
  scene.add(beacons); scene.add(beaconGlows);

  // 悬浮塔尖碎块：3 片绕塔顶公转 + 4 块塔基碎砖（同几何同网格省一条 draw call）
  const fragGeo = new THREE.TetrahedronGeometry(1.4, 0);
  const fragMat = std(P.stone);
  const frags = new THREE.InstancedMesh(fragGeo, fragMat, towerAt.length * (3 + 4));
  scene.add(frags);
  const fragBase = towerAt.map(p => ({ x: p.x, y: p.y + (TOWER_H + 3.5) * p.s, z: p.z, s: p.s }));
  const rubbleBase = towerAt.map(p => ({ x: p.x, y: p.y, z: p.z, s: p.s }));

  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), V = new THREE.Vector3(), S = new THREE.Vector3();
  const compose = (mesh: THREE.InstancedMesh, i: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, s = 1) => {
    E.set(rx, ry, rz, 'YXZ'); Q.setFromEuler(E);
    V.set(x, y, z); S.set(s, s, s);
    M.compose(V, Q, S);
    mesh.setMatrixAt(i, M);
  };

  return {
    update(move: number, t: number) {
      // 静态件回收（塔件自己的 LOOP/WRAP_Z 循环）
      for (const inst of insts) {
        for (const p of inst.items) {
          p.z += move;
          if (p.z > WRAP_Z) p.z -= LOOP;
        }
        writeAll(inst);
      }
      const zShift = (z: number) => { const nz = z + move; return nz > WRAP_Z ? nz - LOOP : nz; };
      // 塔尖碎块：公转 + 自旋
      for (let ti = 0; ti < fragBase.length; ti++) {
        const fb = fragBase[ti], fz = zShift(fb.z);
        for (let k = 0; k < 3; k++) {
          const a = t * 0.22 + ti * 2.1 + k * 2.09;
          compose(frags, ti * 3 + k,
            fb.x + Math.cos(a) * 3.2 * fb.s, fb.y + Math.sin(t * 0.4 + k) * 0.5, fz + Math.sin(a) * 3.2 * fb.s,
            t * 0.3 + k, a, 0, fb.s * (0.8 + k * 0.25));
        }
      }
      // 塔基碎砖堆：每塔 4 块歪斜石块散在塔脚（静态姿，只随世界回收）
      for (let ti = 0; ti < rubbleBase.length; ti++) {
        const rb = rubbleBase[ti];
        for (let k = 0; k < 4; k++) {
          const ri = ti * 4 + k, a = rnd(ri, 301) * 6.283, rr = 6.8 + rnd(ri, 303) * 2.8;
          compose(frags, fragBase.length * 3 + ri,
            rb.x + Math.sin(a) * rr * rb.s, rb.y + 0.9 + rnd(ri, 305) * 1.5, zShift(rb.z) + Math.cos(a) * rr * rb.s,
            rnd(ri, 307) - 0.5, a + rnd(ri, 309) * 2.0, rnd(ri, 311) - 0.5,
            rb.s * (0.34 + rnd(ri, 313) * 0.3));
        }
      }
      frags.instanceMatrix.needsUpdate = true;
      // 锚缆：基础斜拉角 + 轻微风摆（rz ±0.03 sin，相位互错；塔端套环静止所以不脱箍）
      for (let ci = 0; ci < cableDef.length; ci++) {
        const cd = cableDef[ci];
        compose(cables, ci, cd.x, cd.y, zShift(cd.z), 0, cd.ry,
          -CABLE_TILT + Math.sin(t * 0.9 + cd.ph) * 0.03, cd.s);
      }
      cables.instanceMatrix.needsUpdate = true;
      // 塔顶信标：缓慢公转 + 呼吸
      for (let ti = 0; ti < fragBase.length; ti++) {
        const fb = fragBase[ti];
        const by = fb.y + 3.2 + Math.sin(t * 1.1 + ti * 2) * 0.4;
        const bx = fb.x + Math.cos(t * 0.5 + ti * 2) * 1.2;
        const bz = zShift(fb.z) + Math.sin(t * 0.5 + ti * 2) * 1.2;
        compose(beacons, ti, bx, by, bz, t * 0.6, t * 0.4);
        compose(beaconGlows, ti, bx, by, bz);
      }
      beacons.instanceMatrix.needsUpdate = true;
      beaconGlows.instanceMatrix.needsUpdate = true;
    },
  };
}
