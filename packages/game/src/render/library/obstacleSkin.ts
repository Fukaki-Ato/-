/**
 * 失重图书馆 · 障碍皮肤（docs/scenes/library-brief.md §9 六类映射 + §11.1 步骤 7）：
 * 与 titan/forgeheart 工厂同构的显式换皮工厂（entityLayers SKIN_BY_SCENERY 提表按 scenery 取用）：
 * 只换「可视替身」，判定尺寸（o.w/h/d、low 可视 0.75 系数、high 杆下 1.2m 净空、rideTop 列车
 * o.h 支撑面）零改动；zap 闪电圈与 step 登车斜坡保持默认盘不上皮。
 *
 * 六类皮形制（§11.1-7）：
 *   full    静态四翼书架：正对玩家一翼（满高翼面 + 装帧书脊条 + 蜡封红封条竖纹）+ 两侧横翼梢
 *           + 黄铜中柱/底座圆盘（满格墙=必须换道 §4.4；Phase A 静态，真旋转门 Phase B B-10）
 *   low     倒伏书堆（obs_box 等：3 册错缝叠 + 蜡封红标签，可视顶压 h×0.75 跳感不变）/
 *           书鼓（横放卷册沿 z 躺倒 + 页块端面 + 顶书签带）
 *   high    断层书架横梁：皮革棕层板梁（梁体下沿钉在 barLowY → 梁下净空恒 1.2m 与判定同源）
 *           + 梁顶一排书脊 + 两端书塔短柱（层带横条 + 柱头暗盖）
 *   vehicle 巨型对开本典籍：2~3 段书背块沿 z 拼（段顶面全程齐 o.h 保 rideTop）+ 中缝书脊凸线
 *           （顶面恰齐 o.h）+ 页缘纸灰条 + 蜡封红书签带 + 墨渊垫层
 *   moving  墨滴黄铜摆锤：壶体球（1.12m 贴判定挡板盒）+ 墨滴锥尖朝上 + 三节链节；
 *           横摆 x 沿用 entityLayers 的 obstacleX（判定同源），本模块不重复摆动逻辑
 *   hazard  墨渍漫地薄板：墨渊薄板顶面齐 o.h=0.1 + 两块墨青渍斑错位（斑底抬 5mm 防共面）
 *
 * 铁律同 titan：6 个 InstancedMesh 槽（§9「InstancedMesh ≤8 槽」口径，= 皮肤全部新增 draw call）；
 * 确定性 rnd（种子实体首见落 WeakMap——moveZ 冲刺件 worldZ 逐帧漂移，直接当随机会让书堆每帧
 * 换位置）；每帧零分配（dummy/Color 预建）；只消费 o 现状（cls/w/h/d/lane），不读 sim 其它状态。
 * 皮肤材质一律 applyWorldBend（与地面同弯不分家）。调色按 brief §2 本地对表（palette.ts 并行件）。
 */
import * as THREE from 'three';
import type { ObstacleEntity } from '@tr/game/core/sim/trackGen.js';
import { rnd } from '../sceneryProps.js';
import { applyWorldBend } from '../stormspire/worldBend.js';

// ---- 调色（brief §2 七色 + §2 派生；并行件 library/palette.ts 合入前先本地对表）----
const PAPER = 0xeadfc2, PAPER_OLD = 0xb3a17f, LEATHER = 0x7a5a3c, WAX_RED = 0xa63a2e,
  INK_TEAL = 0x46536b, INK_DEEP = 0x1e1a33, INK_MIST = 0x39445c;

/** 判定口径常量（与 entityLayers 同源值，由调用方注入；与 titan/obstacleSkin 的同名接口逐字同构） */
export interface SkinCalibration { obsMax: number; lowVisH: number; barLowY: number }

/** 对开本书背段长度占比（头段最长尾段最短；两套对应 2/3 段拼法。常量预置避免每帧建数组） */
const HULL_FR3 = [0.44, 0.32, 0.24] as const;
const HULL_FR2 = [0.55, 0.45] as const;

/** 实例槽：InstancedMesh + 容量护栏（按「整屏全为该类」的最坏场面给足，写满即丢弃多出的件） */
interface SkinSlot { mesh: THREE.InstancedMesh; cap: number; n: number }

