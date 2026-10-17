/**
 * 雨夜便利店街角 · 商铺排后方的那一块街区（餐厅 + 城市广场），纯程序化低多边形、零素材。
 * 摆位在商铺排再往后 20m（餐厅）与餐厅再往后 15m（广场），正面一律朝局部 +Z（来路方向），
 * 与便利店同一套「可收藏模型底座」语言：底座顶面 y=0、深色裙边、ry=0 不用镜像。
 * 冷蓝雨夜里这一片是唯一的暖色主角：浅米 + 暖木墙、四坡顶、大面玻璃透出暖黄灯光、
 * 门口雨棚 + 发光招牌 + 暖色壁灯 + 门前遮阳伞餐座；广场是浅灰/浅棕拼花的圆形集散空间，
 * 中央环形喷泉，四周几何花坛、灌木、木长椅、暖光路灯与几棵乔木。
 */
import * as THREE from 'three';
import { C, R90 } from './palette.js';
import { rnd, type Diorama } from './kit.js';
import { streetLamp } from './lamps.js';

/** 餐厅占地（米）：楼体 x∈[-5,5]、z∈[-5.5,5.5]，底座朝来路一侧多带一段门前平台（露天餐座摆在这） */
const RW = 5, RD = 5.5, APRON = 11.05;
/** 广场占地：x∈[-7,7]、z∈[-19.5,19.5]（10-13 用户要求前后再加长 15m，圆集散区改成两圆相接） */
const PW = 7, PD = 19.5;
/** 广场四盏灯（臂朝广场内侧，0.62m） */
const PLAZA_LAMPS: [number, number][] = [[-5.4, -13], [5.4, -4.4], [-5.4, 5.2], [5.4, 14]];

