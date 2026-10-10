/**
 * 白日海景 · 一件一件建，一件一件摆（beach 元素工厂）。
 * 为什么不再做「100 米一节的整章」：整章是一个实例，绕回那一刻章里的椰树、栅栏、长椅、礁石
 * 会一起从画面里消失 ⇒ 用户明确说过「不要跑一半直接连片消失」。现在每类元素各自一份几何、
 * 各自一批实例、各自独立绕回，远处看到的是连续的一条海岸，不是一格一格换布景。
 * 沙地基底是「不滚动」的静态长条（它沿 z 方向本来就没有特征，滚不滚看不出来 ⇒ 永远不会跳）。
 */
import { P } from './palette.js';
import { rnd, type Diorama } from '../konbini/kit.js';

/** 沙滩横断面（世界 x，负方向为海）：干沙 → 湿沙 → 水线。静态铺满整圈，不参与绕回 */
export const SHORE = { dry: -6.4, wet: -10.2, waterEdge: -12.2 };

/**
 * 沙底只有两条宽带（干沙 / 湿沙）+ 水线一条深色窄带，边缘再靠碎浪与水洼去打破。
 * 不要铺三四条等宽色带：那在画面里就是一圈圈与跑道平行的「白道蓝道」，看着像车道线。
 */
export function buildSandBase(d: Diorama): void {
  const z0 = 24, z1 = -236, cz = (z0 + z1) / 2, len = z0 - z1;
  d.slab('body', Math.abs(SHORE.dry - SHORE.wet) + 1.4, len, (SHORE.dry + SHORE.wet) / 2, 0.012, cz, P.sand);
  d.slab('body', Math.abs(SHORE.wet - SHORE.waterEdge) + 2.6, len, (SHORE.wet + SHORE.waterEdge) / 2 - 0.7, 0.022, cz, P.sandWet);
  d.slab('body', 0.9, len, SHORE.waterEdge - 0.2, 0.028, cz, '#c2ab7f');
}

/** 一棵会开花的灌木：三团压扁叶团 + 一圈十朵小花（顶生 + 绕根），要的就是「灌木丛上多点缀小花」 */
export function buildFloweringShrub(d: Diorama): void {
  const PET = [P.flower, P.flower2, '#fff0f4', '#ff7fa8'];
  d.blob('body', 0.46, 0.34, 0.44, 0, 0.3, 0, P.grassDark, 0);
  d.blob('body', 0.34, 0.28, 0.32, 0.24, 0.46, -0.1, P.grass, 0, { ry: 0.7 });
  d.blob('body', 0.28, 0.24, 0.28, -0.24, 0.42, 0.12, P.leafLite, 0, { ry: 1.5 });
  for (let i = 0; i < 10; i++) {                                          // 五瓣小花绕着灌木开一圈
    const a = (i / 10) * Math.PI * 2 + rnd(i, 3) * 0.6;
    const r = 0.32 + rnd(i, 5) * 0.28, y = 0.36 + rnd(i, 7) * 0.36;
    const fx = Math.cos(a) * r, fz = Math.sin(a) * r;
    for (let k = 0; k < 5; k++) {                                         // 花瓣放大到 9cm：跑者 40m 外才数得清
      const pa = (k / 5) * Math.PI * 2 + a;
      d.oval('glow', 0.09, 0.022, 0.062, fx + Math.cos(pa) * 0.07, y + 0.03, fz + Math.sin(pa) * 0.07,
        k % 2 ? PET[i % 4] : P.wall, { ry: -pa });
    }
    d.oval('glow', 0.038, 0.032, 0.038, fx, y + 0.05, fz, P.lampWarm, {});
  }
  for (let i = 0; i < 5; i++) {                                           // 根下再撒几簇草
    const a = (i / 5) * Math.PI * 2 + 0.4, len = 0.22 + rnd(i, 11) * 0.12;
    d.spike('body', 0.026, len, Math.cos(a) * 0.42, len / 2, Math.sin(a) * 0.42, i % 2 ? P.grass : P.grassDark,
      { rz: 0.5, ry: -a });
  }
}

