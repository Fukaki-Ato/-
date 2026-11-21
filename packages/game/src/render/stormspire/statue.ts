/**
 * 天穹雷脊 · 缚雷祭司坐像 ×2 + 落头 ×2（docs/stormspire-brief.md §1.1/§4.5）：
 *   seated  坐像（x=∓16，面朝路心，坐高 ~26m）：腿座阶梯堆 + 收分八角躯干（车削 8 段，
 *           颈桩一体车出，断口顶两块歪斜小石块 + 封顶盘）+ 右臂上举握残杖（杖残存 40%、微倾）
 *           + 左手抚膝短粗斜柱 + 衣袍斜切厚板（被风掀向世界 +x，同 §1.2 废墟倾倒向）
 *           + 表面铜绿氧化斑 ×4 + 颈部一道金灼痕（发光）；
 *   fallen  落头（贴路侧 x=∓9，y 从 0 起算）：两级石阶低台（复用腿座几何缩小 0.5）
 *           + 压扁圆雕头颅（顶面读作高台）+ 头顶金信标八面体（MeshBasicMaterial 发光）。
 * 两像共用几何、每件一个 InstancedMesh（10 draw call / 28 实例）；
 * 全静态件走 240m LOOP 回收 + writeAll（与 islands 同一套循环），确定性摆位；不读 sim。
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { LOOP, WRAP_Z, addInst, std, writeAll, type Inst, type Placement } from '../sceneryProps.js';
import { P } from './palette.js';

const gold = () => new THREE.MeshBasicMaterial({ color: P.gold });

/** 坐像锚点：ry 让像面朝路心（左像 +π/2 → 前方 +x；右像 -π/2 → 前方 -x） */
const STATUES = [
  { x: -16, z: -88, ry: Math.PI / 2 },
  { x: 16, z: -198, ry: -Math.PI / 2 },
] as const;

/** 局部摆位（像前=+z、像右=+x）按朝向 ry 搬到世界；writeAll 的 YXZ 欧拉让 rx/rz 先在像本地系里倾斜 */
function loc(st: { x: number; z: number; ry: number }, lx: number, ly: number, lz: number, s = 1): Placement {
  const c = Math.cos(st.ry), si = Math.sin(st.ry);
  return { x: st.x + (lx * c + lz * si) * s, y: ly * s, z: st.z + (-lx * si + lz * c) * s, s, ry: st.ry };
}