export function buildRestaurant(d: Diorama): void {
  const dz = (APRON - RD) / 2;                                                             // 底座朝来路一侧接出门前平台
  d.box('body', RW * 2, 0.34, RD + APRON, 0, -0.17, dz, C.plate);
  d.box('body', RW * 2 + 0.04, 0.14, RD + APRON + 0.04, 0, -0.39, dz, C.plateEdge);
  d.slab('body', RW * 2 - 0.2, APRON - RD - 0.1, 0, 0.014, (RD + APRON) / 2, C.plazaB);     // 门前平台铺浅棕砖

  // ---------- 两层主体：浅米墙 + 暖木腰线/檐口 + 四坡顶（一个四棱锥，低多边形最省事的坡屋顶） ----------
  d.box('body', RW * 2, 3.5, RD * 2, 0, 1.75, 0, C.restWall);
  d.box('body', RW * 2 + 0.26, 0.26, RD * 2 + 0.26, 0, 3.62, 0, C.restWood);            // 一层/二层之间的木腰线
  d.box('body', RW * 2 - 0.5, 3.0, RD * 2 - 0.4, 0, 5.25, 0, C.restWall2);              // 二层略收进
  d.box('body', RW * 2 + 0.4, 0.22, RD * 2 + 0.4, 0, 6.82, 0, C.restWood);              // 檐口
  const roof = new THREE.ConeGeometry(1, 1, 4);
  roof.rotateY(Math.PI / 4); roof.scale(7.8, 2.7, 8.7);                                   // 先转 45° 让四边对正墙面，再拉成矩形坡顶
  d.add('body', roof, C.restRoof, 0, 8.28, 0);
  d.box('body', 0.9, 1.5, 0.9, -2.6, 9.1, -1.8, C.restWall2);                            // 烟囱
  d.box('body', 1.5, 0.4, 1.0, 2.2, 8.9, 1.4, C.metal);                                  // 屋顶排风机
  d.cyl('body', 0.5, 0.55, 0.7, 8, 2.4, 9.0, -2.6, C.lampGrey);                          // 水箱

  // ---------- 一层大面玻璃橱窗：暗框 + 暖黄光面 + 竖框 + 半透玻璃 + 窗下花箱 ----------
  d.box('body', 8.4, 2.7, 0.24, -0.4, 1.5, RD, C.frame);
  d.quad('glow', 7.8, 2.2, -0.4, 1.5, RD + 0.14, C.winWarm);
  for (let i = 0; i < 3; i++) d.box('body', 0.12, 2.7, 0.3, -3.2 + i * 2.8, 1.5, RD + 0.06, C.frame);
  d.quad('glass', 8.0, 2.4, -0.4, 1.5, RD + 0.2, C.glass);
  d.box('body', 7.6, 0.34, 0.5, -0.4, 0.24, RD + 0.34, C.restWood);
  for (let i = 0; i < 5; i++) d.oval('glow', 0.26, 0.16, 0.26, -3.2 + i * 1.4, 0.46, RD + 0.34, i % 2 ? C.flower : C.flower2);
  // 侧墙两排小窗（左右各二），背面一扇货门
  for (const s of [-1, 1]) for (let i = 0; i < 2; i++) {
    d.box('body', 0.16, 1.5, 1.1, s * RW, 4.9, -2.2 + i * 4.4, C.frame);
    d.quad('glow', 0.9, 1.26, s * (RW + 0.1), 4.9, -2.2 + i * 4.4, i % 2 ? C.winSoft : C.winWarm, { ry: s * R90 });
    d.box('body', 0.16, 2.2, 1.3, s * RW, 1.3, 1.2 + i * 3.2, C.frame);
    d.quad('glow', 1.1, 1.9, s * (RW + 0.1), 1.25, 1.2 + i * 3.2, C.winSoft, { ry: s * R90 });
  }
  d.box('body', 1.9, 2.4, 0.18, 0.6, 1.2, -RD, C.frame);                                  // 后侧货门
  d.quad('glow', 1.6, 2.1, 0.6, 1.15, -RD - 0.1, '#3d4552');

  // ---------- 二层：一排暖光窗 + 檐下木格栅 + 门口小阳台 ----------
  for (let i = 0; i < 4; i++) {
    const x = -3.4 + i * 2.25;
    d.box('body', 1.6, 1.7, 0.18, x, 5.3, RD, C.frame);
    d.quad('glow', 1.34, 1.44, x, 5.3, RD + 0.11, i === 2 ? C.winSoft : C.winWarm);
    d.box('body', 1.76, 0.1, 0.34, x, 4.4, RD + 0.06, C.restWood);                        // 窗台
    if (i % 2 === 0) for (let k = 0; k < 3; k++) d.box('body', 0.06, 1.6, 0.06, x - 0.5 + k * 0.5, 5.3, RD + 0.18, C.restWood);
  }

  // ---------- 入口：门 + 暖光 + 门口雨棚（斜顶 + 拉杆 + 棚下灯带）+ 发光招牌 + 壁灯 ----------
  const ex = 3.5;
  d.box('body', 1.7, 2.6, 0.2, ex, 1.3, RD, C.frame);
  d.quad('glow', 1.42, 2.3, ex, 1.25, RD + 0.12, C.winWarm);
  d.slab('body', 2.4, 0.9, ex, 0.03, RD + 0.5, C.curbStone);                              // 门口台阶
  d.add('body', slopeCanopy(2.5, 2.9), C.restWood, ex, 2.86, RD + 1.1);                    // 斜雨棚（外沿压低）
  d.box('body', 2.6, 0.14, 0.1, ex, 2.62, RD + 2.32, C.frame);                            // 棚沿压条
  for (const s of [-1.1, 1.1]) d.strut('body', ex + s, 2.9, RD + 0.2, ex + s, 2.55, RD + 2.3, 0.05, C.restWood, 5);
  d.quad('glow', 2.3, 0.14, ex, 2.72, RD + 1.2, C.warm, { rx: -R90 });                     // 棚下一条暖光灯带
  d.box('body', 3.4, 0.8, 0.22, ex, 3.62, RD + 0.16, C.frame);                            // 招牌底板
  d.quad('glow', 3.0, 0.62, ex, 3.62, RD + 0.3, C.signFace);
  for (let k = 0; k < 3; k++) d.box('glow', 0.42, 0.44, 0.1, ex - 0.9 + k * 0.9, 3.62, RD + 0.34, k === 1 ? C.signBlue : C.signWarm);
  for (const [wx, wz] of [[-3.6, RD + 0.1], [0.4, RD + 0.1], [RW - 0.1, 2.2]] as const) {  // 暖色壁灯
    d.box('body', 0.16, 0.24, 0.2, wx, 3.1, wz, C.frame);
    d.quad('glow', 0.13, 0.18, wx - 0.09, 3.1, wz, C.warm, { ry: -R90 });
  }
  d.quad('glow', 4.6, 2.6, -0.4, 0.05, RD + 1.9, C.wetWarm, { rx: -R90 });                 // 门前湿地那摊暖光
  d.quad('glow', 2.2, 1.6, ex, 0.052, RD + 1.5, '#7a6742', { rx: -R90 });
  // ---------- 精修小件：墙角石、檐下一串挂灯、门口立牌与矮绿篱、二楼窗台花箱 ----------
  for (let i = 0; i < 5; i++) {                                                              // 前墙角石（左右各一条，深浅相间）
    const y = 0.5 + i * 0.72;
    d.box('body', 0.34, 0.34, 0.34, -RW + 0.14, y, RD - 0.14, i % 2 ? C.restWall2 : C.stone);
    d.box('body', 0.34, 0.34, 0.34, RW - 0.14, y, RD - 0.14, i % 2 ? C.stone : C.restWall2);
  }
  for (let i = 0; i < 6; i++) {                                                              // 檐下一串暖挂灯
    const x = -4.2 + i * 1.7;
    d.strut('body', x, 6.72, RD + 0.2, x, 6.42, RD + 0.34, 0.02, C.frame, 4);
    d.oval('glow', 0.14, 0.17, 0.14, x, 6.28, RD + 0.34, C.warm);
  }
  for (const [bx2, bz2] of [[-2.1, RD + 2.1], [-0.6, RD + 2.1], [0.9, RD + 2.1]] as const) {  // 门前一排矮绿篱隔开座区
    d.box('body', 1.3, 0.46, 0.42, bx2, 0.23, bz2, C.stone);
    pShrub(d, bx2, bz2, 0.34);
  }
  d.box('body', 0.9, 1.15, 0.1, ex - 1.75, 0.62, RD + 1.5, C.restWood, { rz: 0.12 });         // 门口 A 字立牌
  d.quad('glow', 0.66, 0.7, ex - 1.78, 0.72, RD + 1.56, C.signWarm, { rz: 0.12 });
  d.box('body', 0.5, 0.34, 0.08, ex + 1.25, 2.02, RD + 0.14, C.frame);                        // 营业时间小牌
  d.quad('glow', 0.38, 0.22, ex + 1.25, 2.02, RD + 0.2, C.signBlue);
  for (let i = 0; i < 4; i++) {                                                               // 二楼窗台花箱
    const x = -3.4 + i * 2.25;
    d.box('body', 1.5, 0.22, 0.3, x, 4.42, RD + 0.24, C.restWood);
    for (let k = 0; k < 3; k++) d.oval('glow', 0.13, 0.1, 0.13, x - 0.46 + k * 0.46, 4.6, RD + 0.24, (i + k) % 2 ? C.flower : C.flower2);
  }
  buildTerrace(d);
}

