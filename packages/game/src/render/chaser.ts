/**
 * 追击者兽群（M7a，render 层）：sim 的 RunnerState.chaserDist（8=贴脸→80=远离，受击拉近/奔跑拉远）
 * 在玩家身后画出「Temple Run 恶魔猴群」的等价物——按主题换形的剪影兽群，全 InstancedMesh：
 *   stormspire 风暴魟×3（P.storm）/ titan 渡魂鸦×5（P.dusk）/ forgeheart 熔岩蜥×4（P.basalt +
 *   眼点 P.ember；brief 口径的 stoneDark 在该调色板无此常量，按「剪影取最暗色」惯例落玄武黑）/
 *   library 墨鸦×5（P.abyss 墨渊）/ 其余主题（seaside/coast/konbini/harbor）通用追猎兽×4（0x2a3444）。
 * 位置口径（关键）：本作是追背机位（cameraRig：镜头 z≈+8.4 眺望 −Z），玩家身后 8~80m 的字面
 *   z=+chaserDist 全部落在镜头背后=视锥外，永远不可见；因此把 chaserDist 单调映射进
 *   「角色脚跟 ↔ 镜头下沿」的可见带（群心 z 1.6→7.0）：贴脸=兽群抵在脚跟后，远离=沉向画面
 *   下缘淡出（Temple Run 猴群掉出画框的同款读法）。跟随相机、不随世界滚动（dist 入参不消费）。
 * 距离戏剧化：chaserDist≤12 个体 ×1.4 且 opacity=1（雾内最清晰档，20 处平滑归零防爆点）；
 *   ≥60 材质渐隐至 0.25（贴镜头下沿时本就在雾近距内，淡出全靠 opacity）。
 * 动效：确定性 sin（禁 Math.random）——相位错开的 2~3Hz 奔跑起伏 + scaleY 1±0.15 压扁拉伸
 *   （无骨骼，scale/pos 起伏读出「疾奔」）+ 鸦群拍翼/魟群摆翼。每帧零分配（compose 暂存预建）；
 *   draw call ≤2（体 1 + 翼/眼点缀 1）；frustumCulled=false（实例矩阵远超几何包围球，必须关剔除）。
 * 只读 runnerScene 传入的 sim 派生值，不反写玩法数据（单向数据流）；调色只走各主题 palette.ts 现有常量。
 */
import * as THREE from 'three';
import { rnd } from './sceneryProps.js';
import { P as P_STORM } from './stormspire/palette.js';
import { P as P_TITAN } from './titan/palette.js';
import { P as P_FORGE } from './forgeheart/palette.js';
import { P as P_LIB } from './library/palette.js';

/** 兽群形态：魟（摆翼纺锤）/ 鸦（体+双翼）/ 蜥（低长体+双眼点）/ 兽（通用剪影） */
type Form = 'ray' | 'crow' | 'lizard' | 'beast';
/** 未登记主题的通用追猎兽深色（任务口径） */
const BEAST_COLOR = 0x2a3444;
/** 可见带（米）：群心 z = Z_HEEL + u·Z_SPAN，u∈[0,1] 对应 chaserDist 8→80（脚跟后→镜头下沿前） */
const Z_HEEL = 1.6, Z_SPAN = 5.4;

/** 主题 → 兽群配置（个体数/主体色/点缀色；点缀 null=只有体层） */
function cfgOf(scenery: string): { form: Form; n: number; body: number; eye: number | null } {
  if (scenery === 'stormspire') return { form: 'ray', n: 3, body: P_STORM.storm, eye: null };
  if (scenery === 'titan') return { form: 'crow', n: 5, body: P_TITAN.dusk, eye: null };
  if (scenery === 'forgeheart') return { form: 'lizard', n: 4, body: P_FORGE.basalt, eye: P_FORGE.ember };
  if (scenery === 'library') return { form: 'crow', n: 5, body: P_LIB.abyss, eye: null };
  return { form: 'beast', n: 4, body: BEAST_COLOR, eye: null };
}

