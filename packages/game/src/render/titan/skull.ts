/**
 * 沉眠泰坦 · 颅首 ×1 与睁眼闩锁（docs/scenes/titan-brief.md §4.1 + §3.2 颅段窗 196~240）：
 *   颅首：Lathe 车削颅穹（颅长 ~26m / 颅宽 14m）+ 几何级压扁 scale(1, 0.78, 0.94)（statue.ts 口径），
 *         z≈−214 面朝路心倾侧 15°（rz 0.26）、下颌半张没入地里；牙列上颌 ×10 骨锥 + 骨象牙
 *         眼眶缘 + 眼窝 ×2（口径 3.1m / 深 2.6m）+ 颅顶破洞（神战创口，缘参差）+ 尸苔斑；
 *         左眼窝 Empty（瞳孔早被打落——只剩右眼会睁开，读作「他只剩一半在看」）。
 *   瞳孔闩锁状态机：THRESHOLD_M = 420（文件头常量，= 第二次途经颅段窗 436~480m 之前，§7 幕三）；
 *         moveAccum（总装累加传入）≥ 420 一次性置 awake（不可逆，达标即置、此后恒真）：
 *         瞳孔亡火金亮起（自发光 0→1，1.2s）+ 眼窝点光渐亮（PointLight 0→8，半径 18m）+
 *         涟漪环一圈扩散（0.3→5m 渐大 + 0.35→0 渐隐，atmosphere.ts ripple 口径）；
 *         未达阈值前瞳孔/点光完全不可见（沉睡感铁律）。不接全局闪电（lightning.strike 需要
 *         sim 锚点且由 runnerScene 持有，越界——睁眼表现全部局部化，§4.1）。
 *   awakeBoost：醒态呼吸增幅 0→1（随 1.2s 渐起），总装读它把呼吸 amp 从 1.5 推到 1.8（§3.3/§4.1）。
 *   复合件烘合（§4.0 纪律 2）：颅穹 / 牙列+眶缘+下颌 / 暗窝+破洞 / 苔斑 各烘一份几何各 1 实例。
 *   LOOP 回收 + 确定性 rnd + 每帧零分配；不读 sim（moveAccum 由总装传入做闩锁）。
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { LOOP, WRAP_Z, addInst, rnd, std, writeAll, type Inst, type Placement } from '../sceneryProps.js';

/** 睁眼闩锁阈值（米）：累计跑距 ≥420 一次性睁眼——第二次途经颅段窗 436~480 之前（§4.1/§7 幕三） */
export const THRESHOLD_M = 420;

/** 本地色表逐值对表 titan/palette.ts（§2 + 派生口径；三文件互不 import） */
const BONE = 0xd9d2be;    // 骨象牙
const SKIN = 0x8a8271;    // 苍岩肤
const MOSS = 0x5c7a5e;    // 尸苔绿
const DUSK = 0x151c2c;    // 烬空暮蓝（眼窝/破洞最暗部，零纯黑口径）
const EMBER = 0xffb454;   // 亡火金：唯一发光色

/** 颅首锚点（面端底心）：x 8.5 右侧路缘外、面朝路心（ry −0.35）、倾侧 15°（rz 0.26），颅体延伸到 z≈−225 */
const SKULL = { x: 8.5, y: 5.2, z: -203, ry: -0.35, rz: 0.26 };

export interface TitanSkull {
  /** 每帧推进：move=距离增量，t=时间，moveAccum=总里程累计（闩锁输入，总装累加传入） */
  update(move: number, t: number, moveAccum: number): void;
  /** 醒态呼吸增幅 0→1（睁眼 1.2s 渐起，不可逆）：总装读它联动呼吸 amp（§3.3 要点 4 / §4.1） */
  awakeBoost: number;
  dispose?(): void;
}