/** 门前露天餐座：三组遮阳伞 + 方桌 + 两把椅子，伞下压一小圈暖光 */
function buildTerrace(d: Diorama): void {
  for (let i = 0; i < 3; i++) {
    const x = -3.6 + i * 3.1, z = RD + 3.3 + (i % 2) * 0.9, s = 0.86 + (i % 2) * 0.14;
    const umbrella = new THREE.ConeGeometry(1.25 * s, 0.62 * s, 8);
    d.add('body', umbrella, i % 2 ? C.band2 : '#d8cbb2', x, 2.35 * s, z);
    d.cyl('body', 0.05, 0.06, 2.3 * s, 6, x, 1.15 * s, z, C.restWood);
    d.cyl('body', 0.34, 0.4, 0.08, 8, x, 0.04, z, C.frame);
    d.cyl('body', 0.62 * s, 0.62 * s, 0.08, 8, x, 0.74 * s, z, C.restWall);               // 桌面
    d.cyl('body', 0.09, 0.14, 0.7, 6, x, 0.37 * s, z, C.restWood);                        // 桌腿
    for (const cs of [-1, 1]) {
      d.box('body', 0.42, 0.08, 0.42, x + cs * 0.95 * s, 0.44, z, C.restWood);
      d.box('body', 0.42, 0.5, 0.08, x + cs * 1.12 * s, 0.7, z, C.restWood);
      d.box('body', 0.06, 0.44, 0.06, x + cs * 0.95 * s, 0.22, z + 0.14, C.frame);
    }
    d.quad('glow', 2.1, 2.1, x, 0.05, z, '#4a3c26', { rx: -R90 });
  }
}

