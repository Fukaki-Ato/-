/**
 * 天穹雷脊 · 氛围层（docs/stormspire-brief.md §3.3 / §6）：
 *   cloudSea  云海：主题 groundColor 的 ground 面之上叠两层程序化云斑纹理平面（异速滚动），
 *             把「悬在云海之上」立住；两侧远处的云墙团块由 stormspireProps 用云白压扁球补。
 *   mist      低层薄雾：2 条贴地半透长平面（cloudShade 色），alpha 横白纵渐隐近淡远浓 + 横向慢滚。
 *   rain      雨：1400 条拖尾线段拆三层池（近 380 贴镜头大雨·加色提亮 / 中 700 常规 / 远 320
 *             细雨融雾让位剪影；零分配：原地改写，风偏 12°，下落逐滴确定，回放安全）。
 *   ripple    雨点涟漪：路缘 60 枚贴地扩散环 ~0.7s 生命周期循环（0.15→1.0 渐大 + 0.35→0 渐隐），
 *             落点固定相位错开，读作雨点砸进水洼荡开一圈。
 *   wind      风痕：12 条半透白云白条在 y 2~8、|x| 5~14 高速向 +Z 漂（自速 + move*2
 *             快速出画绕回，速度独立于世界——原地不动也有气流）。
 *   cloudRow  云墙加密：cloudShade 色补一排更近更大的压扁云丘（|x|≈18，仅 9 团，
 *             半速视差与 stormspireProps 云墙同一配方）。
 * 纯装饰：只吃 update(move, t, dt)，不读 sim。
 */
import * as THREE from 'three';
import { P } from './palette.js';

/** 文件内确定性伪随机（禁 Math.random）：同下标恒同结果，回放安全 */
const rnd1 = (i: number) => { const s = Math.sin(i * 127.1 + 37.7) * 43758.5453; return s - Math.floor(s); };
const texHash = (x: number, y: number) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); }; // 贴图散点哈希（云斑/薄雾共用）

// 每帧零分配：无旋转实例件共用一个 Matrix4、涟漪渐隐共用一个 Color（均原地改写）
const M = new THREE.Matrix4();
const C = new THREE.Color();

/** 滚动贴图公共收尾：重复包裹 + sRGB + 线性过滤 + mipmap（云斑/薄雾共用） */
function scrollable(tex: THREE.DataTexture) {
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true; tex.needsUpdate = true;
  return tex;
}

/** 云斑 alpha 贴图：整数周期正弦斑块，边缘柔、接缝无格纹（与 trackVisuals 的地面纹同一配方） */
function makeCloudTexture(): THREE.DataTexture {
  const N = 128;
  const data = new Uint8Array(N * N * 4);
  const blob = (x: number, y: number, fx: number, fy: number) =>
    Math.sin(((x / N) * fx + texHash(fx, fy)) * 6.2832) * Math.cos(((y / N) * fy + texHash(fy, fx)) * 6.2832);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const m = blob(x, y, 2, 3) * 0.55 + blob(x, y, 5, 4) * 0.3 + blob(x, y, 9, 7) * 0.15;
    const a = Math.max(0, m - 0.18) * 3.1; // 负值裁零＝云隙，亮斑＝云顶
    const i = (y * N + x) * 4;
    data[i] = 233; data[i + 1] = 239; data[i + 2] = 243;
    data[i + 3] = Math.min(255, a * 255);
  }
  return scrollable(new THREE.DataTexture(data, N, N, THREE.RGBAFormat));
}

/** 云海：ground 面就是云海面（主题色），这里在桥面两侧叠异速滚动的云斑条（不打到路面上） */
function addCloudSea(scene: THREE.Scene) {
  const mkTex = () => { const t = makeCloudTexture(); t.repeat.set(2, 9); return t; };
  const layers: { tex: THREE.DataTexture; mesh: THREE.Mesh; speed: number; drift: number }[] = [];
  const strip = (tex: THREE.DataTexture, color: number, opacity: number, x: number, y: number, speed: number, drift: number) => {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(38, 250),
      new THREE.MeshBasicMaterial({ map: tex, color, transparent: true, opacity, depthWrite: false }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, y, -100);
    scene.add(mesh);
    layers.push({ tex, mesh, speed, drift });
  };
  for (const x of [-25, 25]) {
    strip(mkTex(), 0x5d7f9c, 0.95, x, 0.06, 1, 0);        // 底层云斑：跟世界速度
    strip(mkTex(), P.cloud, 0.42, x, 0.12, 1, 1);         // 亮层：再叠自身缓漂
  }
  return {
    scroll(move: number, t: number) {
      // v 轴朝 -Z，正偏移向 +Z 退（与道具同向）
      for (const l of layers) {
        l.tex.offset.y = (l.tex.offset.y + (move * l.speed) / 25) % 1;
        if (l.drift) {
          l.tex.offset.x = t * 0.006;
          l.tex.offset.y = (l.tex.offset.y + t * 0.008) % 1;
        }
      }
    },
    dispose() { for (const l of layers) l.tex.dispose(); },
  };
}

