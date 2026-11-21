/**
 * 沉眠泰坦 · 峡谷雾与魂火粒子（docs/scenes/titan-brief.md §3.4 + §6 表，Phase A 步骤 3）：
 *   bands  谷底贴地雾带 ×2：贴谷底半透长平面（雾灰青→烬空暮蓝 RGB 纵渐变 + alpha 远浓近淡），
 *          抄 stormspire/atmosphere.ts 薄雾配方（横白纵渐隐、横向慢滚 offset=move/60），
 *          alpha ≤0.10；两个实例共用一份几何/纹理/材质（1 draw call，不散 mesh）；
 *   motes  魂火飘屑三层池 ≈60 枚：雨的镜像（atmosphere.ts 三层雨口径抄结构，反转漂移向与
 *          色调）——深渊谷底缓慢上浮的亡火金微光点（0.02~0.08m 竖直微光线段，加色），
 *          近层大而亮 / 远层细而淡，出雾顶回谷底，z 随世界滚动回收；
 *   fires  谷底魂火 ×20（§3.4/§8）：较大光点（0.05~0.12m 八面体，亡火金 additive），
 *          缓慢上浮循环、上浮出雾顶即回收到谷底，明暗呼吸相位互错（instanceColor 0.4~1）。
 * 本地色表逐值对表 titan/palette.ts（§2；三个 titan 文件互不 import）。
 * 全部确定性 rnd、每帧零分配（矩阵/Color 预建原地改写）；LineSegments 不进散 mesh 统计；不读 sim。
 */
import * as THREE from 'three';
import { LOOP, WRAP_Z, rnd, type SceneryProps } from '../sceneryProps.js';

/** 本地色表（逐值对表 titan/palette.ts） */
const C = { mist: 0x46606e, dusk: 0x151c2c, pyre: 0xffb454 } as const;

// 每帧零分配：魂火矩阵与明暗共用一份暂存（原地改写）
const M = new THREE.Matrix4();
const CT = new THREE.Color();

/** 滚动贴图公共收尾（同 atmosphere.scrollable）：重复包裹 + sRGB + 线性过滤 + mipmap */
function scrollable(tex: THREE.DataTexture) {
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true; tex.needsUpdate = true;
  return tex;
}

/** 谷底雾贴图：RGB 沿 v 由雾灰青渐入烬空暮蓝（远端沉进峡谷底色）、alpha 纵向远浓近淡
 *  （smoothstep）+ 轻微横斑起伏（配方同 atmosphere.makeMistTexture，色调换 §2 双色） */
function makeCanyonMistTexture(): THREE.DataTexture {
  const N = 128, data = new Uint8Array(N * N * 4);
  const hash = (x: number, y: number) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
  const ch = (hex: number, sh: number) => (hex >> sh) & 255;
  const r0 = ch(C.mist, 16), r1 = ch(C.dusk, 16), g0 = ch(C.mist, 8), g1 = ch(C.dusk, 8);
  const b0 = ch(C.mist, 0), b1 = ch(C.dusk, 0);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const v = y / N;
    const blob = Math.sin((x / N * 3 + hash(3, 7)) * 6.2832) * Math.cos((v * 2 + hash(7, 3)) * 6.2832) * 0.5 + 0.5;
    const a = (0.25 + 0.75 * v * v * (3 - 2 * v)) * (0.85 + 0.15 * blob);
    const i = (y * N + x) * 4;
    data[i] = r0 + (r1 - r0) * v; data[i + 1] = g0 + (g1 - g0) * v; data[i + 2] = b0 + (b1 - b0) * v;
    data[i + 3] = a * 255;
  }
  return scrollable(new THREE.DataTexture(data, N, N, THREE.RGBAFormat));
}

/** 谷底雾带 ×2：InstancedMesh 双实例共用一份几何/纹理/材质（主雾面 y −5.5 / 沉底雾面 y −7.8，
 *  第二实例转 ½π 并微放大错开斑纹）；平面静止、贴图横向慢滚随世界速度（stormspire 薄雾口径） */
