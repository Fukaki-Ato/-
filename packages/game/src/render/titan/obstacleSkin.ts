/**
 * 沉眠泰坦 · 障碍皮肤（docs/scenes/titan-brief.md §4.12 十二 defs 词汇表 + §10.1 步骤 7）：
 * 与 stormspire/obstacleSkin.ts 同构的显式换皮工厂（entityLayers 皮肤门控提表按 scenery 取用）：
 * 只换「可视替身」，判定尺寸（o.w/h/d、low 可视 0.75 系数、high 杆下 1.2m 净空、rideTop 列车
 * o.h 支撑面）零改动；zap（神罚落点黑盘闪电本就契合）与 step（与登车判定同源）保持默认盘不上皮。
 *
 * 六类皮形制（§4.12）：
 *   full    塌陷甲墙：锈甲大板 + 两层错缝叠板（明暗交替）+ 顶缘参差残块 + 正面竖向魂火灼痕
 *   low     断椎短桩（obs_box：立放骨锥桩 + 断口暗盖 + 侧一条尸苔痕）/
 *           斜插箭丛（obs_barrier_low：横倒箭杆 + 一丛斜插短箭，可视顶压 h×0.75）/
 *           滚落指节（obs_cube_roll：短骨柱段，滚动位移沿用 entityLayers 的 moveZ，不自建物理）
 *   high    断甲横梁：两端断柱托锈甲板（梁体下沿钉在 barLowY → 梁下净空恒 1.2m）+ 板缘金蚀刻
 *   vehicle 殓兽脊甲列（长车：2~3 段收分骨躯、段顶面全程齐 o.h 保 rideTop + 背刺矮椎棘一列 +
 *           侧腹魂火纹）/ 拖棺石兽头（obs_rusher_long：方颅冲锤 + 断角 ×1 + 面甲金纹，不可站）
 *   moving  发束锤：骨铃球锤头（1.12m 贴判定盒）+ 上方三节发束示意；摆动仍归 entityLayers
 *   hazard  魂火灼地薄板：骨石板顶面齐 o.h=0.1 + 两段错位金灼纹（纹底抬 5mm 防共面）
 *
 * 铁律同 stormspire：7 个 InstancedMesh 槽（= 皮肤全部新增 draw call，≤10）；确定性 rnd
 * （种子实体首见落 WeakMap——moveZ 冲刺件 worldZ 逐帧漂移，直接当随机会让残块每帧换位置）；
 * 每帧零分配（dummy/Color 预建）；只消费 o 现状（cls/w/h/d/lane），不读 sim 其它状态。
 */
import * as THREE from 'three';
import type { ObstacleEntity } from '@tr/game/core/sim/trackGen.js';
import { rnd } from '../sceneryProps.js';
import { applyWorldBend } from '../stormspire/worldBend.js';
import { P } from './palette.js';

/** 判定口径常量（与 entityLayers 同源值，由调用方注入；与 stormspire/obstacleSkin 的同名接口逐字同构） */
export interface SkinCalibration { obsMax: number; lowVisH: number; barLowY: number }

/** 殓兽躯段长度占比（头段最长、尾段最短；两套对应 2/3 段拼法。常量预置避免每帧建数组） */
const HULL_FR3 = [0.44, 0.32, 0.24] as const;
const HULL_FR2 = [0.55, 0.45] as const;

/** 实例槽：InstancedMesh + 容量护栏（按「整屏全为该类」的最坏场面给足，写满即丢弃多出的件） */
interface SkinSlot { mesh: THREE.InstancedMesh; cap: number; n: number }

