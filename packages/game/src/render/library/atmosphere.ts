/**
 * 失重图书馆 · 氛围层（docs/scenes/library-brief.md §3.1 / §6，配方抄 stormspire/atmosphere.ts 改色改形）：
 *   inkSea    墨海条 ×4：两侧各两层异速滚动墨斑平面（38×250m，墨渊/墨青），亮层撒 2% 烛光琥珀像素＝灯笼倒影碎光。
 *   inkMist   墨雾带 ×2：贴地半透长平面（14×240m，y 0.5/1.1，墨雾色，op 0.10/0.07），横白纵渐隐 + 横向慢滚。
 *   pages     书页风暴三层 1060 片：近 260（0.3×0.42m，6~10m/s）+ 中 480 + 远 320，相机空间循环盒
 *             （抄三层雨池口径，线段→片状 quad InstancedMesh ×3）；每片绕自身 rx/ry 翻滚（确定性相位）；90% 陈纸米 + 10% 蜡封红。
 *   dust      灯下光尘 600：缓漂光点（烛光琥珀，0.02~0.05m），集中灯柱 ±3m 与近景带（抄雨池循环池结构改点精灵）。
 *   ripple    墨海涟漪 60：路缘（|x| 2.6~6）贴地扩散环 ~0.7s 生命周期（0.15→1.0 渐大 + 0.35→0 渐隐），色墨青×页尘白。
 *   pageWave  翻页光波：每 24~36s（确定性周期）一道页尘白亮带沿路面从远到近扫过（0.9s/次，带宽 3m）＝风翻全城的书。
 * 墨海条/墨雾带/光波为长条平面，按 brief §3.1 例外走贴图滚动、不进 240m 循环回收（注释即口径）。
 * 纯装饰：只吃 update(move, t)，不读 sim、不反写玩法；每帧零分配。
 */
import * as THREE from 'three';
import { rnd } from '../sceneryProps.js';
import { P } from './palette.js';

// 每帧零分配：无旋转共用一套 Matrix4/Quaternion/Euler/Vector3 暂存（均原地改写）
const M4 = new THREE.Matrix4();
const QT = new THREE.Quaternion();
const EU = new THREE.Euler(0, 0, 0, 'YXZ');
const VV = new THREE.Vector3();
const SS = new THREE.Vector3();
const C = new THREE.Color();

/** 滚动贴图公共收尾：重复包裹 + sRGB + 线性过滤 + mipmap（墨斑/墨雾共用） */
function scrollable(tex: THREE.DataTexture) {
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true; tex.needsUpdate = true;
  return tex;
}
const texHash = (x: number, y: number) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };

/** 墨斑贴图：整数周期正弦斑块（抄云斑配方）；色调直接烘进 RGB（材质取白，避免色×色叠黑出纯黑），
 *  glow=true 时撒 2% 烛光琥珀像素（灯笼倒影碎光，alpha 提亮） */
function makeInkTexture(rgb: [number, number, number], glow: boolean): THREE.DataTexture {
  const N = 128;
  const data = new Uint8Array(N * N * 4);
  const blob = (x: number, y: number, fx: number, fy: number) =>
    Math.sin(((x / N) * fx + texHash(fx, fy)) * 6.2832) * Math.cos(((y / N) * fy + texHash(fy, fx)) * 6.2832);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const m = blob(x, y, 2, 3) * 0.55 + blob(x, y, 5, 4) * 0.3 + blob(x, y, 9, 7) * 0.15;
    const a = Math.max(0, m - 0.18) * 3.1; // 负值裁零＝墨隙，亮斑＝墨面反光
    const i = (y * N + x) * 4;
    const spark = glow && texHash(x, y * 7) > 0.98; // 2% 琥珀像素点
    data[i] = spark ? 255 : rgb[0]; data[i + 1] = spark ? 182 : rgb[1]; data[i + 2] = spark ? 92 : rgb[2];
    data[i + 3] = Math.min(255, a * 255 * (spark ? 1.6 : 1));
  }
  return scrollable(new THREE.DataTexture(data, N, N, THREE.RGBAFormat));
}

