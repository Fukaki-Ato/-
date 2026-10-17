/**
 * 雨夜便利店街角 · 侧景道具集（scenery = "konbini"）。
 * 摆位规则（按需求）：进局先在右侧看到一家便利店，之后每约 100m 两侧交替出现一家；
 * 每座便利店往后约 10m 的那一侧摆一排 2~3 层临街商铺（见 shopfronts.ts），再往后约 20m 是一座两层餐厅、
 * 餐厅背后约 15m 是城市广场（见 restaurant.ts）；两家店之间的路段放有围栏的小花园；远景楼群补住地平线。
 * 全部同款复用 ⇒ 一座模型合并成最多 3 份几何（受光/自发光/玻璃），N 家店共用同一份顶点数据 ⇒ 整条街几十个 draw call。
 * 动效全部手写：持续降雨、屋檐滴水、积水涟漪、雨痕顺玻璃滑落、自动门偶尔开合、棚沿水滴、灯下被照亮的雨丝。
 * 店招与信号灯 10-13 起改为常亮（用户：不要闪），不再占动画层。循环周期 LOOP=200m，出画即绕回远处（雾里看不见接缝）。
 */
import * as THREE from 'three';
import type { SceneryProps } from '../sceneryProps.js';
import { Diorama, Layer, addMat, rnd, toonMats, toWorld, writeSpot, type Spot } from './kit.js';
import { buildStoreShell } from './store.js';
import { buildStoreInterior } from './interior.js';
import { buildStreetProps, ANCHOR } from './streetProps.js';
import { buildGarden, buildFarBlocks } from './garden.js';
import { buildLamp } from './lamps.js';
import { buildShopRow, createRowFX } from './shopfronts.js';
import { buildGapPave } from './frontage.js';
import { buildPlaza, buildRestaurant } from './restaurant.js';
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

const spot = (x: number, z: number, ry: number, s = 1): Spot => ({ x, y: 0, z, ry, s });

/**
 * 把 z 折回 (−LOOP+WRAP_Z, WRAP_Z] 区间。
 * 用一次取模而不是 `if (z > WRAP_Z) z -= LOOP`：单条减法是逐帧小步长下的写法，
 * 一旦某帧步长异常（切后台回来、调试面板直接改距离）就会把道具永久甩在画面外。
 */
function wrapZ(z: number): number {
  return z - Math.ceil((z - WRAP_Z) / LOOP) * LOOP;
}

