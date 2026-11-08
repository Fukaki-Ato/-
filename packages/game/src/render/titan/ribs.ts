/**
 * 沉眠泰坦 · 肋拱 ×12（docs/scenes/titan-brief.md §4.2 + §3.2 分区：胸段 4 座 z −64~−90 + 肋段 8 座）：
 *   单拱 = 7~9 节骨段盒（2.2×1.4×1.6m）沿椭圆弧实例摆位（不烘死，§4.2），拱跨 8~14m；
 *   拱下净高两档 4.5m（直接跑过）/ 2.2m（必须滑铲）——与 stormspire 石拱门两档口径同源
 *   （stormspire-brief §4.8 / bridge.ts 石拱门 4.5m）。
 *   【净高与判定的关系】肋拱是纯视觉件，不做任何碰撞：玩家能不能过由 sim 的障碍判定决定
 *   （obs_gate_low / obs_barrier_low 等，entityLayers 判定口径）。两档净高只负责「教读法」：
 *   4.5m 档与可跑/可跳障碍同高、2.2m 档与滑铲档同高（外车道下 ≥2.1m），玩家在 scenery 拱下
 *   预演通过方式，在皮肤障碍上兑现——scenery 拱与 'high' 皮肤（断甲梁）互文（§4.2 玩法）。
 *   损毁四态（比例 §4.2，salt 104 实测恰为 6/3/2/1）：完整 50% / 半塌（一侧断落斜插成坡）25% /
 *   断桩（只剩两节根部 + 断口暗盖）17% / 悬而未坠（断口错位 0.4m 架着）8%；倒伏段为离体死件，
 *   不参与呼吸。
 *   动效：矩阵呼吸 ±0.35m（§3.3，全拱同相位 + 每拱 ±0.2rad 确定性微抖；sin 按 4 帧轮写分桶，
 *   §4.0 纪律 5）；肋是呼吸感知最强的部位（§4.2）。
 *   材质：骨象牙骨段 + 节间深色关节环（兼断口暗盖）+ 迎风面尸苔贴片（§4.0 纪律 4）。
 *   全部 InstancedMesh + 确定性 rnd + LOOP/WRAP_Z 回收；每帧零分配；发光零；不读 sim。
 */
import * as THREE from 'three';
import { LOOP, WRAP_Z, addInst, rnd, std, writeAll, type Inst, type Placement } from '../sceneryProps.js';

/** 本地色表逐值对表 titan/palette.ts（§2 + 派生口径；三文件互不 import） */
const BONE = 0xd9d2be;      // 骨象牙
const MOSS = 0x5c7a5e;      // 尸苔绿
const BONE_DARK = 0x8f9996; // 派生：骨象牙 × 雾灰青（关节环/断口暗面）

/** 椭圆弧骨段摆位：u∈[0,π]，x=半跨·cos u，y=净高·sin u+0.75（顶节下缘 = 拱下净高），长轴贴弧切线 */
function arcPoint(half: number, C: number, u: number): { x: number; y: number; rz: number } {
  return { x: half * Math.cos(u), y: C * Math.sin(u) + 0.75, rz: Math.atan2(C * Math.cos(u), -half * Math.sin(u)) };
}

