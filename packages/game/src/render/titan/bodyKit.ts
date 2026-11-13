/**
 * 沉眠泰坦 · 躯体地形（docs/scenes/titan-brief.md §3.1/§3.2/§3.4 + §4.5/4.6/4.11，Phase A 步骤 3）：
 *   thorax  胸廓车削体块 ×6：Lathe 八段收分剖面（0.34/0.62 高两道浅肋痕环带），几何级烘焙
 *           1.35 纵横比（实例均匀缩放不破坏比例，statue.ts 车削口径），路缘 |x| 5~30m 从脊沟
 *           向外隆起；胸段（0~−90）4 块最高、肋段（−90~−150）2 块渐低（§3.2 解剖分区）；
 *           苍岩肤主体 + 尸苔盖（压扁半球）+ 锈斑贴片，2 块顶部塌陷露骨暗面内壁（§4.11 损毁）；
 *   spines  椎棘骨锥列 ×40（§4.6）：路缘 |x| 3.2~4.5m 两侧各 20（主带 12 + 颈段 5 + 尾带 3），
 *           基准间距 ~13.2m、颈段（−150~−196）×0.7 加密（§3.2 解剖分区密度优先于全循环节奏，
 *           两侧相位错开读作「交替一枚」）；朝后倾 12°（+z = 尸身尾向），20% 折半只剩斜桩；
 *           底径 0.8~1.4 用细/胖两档锥几何覆盖（车削体例：比例烘在几何上）；根部尸苔骨膜环
 *           逐枚随行（§8「根环第二实例组」）；
 *   plates  半埋甲板 ×18（§4.5）：8~14m 大板斜插 10~20°、一半埋进胸廓坡面/平地（坡面高度由
 *           groundAt 近似求基线），按 §3.2 分区（胸 9 / 肋 5 / 颈 3 / 颅 1），1/3 断成两块错位；
 *           板缘甲缝亡火金导引纹细条随甲板（同转同回收永不错位）+ 路缘 |x|≈4.4 分段导引
 *           长纹（§3.1「你在脊柱沟里跑」读法主体）；
 *   wall    峡谷雾墙（§3.4）：两侧 |x| 26~60 压扁球三排纵深，色由深及浅（远排烬空暮蓝、
 *           近两排雾灰青），×0.55 半速视差 + 300m 回收带（抄 stormspireProps 云墙配方）。
 * 呼吸起伏不做（titanProps 总装统一管，brief §10.1-4 / §3.3）：全部摆位 y 是基线，TitanPart.baseY
 * 恒等于初始 y 保留给总装（呼吸相位改写 y 时以 baseY 为原点；苔盖/根环/导引纹应随母件同 amp：
 * 苔盖随胸廓 ±0.5、导引纹随甲板 ±0.06、根环随椎棘 ±0.05）。
 * 本地色表逐值对表 titan/palette.ts（§2 七色 + 派生；三个 titan 文件互不 import）。
 * 全部 InstancedMesh + 确定性 rnd；每帧零分配；不读 sim。
 */
import * as THREE from 'three';
import {
  LOOP, WRAP_Z, addInst, rnd, std, tint, writeAll,
  type Inst, type Placement, type SceneryProps,
} from '../sceneryProps.js';

/** 本地色表（逐值对表 titan/palette.ts：§2 七色 + 骨暗面/锈亮面派生） */
const C = {
  skin: 0x8a8271, moss: 0x5c7a5e, bone: 0xd9d2be, boneDark: 0x8f9996,
  rust: 0x8a4a32, rustLight: 0x985137, pyre: 0xffb454, mist: 0x46606e, dusk: 0x151c2c,
} as const;

/** 躯体件摆位：y = 呼吸基线（呼吸矩阵改写归 titanProps 总装，本模块不起伏，见文件头） */
interface TitanPart extends Placement { baseY: number }