/** 广场：浅灰/浅棕拼花圆地砖 + 环形喷泉 + 几何花坛 + 灌木 + 木长椅 + 暖光路灯 + 乔木 */
export function buildPlaza(d: Diorama): void {
  d.box('body', PW * 2, 0.34, PD * 2, 0, -0.17, 0, C.plate);
  d.box('body', PW * 2 + 0.04, 0.14, PD * 2 + 0.04, 0, -0.39, 0, C.plateEdge);
  d.slab('body', PW * 2 - 0.2, PD * 2 - 0.2, 0, 0.012, 0, C.plazaA);                       // 浅灰地砖底
  // 长轴加到 39m 后单圆太小 ⇒ 两圆相接：仍是圆形拼花的集散空间，但铺满整条长轴，喷泉落在两圆之间
  for (const cz of [-6.6, 6.6]) {
    d.add('body', disc(6.4, 26), C.plazaB, 0, 0.02, cz);                                     // 浅棕外环
    d.add('body', disc(4.4, 22), C.plazaA, 0, 0.026, cz);                                    // 内圈拼回浅灰
    d.add('body', ring(6.45, 26), C.curbStone, 0, 0.05, cz);                                 // 圆周一路缘
    for (let i = 0; i < 8; i++) {                                                            // 放射砖缝（quad，4 顶点一条）
      const a = (i / 8) * Math.PI * 2;
      d.quad('body', 0.07, 1.9, Math.cos(a) * 5.4, 0.045, cz + Math.sin(a) * 5.4, C.plazaSeam, { rx: -R90, ry: Math.PI / 2 - a });
    }
  }

  // ---------- 中央喷泉：环形水池 + 中柱两层盘 + 一柱水光 ----------
  d.cyl('body', 3.05, 3.2, 0.62, 14, 0, 0.31, 0, C.stone);
  d.add('body', disc(2.85, 14), C.water, 0, 0.63, 0);
  d.cyl('body', 0.42, 0.62, 1.5, 8, 0, 1.35, 0, C.stone);
  d.cyl('body', 1.1, 0.9, 0.22, 10, 0, 2.14, 0, C.stone);
  d.add('body', disc(0.95, 10), C.water, 0, 2.26, 0);
  d.cyl('body', 0.16, 0.22, 0.7, 6, 0, 2.6, 0, C.jet);
  d.cyl('body', 0.3, 0.34, 0.16, 8, 0, 0.7, 0, C.stone);
  d.quad('glow', 5.4, 5.4, 0, 0.045, 0, '#2f4a5e', { rx: -R90 });                            // 池子周围一圈湿光

  // ---------- 四周（沿加长的长轴铺开）：几何花坛 + 长椅 + 暖光路灯 + 乔木灌木 ----------
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.4, px = Math.cos(a) * 5.2, pz = Math.sin(a) * 12.6;
    d.cyl('body', 0.95, 1.05, 0.5, 8, px, 0.25, pz, C.stone);                                // 八边形花坛
    d.add('body', disc(0.86, 8), '#3d2f22', px, 0.52, pz);
    pShrub(d, px, pz, 0.42 + rnd(i, 21) * 0.12);
    for (let k = 0; k < 2; k++) d.oval('glow', 0.2, 0.13, 0.2, px - 0.3 + k * 0.6, 0.6, pz + 0.2, k ? C.flower2 : C.flower);
  }
  for (let i = 0; i < 4; i++) {
    const bz = -13.5 + i * 9, bx = i % 2 ? 5.5 : -5.5;
    d.box('body', 1.5, 0.08, 0.5, bx, 0.46, bz, C.restWood);
    d.box('body', 1.5, 0.42, 0.07, bx + (bx > 0 ? 0.22 : -0.22), 0.68, bz, C.restWood);
    for (const s of [-0.6, 0.6]) d.box('body', 0.07, 0.44, 0.07, bx + s, 0.22, bz, C.frame);
    d.quad('glow', 1.8, 1.2, bx, 0.036, bz, '#2f3a48', { rx: -R90 });                          // 椅前一小摊湿地反光
  }
  for (const [lx, lz] of PLAZA_LAMPS) {
    const reach = lx > 0 ? -0.62 : 0.62;                                                      // 臂朝广场内侧
    streetLamp(d, lx, lz, 3.5, reach > 0 ? R90 : -R90, 0.62, C.lampGrey, C.warmPool);
    d.quad('glow', 4.4, 4.4, lx + reach, 0.04, lz, C.wetWarm, { rx: -R90 });
  }
  pTree(d, -4.6, -4.2, 3.4, 0.7);
  pTree(d, 4.8, 4.6, 2.9, -0.5);
  pTree(d, -4.2, 14.6, 2.4, 0.3);
  pTree(d, 4.4, -14.2, 2.6, -0.9);
  for (const [gx, gz, r] of [[3.4, -9.4, 0.5], [-3.2, 3.4, 0.44], [4.2, 10.4, 0.48], [-4.4, -11.6, 0.42]] as const) {
    pShrub(d, gx, gz, r);
  }
  // 广场靠路一侧的湿地反光：把餐厅那摊暖光接过来，与路面积水连成一片
  for (const [px, pz, pw, pd, c] of [
    [0, -PD + 1.6, 8, 2.2, C.wetWarm], [-4.4, 1.4, 2.2, 6.4, C.wetCool], [4.6, -5.2, 2, 5.2, C.wetNeon],
    [0, PD - 1.8, 7, 2.2, C.wetCool],
  ] as const) d.quad('glow', pw, pd, px, 0.034, pz, c, { rx: -R90 });
}

