/**
 * 雨夜便利店街角 · 便利店身后那一排临街低层商铺（中景层，2~3 层，沿街一长条约 25m）。
 * 坐标约定：长轴沿局部 z（−13.4 ~ +13.4，其中靠便利店那一端 9.9~13.4 留成空地），
 * 临街面在局部 −x 一侧：楼体 x∈[0,DEPTH]、人行道 x∈[WALK,0]、再往外是路肩与底座裙边。
 * 整排摆位时绕 y 偏 15°（见 konbiniProps.ts）——正面若与跑道平行就是 78° 掠射，
 * 招牌的淡蓝/暖白发光字和暖黄橱窗全被压成一条细缝，等于白做。
 * 与便利店的分工：便利店是白瓷砖 + 青橙横带 + 一整条横向招牌；这一排是深蓝灰实墙、
 * 逐间小招牌、透明雨棚、公交站，重复度刻意拉开。三桶仍走 kit.Diorama（body 受光 / glow 自发光 / glass 半透明）。
 */
import * as THREE from 'three';
import { C, R90 } from './palette.js';
import { Layer, instanceAt, poolMat, rnd, toWorld, addMat, writeSpot } from './kit.js';
import type { Diorama, Spot } from './kit.js';
import { poolGeo, streetLamp } from './lamps.js';
import { buildFrontClutter, buildPath, buildPaving } from './frontage.js';

const DEPTH = 5.4, X0 = -7.4, X1 = 5.8, ZH = 13.4;
/** 五间门面：开间 4.4m，层高 2 层（6.2/6.4）与 3 层（8.2~8.9）错落，地块一头留空当空地 */
const UW = 4.4, UZ0 = -12.2, H = [8.6, 6.2, 8.9, 6.4, 8.2], NF = [2, 1, 2, 1, 2];
const UPY = [4.45, 6.95];
const WALL = [C.shopA, C.shopB, C.shopC, C.shopB, C.shopA];
/** 人行道上的三盏暖白灯 + 一座候车亭（亭在灯之间，正好处在人行道中段） */
const LAMP: [number, number][] = [[-2.6, -11.6], [-2.6, -1.2], [-2.6, 6.8]];
const LAMP_Y = 4.16, BUS_Z = -6.5;
/** 臂长：灯头（和它下面那摊光池）都在杆子朝街道一侧 LAMP_REACH 处 */
const LAMP_REACH = 0.62;

/** 雨棚沿口挂水滴的锚点（每间三个点），动画层按它换算到世界坐标 */
export const ROW_DRIP: [number, number, number][] = H.map((_, i) => UZ0 + UW * (i + 0.5) - 1.2)
  .flatMap((z): [number, number, number][] => [[-1.78, 2.3, z - 0.66], [-1.78, 2.3, z], [-1.78, 2.3, z + 0.66]]);

export function buildShopRow(d: Diorama): void {
  buildGround(d);
  for (let i = 0; i < H.length; i++) buildUnit(d, i);
  for (const [x, z] of LAMP) buildLamp(d, x, z);
  buildBusStop(d);
  buildFrontClutter(d);                                  // 门前那一巷杂物（挪自便利店与商铺之间的空地）
}

/** 底座 + 铺地（与中间那块空地同一套，见 frontage.buildPaving）+ 贴跑道那条 2m 小道（遇杂物断开） */
function buildGround(d: Diorama): void {
  d.box('body', X1 - X0, 0.34, ZH * 2, (X0 + X1) / 2, -0.17, 0, C.plate);
  d.box('body', X1 - X0 + 0.04, 0.14, ZH * 2 + 0.04, (X0 + X1) / 2, -0.39, 0, C.plateEdge);
  buildPaving(d, X0, ZH);
  buildPath(d, -ZH + 0.4, ZH - 0.4, true);
}

