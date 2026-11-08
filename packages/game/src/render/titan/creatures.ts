/**
 * 沉眠泰坦 · 生物（docs/scenes/titan-brief.md §5.1/§5.2 + §8 + §10.1 步骤 8）：
 *   crows  渡魂鸦 1 群 ×30：参数化群飞（不是真 boid——零分配零 O(n²)，观感等价，
 *          逐字参照 stormspire/creatures.ts 口径）：群心绕「肋段 ↔ 颅首」之间的锚点游移
 *          （锚 z −90~−120、z 向游移 ±38 → 路径往返扫过肋拱带 −64~−150，低空从肋拱下
 *          净空穿行 ≥2 次/游移周期，§5.1 穿拱硬指标），个体绕群心盘旋（鼻向贴合切线）+
 *          相位错开的 3~4Hz 拍翼；鸦体 = 压扁小纺锤 + 双翼薄板，通体烬空暮蓝剪影（零纯黑），
 *          每鸦 1 枚 0.06m 亡火金眼点（仅随滚动基线，无独立动效）；模块内累计 move 作跑距
 *          代理，≥420m 睁眼闩锁后旋速 ×1.3（§4.1/§5.1 同款渲染层闩锁口径）。
 *   corpse 对岸尸影棱柱群（抄 stormspire/skyline.ts 口径）：两侧 |x| 48~64 各 6~7 座
 *          （胸廓鼓包 + 头颅残段 + 脊线矮棱拼出「另一具巨尸」轮廓，主 mass 高 12~26m，
 *          斜插箭杆 3~4 根/侧 = 神战余痕），雾灰青/烬空暮蓝交替、半速视差 ×0.3、300m
 *          回收带、矩阵自管非均匀缩放；谷底剪影不加光柱（泰坦没有信标，§5.2）；
 *          无动效——死者就是死的，与主尸的呼吸形成「死/半死」对比。
 * 逐帧矩阵写：鸦体 30 + 翼 60（拍翼 3~4Hz 高频不可降采样，§4.0 纪律 5 拍翼层）+ 眼点 30；
 * 尸影全量推进重写（skyline 同款）。每帧零分配（compose 暂存预建）；确定性 rnd；
 * 发光只用亡火金；鸦群不注入 world-bend（§3.3 要点 5），尸影走 std 与远景同弯；不读 sim。
 * draw call = 5（鸦体 + 翼 + 眼点 + 尸影双色）。
 */
import * as THREE from 'three';
import { LOOP, WRAP_Z, rnd, std } from '../sceneryProps.js';
import { P } from './palette.js';

const CROWS = 30;
const AWAKEN_DIST = 420; // 睁眼闩锁（§4.1）：渲染层累计跑距阈值，= 第二次途经颅段窗之前

/** 尸影棱柱/箭杆：w/h/d 非均匀盒（z 每帧回收；tilt 为箭杆侧倾，棱柱不带） */
interface Frag { x: number; y: number; z: number; w: number; h: number; d: number; tilt?: number }

