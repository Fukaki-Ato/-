/**
 * 加速表现（render 层）：speedMul 生效期间（雷霆冲刺/加速道具）从镜头两侧向身后掠过的
 * 加色速度线 + 由 runnerScene 配合的 FOV 扩张。只读 fx.speedMul 的派生值，不做玩法判定。
 * 池预建、每帧零分配（docs/02 §8）：线的位置由世界距离推进，速度乘区越大掠过越快。
 */
import * as THREE from 'three';

/** 线数 / 纵深跨度（角色身后 30m 到镜头前 4m）/ 横向离轴最小距离（避免糊住角色） */
const LINE_COUNT = 44, Z_FAR = -30, Z_SPAN = 34, X_MIN = 0.9;
/** 基准掠过速率（相对世界距离）与每线差异区间 */
const BASE_RATE = 0.85, RATE_SPREAD = 0.6;

export function createSpeedLines(scene: THREE.Scene, tint: string) {
  const geo = new THREE.BoxGeometry(0.05, 0.05, 1);
  const mat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(tint), transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const group = new THREE.Group();
  group.visible = false;
  scene.add(group);
  interface Line { m: THREE.Mesh; x: number; y: number; z0: number; rate: number; len: number }
  const lines: Line[] = [];
  for (let i = 0; i < LINE_COUNT; i++) {
    const m = new THREE.Mesh(geo, mat);
    // 左右两侧对称铺：|x| ∈ [X_MIN, 3.6]，y ∈ [0.3, 4.4]
    const side = i % 2 === 0 ? 1 : -1;
    const x = side * (X_MIN + ((i * 0.37) % 2.6));
    const y = 0.3 + ((i * 0.83) % 4.1);
    const z0 = (i * 7.3) % Z_SPAN;
    const rate = BASE_RATE + ((i * 0.29) % RATE_SPREAD);
    const len = 1.1 + ((i * 0.41) % 1.7);
    m.position.set(x, y, Z_FAR + z0);
    m.scale.set(1, 1, len);
    group.add(m);
    lines.push({ m, x, y, z0, rate, len });
  }

  return {
    /** boost = max(0, speedMul-1) 的归一化强度（0=关闭，≥1=满强度）。
     *  技能档提速偏小（雷霆冲刺 1.15×）：×3 放大映射，15% 提速也能看到明确速度线（原始 k=0.15 不可见）。 */
    update(dist: number, boost: number) {
      const k = boost <= 0.001 ? 0 : Math.min(1, boost * 3);
      group.visible = k > 0;
      if (!k) return;
      mat.opacity = 0.75 * k;
      for (const l of lines) {
        const z = Z_FAR + ((l.z0 + dist * l.rate) % Z_SPAN + Z_SPAN) % Z_SPAN;
        l.m.position.set(l.x, l.y, z);
        l.m.scale.set(1, 1, l.len * (1 + k * 2.4));
      }
    },
  };
}