function addFogBands(scene: THREE.Scene) {
  const geo = new THREE.PlaneGeometry(76, 240);
  geo.rotateX(-Math.PI / 2); // 几何级转平＝贴谷底雾面（覆盖 x ±38、z +30~−210）
  const tex = makeCanyonMistTexture();
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.09, depthWrite: false, side: THREE.DoubleSide });
  const mesh = new THREE.InstancedMesh(geo, mat, 2);
  mesh.frustumCulled = false;
  const eu = new THREE.Euler(0, 0, 0, 'YXZ'), qt = new THREE.Quaternion();
  const vv = new THREE.Vector3(), ss = new THREE.Vector3();
  eu.set(0, 0, 0); qt.setFromEuler(eu); vv.set(0, -5.5, -90); ss.set(1, 1, 1);
  M.compose(vv, qt, ss); mesh.setMatrixAt(0, M);
  eu.set(0, Math.PI, 0); qt.setFromEuler(eu); vv.set(0, -7.8, -90); ss.set(1.2, 1, 1.05);
  M.compose(vv, qt, ss); mesh.setMatrixAt(1, M);
  mesh.instanceMatrix.needsUpdate = true;
  scene.add(mesh);
  return {
    scroll(move: number) { tex.offset.x = (move / 60) % 1; },
    dispose() { tex.dispose(); mat.dispose(); geo.dispose(); mesh.dispose(); },
  };
}

/** 单层飘屑参数：n 枚数 / len 光点线长 / alpha / v0+dv 上浮速度 / xIn+xVar 谷宽分布 /
 *  yBot 谷底 / yTop 雾顶 / zTop+zDepth 相机空间回收带 / seed */
interface MoteSpec {
  n: number; len: number; alpha: number; v0: number; dv: number;
  xIn: number; xVar: number; yBot: number; yTop: number; zTop: number; zDepth: number; seed: number;
}

/** 单层飘屑池：相机空间循环盒竖直微光线段（每枚 2 顶点，零分配原地改写），
 *  缓慢上浮 + 横摆微晃（雨的镜像：漂移向反转、色调亡火金），z 随世界滚动回收 */