/** 一棵椰子树（原点=树根，向 +z 外弯）。整批实例共用这一份，靠缩放与朝向做「略微差别」 */
export function buildPalm(d: Diorama): void {
  const h = 5.2, bend = 1.25;
  const pts: [number, number][] = [];
  for (let i = 0; i <= 5; i++) {
    const k = i / 5;
    pts.push([bend * k * k * k, k * h * 0.15]);
  }
  const ys = [0, h * 0.21, h * 0.42, h * 0.63, h * 0.82, h];
  for (let i = 0; i < 5; i++) {
    d.strut('body', pts[i][0], ys[i], pts[i][1], pts[i + 1][0], ys[i + 1], pts[i + 1][1],
      0.135 - i * 0.015, i % 2 ? P.palmTrunk : P.palmTrunkDark, 6);
  }
  const tx = pts[5][0], tz = pts[5][1];
  for (let i = 0; i < 5; i++) {                                                // 叶基 + 一串棕色椰子
    d.blob('body', 0.08, 0.06, 0.08, tx, ys[5] + 0.05, tz, P.palmTrunkDark, 0);
    const a = (i / 5) * Math.PI * 2 + 0.4;
    d.blob('body', 0.08, 0.075, 0.08, tx + Math.cos(a) * 0.17, ys[5] - 0.09, tz + Math.sin(a) * 0.17, P.coco, 0);
  }
  for (let i = 0; i < 7; i++) {                                                // 七片羽状叶，各自向外下垂
    const a = (i / 7) * Math.PI * 2 + rnd(i, 7) * 0.35;
    const len = h * (0.46 + rnd(i, 11) * 0.14);
    const ex = tx + Math.cos(a) * len * 0.84, ez = tz + Math.sin(a) * len * 0.84;
    const ey = ys[5] + 0.1 - len * 0.36;
    d.strut('body', tx, ys[5] + 0.07, tz, ex, ey + len * 0.12, ez, 0.034, P.leafDark, 4);
    for (let k = 0; k < 8; k++) {                                              // 每片叶 16 枚小叶，正反双色
      const t = 0.16 + (k / 8) * 0.84;
      const px = tx + (ex - tx) * t, py = ys[5] + 0.07 + (ey + len * 0.12 - ys[5] - 0.07) * t, pz = tz + (ez - tz) * t;
      const ll = 0.34 - t * 0.18;
      for (const s of [-1, 1]) {
        d.spike('body', ll * 0.17, ll, px, py + ll * 0.3, pz, k % 2 ? P.leaf : P.leafDark, { ry: -a + s * 1.15, rz: s * 0.92 });
      }
    }
  }
}

/** 一丛礁石（一大两小 + 底部湿岩），逐簇摆 */
export function buildRocks(d: Diorama): void {
  for (let i = 0; i < 4; i++) {
    const r = 0.42 + rnd(i, 17) * 0.5;
    const px = -rnd(i, 19) * 1.5, pz = (i - 1.5) * 0.72;
    d.blob('body', r, r * 0.72, r * 0.9, px, r * 0.34, pz, i % 2 ? P.rock : P.rockDark, 0, { ry: i * 0.8 });
    d.blob('body', r * 0.98, r * 0.26, r * 0.88, px, r * 0.1, pz, P.rockWet, 0, { ry: i * 0.8 });
  }
}

/** 观景长椅（面朝海：背朝 +x，人坐着看 -x 方向的海） */
export function buildBench(d: Diorama): void {
  d.box('body', 1.5, 0.08, 0.44, 0, 0.44, 0, P.wood);
  d.box('body', 1.5, 0.42, 0.07, 0, 0.66, 0.2, P.wood);
  d.box('body', 1.5, 0.06, 0.44, 0, 0.86, 0, P.woodDark);
  for (const ox of [-0.66, 0.66]) d.box('body', 0.07, 0.42, 0.4, ox, 0.21, 0, '#6f757d');
}

/** 一道碎浪沫：短、窄、带一点斜角，逐条摆 ⇒ 海岸线是不规则的，不是一条直线白带 */
export function buildFoam(d: Diorama): void {
  d.slab('body', 0.2, 2.6, 0, 0.03, 0, P.foam);
  d.slab('body', 0.12, 1.5, 0.26, 0.028, 0.5, '#f2fbff');
}

/** 湿沙上的一片水洼（反光用，椭圆软边），逐片摆 */
export function buildPuddle(d: Diorama): void {
  d.oval('body', 0.9, 0.02, 0.5, 0, 0.028, 0, P.sandWet, {});
  d.oval('glow', 0.62, 0.02, 0.3, 0.02, 0.034, 0, P.haze, {});
}

