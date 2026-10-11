/**
 * 白日海景 · 侧景道具集（scenery = "coast"）。
 * 四条摆位口径（用户两轮反馈定下来的，别再改回去）：
 * ① |x| < KEEP 之内（跑道 + 护栏）一律不摆景观 ⇒ 灌木不会长在车道上；
 * ② 大件先占地（别墅平台、遮阳伞、椰树、长椅、礁石、栅栏走廊），花草只往剩下的空地塞
 *    ⇒ 「两旁有东西的地方就不再放灌木」；
 * ③ 每类元素一份几何 + 一批实例，各自独立绕回 ⇒ 不再有「一整节布景跑一半突然连片消失」；
 * ④ 沙底与海面是沿 z 无特征的静态长条，不滚动也就永远不会跳，动态交给逐件摆的碎浪、水洼、贝壳。
 * 动态全部轻量化：海面起伏/细碎波光/水线泡沫/远景景深在着色器里算（零 CPU 逐帧），
 * 薄雾横飘、玻璃反光扫过、室内暖光呼吸、草灌整片轻摆、海鸥绕飞扇翅走实例化。
 */
import * as THREE from 'three';
import type { SceneryProps } from '../sceneryProps.js';
import { Diorama, Layer, poolMat, toonMats, writeSpot, rnd, type Bucket, type Spot } from '../konbini/kit.js';
import { P } from './palette.js';
import { ANCHOR_V, buildVilla } from './villa.js';
import { buildVillaInterior } from './villaIn.js';
import {
  SHORE, buildBench, buildBucket, buildFlora, buildFloweringShrub, buildFoam, buildGullBody,
  buildGullWing, buildPalm, buildParasolSet, buildPebble, buildPuddle, buildRingPost, buildRocks, buildSandBase,
  buildShell,
} from './beach.js';
import { mistGeo, seaMat, shallowMat, waterGeo } from './sea.js';

const LOOP = 200, WRAP_Z = 18;
const VILLA_X = 12.3, VILLA_S = 1.15, KEEP = 4.75;
/** 右侧躺椅遮阳伞：按「离路再远 7 米」从 x=5.1 挪到 12.1（护栏在 4.15，原来几乎贴着路） */
const PARASOL_R = 12.1;
const GULL = 7;

const spot = (x: number, z: number, ry = 0, s = 1): Spot => ({ x, y: 0, z, ry, s });
const wrapZ = (z: number): number => z - Math.ceil((z - WRAP_Z) / LOOP) * LOOP;
const at = (v: Spot, lx: number, ly: number, lz: number): [number, number, number] =>
  [v.x + lx * v.s, v.y + ly * v.s, v.z + lz * v.s];

/** 一只海鸥的瞬时位姿：绕海面一个大椭圆慢慢盘，附带起伏与航向 */
function gullPath(i: number, t: number): [number, number, number, number] {
  const w = t * (0.1 + i * 0.012) + i * 1.4;
  const r = 11 + i * 3.4;
  const x = -19 - i * 2.2 + Math.cos(w) * r;
  const z = -60 - i * 17 + Math.sin(w) * r * 0.62;
  const y = 7.5 + i * 0.9 + Math.sin(t * 0.7 + i) * 0.7;
  return [x, y, z, Math.atan2(-Math.sin(w) * 0.62, -Math.cos(w)) + Math.PI / 2];
}

