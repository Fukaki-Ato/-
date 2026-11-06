/**
 * 黄昏渔港铁道 · 侧景道具集（scenery = "harbor"，M 场景批次）。
 * 设计提示词合成（网搜参考：itch.io「Industrial Parallax Background」分层法 + 霓虹夜城 5-7 层视差配方 →
 * 橙青调渔港改造）：五层纵深 ——
 *   far   远景城市剪影 + 门式起重机剪影（补住地平线，深青单色）
 *   mid   长仓库（圆弧顶）+ 集装箱堆（2-3 层错缝，锈红/青绿/橙撞色）+ 桅杆
 *   near  系船柱、栈桥灯柱（暖光灯头）、油桶、渔网架、护栏立柱
 * 全部 InstancedMesh（约 20 个 draw call，微信低端机友好）；摆位确定性 rnd(i, salt)，与回放无关。
 * 循环周期 LOOP=240m，出画即绕回远处（雾里看不见接缝）。
 */
import * as THREE from 'three';
import type { SceneryProps } from '../sceneryProps.js';
import {
  LOOP, WRAP_Z, addInst, addShadow, row, rnd, std, tint, writeAll,
  type Inst, type Placement,
} from '../sceneryProps.js';

/** 黄昏橙青调（主题 sky/fog 在 config；这里只管侧景固有色） */
const SILHOUETTE = [0x2e4a5a, 0x27394a, 0x33505e];
const WAREHOUSE_WALL = 0xd9c3a0;
const WAREHOUSE_ROOF = 0x8a5a44;
const CONTAINER = [0xc96a3b, 0x3b8c8c, 0xb5533c, 0x4a6fa5, 0xc9a227, 0x7a4e8c];
const BOLLARD = 0x4a3f35;
const LAMP_POLE = 0x3a3f46;
const LAMP_HEAD = 0xffd9a0;
const MAST = 0x6b5a45;

interface Builder {
  scene: THREE.Scene;
  insts: Inst[];
}

/** 门式起重机剪影：两腿 + 横梁 + 悬臂斜杆（三段实例，深青剪影色） */
function addGantryCrane(b: Builder, at: Placement[]) {
  const { scene, insts } = b;
  const legH = 9;
  insts.push(addInst(scene, new THREE.BoxGeometry(0.5, legH, 0.5), std(0x3a4e5c),
    at.map(p => ({ ...p, x: p.x - 1.6, y: (legH / 2) * p.s }))));
  insts.push(addInst(scene, new THREE.BoxGeometry(0.5, legH, 0.5), std(0x3a4e5c),
    at.map(p => ({ ...p, x: p.x + 1.6, y: (legH / 2) * p.s }))));
  insts.push(addInst(scene, new THREE.BoxGeometry(5.4, 0.5, 0.5), std(0x3a4e5c),
    at.map(p => ({ ...p, y: legH * p.s }))));
  // 悬臂朝跑道外海侧斜挑
  const jib = new THREE.BoxGeometry(4.2, 0.4, 0.4);
  jib.rotateZ(0.42);
  jib.translate(2.0, 1.1, 0);
  insts.push(addInst(scene, jib, std(0x3a4e5c), at.map(p => ({ ...p, y: legH * p.s, rz: 0 }))));
}

/** 长仓库：墙体 + 圆弧顶 + 大门色块 + 高窗亮条 */
function addWarehouse(b: Builder, at: Placement[]) {
  const { scene, insts } = b;
  const w = 6.5, h = 3.2, d = 4.2;
  insts.push(addInst(scene, new THREE.BoxGeometry(w, h, d), std(WAREHOUSE_WALL),
    at.map(p => ({ ...p, y: (h / 2 + 0.14) * p.s }))));
  const roof = new THREE.CylinderGeometry(d / 2, d / 2, w, 12, 1, false, 0, Math.PI);
  roof.rotateZ(Math.PI / 2);
  insts.push(addInst(scene, roof, std(WAREHOUSE_ROOF), at.map(p => ({ ...p, y: h * p.s }))));
  // 大门（朝跑道）与高窗：贴在临路立面
  insts.push(addInst(scene, new THREE.BoxGeometry(1.7, 2.1, 0.1), std(0x6b5a45),
    at.map(p => ({ ...p, x: p.x + (p.x < 0 ? w / 2 - 0.06 : -(w / 2 - 0.06)) * p.s, y: 1.2 * p.s, ry: 0, rz: 0 }))));
  insts.push(addInst(scene, new THREE.BoxGeometry(0.1, 0.5, 2.6), std(0xffd9a0),
    at.map(p => ({ ...p, x: p.x + (p.x < 0 ? -(w / 2 - 0.06) : w / 2 - 0.06) * p.s, y: 2.5 * p.s, ry: 0, rz: 0 }))));
  addShadow(b.scene, b.insts, at, w * 0.62);
}

/** 集装箱堆：2-3 层错缝，撞色着色 */
function addContainerStack(b: Builder, at: Placement[]) {
  const { scene, insts } = b;
  const box = new THREE.BoxGeometry(2.6, 0.85, 1.15);
  const layers: Placement[] = [];
  for (const p of at) {
    const rows = 2 + Math.floor(rnd(p.z | 0, 91) * 2); // 2~3 层
    for (let k = 0; k < rows; k++) layers.push({ ...p, y: (0.44 + k * 0.87) * p.s, x: p.x + (k % 2 ? 0.12 : -0.08) * p.s });
  }
  const inst = addInst(scene, box, std(0xffffff), layers);
  tint(inst, CONTAINER);
  insts.push(inst);
  addShadow(b.scene, b.insts, at, 1.7);
}