/** 沙滩小物：贝壳 / 卵石 / 水桶 / 救生圈柱，逐件摆，让沙面不空 */
export function buildShell(d: Diorama): void { d.oval('body', 0.1, 0.035, 0.075, 0, 0.03, 0, P.foam, {}); }
export function buildPebble(d: Diorama): void { d.blob('body', 0.15, 0.1, 0.14, 0, 0.05, 0, P.rock, 0, { ry: 1 }); }
export function buildBucket(d: Diorama): void {
  d.cyl('body', 0.16, 0.19, 0.3, 8, 0, 0.15, 0, P.umbrella);
  d.cyl('body', 0.14, 0.14, 0.02, 8, 0, 0.3, 0, P.umbrellaTop);
  d.strut('body', -0.15, 0.3, 0, 0.15, 0.3, 0, 0.014, P.beam, 4);
}
export function buildRingPost(d: Diorama): void {
  d.cyl('body', 0.07, 0.07, 1.3, 6, 0, 0.65, 0, P.beam);
  d.cyl('body', 0.27, 0.27, 0.11, 12, 0, 1.15, 0, P.umbrella, { rx: Math.PI / 2 });
  d.cyl('body', 0.19, 0.19, 0.13, 12, 0, 1.15, 0, P.beam, { rx: Math.PI / 2 });
}

/** 会随风微动的海边植被：一丛草（带穗与小野花）+ 一丛灌木，逐丛摆、整片同方向轻摆 */
export function buildFlora(d: Diorama): void {
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + rnd(i, 3) * 0.7;
    const len = 0.3 + rnd(i, 5) * 0.26;
    d.spike('body', 0.03, len, Math.cos(a) * len * 0.14, len / 2, Math.sin(a) * len * 0.14,
      i % 3 ? P.grass : P.grassDark, { rz: 0.28 + rnd(i, 7) * 0.5, ry: -a });
  }
  d.oval('body', 0.032, 0.11, 0.032, 0.04, 0.46, 0.02, P.flower, {});
  d.oval('body', 0.055, 0.05, 0.055, 0.06, 0.53, 0.03, P.flower2, {});
  d.blob('body', 0.34, 0.26, 0.32, 0, 0.22, 0, P.grassDark, 0);
  d.blob('body', 0.26, 0.22, 0.24, 0.16, 0.36, -0.06, P.grass, 0, { ry: 0.6 });
  d.blob('body', 0.2, 0.18, 0.2, -0.18, 0.32, 0.1, P.leafLite, 0, { ry: 1.2 });
  for (let i = 0; i < 4; i++) d.oval('glow', 0.075, 0.06, 0.075, -0.14 + i * 0.1, 0.46 + i * 0.02, 0.14 - i * 0.09, i % 2 ? P.flower : P.flower2, {});
}

/** 海鸥的一对翅膀（原点=身体中心；摆的时候左右各一实例，各自绕 z 扇动） */
export function buildGullWing(d: Diorama): void {
  d.box('body', 0.62, 0.03, 0.16, 0.33, 0, 0, '#f7fbff');
  d.box('body', 0.2, 0.02, 0.1, 0.72, -0.02, 0, '#e6eef5');
}
export function buildGullBody(d: Diorama): void {
  d.oval('body', 0.16, 0.06, 0.06, 0, 0, 0, '#fbfdff', {});
  d.oval('body', 0.05, 0.04, 0.04, -0.15, 0.01, 0, '#e6eef5', {});
}

/** 遮阳伞 + 两把躺椅（左右两侧共用同一份几何） */
export function buildParasolSet(d: Diorama): void {
  d.cyl('body', 0.05, 0.07, 0.06, 10, 0, 0.03, 0, P.woodDark);
  d.cyl('body', 0.035, 0.035, 2.1, 6, 0, 1.05, 0, P.beam);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    d.spike('body', 0.42, 1.05, Math.cos(a) * 0.5, 2.06, Math.sin(a) * 0.5, i % 2 ? P.umbrella : P.umbrellaTop, { rz: 1.16, ry: -a });
  }
  d.cyl('body', 0.1, 0.16, 0.14, 8, 0, 2.2, 0, P.umbrellaTop);
  for (const s of [-1, 1]) {
    const z = s * 0.95;
    d.box('body', 0.56, 0.07, 1.3, 0.1, 0.32, z, P.lounger, { ry: s * 0.12 });
    d.box('body', 0.56, 0.06, 0.62, 0.1, 0.55, z - s * 0.66, P.lounger, { rx: s * -0.62 });
    for (const [ox, oz] of [[-0.22, -0.5], [0.22, -0.5], [-0.22, 0.5], [0.22, 0.5]] as const) {
      d.box('body', 0.045, 0.3, 0.045, 0.1 + ox, 0.15, z + oz, P.loungerFrame);
    }
    d.box('body', 0.44, 0.03, 0.4, 0.1, 0.37, z + 0.2, P.sofaCool);
  }
  d.cyl('body', 0.12, 0.14, 0.22, 8, -0.55, 0.11, 0.1, P.glass);
  d.box('body', 0.1, 0.16, 0.1, -0.55, 0.3, 0.1, P.flower2);
}
