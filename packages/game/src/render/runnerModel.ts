/**
 * 程序化低多边形跑者模型（docs/05 §1 风格「Stylized Low-Poly + Emissive Trim」、§3 角色规格）
 *
 * 为什么是代码建模而不是 .glb：本机无 Blender、无外网拉取资产（docs/10 §5 允许先用占位体，
 * 正式 volt.glb 由美术按 docs/05 §3 导出后替换 `loadModel` 即可，接口不变）。
 *
 * 规格落实：
 *   - 体型 3 头身、总高 1.7m（与 core/sim 的碰撞盒 0.8×1.7×0.8 对齐），原点=脚底中心；
 *   - 剪影三件套：尖刺发型 / 飘动围巾 / 背后雷核背包（docs/05 §3「识别度」要求）；
 *   - 霓虹描边 = 每块几何体的 EdgesGeometry 线框（低多边形风格的标准做法，比反向壳更省 drawcall）；
 *   - 配色全部来自配置：characters.json 的 tint + 皮肤 materialOverrides（C3 数据驱动）；
 *   - 三角面 ~420 tris，远低于 LOD0 的 6k 上限。
 */
import * as THREE from 'three';

/**
 * 骨架关键高度（米，脚底为 0）——按 docs/05 §3 的「3 头身」反推：
 * 全高 1.70（与 core/sim 碰撞盒一致）→ 头高 ≈0.55，髋 0.72、肩 1.06、颈 1.12。
 */
const HIP_Y = 0.72, SHOULDER_Y = 1.06, HEAD_Y = 1.12;
/** 四肢长度：大腿 / 小腿 / 上臂 / 小臂 */
const THIGH = 0.38, SHIN = 0.34, UPPER_ARM = 0.28, FORE_ARM = 0.26;
/** 跑动步频：每米约 1.5 个完整循环的相位系数 */
const STRIDE_PHASE = 9.4;
/** 姿态混合速度（每秒逼近目标的比例） */
const POSE_LERP = 0.18;

export interface RunnerModelColors {
  /** 主色（皮肤 materialOverrides.bodyTint，缺省回退角色 tint） */
  body: string;
  /** 发光色（皮肤 materialOverrides.emissive）：描边、雷核、护目镜 */
  glow: string;
  /** 整体缩放（characters.json model.scale） */
  scale: number;
}

interface Limb { pivot: THREE.Group; mid: THREE.Group }