export function createStatue(scene: THREE.Scene) {
  const insts: Inst[] = [];

  // ---- 腿座阶梯堆：两大石盒合一几何（下半身没入岛体岩的读法）；落头低台复用同款 ×0.5 ----
  const step1 = new THREE.BoxGeometry(10, 3, 8); step1.translate(0, 1.5, 0);
  const step2 = new THREE.BoxGeometry(7.8, 2.6, 6.2); step2.translate(0, 4.3, 0);
  const stepsGeo = mergeGeometries([step1, step2]);
  const steps: Placement[] = [], heads: Placement[] = [], beacons: Placement[] = [];
  STATUES.forEach((st, i) => {
    steps.push(loc(st, 0, 0, 0));
    // 落头：贴路侧两级石阶低台 + 压扁头颅 + 金信标（台顶 2.4m，颅顶 ~6.6m）
    const hx = st.x > 0 ? 9 : -9, hz = i === 0 ? st.z + 4 : st.z;
    steps.push({ x: hx, y: 0, z: hz, s: 0.5, ry: st.ry });
    heads.push({ x: hx, y: 4.3, z: hz, s: 1, ry: st.ry });
    beacons.push({ x: hx, y: 7.0, z: hz, s: 1, ry: 0 });
  });
  insts.push(addInst(scene, stepsGeo, std(P.stone), steps));

  // ---- 躯干：收分八角柱车削（髋 2.9 → 胸 2.25 → 肩部出檐 → 颈桩 → 断口），
  //      断口参差 = 顶缘封盘 + 两块歪斜小石块，一并烘进同一几何（省 draw call）----
  const lathe = new THREE.LatheGeometry([
    new THREE.Vector2(2.9, 0), new THREE.Vector2(2.5, 6.5), new THREE.Vector2(2.25, 11),
    new THREE.Vector2(2.5, 13.6), new THREE.Vector2(2.35, 13.9),
    new THREE.Vector2(1.2, 14.2), new THREE.Vector2(1.05, 18), new THREE.Vector2(0.9, 19.6),
  ], 8);
  const cap = new THREE.CylinderGeometry(0.88, 0.9, 0.12, 8); cap.translate(0, 19.55, 0);
  const stubA = new THREE.BoxGeometry(0.95, 0.6, 0.95); stubA.rotateZ(0.28); stubA.translate(0.35, 19.85, 0.15);
  const stubB = new THREE.BoxGeometry(0.95, 0.6, 0.95); stubB.rotateZ(-0.24); stubB.translate(-0.45, 19.65, -0.2);
  const torsoGeo = mergeGeometries([lathe, cap, stubA, stubB]);
  insts.push(addInst(scene, torsoGeo, std(P.stone), STATUES.map(st => loc(st, 0, 5.6, 0))));

  // ---- 右臂（像右 = 局部 +x）上举：斜柱肩头出手，rz 让上端外倾 ----
  const armGeo = new THREE.CylinderGeometry(0.5, 0.62, 6, 7);
  insts.push(addInst(scene, armGeo, std(P.stone), STATUES.map(st =>
    ({ ...loc(st, 3.9, 21.8, 0.15), rx: 0.08, rz: -0.55 }))));
  // 残杖：原 ~12m 引雷杖断存 40%，细长柱微倾（断口收细的锥度）
  const staffGeo = new THREE.CylinderGeometry(0.12, 0.17, 4.8, 6);
  insts.push(addInst(scene, staffGeo, std(P.stoneDark), STATUES.map(st =>
    ({ ...loc(st, 5.6, 26.3, 0.2), rx: 0.05, rz: -0.12 }))));
  // ---- 左手抚膝：短粗斜柱从体侧（肘）搭到膝面 ----
  const larmGeo = new THREE.CylinderGeometry(0.55, 0.68, 6, 7);
  insts.push(addInst(scene, larmGeo, std(P.stone), STATUES.map(st =>
    ({ ...loc(st, 2.75, 10.9, 2.85), rx: -0.22, rz: 0.05 }))));

  // ---- 衣袍：四棱收分厚板贴躯干侧，上端被风掀开——
  //      统一取世界 +x 侧（左像在前襟、右像在后摆，风向一致），rx 符号按像翻转 ----
  const robeGeo = new THREE.CylinderGeometry(1.9, 3.4, 9.5, 4);
  robeGeo.rotateY(Math.PI / 4);
  insts.push(addInst(scene, robeGeo, std(P.stone), STATUES.map((st, i) => ({
    x: st.x + 3.2, y: 9.9, z: st.z, s: 1, ry: st.ry, rx: i === 0 ? 0.3 : -0.3,
  }))));

  // ---- 表面铜绿氧化斑 ×4：薄盒贴前胸/腹部八棱面（微偏转贴面、深浅不一） ----
  const verdGeo = new THREE.BoxGeometry(1.5, 2.3, 0.14);
  const verds: Placement[] = [];
  for (const st of STATUES) {
    verds.push({ ...loc(st, 0.4, 16.5, 2.2), ry: st.ry + 0.06 });
    verds.push({ ...loc(st, -1.0, 12.5, 2.45), ry: st.ry - 0.1, s: 0.85 });
    verds.push({ ...loc(st, 1.15, 8.6, 2.75), ry: st.ry + 0.12, s: 1.15 });
    verds.push({ ...loc(st, -0.35, 19.4, 1.7), ry: st.ry - 0.04, s: 0.8 });
  }
  insts.push(addInst(scene, verdGeo, std(P.verdigris), verds));

  // ---- 颈部一道金灼痕：细金条贴颈前（发光，闪电路径灼过的印子） ----
  const scorchGeo = new THREE.BoxGeometry(0.16, 1.9, 0.13);
  insts.push(addInst(scene, scorchGeo, gold(), STATUES.map(st =>
    ({ ...loc(st, 0.18, 21.4, 1.02), ry: st.ry + 0.1 }))));

  // ---- 落头：压扁圆雕头颅（几何级压扁，顶面读作高台）+ 头顶金信标八面体（发光） ----
  const headGeo = new THREE.SphereGeometry(3, 12, 9);
  headGeo.scale(1, 0.78, 0.94);
  insts.push(addInst(scene, headGeo, std(P.stone), heads));
  insts.push(addInst(scene, new THREE.OctahedronGeometry(0.55, 0), gold(), beacons));

  return {
    update(move: number, t: number) {
      void t; // 全静态：t 预留（接口与 landmarks 一致）
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
