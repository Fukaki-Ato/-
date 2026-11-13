/**
 * 天穹雷脊障碍皮肤（scenery === 'stormspire' 显式分支，docs/stormspire-brief.md §10 Phase B-2）：
 * 障碍默认盘是「彩盒 + 二次元海报」（全主题共用，霓虹城味），雷暴云海废墟里出戏——
 * 本模块按障碍类别换程序化废墟皮：只换「可视替身」，判定尺寸（o.w/h/d、low 可视 0.75 系数、
 * high 杆下 1.2m 净空、rideTop 列车 o.h 支撑面）零改动。
 *
 * 分工：entityLayers 仍拥有实体选择/回收/更新骨架（单位池、sink 下沉、obstacleX 横摆、海报注入）；
 * 这里只提供 9 个 InstancedMesh 槽（= 皮肤全部新增 draw call，≤10 铁律；其中 2 槽为雷击圈
 * 换皮，替换 entityLayers 默认黑盘后净增 0），每帧由 entityLayers 按当前可见障碍重写实例矩阵
 * ——实例不与单位槽绑定，count 归零即整池不可见，回收零成本。
 * zap（obs_lightning_circle，zapSkin 接管为导雷落地盘）换皮；step（obs_mount_step 登车斜坡）不在皮内。
 *
 * 铁律：确定性 rnd（种子在实体首见时一次性落 WeakMap——moveZ 冲刺件的 worldZ 逐帧漂移，
 * 直接拿它当随机会让残块/背鳍每帧换位置）；每帧零分配（dummy/Color 预建，HULL 分段比常量预置）；
 * 只消费 o 现状（cls/w/h/d/lane），不读 sim 其它状态、不反写玩法。
 */
import * as THREE from 'three';
import type { ObstacleEntity } from '@tr/game/core/sim/trackGen.js';
import { P } from './palette.js';
import { rnd } from '../sceneryProps.js';
import { applyWorldBend } from './worldBend.js';

/** 换皮类别：full/low/high/vehicle/moving/hazard 六类（zap 闪电圈、step 斜坡保持默认盘） */
export const SKIN_CLASSES: ReadonlySet<string> = new Set(['full', 'low', 'high', 'vehicle', 'moving', 'hazard']);

/** 判定口径常量（与 entityLayers 同源值，由调用方注入，避免循环 import） */
export interface SkinCalibration { obsMax: number; lowVisH: number; barLowY: number }

/** 鲸背躯段长度占比（头段最长、尾段最短；两套对应 2/3 段拼法。常量预置避免每帧建数组） */
const HULL_FR3 = [0.44, 0.32, 0.24] as const;
const HULL_FR2 = [0.55, 0.45] as const;

/** 实例槽：InstancedMesh + 容量护栏（按「整屏全为该类」的最坏场面给足，写满即丢弃多出的件） */
interface SkinSlot { mesh: THREE.InstancedMesh; cap: number; n: number }

