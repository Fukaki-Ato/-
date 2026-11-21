/**
 * 熔炉巨兽 · 氛围层（docs/scenes/forgeheart-brief.md §3.1 潮汐 / §3.5 岩浆海 / §6 粒子）：
 *   lavaSea  岩浆海：双层异速滚动平面（云海条配方贴地）+ 层下渣滩壳；y = −6.5 + 5.7·level(distAcc)
 *            （tide.ts 纯函数），喷发段 +0.3·sin(2Hz) 脉动；亮斑层 opacity 0.42→0.7 随潮位、
 *            UV 0.5 倍速反向滚（壳层漂移错觉）；低潮岩浆面降到渣滩壳以下＝「渣滩全线敞开」。
 *   ash      上升灰烬：1400 条拖尾线段三层（近 380 加色提亮 / 中 700 / 远 320），雨配方反向——
 *            向上漂 +2~4m/s、横漂 3°，出盒顶回盒底；喷发段密度 ×2.5（§3.1）。
 *   mist     热浪雾带：2 条贴岩浆面低层薄雾（熔渣褐＝§2 雾色口径，op 0.10/0.07，横滚），高潮驻留 ×1.5。
 *   sparks   火星泡：岩浆面 60 枚贴面扩散环 ~0.7s 生命周期（0.15→1.0 渐大+渐隐，确定性相位，
 *            addRipples 配方），落点锁亮斑层上方。
 *   streaks  热流痕：12 条岩浆面亮斑条带（炉火橙 additive 扁盒贴面），略快于世界流速滚动出画绕回
 *            （熔流快于壳层，原地不动也有热流）。
 * 取数口径（§3.1）：本模块自累积 distAcc += move 后调 tide.ts 纯函数；Phase B 收敛进 sim。
 * 纯装饰：只吃 update(move, t)，不读 sim；每帧零分配，确定性 rnd 禁 Math.random；发光只用炉火橙（二分见 palette.ts）。
 */
import * as THREE from 'three';
import { P } from './palette.js';
import { level, surgeWindow } from './tide.js';

/** 文件内确定性伪随机（禁 Math.random）：同下标恒同结果，回放安全 */
const rnd1 = (i: number) => { const s = Math.sin(i * 127.1 + 37.7) * 43758.5453; return s - Math.floor(s); };
const texHash = (x: number, y: number) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
/** 整数周期正弦斑块（接缝无格纹，与 stormspire 云斑同一配方，N=128） */
const blob = (x: number, y: number, fx: number, fy: number) =>
  Math.sin(((x / 128) * fx + texHash(fx, fy)) * 6.2832) * Math.cos(((y / 128) * fy + texHash(fy, fx)) * 6.2832);

// 潮位→岩浆面 y（§3.1：低潮堤道缘下 6.5m、高潮 0.8m）；渣滩壳恒略高于低潮面=低潮露出
const LAVA_Y0 = -6.5, LAVA_RISE = 5.7, CRUST_Y = -6.2;
// 每帧零分配：实例矩阵与渐隐色共用一份原地改写（无旋转件不需四元数）
const M = new THREE.Matrix4();
const C = new THREE.Color();

/** 滚动贴图公共收尾：重复包裹 + sRGB + 线性过滤 + mipmap（岩浆斑/渣滩壳/雾带共用） */
function scrollable(tex: THREE.DataTexture) {
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true; tex.needsUpdate = true;
  return tex;
}

/** 岩浆底斑：渣暗面↔熔渣褐双调斑纹（RGB 直出固有色，Basic 不受光=炉液自明） */
function makeLavaTexture() {
  const N = 128, data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const m = blob(x, y, 2, 3) * 0.55 + blob(x, y, 5, 4) * 0.3 + blob(x, y, 9, 7) * 0.15;
    const v = 0.5 + 0.5 * m, i = (y * N + x) * 4; // 0=渣暗面(P.slagDark) 1=熔渣褐(P.slag)
    data[i] = 52 + 22 * v; data[i + 1] = 40 + 18 * v; data[i + 2] = 32 + 14 * v; data[i + 3] = 255;
  }
  return scrollable(new THREE.DataTexture(data, N, N, THREE.RGBAFormat));
}

