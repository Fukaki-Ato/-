/**
 * 沉眠泰坦 · 须发帘（docs/scenes/titan-brief.md §4.4 + §8 + §10.1 步骤 7）：
 *   颈段甲缘（z −150~−196、|x| 4~7m）从上方垂下的发束帘 ×14：每帘 3~5 条渐细长条
 *   （径 0.12~0.2m、长 3~6m，悬自甲缘，色苍岩肤→尸苔绿渐变），束尾坠一枚亡火金魂火珠。
 *   动效：单摆摆幅 ±12°、周期 2.8~3.6s、相邻帘相位互错；摆幅随呼吸相位调制（呼吸 =
 *   t×2π/10 正弦近似，呼气顶点 ×1.2——须发随「呼气」荡开，§4.4）。
 *   逐帧写入两笔账（§4.0 纪律 5）：滚动基线 = 全部实例每帧 z+=move 重写矩阵（同 stormspire
 *   侧景 writeAll 口径，帘与帘之间相对排布恒定）；其上的动效改写（摆角 sin 重算）按 2 帧轮写
 *   ——奇偶帧交替只重算一半束的摆角，另一半沿用上一帧角度（摆动周期 ≥2.8s，30Hz 采样平滑，
 *   观感无差），≈28 束/帧 ≤200 红线。摆动归 x 向（摆向路缘）：束长按峰值摆幅钳制，
 *   束尾内摆恒 x≥3.6（路缘外沿 3.3 之外，不与车道/玩家读法相交）。
 * 全部 InstancedMesh + 确定性 rnd；每帧零分配（compose 暂存预建）；发光只用亡火金；不读 sim。
 * draw call = 2（发束 + 魂火珠）。
 */
import * as THREE from 'three';
import { LOOP, WRAP_Z, rnd, std } from '../sceneryProps.js';
import { applyWorldBend } from '../stormspire/worldBend.js';
import { P } from './palette.js';

const VEILS = 14;
const SWING_AMP = (12 * Math.PI) / 180; // 摆幅 ±12°
const BREATH_S = 10;                    // 呼吸周期 10s（§3.3，t 正弦近似）
const BREATH_MOD = 0.2;                 // 呼气顶点摆幅 ×1.2（§4.4）
/** 摆幅峰值（含呼吸调制）的正弦：束长按它钳制，保证束尾内摆不越进车道（见下） */
const AMP_MAX_SIN = Math.sin(SWING_AMP * (1 + BREATH_MOD));

/** 一条发束：静态参数 + 缓存摆角（ang 只在轮写桶内重算；滚动 z 每帧推进） */
interface Strand { x: number; ay: number; z: number; r: number; len: number; per: number; ph: number; ang: number }