/** 局部坐标 → 世界坐标 与 半透明加色材质 已上移到 kit.ts（商铺排同样要用，不在这里重复一份） */

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
  /** 远景楼三套型（用户：别整条街都是同一组楼）：三栋组 / 两栋高瘦 / 四栋矮密 */
  const fars = [0, 1, 2].map(k => {
    const d = new Diorama();
    buildFarBlocks(d, k);
    return d;
  });
  const row = new Diorama();
  buildShopRow(row);
  /** 商铺排后方的那一块街区：餐厅（含门前平台）+ 再往后的城市广场 */
  const rest = new Diorama();
  buildRestaurant(rest);
  const plaza = new Diorama();
  buildPlaza(plaza);

  // ---------- 摆位：开场右侧就是一家店，之后每 100m 两侧交替；两家店之间夹一座小花园 ----------
  const stores: Spot[] = [spot(SIDE_X, -20, FACE, S_STORE), spot(-SIDE_X, -120, FACE, S_STORE)];
  /** 小花园：10-13 用户要求整排往后（跑者前方）挪 20m */
  const gardens: Spot[] = [spot(-SIDE_X, -90, FACE, S_GARDEN), spot(SIDE_X, -190, FACE, S_GARDEN)];
  /**
   * 商铺排摆在每座便利店往后约 25m 的那一侧（店的底座远边在 −27.25，这排近端在 −52.6）。
   * 中间那段空地只铺路面（与商铺门前同一套，见 frontage.buildGapPave），一巷杂物挪到了商铺正门前；
   * 贴着跑道再铺一条 2m 宽石板小道作区分，杂物占住的位置自动断开（见 frontage.buildPath）。
   * TILT=5°（用户 2026-10-13 从 15° 收回来）：长轴基本贴着跑道方向，只朝来路偏一点点，
   * 偏得越少掠射越狠（0° 时 84°），5° 是「街是直的」和「招牌还读得出来」之间的折中。
   */
  const TILT = 0.0873;
  const rows: Spot[] = [spot(13.8, -66, TILT), spot(-13.8, -166, Math.PI - TILT)];
  /** 空地路面：填在便利店底座与商铺排底座之间那 24m（内容沿 x 镜像对称，两侧摆出来一致） */
  const pave = new Diorama();
  buildGapPave(pave);
  const paves: Spot[] = [spot(13.8, -40, TILT), spot(-13.8, -140, Math.PI - TILT)];
  /**
   * 餐厅两层、0.7 倍，贴到离跑道 2m 的位置（护栏在 |x|=4.15，屋顶外檐最近 6.14）：
   * 从跑者看过去它不再躲在商铺排背后，暖色体块直接压在街面上，是这一片的主光源。
   * 广场摆在餐厅背后 15m（长轴 39m）。正面一律朝 +Z（来路方向），左右两侧只差一个 x 符号，不用镜像。
   * 左侧整条链比右侧早 100m（与店/排一致），绕回后间距不变。
   */
  const rests: Spot[] = [spot(10, -105, 0, 0.7), spot(-10, -5, 0, 0.7)];
  const plazas: Spot[] = [spot(12.6, -145.3, 0), spot(-12.6, -45.3, 0)];
  /** 32 个楼位按套型轮流分，外加每栋自己的尺度抖动 ⇒ 同一侧相邻两组也不会撞形 */
  const farSets: Spot[][] = [[], [], []];
  for (let i = 0; i < 16; i++) {
    const z = -8 - i * 12.5;
    farSets[i % 3].push(spot(FAR_X, z, 0.1 * rnd(i, 1), 0.86 + rnd(i, 5) * 0.42));
    farSets[(i + 1) % 3].push(spot(-FAR_X, z - 6, -0.1 * rnd(i, 2), 0.9 + rnd(i, 7) * 0.38));
  }
  // ---------- 跑道边的路灯：每家店往后 3 盏、间距 20m；每座花园往后 10m 补一盏 ----------
  const lamp = new Diorama();
  buildLamp(lamp);
  const lamps: Spot[] = [
    spot(LAMP_X, -40, Math.PI), spot(LAMP_X, -60, Math.PI), spot(LAMP_X, -80, Math.PI), spot(LAMP_X, -186, Math.PI),
    spot(-LAMP_X, -84, 0), spot(-LAMP_X, -140, 0), spot(-LAMP_X, -160, 0), spot(-LAMP_X, -180, 0),
  ];
  // 灯头不再挂强晕层：便利店门口那盏本来就只有一个朝下的发光面、没有光晕，
  // 用户要「道路两旁路灯的灯头亮度和它一致」⇒ 跑道边/商铺门前/后巷/广场全部统一成同款灯头，不加晕。

  const rowParts = row.place(scene, mats, rows);
  const restParts = rest.place(scene, mats, rests);
  // 测试按名字认这两组（广场长轴 39m 比商铺排还长，尺寸不再是指纹），盯它们的角不压跑道
  rowParts.forEach(m => { m.name = 'shopRow'; });
  restParts.forEach(m => { m.name = 'restaurant'; });

  const groups = [
    { parts: store.place(scene, mats, stores), at: stores },
    { parts: garden.place(scene, mats, gardens, ['body', 'glow']), at: gardens },
    { parts: lamp.place(scene, mats, lamps, ['body', 'glow']), at: lamps },
    { parts: rowParts, at: rows },
    { parts: pave.place(scene, mats, paves, ['body', 'glow']), at: paves },
    { parts: restParts, at: rests },
    { parts: plaza.place(scene, mats, plazas, ['body', 'glow']), at: plazas },
    ...fars.map((d, k) => ({ parts: d.place(scene, mats, farSets[k], ['body', 'glow']), at: farSets[k] })),
  ];
  // 商铺排的专属动件：灯下两层暖白光池 + 雨棚沿口垂着的水滴 + 被灯照住的雨丝
  const rowFX = createRowFX(scene, rows);
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

  // 店招与路口信号灯原来是两个逐帧改亮度的动画层（闪烁 / 绿黄红轮转），
  // 用户 2026-10-13 要求「不要闪」⇒ 已删，亮灯态直接烘进 store.ts / streetProps.ts。

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
      door.update(t); rain.update(t); drips.update(t);
      ripple.update(t); glassRun.update(t);
      ripple.flushColors();
      splash.update(move, t); rowFX.update(t);
    },
    dispose(): void { toonRamp?.dispose(); },
  };
}
