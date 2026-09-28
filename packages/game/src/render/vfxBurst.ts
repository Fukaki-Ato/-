/**
 * 拾取爆点特效池（docs/05 §5 VFX 清单的最小实现；完整清单在 M4 T4.4）
 * 每个爆点 = 光环 + 核心 + 7 粒子，池化复用，播完自动隐藏。
 */
import * as THREE from 'three';

const BURST_T = 0.35;
const BURST_PARTICLES = 7;
/** 池容量：连吃金币/穿云时 8 个槽位不够用，翻倍到 16（复用路径不变，仍零分配） */
const BURST_POOL = 16;
/** 粒子抛体：初速范围、重力、以及磁铁期的放大档 */
const SPARK_SPD = [1.6, 2.4], SPARK_GRAVITY = 7.5, MAGNET_SCALE = 1.4;
const DEFAULT_COLOR = 0xffd84d;

export function createBurstPool(scene: THREE.Scene) {
  const ringGeo = new THREE.RingGeometry(0.2, 0.27, 24);
  const coreGeo = new THREE.SphereGeometry(0.1, 10, 8);
  const sparkGeo = new THREE.OctahedronGeometry(0.055);
  interface Burst { g: THREE.Group; ring: THREE.Mesh; core: THREE.Mesh; parts: THREE.Mesh[]; vel: THREE.Vector3[]; t: number }
  const pool: Burst[] = [];
  for (let i = 0; i < BURST_POOL; i++) {
    const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: DEFAULT_COLOR, transparent: true, opacity: 0, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
    const core = new THREE.Mesh(coreGeo, new THREE.MeshBasicMaterial({ color: 0xfff0b8, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    const g = new THREE.Group(); g.add(ring, core);
    const parts: THREE.Mesh[] = []; const vel: THREE.Vector3[] = [];
    const partMat = new THREE.MeshBasicMaterial({ color: DEFAULT_COLOR, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    for (let p = 0; p < BURST_PARTICLES; p++) { const m = new THREE.Mesh(sparkGeo, partMat); g.add(m); parts.push(m); vel.push(new THREE.Vector3()); }
    g.visible = false; scene.add(g);
    pool.push({ g, ring, core, parts, vel, t: BURST_T });
  }
  let fired = 0;

  return {
    get fired() { return fired; },
    /** 在指定位置触发爆点；color 默认金币金，穿云用白色 */
    fireAt(x: number, y: number, z: number, color = DEFAULT_COLOR) {
      const b = pool.find(s => s.t >= BURST_T); if (!b) return;
      b.t = 0; b.g.visible = true;
      b.g.position.set(x, y, z);
      (b.ring.material as THREE.MeshBasicMaterial).color.setHex(color);
      (b.core.material as THREE.MeshBasicMaterial).color.setHex(color);
      (b.parts[0].material as THREE.MeshBasicMaterial).color.setHex(color);
      for (let p = 0; p < BURST_PARTICLES; p++) {
        const a = Math.random() * Math.PI * 2, sp = SPARK_SPD[0] + Math.random() * SPARK_SPD[1];
        b.vel[p].set(Math.cos(a) * sp, 0.8 + Math.random() * 1.8, Math.sin(a) * sp * 0.5 - 0.6);
        b.parts[p].position.set(0, 0, 0);
      }
      fired++;
    },
    /** magnetOn：磁铁期爆点整体放大一档（用户规则：光圈与粒子特效增大） */
    update(dt: number, magnetOn: boolean) {
      const mf = magnetOn ? MAGNET_SCALE : 1;
      for (const b of pool) {
        if (b.t >= BURST_T) { if (b.g.visible) b.g.visible = false; continue; }
        b.t += dt;
        const k = Math.min(b.t / BURST_T, 1);
        const rs = (0.35 + k * 0.8) * mf; b.ring.scale.set(rs, rs, rs);
        (b.ring.material as THREE.MeshBasicMaterial).opacity = (1 - k) * 0.9;
        const cs = (1 - k * 0.7) * mf; b.core.scale.set(cs, cs, cs);
        (b.core.material as THREE.MeshBasicMaterial).opacity = (1 - k) * 0.85;
        const ps = (1 - k) * mf;
        const pm = b.parts[0].material as THREE.MeshBasicMaterial;
        pm.opacity = k < 0.75 ? 0.95 : (1 - k) * 3.8;
        for (let p = 0; p < BURST_PARTICLES; p++) {
          b.vel[p].y -= SPARK_GRAVITY * dt;
          b.parts[p].position.addScaledVector(b.vel[p], dt);
          b.parts[p].scale.setScalar(ps);
          b.parts[p].rotation.x += dt * 6; b.parts[p].rotation.y += dt * 4;
        }
      }
    },
  };
}