export function createRunnerModel(colors: RunnerModelColors) {
  const bodyMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(colors.body), roughness: 0.55, metalness: 0.08, flatShading: true,
    emissive: new THREE.Color(colors.glow), emissiveIntensity: 0, // 无敌期闪烁由 update(flash) 驱动
  });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x2a3350, roughness: 0.7, flatShading: true });
  const glowMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(colors.glow), emissive: new THREE.Color(colors.glow), emissiveIntensity: 1.6, flatShading: true,
  });
  const edgeMat = new THREE.LineBasicMaterial({ color: new THREE.Color(colors.glow), transparent: true, opacity: 0.85 });

  /** 一块低多边形体：实体 + 霓虹描边线，返回可挂接的组 */
  function part(w: number, h: number, d: number, mat: THREE.Material, cx = 0, cy = 0, cz = 0) {
    const g = new THREE.Group();
    const geo = new THREE.BoxGeometry(w, h, d);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(cx, cy, cz);
    g.add(mesh, new THREE.LineSegments(new THREE.EdgesGeometry(geo), edgeMat));
    (g.children[1] as THREE.LineSegments).position.copy(mesh.position);
    return g;
  }

  /** 两段式肢体：pivot 在关节处，mid 在下一关节处（上段体色、下段深色，读得出关节） */
  function limb(lenA: number, lenB: number, wA: number, wB: number, yRoot: number, x: number) {
    const pivot = new THREE.Group();
    pivot.position.set(x, yRoot, 0);
    const segA = part(wA, lenA, wA, bodyMat, 0, -lenA / 2, 0);
    const mid = new THREE.Group();
    mid.position.y = -lenA;
    const segB = part(wB, lenB, wB, bodyMat, 0, -lenB / 2, 0);
    const foot = part(wB * 1.2, 0.08, wB * 2.1, darkMat, 0, -lenB + 0.04, wB * 0.4);
    mid.add(segB, foot);
    pivot.add(segA, mid);
    return { pivot, mid } as Limb;
  }

  const root = new THREE.Group();          // 原点=脚底中心
  const body = new THREE.Group();          // 整体上下起伏与前后倾
  root.add(body);

  // 躯干 + 胯（略倒三角体量，腰线收一点才读得出「上身」）
  const torso = part(0.4, SHOULDER_Y - HIP_Y + 0.16, 0.28, bodyMat, 0, (HIP_Y + SHOULDER_Y) / 2, 0);
  body.add(torso);
  body.add(part(0.32, 0.16, 0.24, darkMat, 0, HIP_Y - 0.02, 0));

  // 头（3 头身 → 头高 0.5）+ 前额护目镜 + 后扫式发型
  const head = new THREE.Group();
  head.position.y = HEAD_Y;
  head.add(part(0.42, 0.5, 0.4, bodyMat, 0, 0.25, 0));
  head.add(part(0.36, 0.1, 0.06, glowMat, 0, 0.3, -0.2));              // 护目镜（面朝 -z）
  for (const [sx, sy, sz, h, tilt] of [[0, 0.56, 0.06, 0.24, 0.55], [-0.11, 0.5, 0.1, 0.18, 0.7], [0.11, 0.5, 0.1, 0.18, 0.7]] as const) {
    const spike = part(0.1, h, 0.1, glowMat, sx, sy, sz);
    spike.rotation.x = tilt;                                           // 统一向后扫，读作「一束头发」而非两根天线
    head.add(spike);
  }
  body.add(head);

  // 背后雷核背包：外壳收小，让发光核心露在轮廓外（追尾视角第一眼识别点）
  const pack = part(0.26, 0.3, 0.12, darkMat, 0, (HIP_Y + SHOULDER_Y) / 2 + 0.02, 0.22);
  const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.11), glowMat);
  core.position.set(0, 0.02, 0.12);
  pack.add(core);
  body.add(pack);

  // 围巾：三节递减方块，从背包上方往身后飘（跑动时摆动最明显）
  const scarf: THREE.Group[] = [];
  let scarfParent: THREE.Group = body;
  for (let i = 0; i < 3; i++) {
    const seg = new THREE.Group();
    seg.position.set(0, i === 0 ? SHOULDER_Y + 0.06 : -0.13, i === 0 ? 0.28 : 0);
    const w = 0.19 - i * 0.045;
    seg.add(part(w, 0.13, 0.05, glowMat, 0, -0.06, 0.03 + i * 0.03));
    scarfParent.add(seg);
    scarf.push(seg);
    scarfParent = seg;
  }

  // 四肢
  const legL = limb(THIGH, SHIN, 0.15, 0.13, HIP_Y, -0.11);
  const legR = limb(THIGH, SHIN, 0.15, 0.13, HIP_Y, 0.11);
  const armL = limb(UPPER_ARM, FORE_ARM, 0.12, 0.11, SHOULDER_Y + 0.02, -0.26);
  const armR = limb(UPPER_ARM, FORE_ARM, 0.12, 0.11, SHOULDER_Y + 0.02, 0.26);
  for (const l of [legL, legR, armL, armR]) body.add(l.pivot);

  root.scale.setScalar(colors.scale);

  // ---------- 动画状态 ----------
  let phase = 0, lastDistance = 0, bob = 0, hipY = 0, flow = 0;
  const target = { pitch: 0, hipY: 0, crouch: 0 };

  /** 姿态混合：跑 / 空中收腿 / 滑铲贴地 / 飞行前倾 */
  function pickPose(mode: 'run' | 'air' | 'slide' | 'fly') {
    if (mode === 'fly') { target.pitch = 0.85; target.hipY = -0.02; target.crouch = 0; }
    else if (mode === 'slide') { target.pitch = 1.15; target.hipY = -0.24; target.crouch = 1; }
    else if (mode === 'air') { target.pitch = 0.18; target.hipY = 0; target.crouch = 0.25; }
    else { target.pitch = 0.1; target.hipY = 0; target.crouch = 0; }
  }

  function swing(l: Limb, a: number, knee: number) {
    l.pivot.rotation.x = a;
    l.mid.rotation.x = knee;
  }

  return {
    group: root,
    /** 躯干组（本地坐标、随 root 缩放；buff 挂件挂到这里，死亡翻倒时一起倒） */
    body,
    /** 胸口高度（米，脚底为 0），供爆点/护盾等表现对齐身体 */
    get chestY() { return ((HIP_Y + SHOULDER_Y) / 2) * colors.scale; },
    /** 胸口本地高度（躯干组坐标系，挂件定位用） */
    get chestLocalY() { return (HIP_Y + SHOULDER_Y) / 2; },
    /** 头顶高度，供头盔罩对齐 */
    get headY() { return (HEAD_Y + 0.38) * colors.scale; },
    /** 头顶本地高度（躯干组坐标系，挂件定位用） */
    get headLocalY() { return HEAD_Y + 0.38; },
    /** 雷核背包的背部挂点深度（喷气火焰对齐用） */
    get packZ() { return (pack.position.z + 0.1) * colors.scale; },
    /** 背包挂点本地深度（躯干组坐标系，挂件定位用） */
    get packLocalZ() { return pack.position.z + 0.1; },
    /**
     * @param t 本局时间（秒） @param distance 已跑距离（米）
     * @param mode 姿态档 @param power 摆幅强度（受击时降低） @param flash 霓虹闪烁强度（无敌期）
     */
    update(t: number, distance: number, mode: 'run' | 'air' | 'slide' | 'fly', power = 1, flash = 0) {
      pickPose(mode);
      body.rotation.x += (target.pitch - body.rotation.x) * POSE_LERP;
      hipY += (target.hipY - hipY) * POSE_LERP;

      const dm = Math.max(0, distance - lastDistance);
      lastDistance = distance;
      // 滑铲时腿不再交替蹬地，改为前伸；空中收腿
      if (mode === 'run') {
        phase += dm * STRIDE_PHASE;
        const s = Math.sin(phase), c = Math.cos(phase);
        bob += (Math.abs(s) * 0.035 - bob) * 0.25;
        swing(legL, s * 0.95 * power, -Math.max(0, -s) * 1.25);
        swing(legR, -s * 0.95 * power, -Math.max(0, s) * 1.25);
        swing(armL, -s * 0.8 * power, -0.5 - Math.max(0, s) * 0.5);
        swing(armR, s * 0.8 * power, -0.5 - Math.max(0, -s) * 0.5);
        head.rotation.x = -0.1 + c * 0.05;
        torso.position.x = c * 0.012;
      } else {
        const hold = mode === 'slide' ? 1 : 0.55;
        swing(legL, mode === 'slide' ? -1.2 : -0.7, mode === 'slide' ? 0.15 : 1.5);
        swing(legR, mode === 'slide' ? -0.95 : -0.35, mode === 'slide' ? 0.2 : 1.2);
        swing(armL, mode === 'fly' ? 2.4 : -0.4 * hold, -0.3);
        swing(armR, mode === 'fly' ? 2.3 : -0.3 * hold, -0.3);
        bob += (0 - bob) * 0.2;
      }
      body.position.y = hipY + bob;

      // 围巾与雷核：围巾按「平滑后的单步位移」决定飘起角度（速度越快越平），雷核常亮呼吸
      flow += (Math.min(dm, 0.6) - flow) * 0.15;
      for (let i = 0; i < scarf.length; i++) {
        const wave = Math.sin(t * 7 - i * 0.9) * 0.12 + (mode === 'run' ? 0.3 : 0.12) + flow * 1.1;
        scarf[i].rotation.x = wave * (0.6 + i * 0.25);
        scarf[i].rotation.z = Math.sin(t * 3.4 + i) * 0.09;
      }
      core.rotation.y = t * 2.2;
      core.rotation.x = t * 1.4;
      const pulse = 1 + Math.sin(t * 5.5) * 0.12;
      core.scale.setScalar(pulse);
      glowMat.emissiveIntensity = 1.35 + Math.sin(t * 5.5) * 0.35;
      // 无敌期：整块身体往霓虹色上打闪（docs/05 §5 的「角色放电」最小版本）
      bodyMat.emissiveIntensity = flash;
    },
  };
}
