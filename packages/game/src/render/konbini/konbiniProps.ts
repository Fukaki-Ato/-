/**
 * 雨夜便利店街角 · 侧景道具集（scenery = "konbini"）。
 * 摆位规则（按需求）：进局先在右侧看到一家便利店，之后每约 100m 两侧交替出现一家；
 * 两家店之间的路段放有围栏的小花园；远景楼群补住地平线。全部同款复用 ⇒
 * 一座模型合并成 3 份几何（受光/自发光/玻璃），N 家店共用同一份顶点数据 ⇒ 整条街侧景个位数 draw call。
 * 动效全部手写：持续降雨、屋檐滴水、积水涟漪、雨痕顺玻璃滑落、自动门偶尔开合、
 * 招牌灯箱闪烁、远处信号灯轮绿黄红。循环周期 LOOP=200m，出画即绕回远处（雾里看不见接缝）。
 */
import * as THREE from 'three';
import type { SceneryProps } from '../sceneryProps.js';
import { Diorama, Layer, instanceAt, poolMat, toonMats, writeSpot, rnd, type Spot } from './kit.js';
import { buildStoreShell, B } from './store.js';
import { buildStoreInterior } from './interior.js';
import { buildStreetProps, ANCHOR } from './streetProps.js';
import { buildGarden, buildFarBlocks } from './garden.js';
import { buildLamp, haloSpot, poolGeo, poolSpot } from './lamps.js';
import { createSplash, makeSites } from './splash.js';

const LOOP = 200, WRAP_Z = 14, SIDE_X = 12.8, FAR_X = 26;
/** 路灯立在护栏与底座之间：离跑道中线 5m，灯臂朝跑道前伸，光池刚好压住道牙那一条 */
const LAMP_X = 5;
/** 店与花园整体放大一档：跑者视野是窄竖扇形，1:1 的 10m 底座在 60m 外只有一百来像素，读不出店头 */
const S_STORE = 1.45, S_GARDEN = 1.3;
/**
 * 不转 45°：竖屏跑道的可视扇形很窄（半宽 ≈ 0.29×视距），底座斜放会把整家店推到画面边缘外。
 * ry=0 时店招与两面大橱窗正好朝来路（+Z），底座近边离跑道中线 5.5m，左右两侧看到的都是同一面店头
 * ⇒ 远处一团暖光慢慢淡入、近处滑出画面，这就是酷跑里的主视角。
 */
const FACE = 0;
/** 信号灯三盏的本色（自上而下 红/黄/绿） */
const SIG_HUE = ['#ff5a4a', '#ffc247', '#5fe08a'];

const spot = (x: number, z: number, ry: number, s = 1): Spot => ({ x, y: 0, z, ry, s });

/**
 * 把 z 折回 (−LOOP+WRAP_Z, WRAP_Z] 区间。
 * 用一次取模而不是 `if (z > WRAP_Z) z -= LOOP`：单条减法是逐帧小步长下的写法，
 * 一旦某帧步长异常（切后台回来、调试面板直接改距离）就会把道具永久甩在画面外。
 */
function wrapZ(z: number): number {
  return z - Math.ceil((z - WRAP_Z) / LOOP) * LOOP;
}

/** 局部坐标 → 世界坐标（绕 y 转 ry、按实例缩放、再平移到该实例）：动件要跟着底座一起放大才不会错位 */
function toWorld(p: Spot, lx: number, ly: number, lz: number): [number, number, number] {
  const c = Math.cos(p.ry), s = Math.sin(p.ry);
  return [p.x + (lx * c + lz * s) * p.s, p.y + ly * p.s, p.z + (-lx * s + lz * c) * p.s];
}

/** 半透明加色材质：动件统一用它，靠 instanceColor 从亮压到黑来表达淡入淡出（灯光类一律不吃雾） */
function addMat(color: THREE.ColorRepresentation, opacity: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color, transparent: true, opacity, fog: false, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
}