export function createTitanObstacleSkin(scene: THREE.Scene, boxGeo: THREE.BufferGeometry, cal: SkinCalibration) {
  const M = cal.obsMax;
  // 五色直接取 titan/palette 的 P（与场景同源不抄色值，brief §2 七色不出圈）：
  // 甲锈/骨/暗盖走 Lambert 与侧景同光；椎棘（骨象牙）与短箭（雾灰青）双色共槽走实例色（tint 口径）；
  // 灼痕/蚀刻/魂火纹走 Basic（发光物不受光，只认亡火金）。
  const rustMat = new THREE.MeshLambertMaterial({ color: P.rust });
  const darkMat = new THREE.MeshLambertMaterial({ color: P.boneDark });
  const boneMat = new THREE.MeshLambertMaterial({ color: P.bone });
  const coneMat = new THREE.MeshLambertMaterial({ color: 0xffffff }); // 椎棘/短箭实例色共槽，材质白底
  const goldMat = new THREE.MeshBasicMaterial({ color: P.pyre });
  // 假弯道/呼吸注入：皮肤五材质与地面同弯（同一 uBend，见 worldBend.ts），否则远处障碍与弯掉的路面分家
  for (const m of [rustMat, darkMat, boneMat, coneMat, goldMat]) applyWorldBend(m);
  // 单位几何：尺寸全靠实例矩阵（圆柱沿 y；锥底平移到原点，立放/斜插高度全靠 y 缩放）
  const cylGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 12);
  const coneGeo = new THREE.ConeGeometry(0.5, 1, 5);
  coneGeo.translate(0, 0.5, 0);
  const ballGeo = new THREE.SphereGeometry(0.5, 10, 8);
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
  const boxRust = mk(boxGeo, rustMat, M * 4);   // 塌墙甲板 / 断柱 / 横梁 / 方颅
  const boxDark = mk(boxGeo, darkMat, M * 3);   // 断口暗盖 / 顶残块 / 垫层 / 兽面甲 / 尸苔痕(实例色)
  const cylBone = mk(cylGeo, boneMat, M * 3);   // 殓兽骨躯段 / 断椎桩 / 指节 / 发束节(实例色)
  const cylRust = mk(cylGeo, rustMat, M * 2);   // 横倒箭杆
  const cone = mk(coneGeo, coneMat, M * 4);     // 背刺椎棘 / 斜插短箭 / 断角（骨象牙/雾灰青实例色）
  const ball = mk(ballGeo, boneMat, M * 2);     // 发束锤骨铃球锤头
  const gold = mk(boxGeo, goldMat, M * 3);      // 灼痕 / 蚀刻 / 魂火纹 / 面甲金纹
  const dummy = new THREE.Object3D();
  const tmpC = new THREE.Color();
  /** 写一个实例：位置/尺寸/倾角 + 灰阶微差（1=原色）或指定实例色（调色板内 hex）。count 满则丢弃 */
  const put = (sl: SkinSlot, x: number, y: number, z: number, sx: number, sy: number, sz: number,
    rx = 0, shade = 1, rz = 0, hex = 0) => {
    if (sl.n >= sl.cap) return;
    dummy.position.set(x, y, z);
    dummy.rotation.set(rx, 0, rz);
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
        // 塌陷甲墙：锈甲大板 + 两层错缝叠板（横向错位、明暗交替）+ 顶缘参差残块 ×3 + 竖向魂火灼痕
        const wd = Math.max(o.d, 0.5); // 0.18m 海报板太薄读不出甲墙，加厚到 0.5m（判定窗另有 0.4m 前瞻，不穿帮）
        put(boxRust, ox, o.h / 2 - sinkY, z, o.w, o.h, wd, 0, 0.85 + rnd(s, 1) * 0.15);
        for (let i = 0; i < 2; i++) {
          put(i === 0 ? boxDark : boxRust, ox + (rnd(s, 10 + i) - 0.5) * 0.3, o.h * (0.3 + i * 0.34) - sinkY,
            z + wd / 2 + 0.012, o.w * 0.92, o.h * 0.3, 0.02, 0.8 + rnd(s, 14 + i) * 0.2);
        }
        for (let i = 0; i < 3; i++) {
          const bh = 0.16 + rnd(s, 40 + i) * 0.26;
          const bw = o.w * (0.2 + rnd(s, 50 + i) * 0.14);
          put(i === 1 ? boxDark : boxRust,
            ox + (rnd(s, 60 + i) - 0.5) * (o.w - bw), o.h + bh / 2 - 0.02 - sinkY, z + (rnd(s, 70 + i) - 0.5) * 0.1,
            bw, bh, wd * 0.9, 0, 0.85 + rnd(s, 80 + i) * 0.15);
        }
        const gh = o.h * (0.5 + rnd(s, 90) * 0.2);
        put(gold, ox + (rnd(s, 91) - 0.5) * o.w * 0.44, gh / 2 - sinkY, z + wd / 2 + 0.013, 0.09, gh, 0.02);
        break;
      }
      case 'low': {
        // 三种 low 形制按宽分形（defs 实测：obs_box w2 / obs_barrier_low w1.5 / obs_cube_roll w1.1，
        // 同 cls 三 defs——同 stormspire 用几何特征分形、不读 def id）；可视顶一律压 h×0.75（判定同源）
        const vh = o.h * cal.lowVisH;
        if (o.w >= 1.7) {
          // 断椎短桩：立放骨锥桩（视觉厚度取 0.64 倍半径防薄板穿帮）+ 断口暗盖 + 侧一条尸苔痕
          const r = Math.min(o.w, vh) * 0.5;
          const dep = Math.max(o.d, r * 0.64);
          put(cylBone, ox, vh / 2 - sinkY, z, r * 2, vh, dep, 0, 0.9 + rnd(s, 2) * 0.1);
          put(boxDark, ox, vh - 0.04 - sinkY, z, r * 2.06, 0.09, dep * 1.03); // 断口暗盖高出 5mm 防共面闪面
          put(boxDark, ox + r * 0.42, vh * 0.52 - sinkY, z + dep / 2 + 0.012, 0.12, vh * 0.42, 0.02, 0, 1, 0, P.moss);
        } else if (o.w >= 1.3) {
          // 斜插箭丛：横倒箭杆沿 x 躺倒 + 一丛斜插短箭 ×4（锥代杆镞，雾灰青；最高不超可视顶）
          put(cylRust, ox, 0.09 - sinkY, z + 0.1, 0.18, o.w + 0.6, 0.18, 0, 0.9 + rnd(s, 3) * 0.1, Math.PI / 2);
          for (let i = 0; i < 4; i++) {
            const ah = vh * (0.55 + rnd(s, 20 + i) * 0.4);
            put(cone, ox + (rnd(s, 24 + i) - 0.5) * o.w * 0.7, -sinkY,
              z + (rnd(s, 28 + i) - 0.5) * 0.3, 0.16, ah, 0.16, -0.45 - rnd(s, 32 + i) * 0.3, 1, 0, P.mist);
          }
        } else {
          // 滚落指节：短骨柱段 + 断口暗盖（滚动位移沿用 entityLayers 的 moveZ，本模块不自建物理）
          put(cylBone, ox, vh / 2 - sinkY, z, o.w, vh, o.w, 0, 0.9 + rnd(s, 4) * 0.1);
          put(boxDark, ox, vh - 0.03 - sinkY, z, o.w * 1.04, 0.07, o.w * 1.04);
        }
        break;
      }
      case 'high': {
        // 断甲横梁：两端断柱（0.3×o.h×0.3）托锈甲板（o.w×0.5×0.8）；梁体下沿钉在 barLowY（净空 1.2m
        // 与 BAR_LOW_Y 判定同源不变）+ 板缘一道亡火金蚀刻纹 + 1/3 概率梁体崩口豁块
        const pw = 0.3;
        const px = o.w / 2 - pw / 2 - 0.02;
        put(boxRust, ox, cal.barLowY + 0.25 - sinkY, z, o.w, 0.5, 0.8, 0, 0.85 + rnd(s, 5) * 0.15);
        for (let pi = 0; pi < 2; pi++) {
          const sx = ox + (pi === 0 ? -1 : 1) * px;
          put(boxRust, sx, o.h / 2 - sinkY, z, pw, o.h, 0.3, 0, 0.9 + rnd(s, 3 + pi) * 0.1);
          put(boxDark, sx, o.h + 0.09 - sinkY, z, 0.44, 0.22, 0.36); // 柱头断碴：底面压进柱顶 2cm 防共面闪面
        }
        put(gold, ox, cal.barLowY + 0.04 - sinkY, z + 0.41, o.w * 0.94, 0.05, 0.02);
        if (rnd(s, 9) < 0.34) put(boxDark, ox - o.w / 2 + 0.22, cal.barLowY + 0.12 - sinkY, z + 0.25, 0.3, 0.24, 0.34);
        break;
      }
      case 'vehicle': {
        if (o.d > 12) {
          // 殓兽脊甲列：2~3 段收分骨躯直圆柱拼（段心 y = o.h − r → 每段顶面全程齐 o.h，
          // rideTop 列车支撑面口径不变；收分只来自段间半径递减，抄 stormspire 鲸背段拼法）
          // + 背刺矮椎棘一列（站顶擦脚弱化）+ 侧腹魂火纹逐段跟随腰线
          const r0 = Math.min(o.w, o.h) * 0.5;
          const n = o.d > 18 ? 3 : 2;
          const headZ = z + o.d / 2;
          let cz = headZ;
          for (let i = 0; i < n; i++) {
            const len = o.d * (n === 3 ? HULL_FR3[i]! : HULL_FR2[i]!);
            const r = i === 0 ? r0 : r0 * (i === 1 ? 0.8 : 0.62);
            cz -= len / 2;
            put(cylBone, ox, o.h - r - sinkY, cz, r * 2, len, r * 2, Math.PI / 2, 0.88 + rnd(s, 4 + i) * 0.12);
            put(gold, ox + r + 0.02, o.h - r - sinkY, cz, 0.06, 0.12, len * 0.72);
            cz -= len / 2 - (i < n - 1 ? 0.04 : 0); // 段间互叠 4cm：收分半径不同 + 端面错位，不产生共面闪面
          }
          put(boxDark, ox, 0.2 - sinkY, z, o.w * 0.82, 0.4, o.d * 0.7); // 垫层：把拱起的腹部接到地面
          for (let i = 0; i < 4; i++) {
            const fh = 0.22 + rnd(s, 10 + i) * 0.18;
            put(cone, ox + (rnd(s, 20 + i) - 0.5) * 0.4, o.h + fh * 0.4 - sinkY,
              headZ - ((i + 1) * o.d) / (n === 3 ? 4 : 3) - (n === 3 ? 0 : o.d * 0.1), 0.26, fh, 0.26, -0.55, 1, 0, P.bone);
          }
        } else {
          // 拖棺石兽头：方颅冲锤（rideTop=false 不可站，顶面压在 o.h 内）+ 断角 ×1 + 面甲金纹一道
          put(boxRust, ox, o.h * 0.48 - sinkY, z, o.w, o.h * 0.92, o.d * 0.82, 0, 0.85 + rnd(s, 6) * 0.15);
          put(boxDark, ox, o.h * 0.44 - sinkY, z + o.d * 0.4 + 0.01, o.w * 0.86, o.h * 0.6, 0.06);
          put(cone, ox + o.w * 0.32, o.h * 0.9 - sinkY, z + o.d * 0.2, 0.2, 0.85, 0.2, -0.9, 1, 0, P.bone);
          put(gold, ox, o.h * 0.5 - sinkY, z + o.d * 0.4 + 0.045, 0.1, o.h * 0.42, 0.02);
        }
        break;
      }
      case 'moving': {
        // 发束锤：骨铃球锤头（1.12m 贴判定挡板 1.2³ 盒，贴地滑摆的判定观感不变，骨象牙）
        // + 上方三节发束示意（渐细，苍岩肤→尸苔绿实例色渐变）；横摆 x 沿用 entityLayers 的
        // obstacleX（判定同源），本模块不重复摆动逻辑
        put(ball, ox, 0.56 - sinkY, z, 1.12, 1.12, 1.12);
        put(cylBone, ox, 1.32 - sinkY, z, 0.22, 0.44, 0.22, 0, 1, 0, P.skin);
        put(cylBone, ox, 1.74 - sinkY, z, 0.18, 0.4, 0.18, 0, 0.95, 0, P.skin);
        put(cylBone, ox, 2.12 - sinkY, z, 0.15, 0.36, 0.15, 0, 0.9, 0, P.moss);
        break;
      }
      case 'hazard': {
        // 魂火灼地薄板：骨石板（骨暗面提亮一档，顶面齐 o.h=0.1）+ 两段错位金灼纹；
        // 0.35m 可跳提示带仍由 entityLayers 的 band 出
        put(boxDark, ox, o.h / 2 - sinkY, z, o.w, o.h, o.d, 0, 1.08);
        for (let i = 0; i < 2; i++) {
          put(gold, ox + (rnd(s, 30 + i) - 0.5) * o.w * 0.35, o.h + 0.025 - sinkY, // 灼纹底面抬 5mm 离板顶防共面
            z + (i === 0 ? 1 : -1) * o.d * 0.22, o.w * 0.38, 0.04, 0.06);
        }
        break;
      }
      default: break; // zap/step 及未知类别不画皮（保守：留给默认盘，§4.12 处置与 stormspire 一致）
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
