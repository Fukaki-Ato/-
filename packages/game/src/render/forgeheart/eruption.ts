/**
 * 熔炉巨兽 · 喷发管线（docs/scenes/forgeheart-brief.md §3.1 喷发 + §12 矛盾 2 方案 B）：
 * LightningFx 同构接口（lightning.ts:46-53 三件套）——
 *   strike(lane, worldZ, laneWidth) 事件驱动单发（zap 圈/死亡雷击自动继承喷柱视觉，§12 矛盾 2）；
 *   update(dt, dist) 每帧推进：喷发/预警自排程（tide.ts 纯函数单源）+ 返回闪橙强度 0..1；
 *   dispose() 释放几何/材质/灯光。
 * 几何反向对标 lightning.ts 的「天→地锯齿」：喷柱从岩浆面（地）喷向炉腔高处（天），
 * 两端直、中段抖，MC 式频闪断口——但**确定性**：抖动/频闪全走 sceneryProps 的 rnd hash，
 * 不用 Math.random（预警窗与喷发排程同为 dist 纯函数，回放安全，§8 确定性约束）。
 * 排程（§3.1）：喷发段 = tide.surgeWindow 的奇数周期高潮驻留段（216–252/504–540…每 288m）；
 *   段起点 S 前 1.0s 进预警窗 [S−v, S)，v = 渲染估速 (dist−lastDist)/dt（窗宽 12~26m 钳制），
 *   提前量恒定不随难度变；段内喷柱 ×3 打侧柱区（不打赛道，Phase A 不判负）；
 *   段起点触发全场闪橙一次（峰值/衰减复用 lightning.ts 的 FLASH_PEAK/0.26s 口径）。
 * 联动读数（总装每帧取）：ashBoost 灰烬密度倍率 1→2.5、warn 预警红光 0..1（峰值 0.4 由
 *   调用方 lerp 雾/背景）、pulse 岩浆面脉动增量（+0.3m·sin 2Hz，§3.1）。
 * 每帧零分配（jets/pts/向量预建，稳态路径无闭无新数组）；只读 dist，不反写 sim。
 */
import * as THREE from 'three';
import { FLASH_PEAK } from '../lightning.js';
import { surgeStart, surgeWindow } from './tide.js';
import { rnd } from '../sceneryProps.js';
import { P } from './palette.js';

/** 可同时播放的喷柱数（每 288m 三根，实战不会叠段；池化 3 槽 = BOLT_POOL 同款） */
const JET_POOL = 3;
/** 每根喷柱的分节数（点数为节数+1；两端直、中段抖，对标 lightning.ts SEGS） */
const SEGS = 9;
/** 喷柱顶高（米）：蜂巢柱 6~18m 的上限附近（§4.2），从岩浆面读到炉腔高处 */
const JET_TOP_M = 16;
/** 喷柱存活时长（秒）：比雷击 0.3s 留帧稍长，柱体才读得出「喷」而非「劈」 */
const JET_LIFE_S = 0.5;
/** 中段横向抖动幅度（米）：熔流比电弧粗，比闪电的 1.15 放大一档 */
const JITTER_M = 1.5;
/** 全场闪橙衰减时长（秒）：复用 lightning.ts 口径（FLASH_DECAY_S 未导出，同值 0.26） */
const FLASH_DECAY_S = 0.26;
/** 打击点点光峰值强度（对标 lightning.ts IMPACT_LIGHT_PEAK） */
const IMPACT_LIGHT_PEAK = 26;
/** 喷柱基座 = 高潮驻留岩浆面高度（米）：−6.5 + 5.7·level(1)（§3.1，喷发段必在高潮位） */
const LAVA_SURGE_Y = -0.8;
/** 喷发段长度（米）：u ∈ [72, 108)（§3.1 高潮驻留段） */
const SURGE_LEN_M = 36;
/** 三根喷柱在喷发段内的落点偏移（米）：段首/段中/段尾各一根 */
const JET_AT_M = [3, 15, 27] as const;
/** 侧柱区横坐标（米）：路半宽 1.5×2.2=3.3 + 渣肩台 1.2 ≈ 4.5 外（§3.2），±0.6 抖动仍不打赛道 */
const SIDE_X_M = 4.9;
/** 估速钳制（m/s）：config/game.json baseSpeed/maxSpeed=12/26 → 预警窗宽 12~26m（§3.1） */
const V_MIN = 12, V_MAX = 26;
/** 喷发段灰烬密度倍率（§3.1：灰烬 ×2.5） */
export const ASH_BOOST = 2.5;
/** 预警红光峰值：雾色/背景色向炉火橙 lerp 的上限（§3.1，warn×此值由调用方消费） */
export const WARN_LERP = 0.4;
/** 暖闪 tint（§12 矛盾 2 方案 B：forgeheart 的 flashTint 分支值，替换冷白 FLASH_TINT） */
export const FORGE_TINT = 0xff8a50;

