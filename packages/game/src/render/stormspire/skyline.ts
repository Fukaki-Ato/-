/**
 * 天穹雷脊 · 远景剪影带（2026-11-11 三轮整改：远景辨识度——「糊成一团」→「可读的天际线」）：
 *   skyline   两侧 |x|38~58 各一排错落剪影棱柱（11~14 座/侧，高 4~18m 参差，盒为主，
 *             少量尖锥/断塔顶变化；深渊靛与风暴青交替，靠雾吃出空气透视）；
 *   causeway  每侧一条低矮连绵桥影（长扁盒分段留拱口 + 拱口过梁示意拱券），连接剪影群；
 *   beacons   2 根信标光柱立在剪影群制高点：竖直十字双面片 additive 金光（P.gold，
 *             opacity 0.14，宽 0.5m 高 22m，1×16 渐变 alpha 纹理顶亮底渐隐），给远景焦点物。
 * 半速视差：z 走 move*0.3（比云墙 ×0.55 再远一层），回收带 300m（对齐 stormspireProps 云墙写法）。
 * 矩阵自管（盒件要非均匀缩放，不走 writeAll 的等比 s）；每帧 compose 零分配；不读 sim。
 * draw call = 4：双色棱柱（断塔桩/桥影复用同一网格）+ 尖锥 + 光柱。
 */
import * as THREE from 'three';
import { rnd, std } from '../sceneryProps.js';
import { P } from './palette.js';

/** 剪影件：w/h/d 非均匀盒（尖锥复用 w=径、h=高），z 每帧回收 */
interface Frag { x: number; y: number; z: number; w: number; h: number; d: number }