/** 墨海条：桥面两侧各叠两层异速滚动的墨斑平面（38×250m，不打到路面上；长平面例外：贴图滚动不回收） */
function addInkSea(scene: THREE.Scene) {
  const mkTex = (rgb: [number, number, number], glow: boolean) => { const t = makeInkTexture(rgb, glow); t.repeat.set(2, 9); return t; };
  const layers: { tex: THREE.DataTexture; mesh: THREE.Mesh; speed: number; drift: number }[] = [];
  const strip = (tex: THREE.DataTexture, opacity: number, x: number, y: number, speed: number, drift: number) => {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(38, 250),
      new THREE.MeshBasicMaterial({ map: tex, color: 0xffffff, transparent: true, opacity, depthWrite: false }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, y, -100);
    scene.add(mesh);
    layers.push({ tex, mesh, speed, drift });
  };
  for (const x of [-25, 25]) {
    strip(mkTex([30, 26, 51], false), 0.95, x, 0.06, 1, 0);   // 底层墨渊：跟世界速度
    strip(mkTex([70, 83, 107], true), 0.42, x, 0.12, 1, 1);   // 亮层墨青：异速缓漂 + 琥珀碎光
  }
  return {
    scroll(move: number, t: number) {
      // v 轴朝 -Z，正偏移向 +Z 退（与道具同向）；亮层 0.62 倍速 = 异速滚动
      for (const l of layers) {
        l.tex.offset.y = (l.tex.offset.y + (move * l.speed * (l.drift ? 0.62 : 1)) / 25) % 1;
        if (l.drift) {
          l.tex.offset.x = t * 0.006;
          l.tex.offset.y = (l.tex.offset.y + t * 0.008) % 1;
        }
      }
    },
    dispose() { for (const l of layers) l.tex.dispose(); },
  };
}

/** 墨雾 alpha 贴图：横白（u 向匀白微斑，供横漂可读）、纵渐隐（v 向近淡远浓）——抄 mist 配方原样 */
function makeMistTexture(): THREE.DataTexture {
  const N = 128, data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x / N, v = y / N;
    const blob = Math.sin((u * 3 + texHash(3, 7)) * 6.2832) * Math.cos((v * 2 + texHash(7, 3)) * 6.2832) * 0.5 + 0.5;
    const a = (0.25 + 0.75 * v * v * (3 - 2 * v)) * (0.85 + 0.15 * blob);
    const i = (y * N + x) * 4; data[i] = 255; data[i + 1] = 255; data[i + 2] = 255; data[i + 3] = a * 255;
  }
  return scrollable(new THREE.DataTexture(data, N, N, THREE.RGBAFormat));
}

/** 墨雾带 ×2：贴地半透长平面（14×240m，y 0.5/1.1，墨雾色，op 0.10/0.07）；横向慢滚 offset=move/60 */
function addInkMist(scene: THREE.Scene) {
  const geo = new THREE.PlaneGeometry(14, 240);
  const bands: { tex: THREE.DataTexture; mat: THREE.MeshBasicMaterial }[] = [];
  for (const spec of [{ y: 0.5, op: 0.1 }, { y: 1.1, op: 0.07 }]) {
    const tex = makeMistTexture();
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, color: P.inkMist, transparent: true, opacity: spec.op, depthWrite: false, side: THREE.DoubleSide }));
    mesh.rotation.x = -Math.PI / 2; mesh.position.set(0, spec.y, -90);
    scene.add(mesh); bands.push({ tex, mat: mesh.material });
  }
  return {
    scroll(move: number) { for (const b of bands) b.tex.offset.x = (move / 60) % 1; },
    dispose() { for (const b of bands) { b.tex.dispose(); b.mat.dispose(); } geo.dispose(); },
  };
}

/** 单层书页池参数：n 片数 / w×h 页面尺寸 / v0+dv 飘落速度区间 / xMax、zTop、zDepth 循环盒 / seed 种子 / alpha 透明度 */
type PageSpec = { n: number; w: number; h: number; v0: number; dv: number; xMax: number; zTop: number; zDepth: number; seed: number; alpha: number };