export function createKonbiniProps(scene: THREE.Scene): SceneryProps {
  const mats = toonMats(0.52);
  const toonRamp = (mats.body as THREE.MeshToonMaterial).gradientMap;
  const tmp = new THREE.Color();

  // ---------- 三份模型：便利店（外壳 + 店内 + 街具）、小花园、远景楼群 ----------
  const store = new Diorama();
  buildStoreShell(store);
  buildStoreInterior(store);
  buildStreetProps(store);
  const garden = new Diorama();
  buildGarden(garden);
  const far = new Diorama();
  buildFarBlocks(far);

  // ---------- 摆位：开场右侧就是一家店，之后每 100m 两侧交替；两家店之间夹一座小花园 ----------
  const stores: Spot[] = [spot(SIDE_X, -20, FACE, S_STORE), spot(-SIDE_X, -120, FACE, S_STORE)];
  const gardens: Spot[] = [spot(-SIDE_X, -70, FACE, S_GARDEN), spot(SIDE_X, -170, FACE, S_GARDEN)];
  const fars: Spot[] = [];
  for (let i = 0; i < 16; i++) {
    const z = -8 - i * 12.5;
    fars.push(spot(FAR_X, z, 0.1 * rnd(i, 1)), spot(-FAR_X, z - 6, -0.1 * rnd(i, 2), 1.15));
  }
  // ---------- 跑道边的路灯：每家店往后 3 盏、间距 20m；每座花园往后 10m 补一盏 ----------
  const lamp = new Diorama();
  buildLamp(lamp);
  const lamps: Spot[] = [
    spot(LAMP_X, -40, Math.PI), spot(LAMP_X, -60, Math.PI), spot(LAMP_X, -80, Math.PI), spot(LAMP_X, -186, Math.PI),
    spot(-LAMP_X, -84, 0), spot(-LAMP_X, -140, 0), spot(-LAMP_X, -160, 0), spot(-LAMP_X, -180, 0),
  ];
  // 地面光：小亮核（5.2m）+ 大柔光（9m）两层叠出渐变，灯头再挂一片强晕 ⇒ 亮但不见边界
  const pools = instanceAt(scene, poolGeo(5.2), poolMat('#c8e2ff', 1.05), lamps.map(poolSpot));
  const spill = instanceAt(scene, poolGeo(9), poolMat('#9dc2ee', 0.4), lamps.map(poolSpot));
  const halos = instanceAt(scene, new THREE.PlaneGeometry(1.7, 1.7), poolMat('#e2f2ff', 1.7, 85, 165), lamps.map(haloSpot));

  const groups = [
    { parts: store.place(scene, mats, stores), at: stores },
    { parts: garden.place(scene, mats, gardens, ['body', 'glow']), at: gardens },
    { parts: far.place(scene, mats, fars, ['body', 'glow']), at: fars },
    { parts: lamp.place(scene, mats, lamps, ['body', 'glow']), at: lamps },
  ];
  // 近处雨点溅射：30 个点，每点一根雨丝落地当帧炸开 7 颗水珠（与雨丝共用同一条时间线）
  const splash = createSplash(scene, makeSites(30, LOOP), wrapZ);

  // ---------- 动件 1：自动门两扇（15s 一个来回，开 3s 停 3s 再合） ----------
  const doorAt = [ANCHOR.doorL, ANCHOR.doorR];
  const door = new Layer(scene, new THREE.PlaneGeometry(0.86, 2.2), new THREE.MeshBasicMaterial({
    color: '#a8dcf2', transparent: true, opacity: 0.45, fog: false, depthWrite: false, side: THREE.DoubleSide,
  }), stores.length * 2, (i, t, out) => {
    const st = stores[i >> 1], a = doorAt[i & 1], dir = (i & 1) ? 1 : -1;
    const ph = (t + (i & 1 ? 4.5 : 0)) % 15;
    const k = ph < 3 ? ph / 3 : ph < 6 ? 1 : ph < 9 ? 1 - (ph - 6) / 3 : 0;
    const slide = k * k * (3 - 2 * k) * 0.78;
    const [x, y, z] = toWorld(st, a.x + dir * slide, a.y, a.z);
    out.x = x; out.y = y; out.z = z; out.ry = st.ry; out.s = st.s;
  });

  // ---------- 动件 2：持续降雨（跟着世界后退 + 自己往下落，300 根一次 draw call） ----------
  const RAIN = 300;
  const rainBase = Array.from({ length: RAIN }, (_, i) => ({
    x: -13 + rnd(i, 31) * 26, z: -LOOP + rnd(i, 37) * LOOP, ph: rnd(i, 41) * 12, sp: 11 + rnd(i, 43) * 5,
  }));
  let scroll = 0;
  const rain = new Layer(scene, new THREE.PlaneGeometry(0.035, 0.95), addMat('#bfe0ff', 0.42), RAIN, (i, t, out) => {
    const b = rainBase[i];
    out.x = b.x + 0.25 * Math.sin(t * 0.7 + b.ph);
    out.y = 12 - ((b.ph + t * b.sp) % 12);
    out.z = wrapZ(b.z + scroll); out.ry = 0; out.s = 1;
  });

  // ---------- 动件 3：屋檐滴水 + 落点涟漪（滴到哪儿，哪儿起一圈） ----------
  const dripN = ANCHOR.drip.length;
  const drips = new Layer(scene, new THREE.SphereGeometry(0.05, 6, 5), addMat('#d8ecff', 0.8),
    stores.length * dripN, (i, t, out) => {
      const st = stores[(i / dripN) | 0], a = ANCHOR.drip[i % dripN];
      const f = (t * 1.35 + rnd(i, 51) * 2) % 1;
      const [x, , z] = toWorld(st, a[0], 0, a[2]);
      out.x = x; out.y = (2.55 - f * 2.25) * st.s; out.z = z; out.ry = 0; out.s = (0.7 + f * 0.5) * st.s;
    });
  const poolN = ANCHOR.pool.length;
  const ripple = new Layer(scene, new THREE.RingGeometry(0.16, 0.2, 14), addMat('#cfe6ff', 0.5),
    stores.length * poolN * 2, (i, t, out) => {
      const st = stores[(i / (poolN * 2)) | 0], a = ANCHOR.pool[(i >> 1) % poolN];
      const f = (t * 0.85 + rnd(i, 53) * 2) % 1;
      const [x, y, z] = toWorld(st, a[0], a[1], a[2]);
      out.x = x; out.y = y; out.z = z; out.ry = 0; out.s = (0.35 + f * 2.4) * st.s;
      ripple.tint(i, tmp.setScalar((1 - f) * 0.9));
    });

  // ---------- 动件 4：雨痕顺玻璃往下滑（南橱窗三道 + 东橱窗两道，贴着装） ----------
  const runN = ANCHOR.run.length;
  const glassRun = new Layer(scene, new THREE.PlaneGeometry(0.05, 0.3), addMat('#e6f4ff', 0.55),
    stores.length * runN, (i, t, out) => {
      const st = stores[(i / runN) | 0], a = ANCHOR.run[i % runN];
      const f = (t * 0.16 + rnd(i, 57)) % 1;
      const east = a[0] > 1.5;                                               // 东立面那两片玻璃
      const [x, y, z] = toWorld(st, east ? a[0] + 0.04 : a[0], 2.35 - f * 1.75, east ? a[2] : a[2] + 0.04);
      out.x = x; out.y = y; out.z = z; out.ry = st.ry + (east ? Math.PI / 2 : 0); out.s = st.s;
    });

  // ---------- 动件 5：招牌灯箱闪烁（店内灯不闪，只有店招偶尔压一下） ----------
  const sign = new Layer(scene, new THREE.PlaneGeometry(B.x1 - B.x0 - 0.25, 0.48), addMat('#fff2cf', 1),
    stores.length, (i, t, out) => {
      const st = stores[i];
      const [x, y, z] = toWorld(st, (B.x0 + B.x1) / 2, 3.3, B.z1 + 0.18);
      out.x = x; out.y = y; out.z = z; out.ry = st.ry; out.s = st.s;
      const dip = ((t * 0.6 + i * 0.37) % 1) > 0.94 ? 0.3 : 1;
      sign.tint(i, tmp.setScalar(dip * (0.86 + 0.14 * Math.sin(t * 5.1 + i * 2.3))));
    });

  // ---------- 动件 6：路口信号灯 绿→黄→红（远处微弱变化，给街景一点时间感） ----------
  const sig = new Layer(scene, new THREE.CircleGeometry(0.075, 10), addMat('#ffffff', 1), stores.length * 3,
    (i, t, out) => {
      const st = stores[(i / 3) | 0], k = i % 3;
      const [x, y, z] = toWorld(st, ANCHOR.lamp.x, ANCHOR.lamp.y + 0.2 - k * 0.2, ANCHOR.lamp.z + 0.1);
      out.x = x; out.y = y; out.z = z; out.ry = st.ry; out.s = st.s;
      const ph = (t + ((i / 3) | 0) * 3.1) % 11;
      const on = (k === 2 && ph < 5) || (k === 1 && ph >= 5 && ph < 6.5) || (k === 0 && ph >= 6.5);
      sig.tint(i, tmp.set(SIG_HUE[k]).multiplyScalar(on ? 1 : 0.14));
    });

  return {
    update(move: number, t: number): void {
      scroll = (scroll + move) % LOOP;
      for (const g of groups) {
        for (const p of g.at) p.z = wrapZ(p.z + move);
        for (const mesh of g.parts) {
          for (let i = 0; i < mesh.count; i++) writeSpot(mesh, i, g.at[i]);
          mesh.instanceMatrix.needsUpdate = true;
        }
      }
      for (let i = 0; i < lamps.length; i++) {
        const ps = poolSpot(lamps[i]);
        writeSpot(pools, i, ps);
        writeSpot(spill, i, ps);
        writeSpot(halos, i, haloSpot(lamps[i]));
      }
      pools.instanceMatrix.needsUpdate = true;
      spill.instanceMatrix.needsUpdate = true;
      halos.instanceMatrix.needsUpdate = true;
      door.update(t); rain.update(t); drips.update(t);
      ripple.update(t); glassRun.update(t); sign.update(t); sig.update(t);
      ripple.flushColors(); sign.flushColors(); sig.flushColors();
      splash.update(move, t);
    },
    dispose(): void { toonRamp?.dispose(); },
  };
}
