/**
 * 侧景程序化道具（render 层，零贴图零宿主 API）：用 InstancedMesh 在跑道两侧摆真 3D 低模，
 * 沿 Z 按世界速度循环回收（与金币同源：runnerScene 传进来的是插值距离增量）。
 * 侧景完全由几何体承担（贴图带方案已删），因此分三排填深度：
 *   near  近景小件（栅栏/信箱/花盆/路灯/礁石/草丛）
 *   mid   中景房屋与椰树
 *   far   远景房屋与椰树（更小更稀，补住地平线）
 * 排布规则：每种道具独占一条横向车道并错开相位，彼此不重叠；栅栏朝向固定 0 以与道路平行。
 * 全部单几何体实例化，draw call 恒定（约 20 个），微信低端机友好。
 * 道具集按主题的 `scenery` 字段选（见 SCENERY_SETS）："blank" 这类未登记的 id 两侧什么都不摆。
 */
import * as THREE from 'three';
import { createCoastProps } from './coast/coastProps.js';
import { createKonbiniProps } from './konbini/konbiniProps.js';

/** 回收周期（米），与跑道长度同量级；出画即绕回远处 */
const LOOP = 240;
const WRAP_Z = 12;

/** rx / rz 供棕榈叶这类需要「先倾后旋」的部件使用（欧拉序 YXZ：先绕自身 x 下垂，再绕世界 y 展开） */
interface Placement { x: number; z: number; y: number; ry: number; s: number; rx?: number; rz?: number }
interface Inst { mesh: THREE.InstancedMesh; items: Placement[] }

/** 确定性伪随机：同一下标永远同结果，避免每帧抖动与回放不一致 */
const rnd = (i: number, salt: number) => {
  const s = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return s - Math.floor(s);
};

const std = (color: number) => new THREE.MeshLambertMaterial({ color });

const M4 = new THREE.Matrix4();
const Q = new THREE.Quaternion();
const E = new THREE.Euler(0, 0, 0, 'YXZ');
const V = new THREE.Vector3();
const S = new THREE.Vector3();
function writeAll(inst: Inst) {
  for (let i = 0; i < inst.items.length; i++) {
    const p = inst.items[i];
    E.set(p.rx ?? 0, p.ry, p.rz ?? 0); Q.setFromEuler(E);
    V.set(p.x, p.y, p.z); S.set(p.s, p.s, p.s);
    M4.compose(V, Q, S);
    inst.mesh.setMatrixAt(i, M4);
  }
  inst.mesh.instanceMatrix.needsUpdate = true;
}

interface RowOpts { jx?: number; jz?: number; phase?: number; ry?: number; align?: boolean }
/** 沿 Z 等间隔布点；align=true 时朝向锁 0（栅栏这类要与道路平行），jz=0 时完全等距 */
function row(side: -1 | 1, base: number, every: number, salt: number, y: number, o: RowOpts = {}): Placement[] {
  const jx = o.jx ?? 0.5, jz = o.jz ?? 0.3, phase = o.phase ?? 0;
  const out: Placement[] = [];
  for (let z = -LOOP + 10 + phase, i = 0; z < WRAP_Z; z += every, i++) {
    out.push({
      x: side * (base + (rnd(i, salt) - 0.5) * jx),
      z: z + (rnd(i, salt + 7) - 0.5) * every * jz,
      y, s: 0.9 + rnd(i, salt + 11) * 0.25,
      ry: o.align ? 0 : (o.ry ?? 0) + (rnd(i, salt + 3) - 0.5) * (o.ry ?? 0.22),
    });
  }
  return out;
}

function addInst(scene: THREE.Scene, geo: THREE.BufferGeometry, mat: THREE.Material, items: Placement[]): Inst {
  const mesh = new THREE.InstancedMesh(geo, mat, items.length);
  scene.add(mesh);
  const inst = { mesh, items };
  writeAll(inst);
  return inst;
}

/** 给一组实例上多色（墙面/屋顶的粉彩变化） */
function tint(inst: Inst, colors: number[]) {
  for (let i = 0; i < inst.items.length; i++) inst.mesh.setColorAt(i, new THREE.Color(colors[i % colors.length]));
  if (inst.mesh.instanceColor) inst.mesh.instanceColor.needsUpdate = true;
}

/** 落地假投影：真 shadowMap 在微信低端机太贵，用半透明圆面代替 */
function addShadow(scene: THREE.Scene, insts: Inst[], items: Placement[], radius: number) {
  const geo = new THREE.CircleGeometry(radius, 12);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({ color: 0x6b5a3f, transparent: true, opacity: 0.2, depthWrite: false });
  insts.push(addInst(scene, geo, mat, items.map(p => ({ ...p, y: 0.03, rx: 0, rz: 0 }))));
}

const WALL_COLORS = [0xf6ead4, 0xd7ecdf, 0xfadcd6, 0xdce8f6, 0xf5dcb8, 0xe8ddf3];
const ROOF_COLORS = [0xc9714f, 0xb4573a, 0xd98a5f, 0xa84e3a];