export function createStormspireObstacleSkin(scene: THREE.Scene, boxGeo: THREE.BufferGeometry, cal: SkinCalibration) {
  const M = cal.obsMax;
  // 四色直接取 stormspire/palette 的 P（与场景同源不抄色值，brief §2 七色不出圈）：
  // 石体/铜绿换 Standard 走主题 IBL（scene.environment，env.ts 程序化环境）——Lambert 只有
  // hemi 一路光，背光象限只剩 hemiGround 近黑（骑乘鲸背/跳跃断鼓时在角色脚下糊成一坨
  // 「贴地影」穿帮）；Standard 的暗象限能吃进天光+地平光带，且与路面（Standard+IBL）同口径。
  const stoneMat = new THREE.MeshStandardMaterial({ color: P.stone, roughness: 0.88, metalness: 0.04 });
  const darkMat = new THREE.MeshStandardMaterial({ color: P.stoneDark, roughness: 0.92, metalness: 0.04 });
  const bronzeMat = new THREE.MeshStandardMaterial({ color: P.verdigris, roughness: 0.55, metalness: 0.18 });
  const goldMat = new THREE.MeshBasicMaterial({ color: P.gold });
  // 雷击圈导雷盘材质（淡渊靛 38%、不写深度）：近黑 0.96 盘的替代，警示靠环箍+金弧不靠黑度
  const zapDiscMat = new THREE.MeshBasicMaterial({ color: P.abyss, transparent: true, opacity: 0.38, depthWrite: false });
  // 假弯道：皮肤材质与地面同弯（同一 f(z)，见 worldBend.ts），否则远处障碍与弯掉的路面分家
  for (const m of [stoneMat, darkMat, bronzeMat, goldMat, zapDiscMat]) applyWorldBend(m);
  // 单位几何：尺寸全靠实例矩阵（圆柱沿 y；rx=±PI/2 只换朝向，横躺/立放共用同一套）
  const cylGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 14);
  const finGeo = new THREE.ConeGeometry(0.5, 1, 5);
  const ballGeo = new THREE.SphereGeometry(0.5, 12, 9);
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
  const boxStone = mk(boxGeo, stoneMat, M * 2); // 塌墙大板 / 拱肋石柱 / 导雷石板
  const boxDark = mk(boxGeo, darkMat, M * 3);   // 拱肋石梁与柱头 / 顶残块 / 鲸背垫层石
  const cylStone = mk(cylGeo, stoneMat, M * 3); // 断鼓 / 残碑鼓段 / 巨石鲸背躯段（共用直圆柱：鲸背顶面才能全程齐 o.h）
  const cylDark = mk(cylGeo, darkMat, M * 2);   // 鼓段断面暗盖
  const fin = mk(finGeo, darkMat, M * 4);       // 背鳍
  const gold = mk(boxGeo, goldMat, M * 3);      // 灼痕 / 符文 / 电弧纹 / 侧腹金纹
  const bronze = mk(ballGeo, bronzeMat, M * 4); // 摆链锤头 + 链节
  // 雷击圈（zap）换皮双槽：淡渊靛导雷盘 + 平贴环箍——entityLayers 默认盘是 0x0b0e16
  // 近黑 96% 圆盘，玩家跳跃时正好糊在角色脚下（用户截图穿帮②「脚下黑坨」）；本主题以
  // 「导雷铜环落地态」语言接管：警示可读性靠环箍与金弧，不再靠黑度。
  const zapDisc = mk(cylGeo, zapDiscMat, M);
  const zapRimGeo = new THREE.TorusGeometry(0.5, 0.045, 6, 26);
  zapRimGeo.rotateX(Math.PI / 2); // 平贴地面环（管径向 y 薄、径向宽）
  const zapRim = mk(zapRimGeo, goldMat, M);
  const dummy = new THREE.Object3D();
  const tmpC = new THREE.Color();
  /** 写一个实例：位置/尺寸/绕 x 倾角 + 灰阶微差（1=原色）。count 满则丢弃（极端场面少画一件不崩） */
  const put = (sl: SkinSlot, x: number, y: number, z: number, sx: number, sy: number, sz: number, rx = 0, shade = 1) => {
    if (sl.n >= sl.cap) return;
    dummy.position.set(x, y, z);
    dummy.rotation.set(rx, 0, 0);
    dummy.scale.set(sx, sy, sz);
    dummy.updateMatrix();
    sl.mesh.setMatrixAt(sl.n, dummy.matrix);
    sl.mesh.setColorAt(sl.n, tmpC.setScalar(shade));
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
        // 塌墙：石灰岩大板 + 顶部参差残块（2~3 块错高、明暗交替）+ 正面一道竖向金灼痕
        const wd = Math.max(o.d, 0.5); // 0.18m 海报板太薄读不出石墙，加厚到 0.5m（判定窗另有 0.4m 前瞻，不穿帮）
        put(boxStone, ox, o.h / 2 - sinkY, z, o.w, o.h, wd, 0, 0.9 + rnd(s, 1) * 0.1);
        for (let i = 0; i < 3; i++) {
          const bh = 0.16 + rnd(s, 40 + i) * 0.26;
          const bw = o.w * (0.2 + rnd(s, 50 + i) * 0.14);
          put(i === 1 ? boxDark : boxStone,
            ox + (rnd(s, 60 + i) - 0.5) * (o.w - bw), o.h + bh / 2 - 0.02 - sinkY, z + (rnd(s, 70 + i) - 0.5) * 0.1,
            bw, bh, wd * 0.9, 0, 0.85 + rnd(s, 80 + i) * 0.15);
        }
        const gh = o.h * (0.5 + rnd(s, 90) * 0.2);
        put(gold, ox + (rnd(s, 91) - 0.5) * o.w * 0.44, gh / 2 - sinkY, z + wd / 2 + 0.013, 0.09, gh, 0.02);
        break;
      }
      case 'low': {
        // 断鼓/残碑：可视顶压在 h*0.75（与判定口径同源，跳感不变）；d 深的横放躺倒、板薄的立放残碑
        const vh = o.h * cal.lowVisH;
        const r = Math.min(o.w, vh) * 0.5;
        if (o.d >= o.w * 0.9) {
          // 横放断鼓：沿 z 躺倒，两端面暗盖 + 迎面端一条金符文短线
          put(cylStone, ox, r - sinkY, z, r * 2, o.d, r * 2, Math.PI / 2, 0.9 + rnd(s, 2) * 0.1);
          put(cylDark, ox, r - sinkY, z + o.d / 2 - 0.04, r * 2.08, 0.1, r * 2.08, Math.PI / 2);
          put(cylDark, ox, r - sinkY, z - o.d / 2 + 0.04, r * 2.08, 0.1, r * 2.08, Math.PI / 2);
          put(gold, ox, r - sinkY, z + o.d / 2 + 0.02, r * 0.6, r * 0.7, 0.02);
        } else {
          // 立放残碑：椭圆截面鼓段（视觉厚度取 0.64 倍半径；判定按高度、圆顶越往边缘越矮，穿模观感可控）
          const dep = Math.max(o.d, r * 0.64);
          put(cylStone, ox, vh / 2 - sinkY, z, r * 2, vh, dep, 0, 0.9 + rnd(s, 2) * 0.1);
          put(cylDark, ox, vh - 0.04 - sinkY, z, r * 2.06, 0.09, dep * 1.03); // 断口暗盖，顶面高出 5mm 防共面闪面
          put(gold, ox, vh * 0.52 - sinkY, z + dep / 2 + 0.012, o.w * 0.3, vh * 0.16, 0.02);
        }
        break;
      }
      case 'high': {
        // 断拱肋：暗部石梁（下沿钉在 BAR_LOW_Y 1.2m，滑铲净空与判定同源不变）+ 两端石柱与小柱头
        const pw = 0.3;
        const px = o.w / 2 - pw / 2 - 0.02;
        put(boxDark, ox, cal.barLowY + 0.22 - sinkY, z, o.w, 0.44, 0.4);
        for (let pi = 0; pi < 2; pi++) {
          const sx = ox + (pi === 0 ? -1 : 1) * px;
          put(boxStone, sx, o.h / 2 - sinkY, z, pw, o.h, 0.3, 0, 0.9 + rnd(s, 3 + pi) * 0.1);
          put(boxDark, sx, o.h + 0.09 - sinkY, z, 0.44, 0.22, 0.36); // 柱头底面压进柱顶 2cm 防共面闪面
        }
        break;
      }
      case 'vehicle': {
        // 巨石鲸背：收分石躯 2~3 段直圆柱拼（段心 y = o.h - r → 每段顶面全程齐 o.h，
        // rideTop 列车支撑面口径不变；收分只来自段间半径递减，拱起的是腹部，段台读作石鼓接缝）
        // + 背鳍 3~4 枚（矮鳍后掠，站顶擦脚弱化）+ 侧腹金纹一道（逐段跟随腰线，连成一条下潜的纹）
        const r0 = Math.min(o.w, o.h) * 0.5;
        const n = o.d > 12 ? 3 : 2;
        const headZ = z + o.d / 2;
        let cz = headZ;
        for (let i = 0; i < n; i++) {
          const len = o.d * (n === 3 ? HULL_FR3[i] : HULL_FR2[i]);
          const r = i === 0 ? r0 : r0 * (i === 1 ? 0.8 : 0.62);
          cz -= len / 2;
          put(cylStone, ox, o.h - r - sinkY, cz, r * 2, len, r * 2, Math.PI / 2, 0.88 + rnd(s, 4 + i) * 0.12);
          put(gold, ox + r + 0.02, o.h - r - sinkY, cz, 0.06, 0.12, len * 0.72);
          cz -= len / 2 - (i < n - 1 ? 0.04 : 0); // 段间互叠 4cm：收分半径不同 + 端面错位，不产生共面闪面
        }
        put(boxDark, ox, 0.18 - sinkY, z, o.w * 0.82, 0.36, o.d * 0.7); // 垫层石：把拱起的腹部接到地面
        const nf = n === 3 ? 4 : 3;
        for (let i = 0; i < nf; i++) {
          const fh = 0.3 + rnd(s, 10 + i) * 0.16;
          put(fin, ox + (rnd(s, 20 + i) - 0.5) * 0.44, o.h + fh * 0.4 - sinkY,
            headZ - ((i + 1) * o.d) / (nf + 1), 0.3, fh, 0.36, -0.55);
        }
        break;
      }
      case 'moving': {
        // 摆链青铜锤：锤头铜绿球（1.12m ≈ 原挡板 1.1m 盒，贴地滑摆的判定观感不变）+ 上方三节链节示意；
        // 横摆 x 沿用 entityLayers 的 obstacleX（判定同源），本模块不重复摆动逻辑
        put(bronze, ox, 0.56 - sinkY, z, 1.12, 1.12, 1.12);
        put(bronze, ox, 1.3 - sinkY, z, 0.24, 0.24, 0.24);
        put(bronze, ox, 1.72 - sinkY, z, 0.19, 0.19, 0.19);
        put(bronze, ox, 2.14 - sinkY, z, 0.15, 0.15, 0.15);
        break;
      }
      case 'hazard': {
        if (o.zap) {
          // 雷击圈 = 导雷铜环落地态：淡盘（38% 渊靛，alpha 低不糊脚下）+ 环箍贴缘示形 +
          // 两段错位金电弧纹示警；判定体（o.w/o.d 2.2m、可跳）口径零改动
          put(zapDisc, ox, 0.026 - sinkY, z, o.w * 1.02, 0.05, o.d * 1.02);
          put(zapRim, ox, 0.07 - sinkY, z, o.w * 1.04, 1, o.d * 1.04);
          for (let i = 0; i < 2; i++) {
            put(gold, ox + (rnd(s, 30 + i) - 0.5) * o.w * 0.35, 0.045 - sinkY,
              z + (i === 0 ? 1 : -1) * o.d * 0.22, o.w * 0.38, 0.04, 0.06);
          }
          break;
        }
        // 导雷石板：石灰岩薄板（顶面齐 o.h=0.1m）+ 两段错位金电弧纹；0.35m 可跳提示带仍由 entityLayers 的 band 出
        put(boxStone, ox, o.h / 2 - sinkY, z, o.w, o.h, o.d, 0, 0.9 + rnd(s, 5) * 0.1);
        for (let i = 0; i < 2; i++) {
          put(gold, ox + (rnd(s, 30 + i) - 0.5) * o.w * 0.35, o.h + 0.025 - sinkY, // 电弧纹底面抬 5mm 离板顶防共面
            z + (i === 0 ? 1 : -1) * o.d * 0.22, o.w * 0.38, 0.04, 0.06);
        }
        break;
      }
      default: break; // 未知类别不画皮（保守：留给默认盘）
    }
  }

  const api = {
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
  // 声明接管闪电圈：entityLayers 门控读取本标记，对 isZap 障碍也调 emit（默认黑盘+闪电标志让位）。
  // 运行时挂载而非写进返回字面量：SkinFactory 的 ReturnType 交叉类型会把静态 zapSkin 变成
  // 其余三套皮肤（titan/forgeheart/library，不在本仓改动范围）的必填属性。
  (api as { zapSkin?: boolean }).zapSkin = true;
  return api;
}