export function createCoastProps(scene: THREE.Scene): SceneryProps {
  const mats = toonMats(1.06);
  const toonRamp = (mats.body as THREE.MeshToonMaterial).gradientMap;
  const tmp = new THREE.Color();
  const taken: number[][] = [];
  const lists: Spot[][] = [];                                   // 每条列表每帧只推进一次 z
  const meshes: { mesh: THREE.InstancedMesh; at: Spot[] }[] = [];

  /** 占位与避让：先摆的先占地，后摆的只在空位落 */
  const free = (x: number, z: number, r: number): boolean =>
    Math.abs(x) >= KEEP && !taken.some(b => x > b[0] - r && x < b[1] + r && z > b[2] - r && z < b[3] + r);
  const take = (x0: number, x1: number, z0: number, z1: number): void => { taken.push([x0, x1, z0, z1]); };

  /** 一份几何 = 一类元素；scroll=false 表示这条不跟着跑道后退（静态长条） */
  const place = (d: Diorama, at: Spot[], buckets: Bucket[], scroll = true): void => {
    for (const b of buckets) {
      const geo = d.geometry(b);
      if (!geo) continue;
      const mesh = new THREE.InstancedMesh(geo, mats[b], at.length);
      for (let i = 0; i < at.length; i++) writeSpot(mesh, i, at[i]);
      mesh.instanceMatrix.needsUpdate = true;
      mesh.frustumCulled = false;
      scene.add(mesh);
      meshes.push({ mesh, at });
    }
    if (scroll) lists.push(at);
  };
  const build = (fn: (d: Diorama) => void): Diorama => { const d = new Diorama(); fn(d); return d; };

  // ---------- ① 大件先摆、先占地 ----------
  const villa = new Diorama();
  buildVilla(villa);
  buildVillaInterior(villa);
  const villas = [spot(VILLA_X, -30, 0, VILLA_S), spot(VILLA_X, -130, 0, VILLA_S)];
  villas.forEach(v => take(v.x - 6, v.x + 6.5, v.z - 6, v.z + 6));
  place(villa, villas, ['body', 'glow', 'glass']);

  const parasols: Spot[] = [];
  for (const z of [-50, -60, -70, -80, -90, -140, -150]) parasols.push(spot(PARASOL_R, z, (rnd(z, 3) - 0.5) * 0.5));
  for (const z of [-22, -72, -122, -172]) parasols.push(spot(-7.9, z, Math.PI + (rnd(z, 5) - 0.5) * 0.4));
  parasols.forEach(p => take(p.x - 1.8, p.x + 1.8, p.z - 1.8, p.z + 1.8));
  place(build(buildParasolSet), parasols, ['body']);

  const palms: Spot[] = [];
  for (let i = 0; i < 6; i++) {
    const x = -8.9 - rnd(i, 9) * 1.7, z = -6 - i * 33 - rnd(i, 7) * 8;
    palms.push(spot(x, z, rnd(i, 11) * 6.28, 0.82 + rnd(i, 13) * 0.4));
    take(x - 1.7, x + 1.7, z - 1.7, z + 1.7);
  }
  place(build(buildPalm), palms, ['body']);

  const benches: Spot[] = [];
  for (const z of [-18, -34, -96, -160]) { benches.push(spot(-8.5, z, Math.PI / 2)); take(-9.7, -7.3, z - 1.2, z + 1.2); }
  place(build(buildBench), benches, ['body']);

  const rocks: Spot[] = [];
  for (let i = 0; i < 7; i++) {
    const x = -10.6 - rnd(i, 19) * 1.2, z = -14 - i * 27 - rnd(i, 17) * 6;
    rocks.push(spot(x, z, rnd(i, 21) * 6.28, 0.8 + rnd(i, 23) * 0.55));
    take(x - 1.9, x + 1.9, z - 1.9, z + 1.9);
  }
  place(build(buildRocks), rocks, ['body']);

  const gear: Spot[] = [], rings: Spot[] = [];
  for (const z of [-42, -108, -176]) { gear.push(spot(-7.5, z, rnd(z, 25) * 6.28)); take(-8.4, -6.6, z - 0.9, z + 0.9); }
  for (const z of [-64, -132, -196]) { rings.push(spot(-7.3, z, 0)); take(-8.1, -6.5, z - 0.9, z + 0.9); }
  place(build(buildBucket), gear, ['body']);
  place(build(buildRingPost), rings, ['body']);

  // ---------- 开花灌木丛：栅栏撤掉后腾出的这条带子正好给它，左右都要有 ----------
  const shrubs: Spot[] = [];
  for (let i = 0; i < 260 && shrubs.length < 26; i++) {
    const right = i % 3 === 0;
    const x = right ? 7.2 + rnd(i, 71) * 4.2 : -6.9 - rnd(i, 73) * 2.9;
    const z = 14 - (i * 7.3) % LOOP - rnd(i, 75) * 3;
    if (!free(x, z, 1.15)) continue;
    shrubs.push(spot(x, z, rnd(i, 77) * 6.28, 0.8 + rnd(i, 79) * 0.7));
    take(x - 0.9, x + 0.9, z - 0.9, z + 0.9);
  }
  const shrubModel = build(buildFloweringShrub);
  place(shrubModel, shrubs, ['body', 'glow']);

  // ---------- ② 花草只往空地塞（栅栏撤了，左右两条沙带都空出来给它） ----------
  const flora: Spot[] = [];
  for (let i = 0; i < 320 && flora.length < 46; i++) {
    const right = i % 2 > 0;
    const x = right ? 5.2 + rnd(i, 29) * 1.7 : -6.6 - rnd(i, 31) * 3.2;
    const z = 12 - (i * 5.3) % LOOP - rnd(i, 33) * 2.5;
    if (!free(x, z, 0.8)) continue;
    flora.push(spot(x, z, rnd(i, 37) * 6.28, 0.8 + rnd(i, 39) * 0.6));
  }
  // 花草不再单独摆一份：下面那个风动层就是它的唯一绘制批次（同一份几何、同一批位置）
  const floraModel = build(buildFlora);
  lists.push(flora);

  // ---------- ③ 沙面细节：碎浪、水洼、贝壳、卵石（逐件摆 ⇒ 海岸线不规则，不是一条直线） ----------
  const foam: Spot[] = [], puddles: Spot[] = [], shells: Spot[] = [], pebbles: Spot[] = [];
  for (let i = 0; i < 56; i++) {
    foam.push(spot(SHORE.waterEdge + 0.4 + rnd(i, 43) * 1.7, 14 - i * 3.7 - rnd(i, 41) * 2,
      (rnd(i, 45) - 0.5) * 0.55, 0.55 + rnd(i, 47) * 1.0));
  }
  for (let i = 0; i < 18; i++) {
    puddles.push(spot(-9.6 - rnd(i, 51) * 2.4, 10 - i * 11.4, (rnd(i, 53) - 0.5) * 0.8, 0.7 + rnd(i, 55) * 0.9));
  }
  for (let i = 0; i < 46; i++) {
    shells.push(spot(-6.9 - rnd(i, 57) * 4.8, 12 - i * 4.3 - rnd(i, 59) * 3, rnd(i, 61) * 6.28, 0.7 + rnd(i, 63) * 0.8));
  }
  for (let i = 0; i < 24; i++) {
    pebbles.push(spot(-7.4 - rnd(i, 65) * 4.2, 8 - i * 8.3 - rnd(i, 67) * 4, rnd(i, 69) * 6.28, 0.7 + rnd(i, 71) * 0.8));
  }
  place(build(buildFoam), foam, ['body']);
  place(build(buildPuddle), puddles, ['body', 'glow']);
  place(build(buildShell), shells, ['body']);
  place(build(buildPebble), pebbles, ['body']);

  // ---------- ④ 静态：沙底两带宽 + 海面 + 浅滩（沿 z 无特征，不滚动也就不会跳） ----------
  place(build(buildSandBase), [spot(0, 0)], ['body'], false);
  const seaU = seaMat(P.seaLight, P.seaDeep, P.foam, P.haze, 0.26, 0.05, 0.8);
  const sea = new THREE.Mesh(waterGeo(84, 320, 46), seaU);
  sea.position.set(-54, 0, -84);
  scene.add(sea);
  const shU = shallowMat(P.seaLight, P.foam);
  const shallow = new THREE.Mesh(waterGeo(7.6, 216, 18), shU);
  shallow.position.set(-11.6, 0.05, -84);
  scene.add(shallow);

  // ---------- 动态层 ----------
  const mist = new Layer(scene, mistGeo(46, 9), poolMat(P.mist, 0.17, 90, 250), 4, (i, t, out) => {
    out.x = -34 - i * 12 + Math.sin(t * 0.035 + i * 1.7) * 5;
    out.y = 2.6 + i * 1.15; out.z = -118 - i * 24; out.ry = 0; out.s = 1 + i * 0.22;
  });
  const glint = new Layer(scene, waterGeo(0.62, 0.1, 1), new THREE.MeshBasicMaterial({
    color: '#ffffff', transparent: true, opacity: 0.85, fog: false, blending: THREE.AdditiveBlending, depthWrite: false,
  }), 74, (i, t, out) => {
    out.x = -13.5 - rnd(i, 21) * 40; out.y = 0.06; out.z = -6 - rnd(i, 23) * 150;
    out.ry = (rnd(i, 27) - 0.5) * 0.7; out.s = 0.6 + rnd(i, 29) * 1.1;
    const ph = Math.sin(t * (1.4 + rnd(i, 31) * 1.9) + rnd(i, 37) * 6.2);
    glint.tint(i, tmp.setScalar(Math.max(0, ph * ph * ph - 0.25)));
  });
  const sheen = new Layer(scene, new THREE.PlaneGeometry(1, 1), poolMat('#ffffff', 0.5, 60, 150),
    villas.length * ANCHOR_V.sheen.length, (i, t, out) => {
      const v = villas[(i / ANCHOR_V.sheen.length) | 0], a = ANCHOR_V.sheen[i % ANCHOR_V.sheen.length];
      const k = ((t * 0.1 + (i / ANCHOR_V.sheen.length) * 0.42 + (i % 2) * 0.23) % 1);
      const [x, y, z] = at(v, a.x, a.y + (k - 0.5) * 0.9, a.z);
      out.x = x; out.y = y; out.z = z + 0.02; out.ry = a.ry;
      out.s = a.w * (0.55 + 0.45 * Math.sin(k * Math.PI)) / 1.6;
      sheen.tint(i, tmp.setScalar(Math.sin(k * Math.PI)));
    });
  const breathe = new Layer(scene, new THREE.PlaneGeometry(3.2, 0.42), new THREE.MeshBasicMaterial({
    color: P.strip, transparent: true, opacity: 0.9, fog: false, blending: THREE.AdditiveBlending, depthWrite: false,
  }), villas.length * ANCHOR_V.breathe.length, (i, t, out) => {
    const v = villas[(i / ANCHOR_V.breathe.length) | 0], a = ANCHOR_V.breathe[i % ANCHOR_V.breathe.length];
    const [x, y, z] = at(v, a.x, a.y, a.z);
    out.x = x; out.y = y; out.z = z; out.ry = 0; out.s = v.s;
    breathe.tint(i, tmp.setScalar(0.45 + 0.55 * (0.5 + 0.5 * Math.sin(t * 1.05 + i * 1.7))));
  });
  // 草与花分两桶（草受光、花自发光），两批实例共用同一个摆位函数 ⇒ 摆起来是同一丛在动
  const floraPlace = (i: number, t: number, out: Spot): void => {
    const p = flora[i];
    out.x = p.x; out.y = p.y; out.z = p.z; out.ry = p.ry; out.s = p.s;
    out.sway = 0.055 * Math.sin(t * 1.25 + p.z * 0.22) + 0.022 * Math.sin(t * 2.7 + p.z * 0.5);
  };
  const sway = new Layer(scene, floraModel.geometry('body')!, mats.body, flora.length, floraPlace);
  const swayFlowers = new Layer(scene, floraModel.geometry('glow')!, mats.glow, flora.length, floraPlace);
  const gullBody = new Layer(scene, build(buildGullBody).geometry('body')!, mats.body, GULL, (i, t, out) => {
    const b = gullPath(i, t);
    out.x = b[0]; out.y = b[1]; out.z = b[2]; out.ry = b[3]; out.s = 1.1;
  });
  const gullWings = new Layer(scene, build(buildGullWing).geometry('body')!, mats.body, GULL * 2, (i, t, out) => {
    const gi = (i / 2) | 0, side = i % 2 ? 1 : -1, b = gullPath(gi, t);
    const flap = Math.sin(t * (3.4 + gi * 0.4) + gi) * 0.55;
    out.x = b[0]; out.y = b[1] + 0.02; out.z = b[2];
    out.ry = b[3] + (side > 0 ? 0 : Math.PI);
    out.roll = side > 0 ? flap : -flap; out.s = 1.1;
  });

  return {
    update(move: number, t: number): void {
      for (const list of lists) for (const p of list) p.z = wrapZ(p.z + move);
      for (const g of meshes) {
        for (let i = 0; i < g.mesh.count; i++) writeSpot(g.mesh, i, g.at[i]);
        g.mesh.instanceMatrix.needsUpdate = true;
      }
      seaU.uniforms['uT'].value = t;
      shU.uniforms['uT'].value = t;
      mist.update(t); glint.update(t); sheen.update(t); breathe.update(t);
      sway.update(t); swayFlowers.update(t); gullBody.update(t); gullWings.update(t);
      glint.flushColors(); sheen.flushColors(); breathe.flushColors();
    },
    dispose(): void { toonRamp?.dispose(); },
  };
}