/** 单层书页池：相机空间循环盒的翻滚 quad（每片一个实例，零分配原地改写矩阵），层参数独立（各 1 draw call） */
function addPageLayer(scene: THREE.Scene, p: PageSpec) {
  const TOP = 12, BOTTOM = -2, SWAY = 0.8;
  const geo = new THREE.PlaneGeometry(p.w, p.h);
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: p.alpha < 1, opacity: p.alpha, depthWrite: p.alpha >= 1 });
  const mesh = new THREE.InstancedMesh(geo, mat, p.n);
  mesh.frustumCulled = false; scene.add(mesh);
  const x0 = new Float32Array(p.n), yOf = new Float32Array(p.n), zOf = new Float32Array(p.n);
  const spd = new Float32Array(p.n), rw1 = new Float32Array(p.n), rw2 = new Float32Array(p.n), ph = new Float32Array(p.n);
  for (let i = 0; i < p.n; i++) {
    x0[i] = (rnd(i, p.seed) - 0.5) * 2 * p.xMax;
    zOf[i] = p.zTop - rnd(i, p.seed + 51) * p.zDepth;
    yOf[i] = BOTTOM + rnd(i, p.seed + 131) * (TOP - BOTTOM);       // 出生高度铺满整盒，避免开局一条水平页帘
    spd[i] = p.v0 + rnd(i, p.seed + 97) * p.dv;
    rw1[i] = 1.1 + rnd(i, p.seed + 163) * 2.2;                     // 绕自身 rx 翻滚角速度（确定性）
    rw2[i] = 0.8 + rnd(i, p.seed + 179) * 1.8;                     // 绕自身 ry 翻滚角速度
    ph[i] = rnd(i, p.seed + 199) * 6.283;
    C.setHex(rnd(i, p.seed + 211) < 0.1 ? P.wax : P.cream);        // 90% 陈纸米 + 10% 蜡封红
    mesh.setColorAt(i, C);
  }
  return {
    update(dt: number, move: number, t: number) {
      for (let i = 0; i < p.n; i++) {
        let y = yOf[i] - spd[i] * dt;
        if (y < BOTTOM) y = TOP;
        yOf[i] = y;
        let z = zOf[i] + move;
        if (z > p.zTop) z -= p.zDepth;
        zOf[i] = z;
        EU.set(t * rw1[i] + ph[i], t * rw2[i] + ph[i] * 1.7, 0);   // 绕自身 rx/ry 翻滚（确定性相位）
        QT.setFromEuler(EU);
        VV.set(x0[i] + Math.sin(t * 0.7 + ph[i]) * SWAY, y, z);    // 横向缓摆＝飘
        SS.set(1, 1, 1);
        M4.compose(VV, QT, SS);
        mesh.setMatrixAt(i, M4);
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
    dispose() { geo.dispose(); mat.dispose(); },
  };
}

/** 书页风暴三层（§6 地板 1060）：near 260（0.3×0.42m，6~10m/s，加厚冲击层）· mid 480 · far 320（细页融雾让位剪影） */
function addPages(scene: THREE.Scene) {
  return [
    addPageLayer(scene, { n: 260, w: 0.3, h: 0.42, v0: 6, dv: 4, xMax: 10, zTop: 6, zDepth: 36, seed: 900, alpha: 1 }),
    addPageLayer(scene, { n: 480, w: 0.26, h: 0.36, v0: 5, dv: 3, xMax: 15, zTop: 8, zDepth: 46, seed: 0, alpha: 0.8 }),
    addPageLayer(scene, { n: 320, w: 0.22, h: 0.3, v0: 4, dv: 2, xMax: 15, zTop: -14, zDepth: 32, seed: 1900, alpha: 0.55 }),
  ];
}

/** 灯下光尘 600：烛光琥珀点精灵（0.02~0.05m），集中在灯柱 ±3m 与近景带（|x| 2.2~8.6），缓漂 + 随世界回收 */
function addDust(scene: THREE.Scene) {
  const N = 600, ZTOP = 8, SPAN = 240;
  const geo = new THREE.OctahedronGeometry(0.5, 0);
  const mat = new THREE.MeshBasicMaterial({ color: P.amber, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false });
  const mesh = new THREE.InstancedMesh(geo, mat, N);
  mesh.frustumCulled = false; scene.add(mesh);
  const x0 = new Float32Array(N), y0 = new Float32Array(N), zOf = new Float32Array(N), sz = new Float32Array(N), ph = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    x0[i] = (i % 2 === 0 ? -1 : 1) * (2.2 + rnd(i, 11) * 6.4);     // 灯柱带 |x| 2.2~8.6（灯在 ±5.2/±5.6）
    y0[i] = 0.2 + rnd(i, 13) * 3.6;                                // y 0.2~3.8（灯头以下漂）
    zOf[i] = ZTOP - rnd(i, 17) * SPAN;
    sz[i] = 0.02 + rnd(i, 19) * 0.03;                              // 直径 0.02~0.05m
    ph[i] = rnd(i, 23) * 6.283;
  }
  return {
    update(move: number, t: number) {
      for (let i = 0; i < N; i++) {
        let z = zOf[i] + move;
        if (z > ZTOP) z -= SPAN;
        zOf[i] = z;
        VV.set(x0[i] + Math.sin(t * 0.3 + ph[i]) * 0.4, y0[i] + Math.sin(t * 0.22 + ph[i] * 2.1) * 0.3, z);
        SS.set(sz[i], sz[i], sz[i]);
        M4.compose(VV, QT.identity(), SS);
        mesh.setMatrixAt(i, M4);
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
    dispose() { geo.dispose(); mat.dispose(); },
  };
}

/** 墨海涟漪 60：路缘（|x| 2.6~6、y 0.04）贴地扩散环 ~0.7s 生命周期循环（0.15→1.0 渐大 + 0.35→0 渐隐），
 *  色墨青×页尘白（抄 ripples 配方改色）；落点固定相位错开 = 墨潮拍上桥墩荡开一圈 */
function addRipples(scene: THREE.Scene) {
  const N = 60, ZTOP = 8, SPAN = 68;
  const geo = new THREE.RingGeometry(0.7, 1.0, 20);
  geo.rotateX(-Math.PI / 2); // 几何级转平＝贴地环
  const mat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(P.teal).lerp(new THREE.Color(P.pageDust), 0.55), // 墨青×页尘白
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, N);
  mesh.frustumCulled = false; scene.add(mesh);
  const xOf = new Float32Array(N), zOf = new Float32Array(N), ph = new Float32Array(N), rate = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    xOf[i] = (i % 2 === 0 ? -1 : 1) * (2.6 + rnd(i, 7) * 3.4);     // 路缘带 |x|<6，避开中央跑带
    zOf[i] = ZTOP - rnd(i, 23) * SPAN;
    ph[i] = rnd(i, 41);
    rate[i] = 1.3 + rnd(i, 59) * 0.4;                              // ~0.6-0.77s 荡开一圈
  }
  return {
    update(move: number, t: number) {
      for (let i = 0; i < N; i++) {
        let z = zOf[i] + move;
        if (z > ZTOP) z -= SPAN;
        zOf[i] = z;
        const life = (t * rate[i] + ph[i]) % 1;
        const s = 0.15 + 0.85 * life;                              // 0.15→1.0 渐大
        M4.makeScale(s, s, s);
        M4.setPosition(xOf[i], 0.04, z);
        mesh.setMatrixAt(i, M4);
        C.setScalar(0.35 * (1 - life)); mesh.setColorAt(i, C);     // 0.35→0 渐隐（等效 opacity）
      }
      mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    },
    dispose() { geo.dispose(); mat.dispose(); },
  };
}

