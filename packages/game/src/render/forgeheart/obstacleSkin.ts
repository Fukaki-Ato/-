/**
 * 熔炉巨兽 · 障碍皮肤（docs/scenes/forgeheart-brief.md §9 十二 defs 词汇表 + §13 步骤 8）：
 * 与 titan/obstacleSkin.ts 同构的显式换皮工厂（entityLayers SKIN_BY_SCENERY 门控提表按 scenery 取用）：
 * 只换「可视替身」，判定尺寸（o.w/h/d、low 可视 0.75 系数、high 杆下 1.2m 净空、rideTop 列车
 * o.h 支撑面）零改动；step（obs_mount_step 登车渣坡与判定截面同源）保持默认盘不上皮（§9 可选项）。
 *
 * 六类皮形制（§9 全表）：
 *   full    蜂巢崩塌墙：六棱柱束断面（4 根柱拼板、顶参差）+ 竖向炉火橙裂隙 + 顶残渣块
 *   low     断柱短桩（obs_box：立放六棱柱桩 + 断口暗盖 + 侧烧结赤热痕）/
 *           熔渣矮垣（obs_barrier_low：渣块堆垛 2~3 块错缝 + 橙裂纹一线）/
 *           滚落柱段（obs_cube_roll：短六棱柱段，滚动位移沿用 entityLayers 的 moveZ，不自建物理）
 *   high    卡箍残梁：青铜梁熔垂跨道（梁底 1.5m + 垂瘤青铜球下缘钉在 barLowY → 梁下净空恒 1.2m）
 *           + 两端玄武柱头 + 垂瘤熔滴球（§1.2 回火之夜证据 1：铜的下缘泪滴垂瘤）
 *   vehicle 脱轨斗车列（长车：4 节坩埚斗车、段长比抄鲸背 HULL_FR 配方、段顶面全程齐 o.h 保
 *           rideTop + 沉陷轨道垫层双轨条）/ 熔岩舌（obs_rusher_long：低矮熔流堆 + 前缘炉火橙辉
 *           + 顶烟一缕，不可站——rideTop=false 语义吻合：液体）
 *   moving  吊链熔锤：坩埚锤头（青铜球 1.12m 贴判定盒）+ 上方三节链节示意；摆动仍归 entityLayers
 *   hazard  熔裂地缝：玄武薄板顶面齐 o.h=0.1 + 两段错位橙渗缝（缝底抬 5mm 防共面，hazard 皮口径）
 *   zap     炉心灼痕盘（obs_lightning_circle，§9「forgeheart 必须上皮 zap」）：玄武灼痕薄盘 +
 *           两道炉火橙环纹（环底抬 5mm 防共面）——⚠️ entityLayers.ts:167 换皮门控的 `!isZap`
 *           目前把 zap 挡在 emit 之外，本分支以 o.zap 键休眠待放行（见 emit 的 zap 分支）。
 *
 * 铁律同 titan：10 个 InstancedMesh 槽（= 皮肤全部新增 draw call，≤10 上限）；确定性 rnd
 * （种子实体首见落 WeakMap——moveZ 冲刺件 worldZ 逐帧漂移，直接当随机会让残块每帧换位置）；
 * 每帧零分配（dummy/Color 预建）；只消费 o 现状（cls/w/h/d/lane/zap），不读 sim 其它状态。
 */
import * as THREE from 'three';
import type { ObstacleEntity } from '@tr/game/core/sim/trackGen.js';
import { rnd } from '../sceneryProps.js';
import { applyWorldBend } from '../stormspire/worldBend.js';
import { P } from './palette.js';

/** 判定口径常量（与 entityLayers 同源值，由调用方注入；与 titan/obstacleSkin 的同名接口逐字同构） */
export interface SkinCalibration { obsMax: number; lowVisH: number; barLowY: number }

/** 斗车躯段长度占比（§9「段长比抄鲸背 HULL_FR 配方」的 4 节版：头节最长、尾节最短） */
const HULL_FR4 = [0.28, 0.26, 0.24, 0.22] as const;

/** 实例槽：InstancedMesh + 容量护栏（按「整屏全为该类」的最坏场面给足，写满即丢弃多出的件） */
interface SkinSlot { mesh: THREE.InstancedMesh; cap: number; n: number }