/** 薄雾 alpha 贴图：横白（u 向匀白微斑，供横漂可读）、纵渐隐（v 向近淡远浓，v=1 为 -Z 远端） */
function makeMistTexture(): THREE.DataTexture {
  const N = 128, data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x / N, v = y / N;
    const blob = Math.sin((u * 3 + texHash(3, 7)) * 6.2832) * Math.cos((v * 2 + texHash(7, 3)) * 6.2832) * 0.5 + 0.5;
    const a = (0.25 + 0.75 * v * v * (3 - 2 * v)) * (0.85 + 0.15 * blob); // smoothstep 远浓 + 轻微横斑起伏
    const i = (y * N + x) * 4; data[i] = 255; data[i + 1] = 255; data[i + 2] = 255; data[i + 3] = a * 255;
  }
  return scrollable(new THREE.DataTexture(data, N, N, THREE.RGBAFormat));
}

/** 低层薄雾带：2 条贴地半透长平面（14×240m，y 0.5/1.1，cloudShade 色，op 0.10/0.07）；alpha 纵向渐浓＝远端 z<-60 段更实；横向慢滚 offset=move/60 */
function addMist(scene: THREE.Scene) {
  const geo = new THREE.PlaneGeometry(14, 240);
  const bands: { tex: THREE.DataTexture; mat: THREE.MeshBasicMaterial }[] = [];
  for (const spec of [{ y: 0.5, op: 0.1 }, { y: 1.1, op: 0.07 }]) {
    const tex = makeMistTexture();
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, color: P.cloudShade, transparent: true, opacity: spec.op, depthWrite: false, side: THREE.DoubleSide }));
    mesh.rotation.x = -Math.PI / 2; mesh.position.set(0, spec.y, -90); // 覆盖 z +30 ~ -210：近端淡、远端浓
    scene.add(mesh); bands.push({ tex, mat: mesh.material });
  }
  return {
    scroll(move: number) { for (const b of bands) b.tex.offset.x = (move / 60) % 1; },
    dispose() { for (const b of bands) { b.tex.dispose(); b.mat.dispose(); } geo.dispose(); },
  };
}

/** 单层雨池参数：n 条数 / len 线长 / alpha 透明度 / v0+dv 速度区间 / xMax、zTop、zDepth 落盒 / seed 随机种子 */
type RainSpec = { n: number; len: number; alpha: number; v0: number; dv: number; xMax: number; zTop: number; zDepth: number; seed: number; add?: boolean };