/** 一间铺面：实墙方块 + 深灰平顶 + 一层门头（暖黄橱窗 + 门 + 透明雨棚）+ 招牌发光字 + 上层窗 */
function buildUnit(d: Diorama, i: number): void {
  const h = H[i], cz = UZ0 + UW * (i + 0.5), w = WALL[i], warm = i % 2 ? C.winWarm : C.winSoft;
  d.box('body', DEPTH, h, UW - 0.08, DEPTH / 2, h / 2, cz, w);
  d.box('body', DEPTH + 0.26, 0.16, UW, DEPTH / 2 - 0.02, h + 0.08, cz, C.shopRoof);      // 平顶
  d.box('body', 0.16, 0.44, UW - 0.04, -0.04, h + 0.3, cz, w);                            // 沿街女儿墙
  d.box('body', 0.14, 0.15, UW - 0.1, -0.02, 3.32, cz, C.shopSill);                        // 楼层腰线
  d.box('body', 0.2, 3.05, UW - 0.24, -0.05, 1.52, cz, C.shopTrim);                        // 一层门头底板
  d.quad('glow', 2.5, 1.8, -0.16, 1.35, cz + 0.52, warm, { ry: -R90 });                    // 大橱窗
  d.box('body', 0.08, 1.8, 0.09, -0.22, 1.35, cz + 0.52, C.frame);                         // 橱窗中竖
  d.box('body', 0.1, 2.15, 0.96, -0.13, 1.08, cz - 1.22, C.frame);                         // 门框
  d.quad('glow', 0.76, 1.9, -0.2, 1.05, cz - 1.22, C.winSoft, { ry: -R90 });
  d.slab('body', 0.5, 1.0, -0.3, 0.028, cz - 1.22, C.curbStone);                            // 门口台阶

  // 门口透明雨棚：外沿压低、下面挂一条压条（水滴就坠在压条上），两根斜撑挑出去
  d.quad('glass', 1.7, 1.84, -0.95, 2.56, cz - 1.2, C.canopy, { rx: -R90, rz: 0.2 });
  d.box('body', 0.06, 0.14, 1.9, -1.78, 2.4, cz - 1.2, C.shopTrim);
  for (const s of [-0.84, 0.84]) d.strut('body', -0.06, 2.86, cz - 1.2 + s, -1.66, 2.46, cz - 1.2 + s, 0.028, C.shopPipe, 5);

  // 招牌：暗色面板 + 三个发光字块（淡蓝/暖白交替）。字块故意做得比「一间店的字」大一号——
  // 这排在画面里从来只有 45~65m，按真尺度做就糊成一条线，读不出「这里有家店」。
  d.box('body', 0.22, 0.72, UW - 0.5, -0.09, 3.54, cz, C.shopTrim);
  d.quad('glow', UW - 0.74, 0.58, -0.21, 3.54, cz, C.signFace, { ry: -R90 });
  for (let k = 0; k < 3; k++) d.box('glow', 0.1, 0.4, 0.4, -0.26, 3.54, cz - 0.8 + k * 0.8, k % 2 ? C.signWarm : C.signBlue);
  d.box('glow', 0.09, 0.11, 1.15, -0.26, 2.72, cz - 1.2, C.winWarm);                      // 门口那盏灯
  if (i === 1 || i === 4) {                       // 两间挑一面竖招，破掉整排都在同一横线上
    d.box('body', 0.06, 0.06, 0.62, -0.5, 4.28, cz + 1.5, C.lampGrey);
    d.box('body', 0.14, 1.66, 0.52, -0.86, 3.5, cz + 1.78, C.shopTrim);
    d.quad('glow', 0.36, 1.44, -0.94, 3.5, cz + 1.78, i === 1 ? C.signBlue : C.signWarm);
  }

  for (let f = 0; f < NF[i]; f++) {
    for (const s of [-1, 1]) {
      const yz = cz + s * 1.06, lit = (i + f + (s > 0 ? 1 : 0)) % 3 !== 0;
      d.box('body', 0.14, 1.3, 1.12, -0.06, UPY[f], yz, C.frame);
      d.quad('glow', 0.9, 1.06, -0.14, UPY[f], yz, lit ? warm : C.winDark, { ry: -R90 });
      d.box('body', 0.22, 0.08, 1.26, -0.05, UPY[f] - 0.69, yz, C.shopSill);
    }
  }
  if (i % 2 === 0) {                               // 空调外机与支架
    d.box('body', 0.5, 0.44, 0.72, -0.28, 5.5, cz - 1.4, C.metal);
    d.cyl('body', 0.17, 0.17, 0.06, 8, -0.52, 5.5, cz - 1.4, C.frame, { rz: R90 });
  } else {                                          // 小阳台：一块板 + 一圈栏杆
    d.slab('body', 0.86, 1.9, -0.4, 5.14, cz, C.shopSill);
    for (const s of [-0.92, 0.92]) d.box('body', 0.82, 0.86, 0.06, -0.4, 5.6, cz + s, C.lampDark);
    d.box('body', 0.06, 0.86, 1.84, -0.78, 5.6, cz, C.lampDark);
    for (let k = 0; k < 4; k++) d.box('body', 0.05, 0.8, 0.05, -0.4, 5.6, cz - 0.78 + k * 0.52, C.shopPipe);
  }
  if (i === 2) {                                    // 最高那间顶上补水箱与排气管，天际线才有起伏
    d.cyl('body', 0.36, 0.4, 0.76, 8, 1.7, h + 0.5, cz - 1.1, C.lampGrey);
    d.box('body', 0.9, 0.34, 0.6, 3.4, h + 0.3, cz + 1.2, C.metal);
  }
  // 门前湿人行道上的两摊反光：橱窗一摊暖黄、招牌一摊淡蓝（夜里地面才是「这里有家店」的头号线索）
  d.quad('glow', 2.3, 1.5, -1.55, 0.05, cz + 0.52, C.wetWarm, { rx: -R90 });
  d.quad('glow', 0.9, 2.0, -2.9, 0.048, cz, C.wetNeon, { rx: -R90 });
}