export function createLibraryObstacleSkin(scene: THREE.Scene, boxGeo: THREE.BufferGeometry, cal: SkinCalibration) {
  const M = cal.obsMax;
  // 四色直接对表 brief §2（library/palette.ts 合入后可换 P.x，与场景同源不出圈）：
  // 木构/黄铜走 Lambert 与侧景同光；书脊/页块实例色共槽材质白底；墨渊作暗盖与薄板；无发光件（蜡封红是结构色 §2）。
  const woodMat = new THREE.MeshLambertMaterial({ color: LEATHER });
  const bookMat = new THREE.MeshLambertMaterial({ color: 0xffffff }); // 书脊/页块/渍斑实例色共槽，材质白底
  const darkMat = new THREE.MeshLambertMaterial({ color: INK_DEEP });
  // 假弯道：皮肤三材质与地面同弯（同一 f(z)，见 stormspire/worldBend.ts），否则远处障碍与弯掉的路面分家
  for (const m of [woodMat, bookMat, darkMat]) applyWorldBend(m);
  const cylGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 12);
  const ballGeo = new THREE.SphereGeometry(0.5, 12, 9);
  const coneGeo = new THREE.ConeGeometry(0.5, 1, 8);
  coneGeo.translate(0, 0.5, 0); // 锥底平移到原点：墨滴尖朝上高度全靠 y 缩放
  const slots: SkinSlot[] = [];
  const mk = (geo: THREE.BufferGeometry, mat: THREE.Material, cap: number): SkinSlot => {
    const mesh = new THREE.InstancedMesh(geo, mat, cap);
    mesh.count = 0;
    mesh.visible = false;
    mesh.frustumCulled = false; // 矩阵逐帧改，几何包围球不可靠：剔除交给 count=0 时的 visible 开关
    scene.add(mesh);
    const sl: SkinSlot = { mesh, cap, n: 0 };
    slots.push(sl);
    return sl;
  };
  const boxWood = mk(boxGeo, woodMat, M * 3);  // 书架翼面/横梁/短柱/书脊凸线/横翼梢
  const boxBook = mk(boxGeo, bookMat, M * 4);  // 书脊条/书堆/页块/书签带/渍斑（实例色）
  const boxDark = mk(boxGeo, darkMat, M * 2);  // 柱头暗盖/墨渊薄板/垫层
  const cylWood = mk(cylGeo, woodMat, M * 2);  // 书鼓/链节/中柱/底座圆盘
  const ballWood = mk(ballGeo, woodMat, M);    // 墨滴摆锤壶体
  const coneTip = mk(coneGeo, woodMat, M);     // 墨滴锥尖
  const dummy = new THREE.Object3D();
  const tmpC = new THREE.Color();
  /** 写一个实例：位置/尺寸/倾角 + 灰阶微差（1=原色）或指定实例色（调色板内 hex）。count 满则丢弃 */
  const put = (sl: SkinSlot, x: number, y: number, z: number, sx: number, sy: number, sz: number,
    rx = 0, shade = 1, rz = 0, hex = 0, ry = 0) => {
    if (sl.n >= sl.cap) return;
    dummy.position.set(x, y, z);
    dummy.rotation.set(rx, ry, rz);
    dummy.scale.set(sx, sy, sz);
    dummy.updateMatrix();
    sl.mesh.setMatrixAt(sl.n, dummy.matrix);
    if (hex) tmpC.setHex(hex).multiplyScalar(shade); else tmpC.setScalar(shade);
    sl.mesh.setColorAt(sl.n, tmpC);
    sl.n++;
  };
  /** 实体首见时落一次种子（同 entityLayers 海报 WeakMap 口径：键随实体回收自动释放） */
  const seedOf = new WeakMap<object, number>();
  let seedSeq = 0;

  /** 按类别写皮肤实例；ox/z/sinkY（横摆位/相对深度/软清除下沉量）由 entityLayers 算好传入 */
  function emit(o: ObstacleEntity, ox: number, z: number, sinkY: number) {
    let s = seedOf.get(o);
    if (s === undefined) { s = ++seedSeq * 17.31 + (o.lane + 1) * 5.77; seedOf.set(o, s); }
    switch (o.cls) {
      case 'full': {
        // 静态四翼书架（§4.4 障碍位皮肤）：正对玩家一翼满高 + 两侧横翼梢（十字读法）+ 中柱/底座；
        // 判定按满格墙口径零改动（Phase A 静态，真旋转门 Phase B B-10）
        const wd = Math.max(o.d, 0.5); // 0.18m 海报板太薄读不出书架，加厚到 0.5m（判定窗另有 0.4m 前瞻，不穿帮）
        put(boxWood, ox, o.h / 2 - sinkY, z, o.w, o.h, wd, 0, 0.9 + rnd(s, 1) * 0.1);
        put(cylWood, ox, o.h / 2 - sinkY, z, 0.22, o.h + 0.3, 0.22);            // 黄铜中柱（径 0.22m §4.4）
        put(cylWood, ox, 0.12 - sinkY, z, o.w * 0.95, 0.24, o.w * 0.6);         // 底座圆盘
        for (let i = 0; i < 2; i++) // 两侧横翼梢：四翼十字的侧翼读法
          put(boxWood, ox + (i === 0 ? -1 : 1) * (o.w / 2 + 0.22), o.h * 0.46 - sinkY, z, 0.44, o.h * 0.9, o.w * 0.55, 0, 0.85 + rnd(s, 2 + i) * 0.15);
        const spineC = [PAPER, PAPER_OLD, LEATHER, INK_TEAL]; // 翼面装帧书脊条（§3.3 缩微）
        for (let i = 0; i < 4; i++)
          put(boxBook, ox + (i - 1.5) * o.w * 0.2, o.h * 0.46 - sinkY, z + wd / 2 + 0.03, o.w * 0.15, o.h * 0.8, 0.06, 0, 1, 0, spineC[i]);
        put(boxBook, ox - o.w * 0.36, o.h / 2 - sinkY, z + wd / 2 + 0.045, o.w * 0.1, o.h * 0.92, 0.02, 0, 1, 0, WAX_RED); // 蜡封红封条
        break;
      }
      case 'low': {
        // 倒伏书堆/书鼓：可视顶一律压 h×0.75（与判定口径同源，跳感不变，§11.1-7）
        const vh = o.h * cal.lowVisH;
        if (o.d >= o.w * 0.9) {
          // 书鼓：横放卷册沿 z 躺倒（同 stormspire 断鼓分形口径）+ 页块端面 + 顶书签带
          const r = Math.min(o.w, vh) * 0.5;
          put(cylWood, ox, r - sinkY, z, r * 2, o.d, r * 2, Math.PI / 2, 0.9 + rnd(s, 2) * 0.1);
          put(boxBook, ox, r - sinkY, z + o.d / 2 - 0.05, r * 1.9, r * 1.9, 0.1, 0, 1, 0, PAPER);
          put(boxBook, ox, r - sinkY, z - o.d / 2 + 0.05, r * 1.9, r * 1.9, 0.1, 0, 1, 0, PAPER_OLD);
          put(boxBook, ox, r + 0.04 - sinkY, z, 0.16, 0.08, o.d * 0.5, 0, 1, 0, WAX_RED); // 书签丝带
        } else {
          // 倒伏书堆：3 册错缝叠（宽/色/歪斜独立随机，禁止等比同款 §3.3）+ 蜡封红标签一枚
          put(boxBook, ox, vh * 0.3 - sinkY, z, o.w, vh * 0.6, Math.max(o.d, 0.3), 0, 1, 0, PAPER);
          put(boxBook, ox + (rnd(s, 3) - 0.5) * 0.3, vh * 0.72 - sinkY, z, o.w * 0.8, vh * 0.26, Math.max(o.d, 0.3) * 0.85, 0, 1, rnd(s, 4) * 0.14 - 0.07, rnd(s, 5) < 0.5 ? LEATHER : PAPER_OLD);
          put(boxBook, ox + (rnd(s, 6) - 0.5) * 0.5, vh * 0.9 - sinkY, z, o.w * 0.55, vh * 0.18, Math.max(o.d, 0.3) * 0.7, 0, 1, rnd(s, 7) * 0.2 - 0.1, INK_TEAL);
          put(boxBook, ox - o.w * 0.2, vh * 0.38 - sinkY, z + Math.max(o.d, 0.3) / 2 + 0.02, 0.12, 0.1, 0.04, 0, 1, 0, WAX_RED);
        }
        break;
      }
      case 'high': {
        // 断层书架横梁：皮革棕层板梁（梁体下沿钉在 barLowY 1.2m，滑铲净空与判定同源不变）
        // + 梁顶一排书脊 + 两端书塔短柱（陈纸米层带横条 + 柱头暗盖）
        const pw = 0.32, px = o.w / 2 - pw / 2 - 0.02;
        put(boxWood, ox, cal.barLowY + 0.24 - sinkY, z, o.w, 0.48, 0.6, 0, 0.9 + rnd(s, 1) * 0.1);
        const beamC = [PAPER, LEATHER, PAPER_OLD]; // 梁顶书脊排
        for (let i = 0; i < 3; i++)
          put(boxBook, ox + (i - 1) * o.w * 0.26, cal.barLowY + 0.62 - sinkY, z, o.w * 0.2, 0.3, 0.32, 0, 1, 0, beamC[i]);
        for (let pi = 0; pi < 2; pi++) {
          const sx = ox + (pi === 0 ? -1 : 1) * px;
          put(boxWood, sx, o.h / 2 - sinkY, z, pw, o.h, 0.32, 0, 0.88 + rnd(s, 2 + pi) * 0.12);
          for (let bI = 0; bI < 2; bI++) // 短柱层带横条（书塔层带剪影的近景呼应）
            put(boxBook, sx, o.h * (0.3 + bI * 0.36) - sinkY, z, pw + 0.05, 0.09, 0.34, 0, 1, 0, PAPER);
          put(boxDark, sx, o.h + 0.09 - sinkY, z, 0.42, 0.2, 0.36); // 柱头暗盖压进柱顶 2cm 防共面闪面
        }
        break;
      }
      case 'vehicle': {
        // 巨型对开本典籍（§11.1-7）：2~3 段书背块沿 z 拼（段顶面全程齐 o.h，rideTop 列车支撑面
        // 口径不变，抄鲸背段拼法）+ 中缝书脊凸线（顶面恰齐 o.h，页块低 3cm 防共面）+ 页缘纸灰条
        // + 蜡封红书签带（页顶面上，顶不超 o.h）+ 墨渊垫层把书体接到地面
        const n = o.d > 12 ? 3 : 2, headZ = z + o.d / 2, thick = Math.min(o.h, 0.9);
        let cz = headZ;
        for (let i = 0; i < n; i++) {
          const len = o.d * (n === 3 ? HULL_FR3[i] : HULL_FR2[i]);
          cz -= len / 2;
          put(boxBook, ox, o.h - thick / 2 - 0.03 - sinkY, cz, o.w * 0.94, thick, len, 0, 0.92 + rnd(s, 4 + i) * 0.08, 0, PAPER); // 页块
          put(boxWood, ox, o.h - 0.3 - sinkY, cz, 0.36, 0.6, len * 0.98, 0, 0.9); // 中缝书脊凸线（顶面恰齐 o.h）
          put(boxBook, ox + o.w * 0.47, o.h - thick / 2 - 0.05 - sinkY, cz, 0.09, thick * 0.9, len * 0.96, 0, 1, 0, PAPER_OLD);  // 页缘
          put(boxBook, ox - o.w * 0.47, o.h - thick / 2 - 0.05 - sinkY, cz, 0.09, thick * 0.9, len * 0.96, 0, 1, 0, PAPER_OLD);
          cz -= len / 2 - (i < n - 1 ? 0.04 : 0); // 段间互叠 4cm：段长不同 + 端面错位，不产生共面闪面
        }
        put(boxBook, ox, o.h - 0.12 - sinkY, headZ - o.d * 0.18, 0.14, 0.24, 0.6, 0, 1, 0, WAX_RED); // 书签带
        put(boxDark, ox, 0.2 - sinkY, z, o.w * 0.85, 0.4, o.d * 0.72); // 垫层：书体与地面交接
        break;
      }
      case 'moving': {
        // 墨滴黄铜摆锤（§11.1-7）：壶体球（1.12m 贴判定挡板 1.1³ 盒，贴地滑摆的判定观感不变）
        // + 墨滴锥尖朝上（圆底尖顶读法）+ 三节链节渐细；横摆 x 沿用 obstacleX，本模块不重复摆动
        put(ballWood, ox, 0.56 - sinkY, z, 1.12, 1.12, 1.12);
        put(coneTip, ox, 1.1 - sinkY, z, 0.5, 0.42, 0.5);
        put(cylWood, ox, 1.68 - sinkY, z, 0.22, 0.36, 0.22);
        put(cylWood, ox, 2.06 - sinkY, z, 0.18, 0.32, 0.18);
        put(cylWood, ox, 2.42 - sinkY, z, 0.14, 0.28, 0.14);
        break;
      }
      case 'hazard': {
        // 墨渍漫地薄板：墨渊薄板（顶面齐 o.h=0.1）+ 两块墨青渍斑错位（斑底抬 5mm 防共面）；
        // 0.35m 可跳提示带仍由 entityLayers 的 band 出
        put(boxDark, ox, o.h / 2 - sinkY, z, o.w, o.h, o.d, 0, 1);
        for (let i = 0; i < 2; i++)
          put(boxBook, ox + (rnd(s, 30 + i) - 0.5) * o.w * 0.3, o.h + 0.025 - sinkY,
            z + (i === 0 ? 1 : -1) * o.d * 0.2, o.w * (0.55 + rnd(s, 34 + i) * 0.3), 0.03, o.d * (0.5 + rnd(s, 38 + i) * 0.25), 0, 1, 0, INK_MIST);
        break;
      }
      default: break; // zap/step 及未知类别不画皮（保守：留给默认盘，§11.1-7 处置与 titan 一致）
    }
  }

  return {
    beginFrame() { for (const sl of slots) sl.n = 0; },
    emit,
    endFrame() {
      for (const sl of slots) {
        sl.mesh.count = sl.n;
        sl.mesh.visible = sl.n > 0;
        sl.mesh.instanceMatrix.needsUpdate = true;
        if (sl.mesh.instanceColor) sl.mesh.instanceColor.needsUpdate = true;
      }
    },
  };
}