export function createForgeheartObstacleSkin(scene: THREE.Scene, boxGeo: THREE.BufferGeometry, cal: SkinCalibration) {
  const M = cal.obsMax;
  // 五色直接取 forgeheart/palette 的 P（与场景同源不抄色值，brief §2 七色不出圈）：
  // 石体/渣/烬/烧结赤/青铜走 Lambert 与侧景同光（烧结赤「热但死」绝不发光）；
  // 裂隙/裂纹/渗缝/环纹走 Basic 炉火橙（发光唯一色，bloom 阈值 0.82 只捞得到它）。
  const basaltMat = new THREE.MeshLambertMaterial({ color: P.basalt });
  const clinkerMat = new THREE.MeshLambertMaterial({ color: P.slagDark });
  const slagMat = new THREE.MeshLambertMaterial({ color: P.slag });
  const sinterMat = new THREE.MeshLambertMaterial({ color: P.sinter });
  const bronzeMat = new THREE.MeshLambertMaterial({ color: P.bronze });
  const forgeMat = new THREE.MeshBasicMaterial({ color: P.ember });
  // 假弯道：皮肤六材质与地面同弯（同一 f(z)，见 stormspire/worldBend.ts），否则远处障碍与弯掉的路面分家
  for (const m of [basaltMat, clinkerMat, slagMat, sinterMat, bronzeMat, forgeMat]) applyWorldBend(m);
  // 单位几何：尺寸全靠实例矩阵（六棱柱=六棱玄武柱束的最小读法单元；圆柱沿 y，rz=±PI/2 只换朝向）
  const hexGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 6);  // 六棱柱：蜂巢柱束断面/断柱短桩/滚落柱段
  const cylGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 12); // 圆柱：斗车节/熔流堆/灼痕盘
  const ballGeo = new THREE.SphereGeometry(0.5, 10, 8);       // 球：坩埚锤头/垂瘤熔滴
  const ringGeo = new THREE.RingGeometry(0.55, 0.72, 20);     // 平放环：zap 灼痕盘的橙环纹
  ringGeo.rotateX(-Math.PI / 2);
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
  const hexBasalt = mk(hexGeo, basaltMat, M * 3);  // 崩塌墙柱束（×4）/断柱短桩/滚落柱段
  const boxBasalt = mk(boxGeo, basaltMat, M * 2);  // 高杆柱身/hazard 玄武薄板/轨道垫层
  const cylClinker = mk(cylGeo, clinkerMat, M * 3); // 断口暗盖/熔岩舌熔流堆/灼痕盘
  const boxSlag = mk(boxGeo, slagMat, M * 2);      // 矮垣渣块堆垛/墙顶残块
  const boxSinter = mk(boxGeo, sinterMat, M);      // 短桩侧烧结赤热痕（热但死，不发光）
  const cylBronze = mk(cylGeo, bronzeMat, M * 3);  // 熔垂梁/斗车节/链节
  const boxBronze = mk(boxGeo, bronzeMat, M * 2);  // 柱头卡箍块/沉陷轨条
  const ballBronze = mk(ballGeo, bronzeMat, M * 2); // 垂瘤熔滴球/坩埚锤头
  const boxForge = mk(boxGeo, forgeMat, M * 2);    // 竖向裂隙/橙裂纹/渗缝/熔舌前缘辉
  const ringForge = mk(ringGeo, forgeMat, M * 2);  // zap 灼痕盘橙环纹 ×2
  const dummy = new THREE.Object3D();
  const tmpC = new THREE.Color();
  /** 写一个实例：位置/尺寸/倾角 + 灰阶微差（1=原色）。count 满则丢弃（极端场面少画一件不崩） */
  const put = (sl: SkinSlot, x: number, y: number, z: number, sx: number, sy: number, sz: number,
    rx = 0, shade = 1, rz = 0) => {
    if (sl.n >= sl.cap) return;
    dummy.position.set(x, y, z);
    dummy.rotation.set(rx, 0, rz);
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
    if (o.zap === true) {
      // zap（obs_lightning_circle → 炉心灼痕盘，§9「forgeheart 必须上皮 zap」）：玄武灼痕薄盘
      // （直径贴 o.w=2.2、顶面齐 o.h=0.12）+ 两道炉火橙环纹（内环贴喷气孔、外环贴灼痕缘，
      // 环底抬 5mm 防共面闪面，同 hazard 皮口径）。⚠️ 休眠分支：entityLayers.ts:167 `!isZap`
      // 放行前不进 emit；zap strike 的喷柱表现归 forgeheart/eruption.ts（§12 矛盾 2 方案 B）。
      const r = o.w * 0.5;
      put(cylClinker, ox, o.h / 2 - sinkY, z, o.w, o.h, o.w, 0, 0.9 + rnd(s, 1) * 0.1);
      put(ringForge, ox, o.h + 0.005 - sinkY, z, o.w * 0.82, 1, o.w * 0.82); // 外环：灼痕缘
      put(ringForge, ox, o.h + 0.005 - sinkY, z, o.w * 0.4, 1, o.w * 0.4);   // 内环：喷气孔口
      put(boxForge, ox, o.h + 0.004 - sinkY, z - r * 0.24, 0.16, 0.012, o.d * 0.4); // 孔口橙缝
      return;
    }
    switch (o.cls) {
      case 'full': {
        // 蜂巢崩塌墙：六棱柱束断面（4 根柱拼板、宽 2m 内错缝拼满、顶参差）+ 竖向炉火橙裂隙 + 顶残渣块
        const wd = Math.max(o.d, 0.5); // 0.18m 海报板太薄读不出柱束断面，加厚到 0.5m（判定窗另有 0.4m 前瞻，不穿帮）
        const cw = [0.58, 0.5, 0.54, 0.38] as const; // 柱径错缝（和 = o.w，缝线即柱束断面读法）
        let cx = ox - o.w / 2;
        for (let i = 0; i < 4; i++) {
          const ch = o.h * (0.86 + rnd(s, 10 + i) * 0.14); // 顶参差：±14% 错高，最高不超判定顶
          put(hexBasalt, cx + cw[i]! / 2, ch / 2 - sinkY, z, cw[i]!, ch, wd,
            0, 0.9 + rnd(s, 20 + i) * 0.1, (rnd(s, 30 + i) - 0.5) * 0.06);
          if (i === 1 || i === 3) { // 两根柱顶补残渣块（明暗交替）
            const bh = 0.14 + rnd(s, 40 + i) * 0.2;
            put(boxSlag, cx + cw[i]! / 2 + (rnd(s, 50 + i) - 0.5) * 0.2, ch + bh / 2 - 0.03 - sinkY,
              z + (rnd(s, 60 + i) - 0.5) * 0.1, cw[i]! * 0.8, bh, 0.4, 0, 0.85 + rnd(s, 70 + i) * 0.15);
          }
          cx += cw[i]!;
        }
        // 竖向裂隙：贴正面的炉火橙窄条（发光唯一色），高 55%~75% 随种子
        const gh = o.h * (0.55 + rnd(s, 90) * 0.2);
        put(boxForge, ox + (rnd(s, 91) - 0.5) * o.w * 0.44, gh / 2 - sinkY, z + wd / 2 + 0.013, 0.09, gh, 0.02);
        break;
      }
      case 'low': {
        // 三种 low 形制按宽分形（defs 实测：obs_box w2 / obs_barrier_low w1.5 / obs_cube_roll w1.1，
        // 同 cls 三 defs——同 titan 用几何特征分形、不读 def id）；可视顶一律压 h×0.75（判定同源）
        const vh = o.h * cal.lowVisH;
        if (o.w >= 1.7) {
          // 断柱短桩：立放六棱柱桩（视觉厚度取 0.64 倍半径防薄板穿帮）+ 断口暗盖 + 侧烧结赤热痕
          const r = Math.min(o.w, vh) * 0.5;
          const dep = Math.max(o.d, r * 0.64);
          put(hexBasalt, ox, vh / 2 - sinkY, z, r * 2, vh, dep, 0, 0.9 + rnd(s, 2) * 0.1);
          put(cylClinker, ox, vh - 0.04 - sinkY, z, r * 2.06, 0.09, dep * 1.03); // 断口暗盖高出 5mm 防共面闪面
          put(boxSinter, ox + r * 0.42, vh * 0.52 - sinkY, z + dep / 2 + 0.012, 0.12, vh * 0.42, 0.02); // 热但死
        } else if (o.w >= 1.3) {
          // 熔渣矮垣：渣块堆垛（底两块并排 + 顶一块错缝）+ 正面一线橙裂纹（发光）
          const bh = vh * 0.56, bh2 = vh * 0.5;
          put(boxSlag, ox - o.w * 0.24, bh / 2 - sinkY, z, o.w * 0.52, bh, 0.7, 0, 0.9 + rnd(s, 3) * 0.1);
          put(boxSlag, ox + o.w * 0.25, bh / 2 - sinkY, z + 0.04, o.w * 0.5, bh, 0.66, 0, 0.8 + rnd(s, 4) * 0.12);
          put(boxSlag, ox + (rnd(s, 5) - 0.5) * 0.3, bh + bh2 / 2 - 0.05 - sinkY, z - 0.02,
            o.w * 0.48, bh2, 0.62, 0, 0.85 + rnd(s, 6) * 0.15);
          put(boxForge, ox, vh * 0.22 - sinkY, z + 0.362, o.w * 0.62, 0.06, 0.02); // 橙裂纹一线
        } else {
          // 滚落柱段：短六棱柱段 + 断口暗盖（滚动位移沿用 entityLayers 的 moveZ，本模块不自建物理）
          put(hexBasalt, ox, vh / 2 - sinkY, z, o.w, vh, o.w, 0, 0.9 + rnd(s, 7) * 0.1);
          put(cylClinker, ox, vh - 0.03 - sinkY, z, o.w * 1.04, 0.07, o.w * 1.04); // 断口暗盖高出 5mm
        }
        break;
      }
      case 'high': {
        // 卡箍残梁：青铜梁熔垂跨道（梁底抬到 barLowY+0.3，垂瘤球下缘钉回 barLowY → 净空恒 1.2m）
        // + 两端玄武柱身与青铜柱头（卡箍块）+ 垂瘤熔滴球 ×2（§1.2 证据 1 泪滴垂瘤的梁上读法）
        const r = 0.18;
        const beamY = cal.barLowY + 0.3 + r;
        put(cylBronze, ox, beamY - sinkY, z, r * 2, o.w * 0.98, r * 2, 0, 0.88 + rnd(s, 8) * 0.12, Math.PI / 2);
        const pw = 0.3;
        const px = o.w / 2 - pw / 2 - 0.02;
        for (let pi = 0; pi < 2; pi++) {
          const sx = ox + (pi === 0 ? -1 : 1) * px;
          put(boxBasalt, sx, o.h / 2 - sinkY, z, pw, o.h, 0.3, 0, 0.9 + rnd(s, 9 + pi) * 0.1);
          put(boxBronze, sx, beamY - sinkY, z, 0.4, 0.3, 0.36);      // 卡箍夹块：抱柱抱梁的青铜箍（卡箍读法）
          put(boxBronze, sx, o.h + 0.09 - sinkY, z, 0.44, 0.22, 0.36); // 柱头：底面压进柱顶 2cm 防共面闪面
        }
        for (let di = 0; di < 2; di++) { // 垂瘤：梁底挂青铜熔滴球，下缘恰在 barLowY（滑铲净空同源不变）
          const dr = 0.14;
          put(ballBronze, ox + (di === 0 ? -1 : 1) * o.w * 0.26, cal.barLowY + 0.3 + dr - sinkY, z, dr * 2, dr * 2, dr * 2);
        }
        break;
      }
      case 'vehicle': {
        if (o.d > 12) {
          // 脱轨斗车列：4 节坩埚斗车直圆柱拼（段心 y = o.h − r → 每段顶面全程齐 o.h，
          // rideTop 列车支撑面口径不变；坩埚唇缘用暗盖短环读出斗口）+ 沉陷轨道垫层双轨条
          const r0 = Math.min(o.w, o.h) * 0.5;
          const headZ = z + o.d / 2;
          let cz = headZ;
          for (let i = 0; i < 4; i++) {
            const len = o.d * HULL_FR4[i]!;
            cz -= len / 2;
            put(cylBronze, ox, o.h - r0 - sinkY, cz, r0 * 2, len, r0 * 2, Math.PI / 2, 0.86 + rnd(s, 10 + i) * 0.14);
            put(cylClinker, ox, o.h - 0.07 - sinkY, cz, r0 * 2.14, 0.14, r0 * 2.14, Math.PI / 2); // 坩埚唇缘（顶齐 o.h）
            cz -= len / 2 - (i < 3 ? 0.04 : 0); // 段间互叠 4cm：端面错位不产生共面闪面
          }
          put(boxBasalt, ox, 0.14 - sinkY, z, o.w * 0.9, 0.28, o.d * 0.86); // 沉陷轨道垫层
          for (let ri = 0; ri < 2; ri++) { // 双轨条：铸运线的轨基读法（哑青铜锈蚀断续）
            put(boxBronze, ox + (ri === 0 ? -1 : 1) * r0 * 0.5, 0.33 - sinkY, z, 0.12, 0.1, o.d * 0.8,
              0, 0.7 + rnd(s, 20 + ri) * 0.3);
          }
        } else {
          // 熔岩舌：低矮熔流堆（暗烬色扁圆柱堆，顶压在 o.h 内不可站——液体 rideTop=false 语义吻合）
          // + 前缘炉火橙辉（贴玩家侧）+ 顶烟一缕（玄武黑细柱剪影）
          put(cylClinker, ox, o.h * 0.3 - sinkY, z, o.w * 0.94, o.h * 0.6, o.d * 0.9, 0, 0.9 + rnd(s, 11) * 0.1);
          put(cylClinker, ox, o.h * 0.58 - sinkY, z + o.d * 0.12, o.w * 0.66, o.h * 0.34, o.d * 0.5, 0, 1);
          put(boxForge, ox, 0.09 - sinkY, z + o.d * 0.44, o.w * 0.7, 0.14, 0.05); // 前缘辉：流动方向读法
          put(cylClinker, ox + (rnd(s, 12) - 0.5) * 0.3, o.h + 0.5 - sinkY, z - o.d * 0.1, 0.16, 1.0, 0.16);
        }
        break;
      }
      case 'moving': {
        // 吊链熔锤：坩埚锤头（青铜球 1.12m 贴判定挡板 1.2³ 盒，贴地滑摆的判定观感不变）
        // + 上方三节链节示意（渐细）；横摆 x 沿用 entityLayers 的 obstacleX（判定同源），本模块不重复摆动逻辑
        put(ballBronze, ox, 0.56 - sinkY, z, 1.12, 1.12, 1.12);
        put(cylBronze, ox, 1.3 - sinkY, z, 0.24, 0.24, 0.24);
        put(cylBronze, ox, 1.72 - sinkY, z, 0.19, 0.19, 0.19);
        put(cylBronze, ox, 2.14 - sinkY, z, 0.15, 0.15, 0.15);
        break;
      }
      case 'hazard': {
        // 熔裂地缝：玄武薄板（顶面齐 o.h=0.1）+ 两段错位橙渗缝；0.35m 可跳提示带仍由 entityLayers 的 band 出
        put(boxBasalt, ox, o.h / 2 - sinkY, z, o.w, o.h, o.d, 0, 0.9 + rnd(s, 13) * 0.1);
        for (let i = 0; i < 2; i++) {
          put(boxForge, ox + (rnd(s, 30 + i) - 0.5) * o.w * 0.35, o.h + 0.025 - sinkY, // 渗缝底面抬 5mm 离板顶防共面
            z + (i === 0 ? 1 : -1) * o.d * 0.22, o.w * 0.38, 0.04, 0.06);
        }
        break;
      }
      default: break; // step 及未知类别不画皮（保守：留给默认盘，§9 处置——step 登车坡与判定截面同源）
    }
  }

  return {
    zapSkin: true, // 声明 zap（雷击圈=炉心灼痕盘）已上皮：entityLayers 门控据此放行 zap 进 emit
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