/** 单层雨池：相机空间循环盒线段（每条 2 顶点，零分配原地改写），风偏 12°，层参数独立（各 1 draw call） */
function addRainLayer(scene: THREE.Scene, p: RainSpec) {
  const TOP = 14, BOTTOM = -3, SLANT = 0.21;
  const pos = new Float32Array(p.n * 2 * 3);
  const spd = new Float32Array(p.n), xOf = new Float32Array(p.n), zOf = new Float32Array(p.n);
  for (let i = 0; i < p.n; i++) {
    xOf[i] = (rnd1(i + p.seed) - 0.5) * 2 * p.xMax;
    zOf[i] = p.zTop - rnd1(i + p.seed + 51) * p.zDepth;
    spd[i] = p.v0 + rnd1(i + p.seed + 97) * p.dv;
    // 出生高度铺满整盒，避免开局一条水平雨帘
    const y = BOTTOM + rnd1(i + p.seed + 131) * (TOP - BOTTOM);
    const x = xOf[i] + (TOP - y) * SLANT, z = zOf[i], j = i * 6;
    pos[j] = x; pos[j + 1] = y; pos[j + 2] = z;
    pos[j + 3] = x + SLANT * p.len; pos[j + 4] = y + p.len; pos[j + 5] = z;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.LineBasicMaterial({ color: P.rain, transparent: true, opacity: p.alpha,
    blending: p.add ? THREE.AdditiveBlending : THREE.NormalBlending, depthWrite: !p.add });
  const lines = new THREE.LineSegments(geo, mat); lines.frustumCulled = false; scene.add(lines);
  return {
    update(dt: number, move: number) {
      for (let i = 0; i < p.n; i++) {
        let y = pos[i * 6 + 1] - spd[i] * dt;
        if (y < BOTTOM) y = TOP;
        zOf[i] += move;
        if (zOf[i] > p.zTop) zOf[i] -= p.zDepth;
        const x = xOf[i] + (TOP - y) * SLANT, z = zOf[i], j = i * 6;
        pos[j] = x; pos[j + 1] = y; pos[j + 2] = z;
        pos[j + 3] = x + SLANT * p.len; pos[j + 4] = y + p.len; pos[j + 5] = z;
      }
      geo.attributes.position.needsUpdate = true;
    },
    dispose() { geo.dispose(); mat.dispose(); },
  };
}

/** 三层雨工厂：near 380（长1.1/α0.5/17-24m/s，|x|<10、z[-30,6]，加色提亮冲击层）· mid 700（原口径
 *  0.55/α0.34/13-22m/s 全盒）· far 320（0.3/α0.16/7-11m/s，z[-46,-14] 细雨融雾）；总量 1400 不变 */
function addRain(scene: THREE.Scene) {
  return [
    addRainLayer(scene, { n: 380, len: 1.1, alpha: 0.5, v0: 17, dv: 7, xMax: 10, zTop: 6, zDepth: 36, seed: 900, add: true }),
    addRainLayer(scene, { n: 700, len: 0.55, alpha: 0.34, v0: 13, dv: 9, xMax: 16, zTop: 8, zDepth: 46, seed: 0 }),
    addRainLayer(scene, { n: 320, len: 0.3, alpha: 0.16, v0: 7, dv: 4, xMax: 16, zTop: -14, zDepth: 32, seed: 1900 }),
  ];
}

/** 雨点涟漪：路缘（|x| 2.6~6、y 0.04）60 枚贴地扩散环（RingGeometry 内0.7外1.0，环面朝上贴地），
 *  确定性生命周期 (t*rate+相位)%1 ~0.7s：scale 0.15→1.0 渐大 + instanceColor 0.35→0 渐隐
 *  （加色混白，环随生命暗到黑＝等效淡出），死了重开新周期 = 雨点砸进水洼荡开一圈 */
function addRipples(scene: THREE.Scene) {
  const N = 60, ZTOP = 8, SPAN = 68;
  const geo = new THREE.RingGeometry(0.7, 1.0, 20);
  geo.rotateX(-Math.PI / 2); // 几何级转平＝贴地环
  const mat = new THREE.MeshBasicMaterial({ color: P.cloud, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  const mesh = new THREE.InstancedMesh(geo, mat, N);
  mesh.frustumCulled = false;
  scene.add(mesh);
  const xOf = new Float32Array(N), zOf = new Float32Array(N);
  const ph = new Float32Array(N), rate = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    xOf[i] = (i % 2 === 0 ? -1 : 1) * (2.6 + rnd1(i + 7) * 3.4); // 路缘带 |x|<6，避开中央跑带
    zOf[i] = ZTOP - rnd1(i + 23) * SPAN;                        // 桥面可视带，随世界回收
    ph[i] = rnd1(i + 41);                                       // 生命周期相位错开
    rate[i] = 1.3 + rnd1(i + 59) * 0.4;                         // ~0.6-0.77s 荡开一圈
  }
  return {
    update(move: number, t: number) {
      for (let i = 0; i < N; i++) {
        let z = zOf[i] + move;
        if (z > ZTOP) z -= SPAN;
        zOf[i] = z;
        const life = (t * rate[i] + ph[i]) % 1;
        const s = 0.15 + 0.85 * life;                          // 0.15→1.0 渐大
        M.makeScale(s, s, s);
        M.setPosition(xOf[i], 0.04, z);
        mesh.setMatrixAt(i, M);
        C.setScalar(0.35 * (1 - life)); mesh.setColorAt(i, C); // 0.35→0 渐隐（等效 opacity）
      }
      mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    },
    dispose() { geo.dispose(); mat.dispose(); },
  };
}

/** 风痕：12 条水平细长半透白云白条（细长盒，opacity ~0.12），y 2~8、|x| 5~14，
 *  高速向 +Z 漂：自速（独立于世界，原地不动也吹）+ move*2 快速出画绕回 */
function addWindStreaks(scene: THREE.Scene) {
  const N = 12, ZTOP = 30, SPAN = 92;
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const mat = new THREE.MeshBasicMaterial({ color: P.cloud, transparent: true, opacity: 0.12, depthWrite: false });
  const mesh = new THREE.InstancedMesh(geo, mat, N);
  mesh.frustumCulled = false;
  scene.add(mesh);
  const xOf = new Float32Array(N), yOf = new Float32Array(N), zOf = new Float32Array(N);
  const sx = new Float32Array(N), sy = new Float32Array(N), sz = new Float32Array(N), spd = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    xOf[i] = (i % 2 === 0 ? -1 : 1) * (5 + rnd1(i + 91) * 9);    // |x| 5~14
    yOf[i] = 2 + rnd1(i + 107) * 6;                              // y 2~8（高空气流层）
    zOf[i] = ZTOP - rnd1(i + 123) * SPAN;
    sx[i] = 0.3 + rnd1(i + 139) * 0.35;                          // 细
    sy[i] = 0.05 + rnd1(i + 151) * 0.04;                         // 扁
    sz[i] = 5 + rnd1(i + 163) * 5;                               // 细长 5~10m
    spd[i] = 26 + rnd1(i + 179) * 18;                            // 风速 m/s（逐条独立）
  }
  return {
    update(move: number, dt: number) {
      for (let i = 0; i < N; i++) {
        let z = zOf[i] + spd[i] * dt + move * 2;                 // 快速出画绕回
        if (z > ZTOP) z -= SPAN;
        zOf[i] = z;
        M.makeScale(sx[i], sy[i], sz[i]);
        M.setPosition(xOf[i], yOf[i], z);
        mesh.setMatrixAt(i, M);
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
    dispose() { geo.dispose(); mat.dispose(); },
  };
}

/** 云墙加密：cloudShade 色补一排更近的压扁云丘（|x|≈18，比 stormspireProps 近排高 1m、
 *  球更大），仅 9 团；半速视差与回收带和现有云墙同一配方 */
function addNearCloudRow(scene: THREE.Scene) {
  const N = 9, ZTOP = 60, SPAN = 300;
  const geo = new THREE.SphereGeometry(1, 9, 6);
  geo.scale(1, 0.45, 1); // 几何级压扁＝云丘（与 stormspireProps 云墙同一配方）
  const mat = new THREE.MeshLambertMaterial({ color: P.cloudShade });
  const mesh = new THREE.InstancedMesh(geo, mat, N);
  mesh.frustumCulled = false;
  scene.add(mesh);
  const xOf = new Float32Array(N), yOf = new Float32Array(N), zOf = new Float32Array(N), sOf = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    xOf[i] = (i % 2 === 0 ? -1 : 1) * (16.5 + rnd1(i + 191) * 3); // |x|≈18（比现有近排 26 更贴赛道）
    yOf[i] = -4 + rnd1(i + 211) * 0.8;                            // 现有近排 y=-5，抬高 1m
    zOf[i] = -240 + i * 33 + rnd1(i + 227) * 20;                  // 均铺 300m 回收带
    sOf[i] = 10 + rnd1(i + 239) * 4;                              // 球更大（近排 7~10）
  }
  return {
    update(move: number) {
      for (let i = 0; i < N; i++) {
        let z = zOf[i] + move * 0.55;                             // 云墙半速视差
        if (z > ZTOP) z -= SPAN;
        zOf[i] = z;
        M.makeScale(sOf[i], sOf[i], sOf[i]);
        M.setPosition(xOf[i], yOf[i], z);
        mesh.setMatrixAt(i, M);
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
    dispose() { geo.dispose(); mat.dispose(); },
  };
}

export interface Atmosphere {
  update(move: number, t: number, dt: number): void;
  dispose?(): void;
}

export function createAtmosphere(scene: THREE.Scene): Atmosphere {
  const sea = addCloudSea(scene);
  const mist = addMist(scene);
  const rain = addRain(scene); // 三层池
  const ripples = addRipples(scene);
  const wind = addWindStreaks(scene);
  const clouds = addNearCloudRow(scene);
  return {
    update(move, t, dt) {
      sea.scroll(move, t);
      mist.scroll(move);
      for (const l of rain) l.update(dt, move);
      ripples.update(move, t);
      wind.update(move, dt);
      clouds.update(move);
    },
    dispose() {
      sea.dispose();
      mist.dispose();
      for (const l of rain) l.dispose();
      ripples.dispose();
      wind.dispose();
      clouds.dispose();
    },
  };
}