/** 人行道边的灰色路灯杆：细杆 + 三道箍 + 向下张开的灯罩，光走暖白（与跑道边的冷白灯分得开） */
function buildLamp(d: Diorama, x: number, z: number): void {
  streetLamp(d, x, z, LAMP_Y, -R90, LAMP_REACH, C.lampGrey, C.warmPool);
}

/** 小型公交站：银灰候车棚 + 长条座椅 + 内嵌发光广告牌 + 站牌，旁边橙白路桩与深色垃圾桶 */
function buildBusStop(d: Diorama): void {
  const bx = -2.85, bz = BUS_Z;
  for (const [px, pz] of [[-4.0, bz - 1.25], [-1.7, bz - 1.25], [-4.0, bz + 1.25], [-1.7, bz + 1.25]] as const) {
    d.box('body', 0.09, 2.3, 0.09, px, 1.15, pz, C.shelterMetal);
  }
  d.box('body', 2.62, 0.1, 2.78, bx, 2.36, bz, C.shelterMetal);
  d.box('body', 2.5, 0.06, 0.16, bx, 2.44, bz + 1.36, C.lampDark);                      // 棚沿压条
  d.box('body', 2.36, 2.0, 0.1, bx, 1.06, bz - 1.25, C.shopB);                          // 背板（面向来路那侧）
  d.quad('glow', 1.96, 1.36, bx, 1.2, bz - 1.18, C.adGlow);                             // 内嵌发光广告牌
  d.box('body', 0.06, 1.94, 2.4, -4.0, 1.05, bz, C.canopy);                              // 临街一侧玻璃挡板
  d.slab('body', 2.1, 0.44, bx, 0.46, bz - 1.0, C.shelterMetal);                         // 长条座椅
  for (const s of [-0.82, 0.82]) d.box('body', 0.07, 0.42, 0.07, bx + s, 0.23, bz - 1.0, C.lampDark);
  d.quad('glow', 2.0, 1.0, bx, 0.052, bz - 0.1, C.wetWarm, { rx: -R90 });                 // 亭下地面积光
  d.cyl('body', 0.045, 0.055, 2.5, 6, -4.45, 1.25, bz + 1.9, C.lampGrey);                // 站牌杆
  d.box('body', 0.5, 0.36, 0.06, -4.45, 2.4, bz + 1.9, C.frame);
  d.quad('glow', 0.42, 0.28, -4.45, 2.4, bz + 1.86, C.signBlue);
  for (let k = 0; k < 3; k++) {                                                          // 橙白路桩（桩身橙、中段白带）
    const z = bz - 1.9 + k * 1.9;
    d.cyl('body', 0.07, 0.075, 0.7, 6, -4.5, 0.35, z, C.bollA);
    d.cyl('body', 0.078, 0.078, 0.14, 6, -4.5, 0.52, z, C.bollB);
  }
  d.cyl('body', 0.21, 0.18, 0.7, 8, -4.3, 0.35, bz - 2.6, C.binDark);                     // 深色垃圾桶
  d.cyl('body', 0.23, 0.23, 0.07, 8, -4.3, 0.73, bz - 2.6, C.lampDark);
}