const UP = new THREE.Vector3(0, 1, 0); // 摆段朝向的基准轴（对标 lightning.ts 同名常量）

export interface EruptionFx {
  /** 在指定车道/世界深度触发一次喷柱（zap 圈/死亡雷击继承；事件驱动，无随机延迟） */
  strike(lane: number, worldZ: number, laneWidth: number): void;
  /** 每帧推进，返回当前闪橙强度 0..1（调用方应用到灯光/背景/雾，接口同 LightningFx.update） */
  update(dt: number, dist: number): number;
  /** 场景销毁时释放（几何/材质/灯光） */
  dispose(): void;
  /** 灰烬密度倍率（1 平时 → 2.5 喷发段，指数逼近；上升灰烬层按此读数提亮/提速） */
  ashBoost: number;
  /** 预警红光强度 0..1：预警窗内线性爬升、喷发开头 6m 内交给闪橙后回落 */
  warn: number;
  /** 岩浆面脉动增量（米）：喷发段 0.3·sin(4πt)（2Hz），其余恒 0——岩浆海 y 直接加上 */
  pulse: number;
}

export function createEruption(scene: THREE.Scene): EruptionFx {
  const segGeo = new THREE.BoxGeometry(1, 1, 1);
  interface Jet {
    group: THREE.Group;
    segs: THREE.Mesh[];
    glows: THREE.Mesh[];
    coreMat: THREE.MeshBasicMaterial;
    glowMat: THREE.MeshBasicMaterial;
    /** 喷柱锚点：x=世界横坐标（侧柱区/zap 圈车道），worldZ=赛道深度（渲染 z=worldZ-dist 逐帧滚动） */
    x: number; worldZ: number;
    /** 剩余寿命（<=0 = 空闲）/ 已存活（频闪相位量化用） */
    life: number; age: number;
    /** 本根喷柱的确定性种子（排程序号/zap 序号派生，抖动与频闪全走 rnd hash） */
    seed: number;
  }
  const jets: Jet[] = [];
  for (let i = 0; i < JET_POOL; i++) {
    const coreMat = new THREE.MeshBasicMaterial({
      color: P.ember, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const glowMat = new THREE.MeshBasicMaterial({
      color: FORGE_TINT, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const group = new THREE.Group(); group.visible = false; scene.add(group);
    const segs: THREE.Mesh[] = [], glows: THREE.Mesh[] = [];
    for (let s = 0; s < SEGS; s++) {
      const m = new THREE.Mesh(segGeo, coreMat);
      m.visible = false; group.add(m); segs.push(m);
      const g = new THREE.Mesh(segGeo, glowMat);
      g.visible = false; group.add(g); glows.push(g);
    }
    jets.push({ group, segs, glows, coreMat, glowMat, x: 0, worldZ: 0, life: 0, age: 0, seed: 0 });
  }
  const impactLight = new THREE.PointLight(FORGE_TINT, 0, 18, 2);
  impactLight.visible = false;
  scene.add(impactLight);

  const p0 = new THREE.Vector3(), p1 = new THREE.Vector3(), dir = new THREE.Vector3(), mid = new THREE.Vector3();
  const pts: THREE.Vector3[] = []; // 预建路径点（生成锯齿时原地改写，喷发事件也零分配）
  for (let s = 0; s <= SEGS; s++) pts.push(new THREE.Vector3());
  let flashLeft = 0;
  let lastDist = -1;                 // 估速用上一帧 dist（首帧走 V_MIN 兜底）
  let surgeId = -1;                  // 正在喷发的段起点 S（-1 = 无）；变化即段边界 crossing
  let surgeElapsed = 0;              // 段内计时（2Hz 脉动相位）
  let fired = 0;                     // 本段已发射喷柱位掩码（确定性，不补掷不重掷）
  let strikeSeq = 0;                 // zap/死亡雷击序号（种子派生）
  const fx: EruptionFx = {
    ashBoost: 1, warn: 0, pulse: 0,
    strike(lane: number, worldZ: number, laneWidth: number) {
      fireJet(lane * laneWidth, worldZ, ++strikeSeq * 7.77);
      flashLeft = FLASH_DECAY_S; // zap/死亡雷击继承全场闪橙（§12 矛盾 2）
    },
    update(dt: number, dist: number): number {
      // ── 自排程（tide.ts 纯函数单源）：段边界 crossing 触发闪橙，段内按偏移发射喷柱 ──
      const inSurge = surgeWindow(dist);
      const sCur = inSurge ? surgeStart(dist) : -1;
      if (sCur !== surgeId) {
        surgeId = sCur; surgeElapsed = 0; fired = 0;
        if (sCur >= 0) flashLeft = FLASH_DECAY_S; // 段起点：全场闪橙一次（§3.1）
      }
      if (inSurge) surgeElapsed += dt;
      // 估速 v = (dist−lastDist)/dt（runnerScene 传入的 dist 即插值距离，§3.1 取数口径），钳 12~26
      const v = lastDist >= 0 && dt > 0 ? Math.min(V_MAX, Math.max(V_MIN, (dist - lastDist) / dt)) : V_MIN;
      lastDist = dist;
      // 预警窗 [S−v, S)：S = 下一个喷发段起点（正在喷发时取下下段，红光交给闪橙）
      const sNext = inSurge ? surgeStart(dist + SURGE_LEN_M) : surgeStart(dist);
      fx.warn = inSurge ? Math.max(0, 1 - (dist - sCur) / 6)
        : dist < sNext && sNext - dist < v ? 1 - (sNext - dist) / v : 0;
      fx.pulse = inSurge ? 0.3 * Math.sin(4 * Math.PI * surgeElapsed) : 0; // +0.3m 脉动（2Hz）
      const ashTarget = inSurge ? ASH_BOOST : 1;
      fx.ashBoost += (ashTarget - fx.ashBoost) * Math.min(1, dt * (inSurge ? 12 : 2.5)); // 快起慢落
      if (inSurge) {
        for (let i = 0; i < JET_AT_M.length; i++) {
          if ((fired & (1 << i)) === 0 && dist >= sCur + JET_AT_M[i]!) {
            fired |= 1 << i;
            // 侧柱区左右与外缘抖动走确定性 hash（不打赛道：4.9±0.6 > 路半宽 3.3+肩台 1.2）
            const side = rnd(surgeId, 40 + i) < 0.5 ? -1 : 1;
            fireJet(side * (SIDE_X_M + (rnd(surgeId, 50 + i) - 0.5) * 1.2), sCur, surgeId * 3 + i);
          }
        }
      }
      // ── 闪橙与喷柱推进（对标 lightning.ts：前亮后弱 1.5 次幂回落；频闪相位 30Hz 量化取 hash）──
      let flash = 0;
      if (flashLeft > 0) flashLeft = Math.max(0, flashLeft - dt);
      flash = flashLeft <= 0 ? 0 : FLASH_PEAK * (flashLeft / FLASH_DECAY_S) ** 1.5;
      let anyAlive = false, maxLife = -1, newest = -1;
      for (let i = 0; i < JET_POOL; i++) {
        const b = jets[i]!;
        if (b.life <= 0) continue;
        anyAlive = true;
        b.life -= dt; b.age += dt;
        b.group.position.z = b.worldZ - dist; // 喷柱锚定喷发段：随赛道滚动，不飘在身后
        if (b.life <= 0) {
          b.group.visible = false;
          for (let s = 0; s < SEGS; s++) { b.segs[s]!.visible = false; b.glows[s]!.visible = false; }
          continue;
        }
        if (b.life > maxLife) { maxLife = b.life; newest = i; }
        // 确定性频闪：整组忽明忽暗 + 断口（相位量化到 30Hz，同相位恒同结果，回放安全）
        const phase = Math.floor(b.age * 30);
        const strobe = rnd(phase, b.seed) < 0.35 ? 0.15 : 1;
        const fade = Math.min(1, b.life / (JET_LIFE_S * 0.5));
        b.coreMat.opacity = strobe * fade;
        b.glowMat.opacity = strobe * fade * 0.5;
        for (let s = 0; s < SEGS; s++) {
          const vis = rnd(phase * 7 + s, b.seed) > 0.25; // 频闪断口：部分小节隐去
          b.segs[s]!.visible = vis;
          b.glows[s]!.visible = vis;
        }
      }
      impactLight.visible = anyAlive;
      if (anyAlive && newest >= 0) {
        const b = jets[newest]!;
        impactLight.intensity = IMPACT_LIGHT_PEAK * Math.max(flash, 0.25);
        impactLight.position.set(b.x, 0.6, b.worldZ - dist);
      }
      return flash;
    },
    dispose() {
      segGeo.dispose();
      for (let i = 0; i < JET_POOL; i++) {
        jets[i]!.coreMat.dispose(); jets[i]!.glowMat.dispose();
        scene.remove(jets[i]!.group);
      }
      scene.remove(impactLight);
      impactLight.dispose();
    },
  };

  /** 生成一根地→天的锯齿喷柱并摆好各小节（对标 lightning.ts shape 反向：两端直、中段抖） */
  function fireJet(x: number, worldZ: number, seed: number) {
    let b = jets[0]!;
    for (let i = 1; i < JET_POOL; i++) if (jets[i]!.life < b.life) b = jets[i]!; // 空闲槽优先，全忙复用最早一槽
    b.x = x; b.worldZ = worldZ; b.life = JET_LIFE_S; b.age = 0; b.seed = seed;
    b.group.visible = true;
    b.group.position.set(0, LAVA_SURGE_Y, 0);
    pts[0]!.set(x + (rnd(seed, 1) - 0.5) * 0.3, 0, 0); // 柱基：岩浆面破口（局部 y=0，组挂在 LAVA_SURGE_Y）
    for (let s = 1; s < SEGS; s++) {
      const k = s / SEGS;
      const amp = JITTER_M * Math.sin(Math.PI * k); // 中段抖、两端收敛
      pts[s]!.set(x + (rnd(seed, 10 + s) - 0.5) * 2 * amp, k * JET_TOP_M, (rnd(seed, 30 + s) - 0.5) * 0.6 * amp);
    }
    pts[SEGS]!.set(x, JET_TOP_M, 0); // 柱顶：直端收进炉腔高处（反向对标闪电的天端入画）
    for (let s = 0; s < SEGS; s++) {
      p0.copy(pts[s]!);
      p1.copy(pts[s + 1]!);
      dir.subVectors(p1, p0);
      const len = dir.length() || 0.001;
      mid.addVectors(p0, p1).multiplyScalar(0.5);
      dir.divideScalar(len);
      // 柱体比电弧粗一档：核心 0.16 / 辉光 0.45（对标闪电的 0.07/0.2）
      for (let k = 0; k < 2; k++) {
        const ms = k === 0 ? b.segs[s]! : b.glows[s]!;
        ms.visible = true;
        ms.position.copy(mid);
        ms.scale.set(k === 0 ? 0.16 : 0.45, len, k === 0 ? 0.16 : 0.45);
        ms.quaternion.setFromUnitVectors(UP, dir);
      }
    }
  }
  return fx;
}