export function createRibs(scene: THREE.Scene) {
  const insts: Inst[] = [];
  const segGeo = new THREE.BoxGeometry(2.2, 1.4, 1.6);          // 单节骨段盒（§4.2 形制）
  const jointGeo = new THREE.BoxGeometry(1.5, 0.26, 1.74);      // 节间关节环（z 向略深于骨段 → 读作箍；兼断口暗盖）
  const mossGeo = new THREE.BoxGeometry(1.5, 0.8, 0.14);        // 迎风面尸苔贴片
  const segs: Placement[] = [], joints: Placement[] = [], mosses: Placement[] = [];
  const breath: { p: Placement; baseY: number; ph: number }[] = [];
  // 拱位表（§3.2）：胸段 4（z −68~−87.5，避开断剑 −64 入岩锥）+ 肋段 8（−94~−146.5）
  const archZ = [-68, -74.5, -81, -87.5, -94, -101.5, -109, -116.5, -124, -131.5, -139, -146.5];
  for (let a = 0; a < 12; a++) {
    const z = archZ[a] + (rnd(a, 79) - 0.5) * 2;
    const half = 4 + rnd(a, 75) * 3;                            // 半跨 4~7（拱跨 8~14m）
    const low = rnd(a, 106) < 0.45;                             // 净高档：2.2 滑铲 / 4.5 跑过（salt 实测 5/7）
    const C = low ? 2.2 : 4.5;
    const N = 7 + Math.floor(rnd(a, 76) * 3);                   // 7~9 节
    const ph = (rnd(a, 77) - 0.5) * 0.4;                        // 呼吸微抖 ±0.2rad（§3.3）
    const st = rnd(a, 104);
    const state = st < 0.5 ? 0 : st < 0.75 ? 1 : st < 0.92 ? 2 : 3; // 完整/半塌/断桩/悬而未坠（比例 §4.2）
    const dir = rnd(a, 78) < 0.5 ? -1 : 1;                      // 半塌/悬断侧
    const K = Math.floor(N * 0.6);                              // 半塌：保留侧算至 0.6N（含拱顶段）
    const kept = (k: number) => state !== 1 || (dir > 0 ? k <= K : k >= N - 1 - K);
    const put = (k: number, ox = 0, oy = 0) => {
      const u = (Math.PI * k) / (N - 1), q = arcPoint(half, C, u);
      const p: Placement = { x: q.x + ox, y: q.y + oy, z, s: 1, ry: 0, rz: q.rz };
      segs.push(p); breath.push({ p, baseY: p.y, ph });
    };
    const joint = (k: number) => {                              // 节间关节环（k 与 k+1 之间）
      const um = (Math.PI * (k + 0.5)) / (N - 1), q = arcPoint(half, C, um);
      const p: Placement = { x: q.x, y: q.y, z, s: 1, ry: 0, rz: q.rz };
      joints.push(p); breath.push({ p, baseY: p.y, ph });
    };
    const moss = (k: number) => {                               // 迎风面（+z 朝玩家来向）
      const u = (Math.PI * k) / (N - 1), q = arcPoint(half, C, u);
      mosses.push({ x: q.x, y: q.y, z: z + 0.82, s: 1, ry: 0, rz: q.rz });
    };
    if (state === 2) {                                          // 断桩：只剩两节根部 + 断口暗盖
      put(0); put(N - 1);
      joints.push({ x: half, y: 1.95, z, s: 1, ry: 0, rz: 0 });
      joints.push({ x: -half, y: 1.95, z, s: 1, ry: 0, rz: 0 });
      continue;
    }
    const kb = N - 3;                                           // 悬而未坠：上段自 kb 起错位架着
    for (let k = 0; k < N; k++) {
      if (!kept(k)) continue;
      if (state === 3 && k >= kb) put(k, dir * 0.4, 0.12);      // 断口错位 0.4m（§4.2）
      else put(k);
    }
    for (let k = 0; k < N - 2; k++) {
      if (state === 3 && k === kb - 1) continue;                // 断口处无关节环（悬而未坠读法）
      if (!kept(k) || !kept(k + 1)) continue;
      joint(k);
    }
    if (kept(1)) moss(1);
    if (kept(N - 2)) moss(N - 2);
    if (state === 1) {                                          // 半塌：断落 3 节斜插地，读作坡（§4.2）
      const ub = (Math.PI * (dir > 0 ? K : N - 1 - K)) / (N - 1), q0 = arcPoint(half, C, ub);
      for (let j = 0; j < 3; j++) {
        segs.push({                                             // 离体死件：不参与呼吸（离体即死）
          x: q0.x + dir * (2.0 + j * 2.3), y: Math.max(0.8, q0.y - 1.4 - j * 1.7),
          z: z + (j - 1) * 0.5, s: 1, ry: 0, rx: 0.25 * j, rz: dir * (0.95 + j * 0.5),
        });
      }
    }
  }
  insts.push(addInst(scene, segGeo, std(BONE), segs));
  insts.push(addInst(scene, jointGeo, std(BONE_DARK), joints));
  insts.push(addInst(scene, mossGeo, std(MOSS), mosses));

  return {
    update(move: number, t: number) {
      for (const inst of insts) {
        for (const p of inst.items) {
          p.z += move;
          if (p.z > WRAP_Z) p.z -= LOOP;
        }
      }
      // 呼吸 ±0.35m（§4.2）：sin 按 4 帧轮写分桶（§4.0 纪律 5，20Hz 采样，确定性帧序取桶）
      const bucket = Math.floor(t * 20) % 4;
      for (let i = 0; i < breath.length; i++) {
        if (i % 4 !== bucket) continue;
        const br = breath[i];
        br.p.y = br.baseY + Math.sin(t * 0.6283 + br.ph) * 0.35;
      }
      for (const inst of insts) writeAll(inst);
    },
  };
}
