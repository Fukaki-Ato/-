/**
 * 时空隧道（特殊事件 2.0「时空隧道/金币雨/低重力带」的隧道表现层）：s.warp>0 期间用 16 个
 * 圆角矩形环（TorusGeometry 压扁成椭圆截面，最简做法）罩住三车道（半宽 1.5×laneWidth+1.2 /
 * 半高 3.2，环心 y=1.6 罩住地面到 4.6m 天花板），环以世界网格锚定（每 gap 米一环）随奔跑逐环
 * 掠过玩家，逐环绕 z 慢旋（漩涡感）+ 沿法线呼吸脉动；材质 MeshBasic 半透明加色混合（zoneGates
 * 发光条同款，不用 MeshStandard emissive 避免 IBL 依赖），instanceColor 紫罗兰 #b06cff/#7d5cff 交替。
 * 入口冲击：false→true 沿后 0.5s 内环距 12m→6m 收缩（「被吸进去」的压缩感），出口沿对称
 * 回扩并按同窗渐隐后隐藏（稳态 false=全环 scale 0，隧道不存在）。没门位数据就没有门：
 * 入口视觉=首圈环逼近+雾色变化（雾色混在 runnerScene），v1 不做独立门架。
 * 不读 zones 区表，只吃每帧状态 update(dist, t, warpActive)；每帧只写 instance buffer，
 * 临时 Matrix4/Vector3/Quaternion/Color 模块顶层复用，零分配（docs/02 §8）。
 */
import * as THREE from 'three';

/** 环数 / 稳态环距（米）/ 沿窗时长（秒，压缩与回扩共用） */
const RINGS = 16, SPACING = 6, EDGE_S = 0.5;
/** 入口沿起始环距（米）：12→6 收缩营造吸入感；截面半高/环心高/管径 */
const GAP_WIDE = 12, HALF_H = 3.2, CENTER_Y = 1.6, TUBE = 0.06;
/** 慢旋速率（rad/s）与逐环相位差（rad）＝漩涡；呼吸幅度与频率（沿环法线 z） */
const SPIN = 0.8, PHASE = 0.4, BREATH = 0.03, BREATH_HZ = 3;
/** 双色紫罗兰交替（与 urgency 4 横幅描边 #b06cff 同族） */
const COLOR_A = 0xb06cff, COLOR_B = 0x7d5cff;

/** 位姿/矩阵/颜色临时对象（模块顶层建好复用，update 内零分配） */
const M = new THREE.Matrix4(), P = new THREE.Vector3(), S = new THREE.Vector3();
const Q = new THREE.Quaternion(), Z_AXIS = new THREE.Vector3(0, 0, 1), C = new THREE.Color();

export interface WarpTunnelHandle {
  /** dist=玩家插值距离、t=sim 时间；warpActive=s.warp>0。内部自记 flip 沿驱动压缩/回扩 */
  update(dist: number, t: number, warpActive: boolean): void;
  dispose(): void;
}

export function createWarpTunnel(scene: THREE.Scene, laneWidth: number): WarpTunnelHandle {
  const halfW = 1.5 * laneWidth + 1.2;
  // 圆角矩形截面最简做法：单位圆环 Torus 压扁（实例 scale x=半宽 / y=半高），绕 z 旋即涡环
  const geo = new THREE.TorusGeometry(1, TUBE, 8, 32);
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
  const mesh = new THREE.InstancedMesh(geo, mat, RINGS);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  // 矩阵逐帧全量重写，几何包围球不可靠：剔除交给槽位 scale 0（zoneGates/coinField 同款惯例，防闪断）
  mesh.frustumCulled = false;
  scene.add(mesh);
  // 开局把 instanceColor 缓冲建满（双色交替恒定，此后不再写颜色缓冲，首帧后不建对象）
  for (let i = 0; i < RINGS; i++) mesh.setColorAt(i, C.setHex(i % 2 === 0 ? COLOR_A : COLOR_B));

  /** flip 沿内部状态：active=当前激活态；edgeT=最近沿的 sim 时间（初值 −10 ⇒ 从未激活即稳态隐藏） */
  let active = false, edgeT = -10;

  return {
    update(dist: number, t: number, warpActive: boolean) {
      if (warpActive !== active) { active = warpActive; edgeT = t; } // 沿检测：进/出各记一次
      const k = Math.min(1, (t - edgeT) / EDGE_S); // 沿窗进度 0..1（0.5s）
      // 入口：环距 12→6 收缩（吸入感）、全尺寸；出口对称回扩 6→12 并按 1−k 渐隐；稳态 false=隐藏
      const vis = active ? 1 : k < 1 ? 1 - k : 0;
      const gap = active ? GAP_WIDE + (SPACING - GAP_WIDE) * k : SPACING + (GAP_WIDE - SPACING) * k;
      if (vis <= 0) {
        M.makeScale(0, 0, 0);
        for (let i = 0; i < RINGS; i++) mesh.setMatrixAt(i, M); // 隐藏槽位：scale 0（实例退化成不可见点）
      } else {
        // 世界锚定网格：环钉在 gap 网格的世界里程上、z=dist−worldM（entityLayers 口径前方为负），
        // 随奔跑逐环掠过玩家（zoneGates 门式穿环感，非共动包裹——共动会把环焊死在镜头-relative 偏移上）。
        const base = Math.ceil(dist / gap) * gap;
        for (let i = 0; i < RINGS; i++) {
          const rz = dist - (base + i * gap); // ∈(−gap·i−…, 0]：环 0 在脚下、向前逐环铺开
          if (rz > 0.5) { M.makeScale(0, 0, 0); mesh.setMatrixAt(i, M); continue; } // 过环即隐（贴脸巨环糊屏）
          P.set(0, CENTER_Y, rz);
          Q.setFromAxisAngle(Z_AXIS, t * SPIN + i * PHASE); // 逐环绕 z 慢旋 + 相位差=漩涡
          S.set(halfW * vis, HALF_H * vis, (1 + BREATH * Math.sin(t * BREATH_HZ + i)) * vis); // 法向呼吸脉动
          M.compose(P, Q, S);
          mesh.setMatrixAt(i, M);
        }
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
    dispose() { // 同 zoneGates：几何/材质/实例缓冲全释放并移出场景
      scene.remove(mesh); geo.dispose(); mat.dispose(); mesh.dispose();
    },
  };
}