/**
 * 低多边形乔木：树干 + 一团二十面体（detail 0，60 顶点）+ 两团扁椭圆破轮廓。
 * 不用 plants.tree —— 那棵为近景花园而做（树皮纵纹、根部四爪、六片碎叶），一棵 1.1k 顶点，
 * 这片树在 100m 开外，读的是剪影不是细节，120 顶点足够（同一课已记在 oval/blob 那条口径里）。
 */
function pTree(d: Diorama, x: number, z: number, h: number, lean: number): void {
  d.cyl('body', h * 0.05, h * 0.08, h * 0.55, 6, x, h * 0.28, z, '#5c452e', { rz: lean * 0.1 });
  d.blob('body', h * 0.34, h * 0.3, h * 0.34, x, h * 0.74, z, '#33512f', 0, { ry: lean * 3 });
  d.oval('body', h * 0.26, h * 0.22, h * 0.26, x + h * 0.15, h * 0.88, z - h * 0.1, '#4a7048');
  d.oval('body', h * 0.2, h * 0.17, h * 0.2, x - h * 0.16, h * 0.66, z + h * 0.12, '#2f4c37');
}

/** 低矮灌木：三团扁椭圆（同样避开 plants.shrub 的多面叶团） */
function pShrub(d: Diorama, x: number, z: number, r: number): void {
  d.oval('body', r, r * 0.7, r, x, r * 0.66, z, '#3a5c40');
  d.oval('body', r * 0.7, r * 0.52, r * 0.7, x + r * 0.62, r * 0.5, z + r * 0.3, '#2f4c37');
  d.oval('body', r * 0.6, r * 0.45, r * 0.6, x - r * 0.5, r * 0.44, z - r * 0.42, '#456a45');
}

/** 平躺的圆盘（CircleGeometry 是扇形，段数给足就够圆） */
function disc(r: number, seg: number): THREE.BufferGeometry {
  const g = new THREE.CircleGeometry(r, seg);
  g.rotateX(-R90);
  return g;
}

/** 一圈路缘（用细一点的扁环带近似，比 TorusGeometry 省一个数量级顶点） */
function ring(r: number, seg: number): THREE.BufferGeometry {
  const g = new THREE.RingGeometry(r - 0.22, r + 0.06, seg, 1);
  g.rotateX(-R90);
  return g;
}

/** 门口斜雨棚：一块绕 x 斜下来的薄板（外沿低、贴墙高） */
function slopeCanopy(w: number, dep: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, 0.1, dep);
  g.rotateX(-0.24);
  return g;
}