/**
 * 商铺排的动件与地上光：一层雨棚沿口垂着的细碎水滴、三盏灯下的两层暖白光池、
 * 灯柱周围被照亮的雨丝。全部走 kit.Layer / InstancedMesh 一条组，逐帧跟着底座绕回。
 */
export function createRowFX(scene: THREE.Scene, rows: Spot[]) {
  const pool: Spot[] = rows.flatMap(p => LAMP.map(([lx, lz]) => {
    const [x, y, z] = toWorld(p, lx - LAMP_REACH, 0.03, lz);        // 光池在灯头正下方，不在杆子下
    return { x, y, z, ry: 0, s: 1 };
  }));
  const core = instanceAt(scene, poolGeo(4.6), poolMat(C.warmPool, 0.85, 42, 92), pool);
  const soft = instanceAt(scene, poolGeo(8.8), poolMat('#c79f74', 0.32, 42, 92), pool);
  const tmp = new THREE.Color();

  const drops = new Layer(scene, new THREE.SphereGeometry(0.05, 6, 5), addMat('#dceeff', 0.85),
    rows.length * ROW_DRIP.length, (i, t, out) => {
      const st = rows[(i / ROW_DRIP.length) | 0], a = ROW_DRIP[i % ROW_DRIP.length];
      const f = (t * 0.55 + rnd(i, 61)) % 1;                                             // 前 72% 挂着颤，后面脱落坠地
      const hang = f < 0.72, g = hang ? 0 : (f - 0.72) / 0.28;
      const [x, y, z] = toWorld(st, a[0] + Math.sin(t * 2.2 + i) * 0.012, a[1], a[2]);
      out.x = x; out.z = z; out.ry = 0;
      out.y = hang ? y + Math.sin(t * 3.1 + i * 1.7) * 0.018 : y - g * g * y;             // toWorld 已按底座缩放
      out.s = (hang ? 0.55 + f * 0.45 : 1 - g * 0.4) * st.s;
      drops.tint(i, tmp.setScalar(hang ? 1 : 1 - g * g));                                // 落地前淡出，不硬消失
    });

  const rainN = LAMP.length * 7;
  const litRain = new Layer(scene, new THREE.PlaneGeometry(0.03, 0.8), addMat('#ffe1b6', 0.5),
    rows.length * rainN, (i, t, out) => {
      const st = rows[(i / rainN) | 0], [lx, lz] = LAMP[(i % rainN) / 7 | 0];
      const ph = rnd(i, 71), f = (t * (2.6 + ph * 1.6) + ph * 9) % 1;
      const [x, y, z] = toWorld(st, lx + (rnd(i, 73) - 0.5) * 1.5, 0, lz + (rnd(i, 79) - 0.5) * 2.2);
      out.x = x; out.y = y + (LAMP_Y - 0.2 - f * (LAMP_Y - 0.2)) * st.s; out.z = z;
      out.ry = 0; out.s = 0.55 + ph * 0.5;
      litRain.tint(i, tmp.setScalar((1 - Math.abs(f - 0.45) * 1.6) * (0.55 + ph * 0.45)));
    });

  return {
    update(t: number): void {
      for (let i = 0; i < pool.length; i++) {
        const [x, y, z] = toWorld(rows[(i / LAMP.length) | 0], LAMP[i % LAMP.length][0] - LAMP_REACH, 0.03, LAMP[i % LAMP.length][1]);
        pool[i].x = x; pool[i].y = y; pool[i].z = z;
        writeSpot(core, i, pool[i]); writeSpot(soft, i, pool[i]);
      }
      core.instanceMatrix.needsUpdate = true;
      soft.instanceMatrix.needsUpdate = true;
      drops.update(t); litRain.update(t);
      drops.flushColors(); litRain.flushColors();
    },
  };
}