function addMoteLayer(scene: THREE.Scene, p: MoteSpec) {
  const pos = new Float32Array(p.n * 2 * 3);
  const spd = new Float32Array(p.n), xOf = new Float32Array(p.n), zOf = new Float32Array(p.n), ph = new Float32Array(p.n);
  for (let i = 0; i < p.n; i++) {
    xOf[i] = (i % 2 === 0 ? -1 : 1) * (p.xIn + rnd(i + p.seed, 3) * p.xVar); // 两侧谷底 |x| 分布
    zOf[i] = p.zTop - rnd(i + p.seed + 51, 3) * p.zDepth;
    spd[i] = p.v0 + rnd(i + p.seed + 97, 3) * p.dv;
    ph[i] = rnd(i + p.seed + 131, 3) * 6.283;
    const y = p.yBot + rnd(i + p.seed + 173, 3) * (p.yTop - p.yBot); // 出生铺满整盒，避免开局齐刷刷
    const j = i * 6;
    pos[j] = xOf[i]; pos[j + 1] = y; pos[j + 2] = zOf[i];
    pos[j + 3] = xOf[i]; pos[j + 4] = y + p.len; pos[j + 5] = zOf[i];
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.LineBasicMaterial({ color: C.pyre, transparent: true, opacity: p.alpha,
    blending: THREE.AdditiveBlending, depthWrite: false });
  const lines = new THREE.LineSegments(geo, mat);
  lines.frustumCulled = false;
  scene.add(lines);
  return {
    update(dt: number, move: number, t: number) {
      for (let i = 0; i < p.n; i++) {
        let y = pos[i * 6 + 1] + spd[i] * dt;   // 上浮（雨的镜像）
        if (y > p.yTop) y = p.yBot;             // 出雾顶回谷底
        zOf[i] += move;
        if (zOf[i] > p.zTop) zOf[i] -= p.zDepth;
        const x = xOf[i] + Math.sin(t * 0.6 + ph[i]) * 0.3, z = zOf[i], j = i * 6;
        pos[j] = x; pos[j + 1] = y; pos[j + 2] = z;
        pos[j + 3] = x; pos[j + 4] = y + p.len; pos[j + 5] = z;
      }
      geo.attributes.position.needsUpdate = true;
    },
    dispose() { geo.dispose(); mat.dispose(); },
  };
}

/** 三层池（近 26 大而亮 / 中 20 / 远 14 细而淡 ≈ 60 枚；分层口径镜像 atmosphere.addRain） */
function addMotes(scene: THREE.Scene) {
  return [
    addMoteLayer(scene, { n: 26, len: 0.08, alpha: 0.5, v0: 0.5, dv: 0.4, xIn: 7, xVar: 26, yBot: -10, yTop: 4, zTop: 6, zDepth: 40, seed: 700 }),
    addMoteLayer(scene, { n: 20, len: 0.05, alpha: 0.3, v0: 0.35, dv: 0.3, xIn: 8, xVar: 28, yBot: -11, yTop: 2, zTop: 8, zDepth: 52, seed: 0 }),
    addMoteLayer(scene, { n: 14, len: 0.03, alpha: 0.16, v0: 0.25, dv: 0.2, xIn: 10, xVar: 26, yBot: -12, yTop: 0, zTop: -12, zDepth: 34, seed: 1700 }),
  ];
}

/** 谷底魂火 ×20：0.05~0.12m 亡火金八面体 additive，谷底缓慢上浮、出雾顶（雾面 y≈−5.5）
 *  回收到谷底；明暗呼吸相位互错（instanceColor 0.4~1 正弦）+ 上下 ±12% 微缩放 */
function addSoulFires(scene: THREE.Scene) {
  const N = 20, YBOT = -10, YTOP = -2.6;
  const geo = new THREE.OctahedronGeometry(0.08, 0);
  const mat = new THREE.MeshBasicMaterial({ color: C.pyre, transparent: true, opacity: 0.9,
    blending: THREE.AdditiveBlending, depthWrite: false });
  const mesh = new THREE.InstancedMesh(geo, mat, N);
  mesh.frustumCulled = false;
  scene.add(mesh);
  const xOf = new Float32Array(N), yOf = new Float32Array(N), zOf = new Float32Array(N);
  const spd = new Float32Array(N), scl = new Float32Array(N), ph = new Float32Array(N), rate = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    xOf[i] = (i % 2 === 0 ? -1 : 1) * (9 + rnd(i, 211) * 22);      // 谷底 |x| 9~31（路缘之外）
    yOf[i] = YBOT + rnd(i, 223) * (YTOP - YBOT);                   // 出生铺满整程
    zOf[i] = WRAP_Z - rnd(i, 227) * LOOP;                          // 240m 循环带
    spd[i] = 0.15 + rnd(i, 229) * 0.2;                             // 缓慢上浮
    scl[i] = (0.05 + rnd(i, 231) * 0.07) / 0.08;                   // 半径 0.05~0.12m → 实例缩放
    ph[i] = rnd(i, 233) * 6.283;                                   // 呼吸相位互错
    rate[i] = 0.8 + rnd(i, 239) * 0.8;
  }
  return {
    update(move: number, t: number, dt: number) {
      for (let i = 0; i < N; i++) {
        let y = yOf[i] + spd[i] * dt;
        if (y > YTOP) y = YBOT;                                    // 出雾顶回谷底
        yOf[i] = y;
        let z = zOf[i] + move;
        z -= Math.ceil((z - WRAP_Z) / LOOP) * LOOP;
        zOf[i] = z;
        const br = Math.sin(t * rate[i] + ph[i]);
        M.makeScale(scl[i], scl[i] * (1 + br * 0.12), scl[i]);
        M.setPosition(xOf[i], y, z);
        mesh.setMatrixAt(i, M);
        CT.setScalar(0.4 + 0.6 * (0.5 + 0.5 * br));                // 明暗 0.4~1，相位互错
        mesh.setColorAt(i, CT);
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    },
    dispose() { geo.dispose(); mat.dispose(); mesh.dispose(); },
  };
}

export function createMist(scene: THREE.Scene): SceneryProps {
  const bands = addFogBands(scene);
  const motes = addMotes(scene);
  const fires = addSoulFires(scene);
  let lastT = 0;
  return {
    update(move: number, t: number) {
      const dt = Math.min(Math.max(t - lastT, 0), 0.1); // SceneryProps 只传 move/t，dt 由 t 差分（stormspireProps 同款）
      lastT = t;
      bands.scroll(move);
      for (const m of motes) m.update(dt, move, t);
      fires.update(move, t, dt);
    },
    dispose() {
      bands.dispose();
      for (const m of motes) m.dispose();
      fires.dispose();
    },
  };
}