/** 翻页光波：1 条 3×240m 加色半透长平面（3m 横向亮带沿 240m 路幅），贴图亮带 v 向扫描＝从远(v1)到近(v0)；
 *  每 24~36s（确定性周期 rnd(9,4)）扫一次、0.9s/次，间隙 opacity 归零隐藏；长平面例外：贴图滚动不回收 */
function addPageWave(scene: THREE.Scene) {
  const SWEEP = 0.9;
  const PERIOD = 24 + rnd(9, 4) * 12; // 24~36s，确定性
  const N = 64, ROWS = 256;
  const data = new Uint8Array(N * ROWS * 4);
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < N; x++) {
    const v = (y + 0.5) / ROWS - 0.5;                              // 亮带中心 v=0.5，带宽 3m/240m≈0.0125（高斯软边）
    const a = Math.exp(-(v * v) / (2 * 0.006 * 0.006)) * (0.7 + 0.3 * texHash(x, 5));
    const i = (y * N + x) * 4;
    data[i] = 255; data[i + 1] = 255; data[i + 2] = 255; data[i + 3] = 255 * a;
  }
  const tex = new THREE.DataTexture(data, N, ROWS, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter; tex.needsUpdate = true;
  const geo = new THREE.PlaneGeometry(3, 240);
  const mat = new THREE.MeshBasicMaterial({ map: tex, color: P.pageDust, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(0, 0.07, -90); // 覆盖 z +30 ~ -210；长平面例外：亮带走贴图 v 扫描，不回收
  scene.add(mesh);
  return {
    sweep(t: number) {
      const c = t % PERIOD;
      mat.opacity = c < SWEEP ? 0.5 : 0;
      if (c < SWEEP) tex.offset.y = -0.5 + c / SWEEP;              // 亮带自 v=1（远端）匀速扫到 v=0（近端）
    },
    dispose() { geo.dispose(); mat.dispose(); tex.dispose(); },
  };
}

export interface Atmosphere { update(move: number, t: number): void; dispose?(): void }

export function createAtmosphere(scene: THREE.Scene): Atmosphere {
  const sea = addInkSea(scene);
  const mist = addInkMist(scene);
  const pages = addPages(scene); // 三层池 1060 片
  const dust = addDust(scene);
  const ripples = addRipples(scene);
  const wave = addPageWave(scene);
  let lastT = 0;
  return {
    update(move, t) {
      const dt = Math.min(Math.max(t - lastT, 0), 0.1); // dt 由 t 差分得出（SceneryProps 只传 move/t）
      lastT = t;
      sea.scroll(move, t);
      mist.scroll(move);
      for (const l of pages) l.update(dt, move, t);
      dust.update(move, t);
      ripples.update(move, t);
      wave.sweep(t);
    },
    dispose() {
      sea.dispose();
      mist.dispose();
      for (const l of pages) l.dispose();
      dust.dispose();
      ripples.dispose();
      wave.dispose();
    },
  };
}
