/**
 * 天穹雷脊 · 主地标（docs/stormspire-brief.md §4.1/4.4/4.7）：
 *   rings   导雷铜环 ×6：横跨跑道上空（外径 5.2m），铜绿环体 + 内缘熔金发光缝（1±0.06 脉动），
 *           绕主轴慢自转，歪斜两枚；每环悬吊细缆 ×2 向上出画 + 环缘电弧火花
 *           （4~9s 确定性相位，2~3 帧生命，池 ×6）；Phase A 纯装饰（穿环计分是 Phase B）；
 *   chains  近景摆链 ×6：路缘上空的悬链荡锤（呼应 sim 的 obs_pendulum），
 *           单摆 ±0.6rad 相位互错，链节横竖交替 + 锤头磨损痕；
 *   mills   风车残骸 ×3：1 号断一叶，断口截面加深色端盖。
 * 雷脊塔（塔身/残茬/灼痕/阳台/锚缆/信标/碎块及其动画）拆在同目录 tower.ts（300 行红线
 * 机械拆分，逐字搬家）：createLandmarks 先建塔再建其余，网格/材质创建顺序与拆分前一致；
 * 每帧 update 先走 tower.update（塔件自含 LOOP/WRAP_Z 回收与 zShift/compose 助手）。
 * 每帧重写动画件矩阵（数量小），其余静态；不读 sim。
 */
import * as THREE from 'three';
import { LOOP, WRAP_Z, addInst, rnd, std, writeAll, type Inst } from '../sceneryProps.js';
import { P } from './palette.js';
import { createTower } from './tower.js';

const gold = () => new THREE.MeshBasicMaterial({ color: P.gold });