/** 个体确定性参数（rnd 同下标同结果：横向 ±3 / 前后 ±1.5 / 贴地 0.5~1.5 / 起伏 2~3Hz） */
interface Ind { x: number; dz: number; y0: number; f: number; ph: number; s: number }

/** 一群已建好的兽（scenery 每局恒定，update 惰性建一次；变了才拆重建，实践不触发） */
interface Flock {
  scenery: string; form: Form;
  body: THREE.InstancedMesh; bodyMat: THREE.MeshLambertMaterial; geoA: THREE.BufferGeometry;
  accent: THREE.InstancedMesh | null; accentMat: THREE.MeshBasicMaterial | null; geoB: THREE.BufferGeometry | null;
  inds: Ind[];
}

export function createChaser(scene: THREE.Scene) {
  // 每帧 compose 暂存（零分配）：欧拉序 YXZ，与 creatures.ts 同款
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), V = new THREE.Vector3(), S = new THREE.Vector3();
  const set = (mesh: THREE.InstancedMesh, i: number, x: number, y: number, z: number,
    rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => {
    E.set(rx, ry, rz, 'YXZ'); Q.setFromEuler(E);
    V.set(x, y, z); S.set(sx, sy, sz);
    M.compose(V, Q, S);
    mesh.setMatrixAt(i, M);
  };

  let flock: Flock | null = null;

  function build(scenery: string): Flock {
    const cfg = cfgOf(scenery);
    // 体几何：四棱锥纺锤横放、锥尖朝 −Z（鼻向玩家）；点缀层=鸦翼（同色薄板）/蜥眼（加色发光点）
    const geoA = new THREE.ConeGeometry(0.5, 1, 4);
    geoA.rotateX(Math.PI / 2); geoA.rotateY(Math.PI);
    const bodyMat = new THREE.MeshLambertMaterial({ color: cfg.body, transparent: true, opacity: 1 });
    const body = new THREE.InstancedMesh(geoA, bodyMat, cfg.n);
    body.frustumCulled = false; // 实例矩阵把个体摆到远离几何原点，默认包围球剔除会整群消失
    scene.add(body);
    const inds: Ind[] = Array.from({ length: cfg.n }, (_, i) => ({
      x: (rnd(i, 11) - 0.5) * 6,   // 横向 −3~+3 错开
      dz: (rnd(i, 13) - 0.5) * 3,  // 前后 ±1.5 错位
      y0: 0.5 + rnd(i, 15),        // 贴地基准 0.5~1.5m
      f: 2 + rnd(i, 17),           // 奔跑起伏 2~3Hz
      ph: rnd(i, 19) * 6.283,      // 相位错开
      s: 0.9 + rnd(i, 21) * 0.3,   // 体型 0.9~1.2
    }));
    let accent: THREE.InstancedMesh | null = null;
    let accentMat: THREE.MeshBasicMaterial | null = null;
    let geoB: THREE.BufferGeometry | null = null;
    if (cfg.form === 'crow') {
      geoB = new THREE.BoxGeometry(1, 0.03, 0.4); // 翼薄板：根部在体心、向 +x 展开（左翼 ry=π 镜像）
      geoB.translate(0.5, 0, 0);
      accent = new THREE.InstancedMesh(geoB, bodyMat, cfg.n * 2); // 翼与体同色同材质（剪影一体）
    } else if (cfg.eye !== null) {
      geoB = new THREE.SphereGeometry(1, 6, 4);
      accentMat = new THREE.MeshBasicMaterial({ color: cfg.eye, transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending });
      accent = new THREE.InstancedMesh(geoB, accentMat, cfg.n * 2); // 每蜥 2 枚眼点（炉火橙直出）
    }
    if (accent) { accent.frustumCulled = false; scene.add(accent); }
    return { scenery, form: cfg.form, body, bodyMat, geoA, accent, accentMat, geoB, inds };
  }

  function teardown() {
    if (!flock) return;
    scene.remove(flock.body); flock.body.dispose(); flock.geoA.dispose(); flock.bodyMat.dispose();
    if (flock.accent && flock.geoB) {
      scene.remove(flock.accent); flock.accent.dispose(); flock.geoB.dispose();
      flock.accentMat?.dispose();
    }
    flock = null;
  }

  return {
    /** dist：插值距离（本模块跟随相机不随世界滚动，入参不消费）；chaserDist：8 贴脸→80 远离；t：sim 时钟 */
    update(dist: number, chaserDist: number, t: number, scenery: string) {
      void dist; // 显式标注不消费（签名对齐总装约定）
      if (!flock || flock.scenery !== scenery) { teardown(); flock = build(scenery); }
      const u = Math.max(0, Math.min(1, (chaserDist - 8) / 72));          // 0=贴脸(8) → 1=远离(80)
      const zc = Z_HEEL + u * Z_SPAN;                                      // 群心：脚跟后 → 镜头下沿前
      const near = Math.max(0, Math.min(1, (20 - chaserDist) / 8));        // ≤12 全 1、≥20 归 0（×1.4 档）
      const op = 0.25 + 0.75 * Math.max(0, Math.min(1, (60 - chaserDist) / 20)); // ≥60 渐隐至 0.25
      const k = 1 + 0.4 * near;                                            // 贴脸档个体放大
      flock.bodyMat.opacity = op;
      if (flock.accentMat) flock.accentMat.opacity = Math.min(1, op * 0.95);
      for (let i = 0; i < flock.inds.length; i++) {
        const b = flock.inds[i]!;
        const run = Math.sin(t * b.f + b.ph);            // 奔跑起伏（确定性 sin）
        const sq = 1 + 0.15 * run;                       // 压扁拉伸：腾空拉伸、触地压扁
        const x = b.x + Math.sin(t * 0.9 + b.ph) * 0.25; // 横向缓摆
        const y = b.y0 + Math.max(0, run) * 0.35 * b.s;  // 只在腾空半周抬升（迈步读法）
        const z = zc + b.dz - near * 1.2;                // 贴脸档整体向玩家前压 1.2m
        const s = b.s * k;
        if (flock.form === 'ray') {
          const flap = Math.sin(t * b.f * 1.3 + b.ph) * 0.35; // 摆翼：翼厚随相位呼吸 + 绕 z 起伏
          set(flock.body, i, x, y, z, flap * 0.3, 0, flap, s * 1.2, s * (0.55 + flap * 0.25) * sq, s * 1.6);
        } else if (flock.form === 'crow') {
          const flap = Math.sin(t * b.f * 1.6 + b.ph) * 0.55; // 拍翼 3~5Hz（起伏的 1.6 倍频）
          set(flock.body, i, x, y, z, flap * 0.2, 0, flap * 0.4, s * 0.8, s * 0.55 * sq, s * 1.7);
          set(flock.accent!, i * 2, x, y, z, 0, 0, flap, s * 1.4, 1, 1);        // 右翼
          set(flock.accent!, i * 2 + 1, x, y, z, 0, Math.PI, flap, s * 1.4, 1, 1); // 左翼：ry=π 镜像（rz 同号翼尖同升同落）
        } else if (flock.form === 'lizard') {
          set(flock.body, i, x, y, z, 0, 0, 0, s * 0.9, s * 0.45 * sq, s * 2.0); // 低长体疾奔
          const eh = 0.06 * k; // 眼点（贴头端 −Z 侧，随放大档同涨）
          set(flock.accent!, i * 2, x - s * 0.14, y + s * 0.08, z - s * 0.8, 0, 0, 0, eh, eh, eh);
          set(flock.accent!, i * 2 + 1, x + s * 0.14, y + s * 0.08, z - s * 0.8, 0, 0, 0, eh, eh, eh);
        } else {
          set(flock.body, i, x, y, z, 0, 0, 0, s * 0.8, s * 0.7 * sq, s * 1.8); // 通用追猎兽：纯起伏剪影
        }
      }
      flock.body.instanceMatrix.needsUpdate = true;
      if (flock.accent) flock.accent.instanceMatrix.needsUpdate = true;
    },
    dispose() { teardown(); },
  };
}