/** 亮斑层 alpha：熔流破壳亮斑（RGB 恒白交回材质色 P.ember，明暗/色调分离同云海配方） */
function makeEmberTexture() {
  const N = 128, data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const m = blob(x, y, 3, 4) * 0.5 + blob(x, y, 7, 5) * 0.3 + blob(x, y, 11, 8) * 0.2;
    const a = Math.max(0, m - 0.3) * 3.6, i = (y * N + x) * 4; // 负值裁零＝黑壳隙，亮斑＝熔流
    data[i] = 255; data[i + 1] = 255; data[i + 2] = 255; data[i + 3] = Math.min(255, a * 255);
  }
  return scrollable(new THREE.DataTexture(data, N, N, THREE.RGBAFormat));
}

/** 渣滩壳：熔渣褐斑 + |blob| 谷线嵌烧结赤裂纹（热但死不发光）+ alpha 露洞（缝间透岩浆火光） */
function makeCrustTexture() {
  const N = 128, data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const m = blob(x, y, 2, 5) * 0.5 + blob(x, y, 6, 3) * 0.3 + blob(x, y, 10, 9) * 0.2;
    const crack = Math.abs(blob(x, y, 4, 7)), v = 0.5 + 0.5 * m, i = (y * N + x) * 4;
    let r = 52 + 22 * v, g = 40 + 18 * v, b = 32 + 14 * v;
    if (crack < 0.12) { const w = 1 - crack / 0.12; r += (122 - r) * w; g += (59 - g) * w; b += (45 - b) * w; } // 烧结赤
    data[i] = r; data[i + 1] = g; data[i + 2] = b;
    data[i + 3] = Math.max(0, Math.min(255, (0.3 + 0.75 * m) * 255)); // 负斑裁零＝露洞
  }
  return scrollable(new THREE.DataTexture(data, N, N, THREE.RGBAFormat));
}

/** 雾带 alpha：横白（u 向匀白微斑，供横漂可读）+ 纵渐隐（v 向近淡远浓，v=1 为 -Z 远端） */
function makeMistTexture() {
  const N = 128, data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x / N, v = y / N;
    const sp = Math.sin((u * 3 + texHash(3, 7)) * 6.2832) * Math.cos((v * 2 + texHash(7, 3)) * 6.2832) * 0.5 + 0.5;
    const a = (0.25 + 0.75 * v * v * (3 - 2 * v)) * (0.85 + 0.15 * sp);
    const i = (y * N + x) * 4; data[i] = 255; data[i + 1] = 255; data[i + 2] = 255; data[i + 3] = a * 255;
  }
  return scrollable(new THREE.DataTexture(data, N, N, THREE.RGBAFormat));
}

/** 岩浆海：双层异速滚动大平面 + 渣滩壳（§3.5）。长条贴 y 移动不回收（铁律例外）：
 *  运动感全交纹理 offset，y 每帧贴潮位（只写 position.y 与材质参数，零分配） */