/** 把房屋局部坐标按该栋朝向与缩放换到世界坐标（门窗要贴在临路立面上） */
function houseOff(p: Placement, lx: number, ly: number, lz: number): Placement {
  const c = Math.cos(p.ry), s = Math.sin(p.ry);
  return { ...p, x: p.x + (lx * c + lz * s) * p.s, y: ly * p.s, z: p.z + (-lx * s + lz * c) * p.s, rx: 0, rz: 0 };
}

/** 一排房屋：三种户型循环（宽矮 / 窄高 / 扁平小屋），带基座、四坡顶、烟囱、门与两扇亮窗 */
function addHouseRow(scene: THREE.Scene, insts: Inst[], side: -1 | 1, base: number, every: number, salt: number, scaleMul: number) {
  const KINDS = [
    { wx: 3.2, h: 2.6, wz: 3.4, roof: 2.95, rh: 1.7 },
    { wx: 2.4, h: 3.6, wz: 2.8, roof: 2.35, rh: 2.3 },
    { wx: 3.8, h: 2.2, wz: 2.6, roof: 3.05, rh: 1.35 },
  ];
  const at = row(side, base, every, salt, 0, { jx: 1.3, jz: 0.22 });
  at.forEach((p, i) => { p.s = (0.85 + rnd(i, salt + 13) * 0.4) * scaleMul; });
  for (let k = 0; k < KINDS.length; k++) {
    const K = KINDS[k];
    const sel = at.filter((_, i) => i % KINDS.length === k);
    if (!sel.length) continue;
    const body = addInst(scene, new THREE.BoxGeometry(K.wx, K.h, K.wz), std(0xffffff), sel.map(p => ({ ...p, y: (K.h / 2 + 0.16) * p.s })));
    tint(body, WALL_COLORS);
    insts.push(body);
    insts.push(addInst(scene, new THREE.BoxGeometry(K.wx + 0.24, 0.16, K.wz + 0.24), std(0x9a8f7d), sel.map(p => ({ ...p, y: 0.08 * p.s }))));
    const roofGeo = new THREE.ConeGeometry(K.roof, K.rh, 4);
    roofGeo.rotateY(Math.PI / 4);
    const roof = addInst(scene, roofGeo, std(0xffffff), sel.map(p => ({ ...p, y: (K.h + 0.16 + K.rh / 2) * p.s })));
    tint(roof, ROOF_COLORS);
    insts.push(roof);
    insts.push(addInst(scene, new THREE.BoxGeometry(0.34, 1.0, 0.34), std(0xb8a08a), sel.map(p => houseOff(p, K.wx * 0.25, K.h + K.rh * 0.6, K.wz * 0.2))));
    insts.push(addInst(scene, new THREE.BoxGeometry(0.12, 1.4, 0.8), std(0x6f4a2f), sel.map(p => houseOff(p, -K.wx / 2 - 0.05, 0.86, 0))));
    insts.push(addInst(scene, new THREE.BoxGeometry(0.12, 0.72, 0.72), std(0xffe9a8), sel.map(p => houseOff(p, -K.wx / 2 - 0.05, K.h * 0.68 + 0.16, K.wz * 0.27))));
    insts.push(addInst(scene, new THREE.BoxGeometry(0.12, 0.72, 0.72), std(0xffe9a8), sel.map(p => houseOff(p, -K.wx / 2 - 0.05, K.h * 0.68 + 0.16, -K.wz * 0.27))));
    addShadow(scene, insts, sel, K.wx * 0.85);
  }
}

/** 一排棕榈：弯干 + 真叶片（每棵 7 片，先绕自身 x 下垂再绕 y 放射展开）+ 椰青 */
function addPalmRow(scene: THREE.Scene, insts: Inst[], side: -1 | 1, base: number, every: number, salt: number, scaleMul: number) {
  const at = row(side, base, every, salt, 0, { jx: 1.6, jz: 0.2 });
  at.forEach((p, i) => { p.s = (1.25 + rnd(i, salt + 17) * 0.75) * scaleMul; p.rz = (rnd(i, salt + 19) - 0.5) * 0.16; });
  const trunkH = 3.6;
  insts.push(addInst(scene, new THREE.CylinderGeometry(0.1, 0.19, trunkH, 6), std(0x8f6b45),
    at.map(p => ({ ...p, y: (trunkH / 2) * p.s }))));
  // 叶片：几何体平移到根部，实例旋转 = 世界 y 放射 * 自身 x 下垂
  const frond = new THREE.ConeGeometry(0.36, 2.5, 4);
  frond.translate(0, 1.25, 0);
  frond.scale(1, 1, 0.3);
  const leaves: Placement[] = [];
  for (const p of at) for (let k = 0; k < 7; k++) {
    leaves.push({ ...p, y: (trunkH - 0.1) * p.s, ry: (k / 7) * Math.PI * 2 + p.ry, rx: 1.15 + rnd(k, p.z | 0) * 0.25, rz: 0 });
  }
  insts.push(addInst(scene, frond, std(0x35924c), leaves));
  insts.push(addInst(scene, new THREE.SphereGeometry(0.26, 8, 6), std(0x7a5a3a),
    at.map(p => ({ ...p, y: (trunkH - 0.45) * p.s, rx: 0, rz: 0 }))));
  addShadow(scene, insts, at, 1.3);
}