export function createSkull(scene: THREE.Scene): TitanSkull {
  const insts: Inst[] = [];
  // ---- 颅穹：Lathe 收分剖面 → 躺平 → 压扁（颅宽 14 / 颅高 ~10.9 / 颅长 ~23.5）→ 面端朝玩家 ----
  const prof = [[4.6, 0], [6.6, 3.2], [7.0, 8], [6.7, 13], [5.6, 18], [3.6, 22], [1.2, 24.2], [0.25, 25]]
    .map(p => new THREE.Vector2(p[0]!, p[1]!));
  const craniumGeo = new THREE.LatheGeometry(prof, 12);
  craniumGeo.rotateX(Math.PI / 2);   // 颅长 +Y → +Z，底切口 = 面端 z0
  craniumGeo.scale(1, 0.78, 0.94);   // 几何级压扁（statue.ts 头颅口径，§4.0 纪律 3）
  craniumGeo.rotateY(Math.PI);       // 颅顶甩向 −z（面端留在 z≈0，面向玩家来向）

  // ---- 骨象牙烘合：上颌托 + 牙列 ×10 + 眶缘 ×2 + 下颌（半张前倾没入地里）+ 破洞缘参差 ×3 ----
  const ivoryParts: THREE.BufferGeometry[] = [];
  const ridge = new THREE.BoxGeometry(7.4, 0.7, 1.0); ridge.translate(0, -4.55, 2.2);
  ivoryParts.push(ridge);
  for (let k = 0; k < 10; k++) {     // 上颌牙列 ×10 骨锥，尖朝下（没入地面读作半张）
    const tx = -3.15 + k * 0.7;
    const g = new THREE.ConeGeometry(0.26, 1.15, 5);
    g.rotateZ(Math.PI);
    g.translate(tx, -4.9, 2.4 - Math.abs(tx) * 0.12);
    ivoryParts.push(g);
  }
  for (const sgn of [-1, 1]) {       // 骨象牙眼眶缘：贴颅穹前端坡面
    const g = new THREE.TorusGeometry(1.75, 0.3, 6, 10, Math.PI);
    g.translate(sgn * 2.9, 3.0, 0.5);
    ivoryParts.push(g);
  }
  const jaw = new THREE.TorusGeometry(3.15, 0.42, 6, 10, Math.PI); // 下颌：半张前倾、前端没入地里
  jaw.rotateX(Math.PI / 2 + 0.55);
  jaw.translate(0, -5.0, 2.0);
  ivoryParts.push(jaw);
  for (let k = 0; k < 3; k++) {      // 颅顶破洞缘参差（神战创口）
    const g = new THREE.BoxGeometry(0.5, 0.9, 0.4);
    g.rotateZ((rnd(k, 181) - 0.5) * 0.9); g.rotateX(-0.3);
    g.translate(0.5 + (rnd(k, 182) - 0.5) * 2.6, 3.5, -19.4 + (rnd(k, 183) - 0.5) * 1.6);
    ivoryParts.push(g);
  }
  const ivoryGeo = mergeGeometries(ivoryParts);

  // ---- 暗部烘合：眼窝 ×2（口径 3.1 / 深 2.6，窝口朝玩家）+ 颅顶破洞盖（左窝同样有窝，只差瞳孔）----
  const darkParts: THREE.BufferGeometry[] = [];
  for (const sgn of [-1, 1]) {
    const g = new THREE.CylinderGeometry(1.55, 1.55, 2.6, 10);
    g.rotateX(Math.PI / 2);
    g.translate(sgn * 2.9, 1.8, 0.6);
    darkParts.push(g);
  }
  const hole = new THREE.CylinderGeometry(1.7, 2.0, 0.16, 9); // 颅顶破洞暗盖
  hole.rotateX(-0.3); hole.translate(0.5, 3.3, -19.6);
  darkParts.push(hole);
  const darkGeo = mergeGeometries(darkParts);

  // ---- 尸苔斑 ×4（~30% 面积读感，贴颅穹坡面）----
  const mossParts: THREE.BufferGeometry[] = [];
  const spots = [[-7.05, 0.4, -7.5, 0, -1.35], [6.95, -1.2, -11, 0, 1.32], [0.8, 5.05, -12.5, -0.3, 0], [-3.7, 3.0, -17.5, -0.5, -0.9]];
  for (const [mx, my, mz, rx, ry] of spots) {
    const g = new THREE.BoxGeometry(2.8, 2.0, 0.16);
    g.rotateZ(rx!); g.rotateY(ry!); g.translate(mx!, my!, mz!);
    mossParts.push(g);
  }
  const mossGeo = mergeGeometries(mossParts);

  // ---- 四份复合几何各 1 实例（同锚点同姿态），颅段呼吸在 update 里统一写 y ----
  const place: Placement = { x: SKULL.x, y: SKULL.y, z: SKULL.z, s: 1, ry: SKULL.ry, rz: SKULL.rz };
  insts.push(addInst(scene, craniumGeo, std(SKIN), [{ ...place }]));
  insts.push(addInst(scene, ivoryGeo, std(BONE), [{ ...place }]));
  insts.push(addInst(scene, darkGeo, std(DUSK), [{ ...place }]));
  insts.push(addInst(scene, mossGeo, std(MOSS), [{ ...place }]));
  const skullBreath = insts.map(inst => ({ p: inst.items[0]!, baseY: SKULL.y }));

  // ---- 瞳孔（右窝）+ 光晕壳 + 眼窝点光 + 涟漪环：闩锁前完全不可见（沉睡铁律）----
  // 右窝 = 颅自身右侧（面朝 +z 时其右 = 世界 −x）；左窝 Empty（瞳孔早被打落，§4.1 损毁态）
  const pupilMat = new THREE.MeshBasicMaterial({ color: EMBER, transparent: true, opacity: 0, depthWrite: false });
  const pupil = new THREE.Mesh(new THREE.OctahedronGeometry(0.9, 0), pupilMat);
  pupil.visible = false; scene.add(pupil);
  const shellMat = new THREE.MeshBasicMaterial({ color: EMBER, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const shell = new THREE.Mesh(new THREE.OctahedronGeometry(1.7, 0), shellMat);
  shell.visible = false; scene.add(shell);
  const eyeLight = new THREE.PointLight(EMBER, 0, 18, 2);     // 半径 18m，强度 0→8（§4.1）
  eyeLight.visible = false; scene.add(eyeLight);
  const ripGeo = new THREE.RingGeometry(0.7, 1.0, 24);
  const ripMat = new THREE.MeshBasicMaterial({ color: EMBER, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const ripple = new THREE.Mesh(ripGeo, ripMat);
  ripple.visible = false; scene.add(ripple);

  // 锚点姿态矩阵 → 瞳孔窝底/窝心、点光、涟漪环的世界偏移（建场算一次，逐帧零分配）
  const placeM = new THREE.Matrix4().compose(
    new THREE.Vector3(SKULL.x, SKULL.y, SKULL.z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0, SKULL.ry, SKULL.rz, 'YXZ')),
    new THREE.Vector3(1, 1, 1));
  const toWorld = (lx: number, ly: number, lz: number) => new THREE.Vector3(lx, ly, lz).applyMatrix4(placeM);
  const pupilLo = toWorld(-2.9, 1.8, -0.2);                  // 闭眼：沉在窝底（暗态不渲染，仅留动线）
  const pupilHi = toWorld(-2.9, 1.8, 1.1);                   // 睁眼：升至窝心（§4.1）
  const lightPos = toWorld(-2.9, 1.8, 2.2);
  const ripPos = toWorld(-2.9, 1.8, 2.4);
  const faceQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, SKULL.ry, SKULL.rz, 'YXZ'));
  ripple.quaternion.setFromUnitVectors(                       // 环面贴脸法向（一次成型）
    new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, 1).applyQuaternion(faceQuat));

  // 闩锁状态机：一次性、不可逆；awake 后 wakeT 固定，k 只随 1.2s 窗口爬升
  let awake = false, wakeT = 0, zCur = SKULL.z;
  const handle: TitanSkull = {
    awakeBoost: 0,
    update(move: number, t: number, moveAccum: number) {
      // 回收 + 颅段矩阵呼吸 ±0.2m（骨穹/牙列/暗窝/苔斑同相位升降，§3.3 一尸一息）
      zCur += move; if (zCur > WRAP_Z) zCur -= LOOP;
      for (const inst of insts) {
        for (const p of inst.items) {
          p.z += move;
          if (p.z > WRAP_Z) p.z -= LOOP;
        }
      }
      const delta = Math.sin(t * 0.6283 + 1.3) * 0.2;
      for (const br of skullBreath) br.p.y = br.baseY + delta;
      for (const inst of insts) writeAll(inst);
      if (!awake && moveAccum >= THRESHOLD_M) { awake = true; wakeT = t; } // 达标即置、不再回退
      const k = awake ? Math.min(1, (t - wakeT) / 1.2) : 0;  // 睁眼渐起 0→1（1.2s，§4.1）
      handle.awakeBoost = k;
      pupil.visible = shell.visible = eyeLight.visible = awake;
      if (!awake) return;                                    // 未醒：瞳孔/点光完全不可见（沉睡感）
      const dz = zCur - SKULL.z;
      const px = pupilLo.x + (pupilHi.x - pupilLo.x) * k;
      const py = pupilLo.y + (pupilHi.y - pupilLo.y) * k + delta;
      const pz = pupilLo.z + (pupilHi.z - pupilLo.z) * k + dz;
      pupil.position.set(px, py, pz); pupil.rotation.y = t * 0.6;
      pupilMat.opacity = k;                                  // 瞳孔亡火金自发光渐起 0→1
      shell.position.set(px, py, pz); shell.rotation.y = t * 0.6;
      shellMat.opacity = 0.22 * k;
      eyeLight.intensity = 8 * k;
      eyeLight.position.set(lightPos.x, lightPos.y + delta, lightPos.z + dz);
      if (k < 1) {                                           // 涟漪环：0.3→5m 渐大 + 0.35→0 渐隐，一次性
        ripple.visible = true;
        ripple.position.set(ripPos.x, ripPos.y + delta, ripPos.z + dz);
        ripple.scale.setScalar(0.3 + 4.7 * k);
        ripMat.opacity = 0.35 * (1 - k);
      } else ripple.visible = false;                         // 醒态常亮：瞳孔 + 点光不可逆常驻
    },
    dispose() {
      scene.remove(pupil); scene.remove(shell); scene.remove(ripple); scene.remove(eyeLight);
      pupil.geometry.dispose(); pupilMat.dispose();
      shell.geometry.dispose(); shellMat.dispose();
      ripGeo.dispose(); ripMat.dispose();
      eyeLight.dispose();
    },
  };
  return handle;
}