export function createVeils(scene: THREE.Scene) {
  // 发束：锥柱渐细（顶径 1、底径 0.48），束根平移到原点向下悬；魂火珠：小八面体（同瞳孔/魂火口径）
  const strandGeo = new THREE.CylinderGeometry(0.5, 0.24, 1, 5);
  strandGeo.translate(0, -0.5, 0);
  const beadGeo = new THREE.OctahedronGeometry(0.5, 0);
  // 发束色走实例色（sceneryProps tint 口径）：苍岩肤→尸苔绿渐变（油亮的死人长发），材质白底
  const strandMat = std(0xffffff);
  const beadMat = new THREE.MeshBasicMaterial({ color: P.pyre });
  applyWorldBend(beadMat); // 束尾珠贴甲缘，与侧景同弯不脱体（实心 Basic 可注入，同 stormspire 金纹口径）

  // 14 帘沿颈段 −150~−196 均布错落；束沿甲缘（z 向）并排成帘；锚高 = 甲缘 5~6.8m，
  // 束长按「束尾不离地 + 内摆不入车道」双钳制：len ≤ (|x|−3.6)/sin(峰值摆幅) ⇒ 束尾恒 x≥3.6
  // （路缘外沿 3.3 之外，不与玩家读法相交；|x| 取 4.5~7 才放得下 3~6m 全长）。
  const defs: Strand[] = [];
  for (let v = 0; v < VEILS; v++) {
    const side = v % 2 === 0 ? -1 : 1;
    const vx = side * (4.5 + rnd(v, 41) * 2.5);               // |x| 4.5~7m（甲缘外侧，4~7 带内收安全档）
    const vz = -150 - (v + rnd(v, 21) * 0.8) * (46 / VEILS);  // 颈段均布 + 抖动
    const ay = 5 + rnd(v, 43) * 1.8;                          // 帘内各束同锚高（甲缘平直读法）
    const ph = rnd(v, 37) * 6.283;                            // 相邻帘相位互错
    const n = 3 + Math.floor(rnd(v, 23) * 3);                 // 每帘 3~5 束
    for (let k = 0; k < n; k++) {
      const i = v * 5 + k;
      defs.push({
        x: vx,
        ay,
        z: vz + (k - (n - 1) / 2) * (0.34 + rnd(i, 45) * 0.2),
        r: 0.12 + rnd(i, 31) * 0.08,                          // 径 0.12~0.2m
        len: Math.min(3 + rnd(i, 33) * 3, ay - 0.4, (Math.abs(vx) - 3.6) / AMP_MAX_SIN), // 长 3~6m
        per: 2.8 + rnd(i, 35) * 0.8,                          // 摆周期 2.8~3.6s
        ph: ph + (rnd(i, 39) - 0.5) * 0.5,
        ang: 0,
      });
    }
  }
  const cap = defs.length;
  const strands = new THREE.InstancedMesh(strandGeo, strandMat, cap);
  const beads = new THREE.InstancedMesh(beadGeo, beadMat, cap);
  strands.frustumCulled = false; beads.frustumCulled = false; // 矩阵逐帧改，剔除交给 count/visible 语义外的整 Mesh 常显
  scene.add(strands); scene.add(beads);
  const skinC = new THREE.Color(P.skin), mossC = new THREE.Color(P.moss), tmpC = new THREE.Color();
  for (let i = 0; i < cap; i++) { // 初色：束间苍岩肤→尸苔绿渐变 + 明暗微差
    tmpC.copy(skinC).lerp(mossC, rnd(i, 47)).multiplyScalar(0.9 + rnd(i, 49) * 0.15);
    strands.setColorAt(i, tmpC);
  }
  if (strands.instanceColor) strands.instanceColor.needsUpdate = true;

  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), V = new THREE.Vector3(), S = new THREE.Vector3();
  const compose = (mesh: THREE.InstancedMesh, i: number, x: number, y: number, z: number, rz: number, sx: number, sy: number, sz: number) => {
    E.set(0, 0, rz, 'YXZ'); Q.setFromEuler(E);
    V.set(x, y, z); S.set(sx, sy, sz);
    M.compose(V, Q, S);
    mesh.setMatrixAt(i, M);
  };

  let frame = 0;
  return {
    update(move: number, t: number) {
      frame++;
      const half = frame & 1; // 2 帧轮写桶：奇偶帧交替刷新一半束的摆角，另一半沿用
      const amp = SWING_AMP * (1 + BREATH_MOD * (0.5 + 0.5 * Math.sin((t * Math.PI * 2) / BREATH_S)));
      for (let i = 0; i < cap; i++) {
        const s = defs[i]!;
        s.z += move;
        if (s.z > WRAP_Z) s.z -= LOOP;
        if ((i & 1) === half) s.ang = Math.sin((t * Math.PI * 2) / s.per + s.ph) * amp; // 动效改写：轮写桶内才重算
        compose(strands, i, s.x, s.ay, s.z, s.ang, s.r * 2, s.len, s.r * 2);
        // 束尾魂火珠：钉在束的尾端（随缓存摆角摆出），随滚动基线重写
        compose(beads, i, s.x + Math.sin(s.ang) * s.len, s.ay - Math.cos(s.ang) * s.len, s.z, 0, 0.22, 0.22, 0.22);
      }
      strands.instanceMatrix.needsUpdate = true;
      beads.instanceMatrix.needsUpdate = true;
    },
    dispose() {
      scene.remove(strands); scene.remove(beads);
      strandGeo.dispose(); beadGeo.dispose(); strandMat.dispose(); beadMat.dispose();
      strands.dispose(); beads.dispose();
    },
  };
}