export interface SceneryProps { update(move: number, t: number): void }

/** 老「晴湾小镇」那套侧景（近景小件 + 中远景房屋/棕榈）：没有主题引用了，仍当 createTrackVisuals 的缺省集，emptyScene 与测试依赖它 */
function createSeasideProps(scene: THREE.Scene): SceneryProps {
  const insts: Inst[] = [];
  insts.push(addInst(scene, new THREE.DodecahedronGeometry(0.42, 0), std(0x9aa3ad), row(-1, 5.1, 41, 2, 0.2, { jx: 0.6, phase: 9 })));
  insts.push(addInst(scene, new THREE.ConeGeometry(0.2, 0.6, 5), std(0xb9c46a), row(-1, 4.4, 9, 3, 0.28, { jx: 0.6, phase: 4 })));
  const posts = row(1, 5.6, 1.7, 4, 0.36, { jx: 0, jz: 0, align: true });
  insts.push(addInst(scene, new THREE.BoxGeometry(0.07, 0.72, 0.07), std(0xf4f1e8), posts));
  const railAt = posts.map(p => ({ ...p, z: p.z + 0.85 }));
  insts.push(addInst(scene, new THREE.BoxGeometry(0.05, 0.07, 1.7), std(0xf4f1e8), railAt.map(p => ({ ...p, y: 0.5 }))));
  insts.push(addInst(scene, new THREE.BoxGeometry(0.05, 0.07, 1.7), std(0xf4f1e8), railAt.map(p => ({ ...p, y: 0.26 }))));
  const boxAt = row(1, 4.9, 26, 5, 0.95, { jx: 0.2, jz: 0, phase: 5, align: true });
  insts.push(addInst(scene, new THREE.BoxGeometry(0.32, 0.26, 0.46), std(0xd9534f), boxAt));
  insts.push(addInst(scene, new THREE.CylinderGeometry(0.05, 0.06, 0.95, 6), std(0x7a5a3a), boxAt.map(p => ({ ...p, y: 0.47 }))));
  const potAt = row(1, 4.3, 13, 6, 0.13, { jx: 0.3, jz: 0, phase: 2.5 });
  insts.push(addInst(scene, new THREE.CylinderGeometry(0.17, 0.13, 0.26, 8), std(0xc96f4a), potAt));
  insts.push(addInst(scene, new THREE.ConeGeometry(0.16, 0.3, 6), std(0xe88aa8), potAt.map(p => ({ ...p, y: 0.38 }))));
  const lampAt = row(1, 6.3, 34, 7, 1.3, { jx: 0, jz: 0, phase: 17, align: true });
  insts.push(addInst(scene, new THREE.CylinderGeometry(0.05, 0.07, 2.6, 6), std(0x3a3f46), lampAt));
  insts.push(addInst(scene, new THREE.SphereGeometry(0.16, 8, 6), std(0xfff6d8), lampAt.map(p => ({ ...p, y: 2.66 }))));

  // ---- 中景与远景：房屋 + 棕榈，两排拉开纵深（贴图带已删，地平线由 far 排补住） ----
  addHouseRow(scene, insts, 1, 9.8, 14, 21, 1);
  addPalmRow(scene, insts, -1, 9.4, 17, 22, 1);
  addHouseRow(scene, insts, 1, 17.5, 19, 31, 0.8);
  addPalmRow(scene, insts, -1, 16.5, 21, 32, 0.8);
  addHouseRow(scene, insts, -1, 13.5, 23, 41, 0.9);

  return {
    update(move: number) {
      if (move === 0) return;
      // 每帧都重写矩阵：道具必须和金币一样逐帧平滑后退，
      // 只在绕回时重写会让它们平时冻住、绕回瞬间跳一下（旧实现的 bug）
      for (const inst of insts) {
        for (const p of inst.items) {
          p.z += move;
          if (p.z > WRAP_Z) p.z -= LOOP;
        }
        writeAll(inst);
      }
    },
  };
}

/**
 * 主题 config 的 `scenery` 字段 → 侧景道具集。
 * 表里没有的 id（如占位场景的 "blank"）就是两侧什么都不摆。
 */
const SCENERY_SETS: Record<string, (scene: THREE.Scene) => SceneryProps> = {
  seaside: createSeasideProps,
  konbini: createKonbiniProps,
  coast: createCoastProps,
};

export function createSceneryProps(scene: THREE.Scene, scenery: string = 'seaside'): SceneryProps {
  return SCENERY_SETS[scenery]?.(scene) ?? { update: () => undefined };
}