export function createBodyKit(scene: THREE.Scene): SceneryProps {
  const insts: Inst[] = [];     // LOOP 回收件（每帧全量 writeAll，stormspire 基线口径）
  const wallInsts: Inst[] = []; // 峡谷雾墙（×0.55 半速 + 300m 回收带）

  /** 摆位构造：baseY 恒等于初始 y（呼吸基线，见文件头说明） */
  const part = (x: number, y: number, z: number, s: number, ry = 0, o: Partial<Placement> = {}): TitanPart =>
    ({ x, y, z, s, ry, baseY: y, ...o });

  // ---- 胸廓体块 ×6：八段收分剖面 + 纵横比 1.35 烘在几何上（s=底半径 5~8 ⇒ 底径 10~16、高 6.75~10.8）----
  const prof = [
    [1.0, 0], [0.9, 0.22], [0.86, 0.34], [0.78, 0.52], [0.74, 0.62], [0.5, 0.82], [0.24, 0.95], [0.02, 1.0],
  ].map(([r, h]) => new THREE.Vector2(r, h));
  const thoraxGeo = new THREE.LatheGeometry(prof, 10);
  thoraxGeo.scale(1, 1.35, 1);
  const capGeo = new THREE.SphereGeometry(1, 10, 6);
  capGeo.scale(1.04, 0.5, 1.04); // 苔盖压扁半球（islands 草盖口径）
  const rustGeo = new THREE.BoxGeometry(2.4, 1.8, 0.28);
  // [x, z, 底半径]：正负 x 交替、相邻块错落咬合（微倾 ±0.08）；胸段 4 高、肋段 2 矮
  const MASS: [number, number, number][] = [
    [-12.5, -16, 7.6], [13.5, -38, 8.0], [-11.8, -58, 6.8], [22, -78, 7.4], [-13, -104, 5.6], [15.5, -136, 5.0],
  ];
  const masses: TitanPart[] = [], caps: TitanPart[] = [], inners: TitanPart[] = [], rusts: TitanPart[] = [];
  for (let i = 0; i < MASS.length; i++) {
    const [mx, mz, ms] = MASS[i]!;
    const mH = 1.35 * ms;
    const m = part(mx, 0, mz, ms, 0, { rz: (rnd(i, 11) - 0.5) * 0.16 });
    masses.push(m);
    if (i === 2 || i === 4) {
      // 损毁：顶部塌陷（破口露「肋骨内壁」骨暗面反色），塌坑不长苔
      inners.push(part(mx, mH * 0.62, mz, ms * 0.42, 0, { rz: m.rz }));
    } else {
      caps.push(part(mx, mH * 0.8, mz, ms * 0.55, 0, { rz: m.rz })); // 苔盖扣冠顶
    }
    // 锈斑贴片 ×2/块：薄盒贴坡面微埋（statue 铜绿斑口径），随机方位、深浅交 tint
    for (let k = 0; k < 2; k++) {
      const f = 0.62 + rnd(i * 2 + k, 13) * 0.14, a = rnd(i * 2 + k, 17) * 6.283;
      rusts.push(part(mx + Math.cos(a) * ms * f, mH * (1 - Math.pow(f, 2.2)) * 0.9,
        mz + Math.sin(a) * ms * f, 0.6 + rnd(k, 19) * 0.5, Math.PI / 2 - a, { rx: 0.55, rz: Math.sin(a) * 0.35 }));
    }
  }
  // 胸廓坡面高度（甲板接地用）：剖面近似 h=(1−f^2.2)·mH，f = 平面距/底半径
  const groundAt = (x: number, z: number) => {
    let h = 0;
    for (const m of masses) {
      const f = Math.hypot(x - m.x, z - m.z) / m.s;
      if (f < 0.97) h = Math.max(h, 1.35 * m.s * (1 - Math.pow(f, 2.2)));
    }
    return h;
  };

  // ---- 椎棘骨锥列 ×40（§4.6）----
  const spineA: TitanPart[] = [], spineB: TitanPart[] = [], rings: TitanPart[] = [];
  const coneA = new THREE.ConeGeometry(0.225, 1, 6); coneA.translate(0, 0.5, 0); // 细档：底径=0.45·高
  const coneB = new THREE.ConeGeometry(0.425, 1, 6); coneB.translate(0, 0.5, 0); // 胖档：底径=0.85·高
  const ringGeo = new THREE.TorusGeometry(0.5, 0.09, 6, 10);
  ringGeo.rotateX(Math.PI / 2); // 几何级转平＝贴地根环
  for (const side of [-1, 1] as const) {
    const salt = 71 + ((side + 1) / 2) * 100;
    for (let k = 0; k < 20; k++) {
      // 主带 12（+6~−146，间距 13.2）/ 颈段 5（×0.7 加密）/ 尾带 3；两侧相位错开半步
      const band = k < 12 ? 0 : k < 17 ? 1 : 2;
      const base = band === 0 ? 6 - k * 13.2 - (side < 0 ? 0 : 6.6)
        : band === 1 ? (side < 0 ? -153 : -158) - (k - 12) * 9.2
          : (side < 0 ? -200 : -206) - (k - 17) * 11.5;
      const z = base + (rnd(k, salt + 1) - 0.5) * 2.4;
      const px = side * (3.2 + rnd(k, salt + 3) * 1.3);      // 路缘 |x| 3.2~4.5
      const tall = rnd(k, salt + 9) < 0.55;                  // 高锥走细档 / 矮锥走胖档（底径 0.8~1.4）
      const h = tall ? 1.8 + rnd(k, salt + 11) * 0.8 : 1.2 + rnd(k, salt + 13) * 0.45;
      const broken = rnd(k, salt + 17) < 0.2;                // 损毁：折半只剩根部斜桩
      const hh = broken ? h * 0.38 : h;
      const lean = 0.21 + (broken ? 0.35 : 0);               // 朝后倾 12°，断桩倒得更狠
      (tall ? spineA : spineB).push(part(px, 0, z, hh, rnd(k, salt + 19) * 6.283, { rx: lean }));
      rings.push(part(px, 0.12, z, hh * 0.92, 0, { rx: lean * 0.5 })); // 根部尸苔骨膜环随行
    }
  }

  // ---- 半埋甲板 ×18（§4.5）：按 §3.2 分区（胸 9 / 肋 5 / 颈 3 / 颅 1）----
  const platesA: TitanPart[] = [], platesB: TitanPart[] = [], strips: TitanPart[] = [];
  const PZONES: [number, number, number][] = [[9, -6, -88], [5, -92, -148], [3, -154, -194], [1, -216, -216]];
  let idx = 0;
  for (const [count, z0, z1] of PZONES) {
    for (let k = 0; k < count; k++) {
      const i = idx++;
      const side: -1 | 1 = i % 2 === 0 ? -1 : 1;
      const z = z0 + ((k + 0.5) * (z1 - z0)) / count + (rnd(i, 61) - 0.5) * 3;
      const px = side * (6.5 + rnd(i, 63) * 13);             // |x| 6.5~19.5：胸廓坡脚内外错落
      const big = rnd(i, 65) < 0.45;                         // 两档板型（4×0.7×9 / 3.4×0.55×13）
      const ps = 0.85 + rnd(i, 67) * 0.3;
      const tilt = 0.17 + rnd(i, 69) * 0.18;                 // 斜插 10~20°
      const rz = -side * tilt;                               // 向路心一端翘起（板背朝天覆苔）
      const rx = (rnd(i, 71) - 0.5) * 0.14, ry = (rnd(i, 73) - 0.5) * 0.5;
      const py = groundAt(px, z) * 0.55 + 0.3;               // 基线：坡面高度一半 ≈ 半埋
      const arr = big ? platesA : platesB;
      arr.push(part(px, py, z, ps, ry, { rx, rz }));
      if (rnd(i, 75) < 0.33) {                               // 损毁：断成两块错位（后截缩比斜搭）
        arr.push(part(px + (rnd(i, 77) - 0.5) * 1.2, py - 0.25, z + (big ? 5.4 : 7.6) * ps,
          ps * 0.6, ry, { rx, rz: rz + (rnd(i, 79) - 0.5) * 0.24 }));
      }
      // 甲缝导引纹细条：贴板缘向路心翘起端（局部 −side·半宽、半厚上抬），随板同转
      const lw = (big ? 2 : 1.7) * ps, lt = (big ? 0.42 : 0.34) * ps;
      strips.push(part(px + (-side * lw) * Math.cos(rz) - lt * Math.sin(rz),
        py + (-side * lw) * Math.sin(rz) + lt * Math.cos(rz), z, 1, ry, { rx, rz }));
    }
  }

  // ---- 路缘甲缝导引长纹（§3.1 路缘带读法）：两侧 |x|≈4.4 分段金条（0.6m 缝口），随 LOOP 滚动 ----
  const guides: TitanPart[] = [];
  for (const side of [-1, 1] as const) {
    for (let k = 0; k < 12; k++) guides.push(part(side * 4.4, 0.05, -LOOP + 10 + k * 20, 1));
  }

  // ---- 峡谷雾墙（§3.4）：压扁球三排，色由深及浅；×0.55 半速视差 + 300m 回收带 ----
  const wallGeo = new THREE.SphereGeometry(1, 9, 6);
  wallGeo.scale(1, 0.45, 1); // 几何级压扁＝雾丘（云墙同款）
  const wallNear: TitanPart[] = [], wallFar: TitanPart[] = [];
  const ROWS: [number, number, number, number][] = [[26, -2, 8.5, 3.5], [38, -4.5, 11, 4], [50, -7, 14, 5]];
  for (const side of [-1, 1] as const) {
    ROWS.forEach(([bx, wy, s0, sv], ri) => {
      const every = 34 + ri * 7;
      for (let k = 0; k < Math.ceil(300 / every); k++) {
        const w = part(side * (bx + rnd(k, 201 + ri) * 8), wy + (rnd(k, 203 + ri) - 0.5) * 2,
          -240 + k * every + rnd(k, 209 + ri) * 12, s0 + rnd(k, 211 + ri) * sv);
        (ri === 2 ? wallFar : wallNear).push(w);
      }
    });
  }

  // ---- 实例化：13 draw call（躯体 11 + 雾墙 2）----
  insts.push(addInst(scene, thoraxGeo, std(C.skin), masses));
  insts.push(addInst(scene, capGeo, std(C.moss), caps));
  insts.push(addInst(scene, capGeo, std(C.boneDark), inners));
  const rustInst = addInst(scene, rustGeo, std(C.rust), rusts);
  tint(rustInst, [C.rust, C.rustLight]); // 锈斑深浅不一
  insts.push(rustInst);
  insts.push(addInst(scene, coneA, std(C.bone), spineA));
  insts.push(addInst(scene, coneB, std(C.bone), spineB));
  insts.push(addInst(scene, ringGeo, std(C.moss), rings));
  const plateAInst = addInst(scene, new THREE.BoxGeometry(4, 0.7, 9), std(C.rust), platesA);
  tint(plateAInst, [C.rust, C.rustLight]);
  const plateBInst = addInst(scene, new THREE.BoxGeometry(3.4, 0.55, 13), std(C.rust), platesB);
  tint(plateBInst, [C.rust, C.rustLight]);
  insts.push(plateAInst, plateBInst);
  // 发光件（导引纹）：亡火金 MeshBasicMaterial（发光只认亡火金）
  insts.push(addInst(scene, new THREE.BoxGeometry(0.16, 0.06, 7.2), new THREE.MeshBasicMaterial({ color: C.pyre }), strips));
  insts.push(addInst(scene, new THREE.BoxGeometry(0.14, 0.04, 19.4), new THREE.MeshBasicMaterial({ color: C.pyre }), guides));
  wallInsts.push(addInst(scene, wallGeo, std(C.mist), wallNear));
  wallInsts.push(addInst(scene, wallGeo, std(C.dusk), wallFar));

  return {
    update(move: number, t: number) {
      void t; // 呼吸起伏不做（titanProps 总装统一管，见文件头）；t 预留
      for (const inst of insts) {
        for (const p of inst.items) {
          p.z += move;
          p.z -= Math.ceil((p.z - WRAP_Z) / LOOP) * LOOP;
        }
        writeAll(inst);
      }
      // 峡谷雾墙：半速视差 + 300m 回收带（对齐 stormspire 云墙）
      for (const inst of wallInsts) {
        for (const p of inst.items) {
          p.z += move * 0.55;
          p.z -= Math.ceil((p.z - 60) / 300) * 300;
        }
        writeAll(inst);
      }
    },
    dispose() {
      for (const inst of [...insts, ...wallInsts]) {
        inst.mesh.geometry.dispose();
        (inst.mesh.material as THREE.Material).dispose();
        inst.mesh.dispose();
      }
    },
  };
}