function addLavaSea(scene: THREE.Scene) {
  const lavaTex = makeLavaTexture(); lavaTex.repeat.set(4, 10);
  const emberTex = makeEmberTexture(); emberTex.repeat.set(3, 8);
  const crustTex = makeCrustTexture(); crustTex.repeat.set(5, 14);
  const plane = new THREE.PlaneGeometry(76, 260); // 覆盖炉腔内径 60m + 余量
  const base = new THREE.Mesh(plane, new THREE.MeshBasicMaterial({ map: lavaTex }));
  base.rotation.x = -Math.PI / 2; base.position.set(0, LAVA_Y0, -100);
  const crust = new THREE.Mesh(plane, new THREE.MeshLambertMaterial({ map: crustTex, transparent: true, depthWrite: false }));
  crust.rotation.x = -Math.PI / 2; crust.position.set(0, CRUST_Y, -100); crust.renderOrder = 1;
  const bright = new THREE.Mesh(plane, new THREE.MeshBasicMaterial({ map: emberTex, color: P.ember, transparent: true, opacity: 0.42, depthWrite: false }));
  bright.rotation.x = -Math.PI / 2; bright.position.set(0, LAVA_Y0 + 0.12, -100); bright.renderOrder = 2;
  scene.add(base, crust, bright);
  return {
    /** 贴潮位并滚纹理，返回岩浆面 y（供火星泡/雾带/热流痕同源贴面） */
    scroll(move: number, t: number, lvl: number, surge: boolean) {
      const y = LAVA_Y0 + LAVA_RISE * lvl + (surge ? 0.3 * Math.sin(t * 12.566) : 0); // 喷发段 2Hz 脉动
      base.position.y = y; bright.position.y = y + 0.12;
      (bright.material as THREE.MeshBasicMaterial).opacity = 0.42 + 0.28 * lvl;       // 亮斑 0.42→0.7
      lavaTex.offset.y = (lavaTex.offset.y + move / 26) % 1;                          // 底层跟世界
      emberTex.offset.y = (emberTex.offset.y - move * 0.5 / 32.5) % 1;                // 亮斑 0.5 倍速反向
      emberTex.offset.x = t * 0.006;                                                  // 壳层漂移错觉
      crustTex.offset.y = (crustTex.offset.y + move / 18.6) % 1;
      return y;
    },
    dispose() {
      lavaTex.dispose(); emberTex.dispose(); crustTex.dispose(); plane.dispose();
      for (const m of [base, crust, bright]) (m.material as THREE.Material).dispose();
    },
  };
}

/** 单层灰烬池参数：n 条数 / len 线长 / alpha / v0+dv 上升速度区间 / xMax、zTop、zDepth 落盒 / seed */
type AshSpec = { n: number; len: number; alpha: number; v0: number; dv: number; xMax: number; zTop: number; zDepth: number; seed: number; add?: boolean };

/** 单层上升灰烬池：雨配方反向——线段向上漂（自速 +2~4m/s、横漂 3°），出盒顶回盒底；
 *  dens 门控常态 0.4、喷发段 1.0＝密度 ×2.5（§3.1），被门控段折成零长（零分配隐身） */