/** 光柱渐变 alpha（1×16）：RGB 恒白乘材质色；DataTexture 首行是 v=0（底部），alpha 随行号走高 = 顶亮底渐隐 */
function makeBeamTexture(): THREE.DataTexture {
  const N = 16;
  const data = new Uint8Array(N * 4);
  for (let y = 0; y < N; y++) {
    const i = y * 4;
    data[i] = 255; data[i + 1] = 255; data[i + 2] = 255;
    data[i + 3] = 255 * Math.pow(y / (N - 1), 1.7);
  }
  const tex = new THREE.DataTexture(data, 1, N, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

const BAND = 300, BAND_TOP = 60; // 回收带对齐云墙：z>60 减 300

export function createSkyline(scene: THREE.Scene) {
  const abyssBoxes: Frag[] = [], stormBoxes: Frag[] = [], spires: Frag[] = [], tall: Frag[] = [];
  const prismGeo = new THREE.BoxGeometry(1, 1, 1);
  prismGeo.translate(0, 0.5, 0); // 底面落地：高度全靠 y 缩放表达
  // 两侧剪影棱柱群：双色交替；1/3 顶部加尖锥或断塔桩（断塔桩复用棱柱网格省 draw call）
  for (const side of [-1, 1] as const) {
    const n = 11 + Math.floor(rnd(side + 3, 401) * 4);
    for (let k = 0; k < n; k++) {
      const summit = (side < 0 && k === 2) || (side > 0 && k === 7); // 两处制高点，光柱立此
      const z = -240 + (((k + 0.3 + rnd(k, side + 7) * 0.4) % n) * BAND) / n;
      const h = summit ? 16.5 + rnd(k, side + 11) * 1.5 : 4 + rnd(k, side + 13) * 12;
      const w = 2.6 + rnd(k, side + 17) * 3.4;
      const f: Frag = {
        x: side * (38 + rnd(k, side + 19) * 18), y: -5 + rnd(k, side + 23) * 2, z,
        w, d: w * (0.8 + rnd(k, side + 29) * 0.5), h,
      };
      (k % 2 === 0 ? abyssBoxes : stormBoxes).push(f);
      if (summit) tall.push(f); // 光柱跟这根棱柱同 z 回收（同一引用，不重复推进）
      const top = rnd(k, side + 31);
      if (!summit && top < 0.3) {
        spires.push({ x: f.x, y: f.y + f.h, z: f.z, w: w * 0.4, d: w * 0.4, h: 1.6 + rnd(k, side + 33) * 2.4 }); // 尖锥顶
      } else if (!summit && top > 0.82) {
        (k % 2 === 0 ? abyssBoxes : stormBoxes).push({ // 断塔桩：歪出棱柱一小截
          x: f.x + w * 0.18, y: f.y + f.h - 0.4, z: f.z + w * 0.1,
          w: w * 0.55, d: w * 0.5, h: 1.2 + rnd(k, side + 37) * 1.8,
        });
      }
    }
  }
  // 低矮连绵桥影：每侧一条长扁盒分段（段间 5m 拱口，偶数口上架过梁示意拱券）
  for (const side of [-1, 1] as const) {
    const segs = 7, segLen = BAND / segs;
    for (let k = 0; k < segs; k++) {
      const z = -240 + (k + 0.5) * segLen;
      abyssBoxes.push({ x: side * 47, y: -3.4, z, w: 5, h: 1.5, d: segLen - 5 });
      if (k % 2 === 0) {
        stormBoxes.push({ x: side * 47, y: -2.3, z: z + (segLen - 5) / 2 + 2.5, w: 5.6, h: 0.7, d: 3.4 });
      }
    }
  }

  // ---- 网格装配：共 4 个 InstancedMesh = 4 draw call ----
  const spireGeo = new THREE.ConeGeometry(0.5, 1, 4);
  spireGeo.translate(0, 0.5, 0);
  const abyssMesh = new THREE.InstancedMesh(prismGeo, std(P.abyss), abyssBoxes.length);
  const stormMesh = new THREE.InstancedMesh(prismGeo, std(P.storm), stormBoxes.length);
  const spireMesh = new THREE.InstancedMesh(spireGeo, std(P.abyss), spires.length);
  const beamGeo = new THREE.PlaneGeometry(0.5, 22);
  beamGeo.translate(0, 11, 0); // 底端落在制高点顶上，向上长 22m
  const beamTex = makeBeamTexture();
  const beamMat = new THREE.MeshBasicMaterial({
    color: P.gold, map: beamTex, transparent: true, opacity: 0.14,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  const beamMesh = new THREE.InstancedMesh(beamGeo, beamMat, tall.length * 2); // 十字双面片 ×2 根
  scene.add(abyssMesh); scene.add(stormMesh); scene.add(spireMesh); scene.add(beamMesh);

  // 每帧 compose 暂存（零分配）：盒件非均匀缩放；光柱第二片绕 y 转 90° 拼十字
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(0, 0, 0, 'YXZ');
  const V = new THREE.Vector3(), S = new THREE.Vector3();
  const put = (mesh: THREE.InstancedMesh, i: number, f: Frag) => {
    E.set(0, 0, 0); Q.setFromEuler(E);
    V.set(f.x, f.y, f.z); S.set(f.w, f.h, f.d);
    M.compose(V, Q, S);
    mesh.setMatrixAt(i, M);
  };
  const advance = (list: Frag[], m: number) => {
    for (let i = 0; i < list.length; i++) {
      const f = list[i]!;
      f.z += m;
      if (f.z > BAND_TOP) f.z -= BAND;
    }
  };

  return {
    update(move: number, t: number) {
      const m = move * 0.3; // 半速视差：比云墙（×0.55）再远一层
      advance(abyssBoxes, m); advance(stormBoxes, m); advance(spires, m);
      for (let i = 0; i < abyssBoxes.length; i++) put(abyssMesh, i, abyssBoxes[i]!);
      for (let i = 0; i < stormBoxes.length; i++) put(stormMesh, i, stormBoxes[i]!);
      for (let i = 0; i < spires.length; i++) put(spireMesh, i, spires[i]!);
      // 光柱跟随制高点棱柱回收（tall 是同一 Frag 引用，z 已被上面推进），底端微浮 + 相位互错
      for (let i = 0; i < tall.length; i++) {
        const f = tall[i]!;
        E.set(0, 0, 0); Q.setFromEuler(E);
        V.set(f.x, f.y + f.h + 0.4 + Math.sin(t * 1.3 + i * 2.4) * 0.4, f.z); S.set(1, 1, 1);
        M.compose(V, Q, S);
        beamMesh.setMatrixAt(i * 2, M);
        E.set(0, Math.PI / 2, 0); Q.setFromEuler(E);
        M.compose(V, Q, S);
        beamMesh.setMatrixAt(i * 2 + 1, M);
      }
      abyssMesh.instanceMatrix.needsUpdate = true;
      stormMesh.instanceMatrix.needsUpdate = true;
      spireMesh.instanceMatrix.needsUpdate = true;
      beamMesh.instanceMatrix.needsUpdate = true;
    },
    dispose() {
      beamTex.dispose(); beamMat.dispose(); beamGeo.dispose();
      prismGeo.dispose(); spireGeo.dispose();
      abyssMesh.dispose(); stormMesh.dispose(); spireMesh.dispose(); beamMesh.dispose();
    },
  };
}