/** 系船柱：短粗圆柱 + 顶帽，缆绳桩排 */
function addBollards(b: Builder, side: -1 | 1) {
  const { scene, insts } = b;
  const at = row(side, 3.9, 11, side === -1 ? 61 : 62, 0.34, { jx: 0.25, jz: 0, phase: 6 });
  insts.push(addInst(scene, new THREE.CylinderGeometry(0.16, 0.2, 0.5, 8), std(BOLLARD), at));
  insts.push(addInst(scene, new THREE.CylinderGeometry(0.22, 0.16, 0.1, 8), std(BOLLARD), at.map(p => ({ ...p, y: 0.5 }))));
}

/** 栈桥灯柱：细杆 + 暖光灯头（黄昏里自然亮着） */
function addHarborLamps(b: Builder, side: -1 | 1) {
  const { scene, insts } = b;
  const at = row(side, 4.9, 34, side === -1 ? 71 : 72, 1.5, { jx: 0, jz: 0, phase: 15, align: true });
  insts.push(addInst(scene, new THREE.CylinderGeometry(0.05, 0.07, 2.9, 6), std(LAMP_POLE), at));
  insts.push(addInst(scene, new THREE.SphereGeometry(0.17, 8, 6), std(LAMP_HEAD), at.map(p => ({ ...p, y: 2.98 }))));
}

/** 油桶 + 渔网架：近景小件 */
function addBarrelsAndNets(b: Builder, side: -1 | 1) {
  const { scene, insts } = b;
  const barrelAt = row(side, 4.4, 19, side === -1 ? 81 : 82, 0.4, { jx: 0.4, phase: 3 });
  insts.push(addInst(scene, new THREE.CylinderGeometry(0.24, 0.24, 0.62, 10), std(0x9c4a3c), barrelAt));
  insts.push(addInst(scene, new THREE.CylinderGeometry(0.25, 0.25, 0.06, 10), std(0x7a3a30),
    barrelAt.map(p => ({ ...p, y: 0.34 }))));
  // 网架：两根斜柱 + 一根横杆（挂网示意）
  const netAt = row(side, 5.4, 27, side === -1 ? 83 : 84, 0, { jx: 0.3, phase: 12 });
  insts.push(addInst(scene, new THREE.BoxGeometry(0.06, 1.5, 0.06), std(MAST),
    netAt.map(p => ({ ...p, y: 0.75, rz: 0.18 }))));
  insts.push(addInst(scene, new THREE.BoxGeometry(0.06, 1.5, 0.06), std(MAST),
    netAt.map(p => ({ ...p, x: p.x + 0.9, y: 0.75, rz: -0.18 }))));
  insts.push(addInst(scene, new THREE.BoxGeometry(1.0, 0.05, 0.05), std(MAST),
    netAt.map(p => ({ ...p, x: p.x + 0.45, y: 1.42 }))));
}

/** 远景剪影带：城市块 + 门吊（单侧一排即可，两侧都摆会盖住雾色地平线） */
function addFarSilhouette(b: Builder, side: -1 | 1) {
  const { scene, insts } = b;
  const at = row(side, 27, 16, side === -1 ? 91 : 92, 0, { jx: 3.5, jz: 0.4 });
  const block = addInst(scene, new THREE.BoxGeometry(3.6, 6.5, 2.2), std(0xffffff), at.map(p => ({ ...p, y: 3.2 * p.s })));
  tint(block, SILHOUETTE);
  insts.push(block);
  const craneAt = at.filter((_, i) => i % 3 === 1);
  if (craneAt.length) addGantryCrane(b, craneAt.map(p => ({ ...p, x: p.x + 4, s: p.s * 1.15 })));
}

/** 渔船桅杆（只在海侧 |x| 14-20）：细桅 + 斜帆桁 */
function addMasts(b: Builder, side: -1 | 1) {
  const { scene, insts } = b;
  const at = row(side, 16, 23, side === -1 ? 93 : 94, 0.2, { jx: 2.2, phase: 8 });
  insts.push(addInst(scene, new THREE.CylinderGeometry(0.05, 0.08, 5.2, 6), std(MAST), at.map(p => ({ ...p, y: 2.6 * p.s }))));
  insts.push(addInst(scene, new THREE.BoxGeometry(0.04, 0.04, 1.6), std(MAST),
    at.map(p => ({ ...p, y: 3.6 * p.s, rx: 0.35 }))));
}

export function createHarborProps(scene: THREE.Scene): SceneryProps {
  const b: Builder = { scene, insts: [] };
  // 五层纵深：远剪影（外海侧）→ 桅杆 → 仓库/集装箱（两侧交替）→ 灯柱 → 近景小件
  addFarSilhouette(b, -1);
  addFarSilhouette(b, 1);
  addMasts(b, -1);
  addWarehouse(b, row(-1, 13.5, 47, 101, 0, { jx: 1.5, jz: 0.15 }).map(p => ({ ...p, s: 1.1 })));
  addWarehouse(b, row(1, 15.5, 53, 102, 0, { jx: 1.5, jz: 0.15 }).map(p => ({ ...p, s: 1.05 })));
  addContainerStack(b, row(-1, 11.2, 17, 103, 0, { jx: 0.8, jz: 0.2 }));
  addContainerStack(b, row(1, 12.4, 21, 104, 0, { jx: 0.8, jz: 0.2 }));
  addHarborLamps(b, -1);
  addHarborLamps(b, 1);
  addBollards(b, -1);
  addBollards(b, 1);
  addBarrelsAndNets(b, 1);
  return {
    update(move: number) {
      if (move === 0) return;
      for (const inst of b.insts) {
        for (const p of inst.items) {
          p.z += move;
          if (p.z > WRAP_Z) p.z -= LOOP;
        }
        writeAll(inst);
      }
    },
  };
}