export function createLandmarks(scene: THREE.Scene) {
  const insts: Inst[] = [];

  // ---- 雷脊塔 ×2 拆到 tower.ts（createTower）：先建塔再建其余，网格/材质创建顺序不变 ----
  const tower = createTower(scene);

  // ---- 导雷铜环 ×6（横跨路上空，动画件：慢自转）----
  const ringGeo = new THREE.TorusGeometry(2.6, 0.2, 8, 28);
  const seamGeo = new THREE.TorusGeometry(2.42, 0.07, 6, 28); // 内缘半径：2.6 会整条埋进环管看不见
  const RINGS = 6;
  const ringBody = new THREE.InstancedMesh(ringGeo, std(P.verdigris), RINGS);
  const ringSeam = new THREE.InstancedMesh(seamGeo, gold(), RINGS);
  scene.add(ringBody); scene.add(ringSeam);
  const ringDef = Array.from({ length: RINGS }, (_, i) => {
    const per = 4 + rnd(i, 91) * 5; // 电弧火花周期 4~9s
    return {
      x: (i % 2 === 0 ? -1 : 1) * (rnd(i, 61) - 0.5) * 1.6,
      // 环心抬到地面相机带外（|y−2.7|>3，二分定位 2026-11-11）：旧 y 3.4~5.4 时环底弧
      // 下探到 0.6m，玩家每 38m 穿环一次、环管贴近相机扫过画面成整屏 ~30° 斜板穿帮
      y: 6.1 + rnd(i, 63) * 0.9,
      z: -24 - i * 38 - rnd(i, 65) * 10,
      tilt: i < 4 ? 0 : 0.42 * (i % 2 === 0 ? 1 : -1), // 后两枚歪斜，更难穿（Phase B 计分）
      spin: 0.18 + rnd(i, 67) * 0.14,
      per,
      off: rnd(i, 93) * per, // 首闪相位错开
    };
  });
  // 每环两根悬吊细缆：从环顶向上出画（底端探进环管，歪斜环也搭得上）
  insts.push(addInst(scene, new THREE.BoxGeometry(0.05, 8, 0.05), std(P.stoneDark),
    ringDef.flatMap(r => [-1, 1].map(sx => ({
      x: r.x + sx * 0.5, y: r.y + 6.15, z: r.z, s: 1, ry: 0, rx: 0, rz: sx * 0.06,
    })))));
  // 电弧火花池 ×6：每环一枚槽位，命中窗 0.07s≈2~3 帧
  const sparks = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.16, 0), gold(), RINGS);
  scene.add(sparks);

  // ---- 近景摆链 ×6（路缘上空，动画件：单摆）----
  const CHAINS = 6, LINKS = 7;
  const linkGeo = new THREE.TorusGeometry(0.26, 0.08, 6, 10);
  const links = new THREE.InstancedMesh(linkGeo, std(P.stoneDark), CHAINS * LINKS);
  const weights = new THREE.InstancedMesh(new THREE.SphereGeometry(0.42, 8, 6), std(P.verdigris), CHAINS);
  const anchors = new THREE.InstancedMesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), std(P.stoneDark), CHAINS);
  // 锤头磨损痕：stoneDark 细环箍住锤身（垂直链轴，随摆同倾）
  const wears = new THREE.InstancedMesh(new THREE.TorusGeometry(0.43, 0.035, 5, 14), std(P.stoneDark), CHAINS);
  scene.add(links); scene.add(weights); scene.add(anchors); scene.add(wears);
  const chainDef = Array.from({ length: CHAINS }, (_, i) => ({
    x: (i % 2 === 0 ? -1 : 1) * 5.2,
    y: 5.4 + rnd(i, 71) * 1.4,
    z: -36 - i * 38 - rnd(i, 73) * 8,
    ph: rnd(i, 75) * 6.283,
  }));
  insts.push({ mesh: anchors, items: chainDef.map(c => ({ x: c.x, y: c.y, z: c.z, s: 1, ry: 0 })) });

  // ---- 风车残骸 ×3（贴路 |x|8~10，叶片自转；两顺一逆）----
  const WINDMILLS = 3;
  const windDef = [
    { x: -8.6, z: -64, w: 0.9, s: 1 },
    { x: 9.4, z: -128, w: -0.62, s: 1.15 },
    { x: -9.8, z: -196, w: 0.72, s: 0.92 },
  ];
  insts.push(addInst(scene, new THREE.CylinderGeometry(0.14, 0.3, 7.2, 6), std(P.stoneDark),
    windDef.map(p => ({ x: p.x, y: 3.6 * p.s, z: p.z, s: p.s, ry: 0 }))));
  insts.push(addInst(scene, new THREE.CylinderGeometry(0.3, 0.3, 0.5, 8), std(P.verdigris),
    windDef.map(p => ({ x: p.x, y: 7.2 * p.s, z: p.z, s: p.s, ry: 0 }))));
  const bladeGeo = new THREE.BoxGeometry(0.3, 3.1, 0.08);
  bladeGeo.translate(0, 1.55, 0);
  const blades = new THREE.InstancedMesh(bladeGeo, std(P.verdigris), WINDMILLS * 3);
  scene.add(blades);
  // 1 号风车断一叶：断口截面用 stoneDark 端盖封在毂缘（随轮转，update 里 compose）
  const wmCap = new THREE.InstancedMesh(new THREE.BoxGeometry(0.38, 0.1, 0.13), std(P.stoneDark), 1);
  scene.add(wmCap);

  // ---- 雷光结晶 ×18（拾雷者捡的那种残雷：金核 + 光晕壳，悬浮呼吸）----
  const CRYSTALS = 18;
  const crysCore = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.16, 0), gold(), CRYSTALS);
  const crysGlow = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.34, 0),
    new THREE.MeshBasicMaterial({ color: P.gold, transparent: true, opacity: 0.2, depthWrite: false, blending: THREE.AdditiveBlending }), CRYSTALS);
  scene.add(crysCore); scene.add(crysGlow);
  const crysDef = Array.from({ length: CRYSTALS }, (_, i) => ({
    x: (i % 2 === 0 ? -1 : 1) * (5.2 + rnd(i, 201) * 4.5),
    y: 0.8 + rnd(i, 203) * 2.6,
    z: -8 - i * 13 - rnd(i, 205) * 6,
    ph: rnd(i, 207) * 6.283,
  }));

  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), V = new THREE.Vector3(), S = new THREE.Vector3();
  const compose = (mesh: THREE.InstancedMesh, i: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, s = 1) => {
    E.set(rx, ry, rz, 'YXZ'); Q.setFromEuler(E);
    V.set(x, y, z); S.set(s, s, s);
    M.compose(V, Q, S);
    mesh.setMatrixAt(i, M);
  };

  // M4 crossings 视觉对齐：前方判定体画在负 Z（dist−worldZ），done 即隐
  const simRingGeo = new THREE.TorusGeometry(2.2, 0.14, 8, 24);
  const simRings = new THREE.InstancedMesh(simRingGeo, gold(), 16);
  simRings.frustumCulled = false; scene.add(simRings);

  return {
    syncCrossings(list: readonly { lane: number; worldZ: number; done?: boolean }[], dist: number, laneW: number) {
      let n = 0;
      for (const c of list) {
        if (c.done || n >= 16) continue;
        const rel = c.worldZ - dist;
        if (rel < -10 || rel > 120) continue;
        compose(simRings, n++, c.lane * laneW, 2.2, -rel, 0, 0.3, 0, 1);
      }
      for (let i = n; i < 16; i++) compose(simRings, i, 0, -999, 0, 0, 0, 0.0001);
      simRings.instanceMatrix.needsUpdate = true;
    },
    update(move: number, t: number) {
      tower.update(move, t); // 塔件（塔身静态回收 + 碎块/锚缆/信标动画）拆到 tower.ts 自含；先塔后其余，与创建顺序一致
      // 静态件回收
      for (const inst of insts) {
        for (const p of inst.items) {
          p.z += move;
          if (p.z > WRAP_Z) p.z -= LOOP;
        }
        writeAll(inst);
      }
      const zShift = (z: number) => { const nz = z + move; return nz > WRAP_Z ? nz - LOOP : nz; };
      // 铜环：绕主轴慢自转 + 内缘金缝随 sin 微脉动（1±0.06，缩放推着金缝在环口吞吐）
      for (let i = 0; i < RINGS; i++) {
        const r = ringDef[i], ry = t * r.spin + i;
        compose(ringBody, i, r.x, r.y, zShift(r.z), 0, ry, r.tilt);
        compose(ringSeam, i, r.x, r.y, zShift(r.z), 0, ry, r.tilt, 1 + Math.sin(t * 2.8 + i * 1.9) * 0.06);
      }
      ringBody.instanceMatrix.needsUpdate = true;
      ringSeam.instanceMatrix.needsUpdate = true;
      // 电弧火花：事件窗 0.07s（≈2~3 帧）；方位角由事件序号确定性取样，渲染层不回写 sim
      for (let i = 0; i < RINGS; i++) {
        const r = ringDef[i];
        const ev = (t + r.off) / r.per, frac = ev - Math.floor(ev);
        if (frac > 0.07) { compose(sparks, i, 0, -60, 0, 0, 0, 0, 0.0001); continue; }
        const ry = t * r.spin + i, a = rnd(Math.floor(ev), 95 + i * 7) * 6.283;
        const ct = Math.cos(r.tilt), st = Math.sin(r.tilt), cr = Math.cos(ry), sr = Math.sin(ry);
        const cu = Math.cos(a) * 2.6, su = Math.sin(a) * 2.6;
        compose(sparks, i,
          r.x + (cu * ct - su * st) * cr,
          r.y + cu * st + su * ct,
          zShift(r.z) + (su * st - cu * ct) * sr,
          t * 2 + a, a, 0, 1.25 - (frac / 0.07) * 0.25);
      }
      sparks.instanceMatrix.needsUpdate = true;
      // 摆链：单摆 ±0.6rad，链节沿摆线排布 + 坠锤；链节横竖向交替（k 奇偶差 90°）
      for (let c = 0; c < CHAINS; c++) {
        const cd = chainDef[c], cz = zShift(cd.z);
        const ang = Math.sin(t * 2.0 + cd.ph) * 0.6;
        const L = 0.52;
        for (let k = 0; k < LINKS; k++) {
          const d = (k + 1) * L;
          compose(links, c * LINKS + k, cd.x + Math.sin(ang) * d, cd.y - Math.cos(ang) * d, cz,
            0, (k % 2) * (Math.PI / 2), -ang);
        }
        const wx = cd.x + Math.sin(ang) * (LINKS + 0.5) * L, wy = cd.y - Math.cos(ang) * (LINKS + 0.5) * L;
        compose(weights, c, wx, wy, cz);
        // 磨损痕：环孔对准链轴（rx 补摆角、ry 转 90° 把孔从 z 翻到链向下方向）
        compose(wears, c, wx, wy, cz, Math.PI / 2 - ang, Math.PI / 2, 0);
      }
      links.instanceMatrix.needsUpdate = true;
      weights.instanceMatrix.needsUpdate = true;
      wears.instanceMatrix.needsUpdate = true;
      // 风车叶片自转（两顺一逆）；1 号只留 2 叶，第三叶位槽位缩没
      for (let wI = 0; wI < WINDMILLS; wI++) {
        const wd = windDef[wI];
        for (let k = 0; k < 3; k++) {
          if (wI === 1 && k === 2) { compose(blades, wI * 3 + k, 0, -60, 0, 0, 0, 0, 0.0001); continue; }
          compose(blades, wI * 3 + k, wd.x, 7.2 * wd.s, zShift(wd.z), 0, 0, t * wd.w + k * 2.094, wd.s);
        }
      }
      blades.instanceMatrix.needsUpdate = true;
      // 断叶端盖：贴毂缘压住第三叶的断口截面，随轮同转
      {
        const wd = windDef[1], th = t * wd.w + 2 * 2.094;
        compose(wmCap, 0, wd.x - Math.sin(th) * 0.36 * wd.s, 7.2 * wd.s + Math.cos(th) * 0.36 * wd.s,
          zShift(wd.z), 0, 0, th, wd.s);
        wmCap.instanceMatrix.needsUpdate = true;
      }
      // 雷光结晶：悬浮呼吸 + 随世界回收
      for (let i = 0; i < CRYSTALS; i++) {
        const cd = crysDef[i];
        const y = cd.y + Math.sin(t * 1.2 + cd.ph) * 0.3;
        const x = cd.x + Math.sin(t * 0.4 + cd.ph) * 0.4;
        compose(crysCore, i, x, y, zShift(cd.z), t * 0.8 + cd.ph, t * 0.5);
        compose(crysGlow, i, x, y, zShift(cd.z), t * 0.8 + cd.ph, t * 0.5);
      }
      crysCore.instanceMatrix.needsUpdate = true;
      crysGlow.instanceMatrix.needsUpdate = true;
    },
  };
}