function addAshLayer(scene: THREE.Scene, p: AshSpec) {
  const TOP = 12, BOTTOM = -7, SLANT = 0.052; // 横漂 3°（tan3°≈0.052）
  const pos = new Float32Array(p.n * 2 * 3);
  const spd = new Float32Array(p.n), xOf = new Float32Array(p.n), zOf = new Float32Array(p.n), dens = new Float32Array(p.n);
  for (let i = 0; i < p.n; i++) {
    xOf[i] = (rnd1(i + p.seed) - 0.5) * 2 * p.xMax;
    zOf[i] = p.zTop - rnd1(i + p.seed + 51) * p.zDepth;
    spd[i] = p.v0 + rnd1(i + p.seed + 97) * p.dv;
    dens[i] = rnd1(i + p.seed + 211);
    // 出生高度铺满整盒（避免开局一条水平灰线）；头在上、尾在下（拖尾追不上上升）
    const y = BOTTOM + rnd1(i + p.seed + 131) * (TOP - BOTTOM);
    const x = xOf[i] + (y - BOTTOM) * SLANT, z = zOf[i], j = i * 6;
    pos[j] = x; pos[j + 1] = y; pos[j + 2] = z;
    pos[j + 3] = x - SLANT * p.len; pos[j + 4] = y - p.len; pos[j + 5] = z;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.LineBasicMaterial({ color: P.ash, transparent: true, opacity: p.alpha,
    blending: p.add ? THREE.AdditiveBlending : THREE.NormalBlending, depthWrite: !p.add });
  const lines = new THREE.LineSegments(geo, mat); lines.frustumCulled = false; scene.add(lines);
  return {
    update(dt: number, move: number, gate: number) {
      for (let i = 0; i < p.n; i++) {
        let y = pos[i * 6 + 1] + spd[i] * dt;
        if (y > TOP) y -= TOP - BOTTOM;
        zOf[i] += move;
        if (zOf[i] > p.zTop) zOf[i] -= p.zDepth;
        const len = dens[i] <= gate ? p.len : 0; // 门控外＝零长段隐身
        const x = xOf[i] + (y - BOTTOM) * SLANT, z = zOf[i], j = i * 6;
        pos[j] = x; pos[j + 1] = y; pos[j + 2] = z;
        pos[j + 3] = x - SLANT * len; pos[j + 4] = y - len; pos[j + 5] = z;
      }
      geo.attributes.position.needsUpdate = true;
    },
    dispose() { geo.dispose(); mat.dispose(); },
  };
}

/** 三层灰烬池：near 380（长1.1/α0.5/2.6-4m/s，|x|<10、z[-30,6]，加色提亮冲击层）·
 *  mid 700（0.55/α0.34/2-4m/s 全盒）· far 320（0.3/α0.16/2-3m/s，z[-46,-14] 融雾让位剪影） */
function addAsh(scene: THREE.Scene) {
  return [
    addAshLayer(scene, { n: 380, len: 1.1, alpha: 0.5, v0: 2.6, dv: 1.4, xMax: 10, zTop: 6, zDepth: 36, seed: 900, add: true }),
    addAshLayer(scene, { n: 700, len: 0.55, alpha: 0.34, v0: 2, dv: 2, xMax: 16, zTop: 8, zDepth: 46, seed: 0 }),
    addAshLayer(scene, { n: 320, len: 0.3, alpha: 0.16, v0: 2, dv: 1, xMax: 16, zTop: -14, zDepth: 32, seed: 1900 }),
  ];
}

/** 热浪雾带：2 条贴岩浆面低层薄雾（addMist 配方，14×240m，色熔渣褐，op 0.10/0.07，
 *  alpha 纵向渐浓＝远端更实）；y 随潮位（岩浆面 +0.5/+1.1），高潮驻留段 opacity ×1.5 */
function addMistBands(scene: THREE.Scene) {
  const geo = new THREE.PlaneGeometry(14, 240);
  const tex = makeMistTexture(); // 两带共用一张（offset 同步横滚）
  const bands = [0.5, 1.1].map((dy, i) => {
    const mat = new THREE.MeshBasicMaterial({ map: tex, color: P.slag, transparent: true, opacity: i ? 0.07 : 0.1, depthWrite: false, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2; mesh.position.set(0, dy, -90); mesh.renderOrder = 4; // 覆盖 z +30~-210
    scene.add(mesh);
    return { mesh, mat, dy, op: i ? 0.07 : 0.1 };
  });
  return {
    update(move: number, lavaY: number, highDwell: boolean) {
      tex.offset.x = (move / 60) % 1;
      for (const b of bands) {
        b.mesh.position.y = lavaY + b.dy;
        b.mat.opacity = b.op * (highDwell ? 1.5 : 1);
      }
    },
    dispose() { tex.dispose(); geo.dispose(); for (const b of bands) b.mat.dispose(); },
  };
}

/** 火星泡：岩浆面 60 枚贴面扩散环（RingGeometry 转平贴面），确定性生命周期 (t·rate+相位)%1 ~0.7s：
 *  scale 0.15→1.0 渐大 + instanceColor 0.35→0 渐隐（加色混暗＝等效淡出），死了重开新周期 */
function addSparks(scene: THREE.Scene) {
  const N = 60, ZTOP = 8, SPAN = 68;
  const geo = new THREE.RingGeometry(0.7, 1.0, 20);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({ color: P.ember, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  const mesh = new THREE.InstancedMesh(geo, mat, N);
  mesh.frustumCulled = false; scene.add(mesh);
  const xOf = new Float32Array(N), zOf = new Float32Array(N), ph = new Float32Array(N), rate = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    xOf[i] = (i % 2 === 0 ? -1 : 1) * (3 + rnd1(i + 7) * 30); // 岩浆海全域 |x| 3~33（海在路下不避中带）
    zOf[i] = ZTOP - rnd1(i + 23) * SPAN;
    ph[i] = rnd1(i + 41);
    rate[i] = 1.3 + rnd1(i + 59) * 0.4;                       // ~0.6-0.77s 荡开一圈
  }
  return {
    update(move: number, t: number, lavaY: number) {
      for (let i = 0; i < N; i++) {
        let z = zOf[i] + move;
        z -= Math.ceil((z - ZTOP) / SPAN) * SPAN; // ceil 多重回收：大步长（后台回前台）也一次到位
        zOf[i] = z;
        const life = (t * rate[i] + ph[i]) % 1;
        const s = 0.15 + 0.85 * life;
        M.makeScale(s, s, s);
        M.setPosition(xOf[i], lavaY + 0.24, z);
        mesh.setMatrixAt(i, M);
        C.setScalar(0.35 * (1 - life)); mesh.setColorAt(i, C);
      }
      mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    },
    dispose() { geo.dispose(); mat.dispose(); },
  };
}

/** 热流痕：12 条岩浆面亮斑条带（炉火橙 additive 扁盒贴面，op 0.5）——熔流快于壳层：
 *  z += move·流率 + 自速（原地不动也有热流），出画绕回（绕回点 z=12 在相机身后不穿帮） */
function addStreaks(scene: THREE.Scene) {
  const N = 12, ZTOP = 12, SPAN = 104;
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const mat = new THREE.MeshBasicMaterial({ color: P.ember, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false });
  const mesh = new THREE.InstancedMesh(geo, mat, N);
  mesh.frustumCulled = false; scene.add(mesh);
  const xOf = new Float32Array(N), zOf = new Float32Array(N), sx = new Float32Array(N), sz = new Float32Array(N);
  const flow = new Float32Array(N), spd = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    xOf[i] = (i % 2 === 0 ? -1 : 1) * (2 + rnd1(i + 301) * 30);
    zOf[i] = ZTOP - rnd1(i + 313) * SPAN;
    sx[i] = 0.6 + rnd1(i + 331) * 0.9;   // 宽 0.6~1.5m
    sz[i] = 4 + rnd1(i + 337) * 5;       // 条带长 4~9m
    flow[i] = 1.12 + rnd1(i + 349) * 0.13; // 流率：略快于世界速度
    spd[i] = 1.2 + rnd1(i + 359) * 1.2;  // 自速 m/s
  }
  return {
    update(move: number, dt: number, lavaY: number) {
      for (let i = 0; i < N; i++) {
        let z = zOf[i] + move * flow[i] + spd[i] * dt;
        z -= Math.ceil((z - ZTOP) / SPAN) * SPAN; // ceil 多重回收：大步长（后台回前台）也一次到位
        zOf[i] = z;
        M.makeScale(sx[i], 0.06, sz[i]);
        M.setPosition(xOf[i], lavaY + 0.18, z);
        mesh.setMatrixAt(i, M);
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
    dispose() { geo.dispose(); mat.dispose(); },
  };
}

export interface Atmosphere {
  update(move: number, t: number): void;
  dispose?(): void;
}

export function createAtmosphere(scene: THREE.Scene): Atmosphere {
  const sea = addLavaSea(scene);
  const ash = addAsh(scene);
  const mist = addMistBands(scene);
  const sparks = addSparks(scene);
  const streaks = addStreaks(scene);
  let distAcc = 0, lastT = 0;
  return {
    update(move, t) {
      distAcc += move; // §3.1 取数口径：渲染层自累积距离，Phase B 收敛进 sim 单源
      const dt = Math.min(Math.max(t - lastT, 0), 0.1); lastT = t; // 只传 move/t，dt 由 t 差分
      const lvl = level(distAcc);
      const surge = surgeWindow(distAcc);
      const lavaY = sea.scroll(move, t, lvl, surge);
      for (const l of ash) l.update(dt, move, surge ? 1 : 0.4); // 喷发段灰烬密度 ×2.5
      mist.update(move, lavaY, lvl > 0.995); // 高潮驻留段（level 平台）读法
      sparks.update(move, t, lavaY);
      streaks.update(move, dt, lavaY);
    },
    dispose() {
      sea.dispose();
      for (const l of ash) l.dispose();
      mist.dispose();
      sparks.dispose();
      streaks.dispose();
    },
  };
}