export function createCreatures(scene: THREE.Scene) {
  // ---- 渡魂鸦 ----
  // 鸦体：四棱锥压扁纺锤，锥尖朝 +Z（鼻向）；翼：薄板自根部向 +x 展开（左翼 ry=π 镜像）
  const bodyGeo = new THREE.ConeGeometry(0.5, 1.6, 4);
  bodyGeo.rotateX(Math.PI / 2);
  const wingGeo = new THREE.BoxGeometry(1, 0.03, 0.4);
  wingGeo.translate(0.5, 0, 0);
  const eyeGeo = new THREE.SphereGeometry(1, 6, 4);
  const crowMat = new THREE.MeshLambertMaterial({ color: P.dusk }); // 烬空暮蓝剪影；鸦群不注入 world-bend
  const eyeMat = new THREE.MeshBasicMaterial({ color: P.pyre, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending });
  const bodies = new THREE.InstancedMesh(bodyGeo, crowMat, CROWS);
  const wings = new THREE.InstancedMesh(wingGeo, crowMat, CROWS * 2);
  const eyes = new THREE.InstancedMesh(eyeGeo, eyeMat, CROWS);
  bodies.frustumCulled = wings.frustumCulled = eyes.frustumCulled = false;
  scene.add(bodies); scene.add(wings); scene.add(eyes);
  // 群心：锚 z 落肋段，游移覆盖 −64~−150（穿拱硬指标）；随 LOOP 回收（同 stormspire 群心口径）
  const school = {
    x0: (rnd(0, 61) - 0.5) * 6,     // 群心横向缓游 ±3
    y0: 2.3,                        // 低空：4.2m 拱全过、低点钻 2.2m 拱
    z: -90 - rnd(0, 63) * 30,       // 群心锚 z（随 LOOP 回收）
    spin: 0.55 + rnd(0, 65) * 0.2,  // 盘旋角速度（睁眼后 ×1.3）
    wob: 0.16 + rnd(0, 67) * 0.06,  // 群心游移频率（周期 ~5s，往返扫过肋拱带）
    wander: 38,                     // z 向游移半幅：路径 −52~−158，覆盖肋拱带 −64~−150
  };
  const crows = Array.from({ length: CROWS }, (_, i) => ({
    r: 1.6 + rnd(i, 71) * 4.2,      // 个体盘旋半径
    a: rnd(i, 73) * 6.283,          // 初始相位
    vy: (rnd(i, 75) - 0.5) * 1.4,   // 高度错层（保持低空穿拱读法）
    flap: 3 + rnd(i, 77) * 1,       // 拍翼 3~4Hz
    span: 0.8 + rnd(i, 79) * 0.4,   // 翼展 0.8~1.2m（单翼 = span/2）
    s: 0.26 + rnd(i, 81) * 0.1,     // 体长
  }));

  // ---- 对岸尸影（远景剪影带，无动效）----
  const BAND = 300, BAND_TOP = 60; // 回收带对齐 stormspire 云墙/skyline：z>60 减 300
  const corpseA: Frag[] = [], corpseB: Frag[] = []; // 雾灰青 / 烬空暮蓝 双色交替
  const prismGeo = new THREE.BoxGeometry(1, 1, 1);
  prismGeo.translate(0, 0.5, 0); // 底面落地：高度全靠 y 缩放表达
  for (const side of [-1, 1] as const) {
    const n = 6 + Math.floor(rnd(side + 3, 401) * 2); // 6~7 座/侧（合计 12~14，§8 地板 11~14 棱柱）
    for (let k = 0; k < n; k++) {
      const z = -240 + (((k + 0.3 + rnd(k, side + 7) * 0.4) % n) * BAND) / n;
      const x = side * (48 + rnd(k, side + 19) * 16); // |x| 48~64（§5.2 雾视窗包络，再远沉进 120m 雾外）
      const y = -3 + rnd(k, side + 23) * 2;           // 基座沉进谷雾
      // 三段轮廓拼「另一具巨尸」：胸廓鼓包 / 头颅残段 / 脊线矮棱（k%3 轮转，双色交替由 k%2 定）
      const f: Frag = k % 3 === 0
        ? { x: x - side * 2, y, z, w: 9 + rnd(k, side + 29) * 4, h: 16 + rnd(k, side + 31) * 10, d: 7 + rnd(k, side + 33) * 4 }
        : k % 3 === 1
          ? { x: x + side * 3, y, z: z + 8, w: 6 + rnd(k, side + 35) * 2, h: 12 + rnd(k, side + 37) * 6, d: 6 }
          : { x, y, z: z - 6, w: 3.5 + rnd(k, side + 39) * 2, h: 9 + rnd(k, side + 41) * 5, d: 9 };
      (k % 2 === 0 ? corpseA : corpseB).push(f);
    }
    // 斜插箭杆 3~4 根/侧：细长盒斜倚尸影群（tilt 侧倾，双色随序交替）
    const na = 3 + Math.floor(rnd(side, 441) * 2);
    for (let a = 0; a < na; a++) {
      (a % 2 === 0 ? corpseA : corpseB).push({
        x: side * (48 + rnd(a, side + 45) * 14), y: -2.5, z: -240 + ((a + 0.5) * BAND) / na,
        w: 0.5, h: 10 + rnd(a, side + 49) * 6, d: 0.5, tilt: side * (0.3 + rnd(a, side + 51) * 0.25),
      });
    }
  }
  const corpseMeshA = new THREE.InstancedMesh(prismGeo, std(P.mist), corpseA.length);
  const corpseMeshB = new THREE.InstancedMesh(prismGeo, std(P.dusk), corpseB.length);
  scene.add(corpseMeshA); scene.add(corpseMeshB);

  // 每帧 compose 暂存（零分配）：欧拉序 YXZ 与 writeAll 一致
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), V = new THREE.Vector3(), S = new THREE.Vector3();
  const compose = (mesh: THREE.InstancedMesh, i: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => {
    E.set(rx, ry, rz, 'YXZ'); Q.setFromEuler(E);
    V.set(x, y, z); S.set(sx, sy, sz);
    M.compose(V, Q, S);
    mesh.setMatrixAt(i, M);
  };
  const advance = (list: Frag[], m: number) => {
    for (let i = 0; i < list.length; i++) {
      const f = list[i]!;
      f.z += m;
      f.z -= Math.ceil((f.z - BAND_TOP) / BAND) * BAND;
    }
  };

  let distAcc = 0, awake = false;
  return {
    update(move: number, t: number) {
      // 睁眼闩锁：模块内累计 move 作跑距代理（同 skull.ts 渲染层口径），≥420m 一次性翻转不可逆
      if (!awake) { distAcc += move; if (distAcc >= AWAKEN_DIST) awake = true; }
      const spin = school.spin * (awake ? 1.3 : 1);
      // 渡魂鸦：群心随 LOOP 回收 + 缓慢游移；个体绕群心盘旋（ry=-a 使鼻向贴合切线）
      school.z += move;
      school.z -= Math.ceil((school.z - WRAP_Z) / LOOP) * LOOP;
      const cx = school.x0 + Math.sin(t * school.wob + 2.1) * 3;
      const cy = school.y0 + Math.sin(t * school.wob * 0.7) * 0.9;
      const cz = school.z + Math.sin(t * school.wob * 0.41 + 1.2) * school.wander;
      for (let i = 0; i < CROWS; i++) {
        const b = crows[i]!;
        const a = b.a + t * spin;
        const flap = Math.sin(t * b.flap + b.a * 3.0) * 0.55;
        const bx = cx + Math.cos(a) * b.r;
        const by = cy + b.vy + Math.sin(a * 2) * 0.5;
        const bz = cz + Math.sin(a) * b.r * 0.7;
        compose(bodies, i, bx, by, bz, flap * 0.3, -a, flap, b.s, b.s * 0.55, b.s * 1.7);
        // 双翼薄板：右翼 rz=+flap；左翼 ry=π 镜像 + rz=−flap（翼尖同升同落，单翼长 = span/2）
        compose(wings, i * 2, bx, by, bz, 0, 0, flap, b.span * 0.5, 1, 1);
        compose(wings, i * 2 + 1, bx, by, bz, 0, Math.PI, flap, b.span * 0.5, 1, 1); // ry=π 镜像：rz 同号翼尖才同升同落
        // 眼点：随滚动基线贴头部（鼻向偏移），无独立动效（§5.1：侧视只见朝镜头一侧的一枚）
        compose(eyes, i, bx - Math.sin(a) * b.s * 0.8, by + b.s * 0.18, bz + Math.cos(a) * b.s * 0.8,
          0, 0, 0, 0.12, 0.12, 0.12);
      }
      bodies.instanceMatrix.needsUpdate = true;
      wings.instanceMatrix.needsUpdate = true;
      eyes.instanceMatrix.needsUpdate = true;
      // 对岸尸影：半速视差 ×0.3 + 300m 回收带（skyline 口径）；死者不动，只有视差推进
      const m = move * 0.3;
      advance(corpseA, m); advance(corpseB, m);
      for (let i = 0; i < corpseA.length; i++) {
        const f = corpseA[i]!;
        compose(corpseMeshA, i, f.x, f.y, f.z, 0, 0, f.tilt ?? 0, f.w, f.h, f.d);
      }
      for (let i = 0; i < corpseB.length; i++) {
        const f = corpseB[i]!;
        compose(corpseMeshB, i, f.x, f.y, f.z, 0, 0, f.tilt ?? 0, f.w, f.h, f.d);
      }
      corpseMeshA.instanceMatrix.needsUpdate = true;
      corpseMeshB.instanceMatrix.needsUpdate = true;
    },
    dispose() {
      scene.remove(bodies); scene.remove(wings); scene.remove(eyes);
      scene.remove(corpseMeshA); scene.remove(corpseMeshB);
      bodyGeo.dispose(); wingGeo.dispose(); eyeGeo.dispose(); prismGeo.dispose();
      crowMat.dispose(); eyeMat.dispose();
      corpseMeshA.dispose(); corpseMeshB.dispose();
      bodies.dispose(); wings.dispose(); eyes.dispose();
    },
  };
}
