/**
 * 落脚尘土（render 层）：Run 步态中脚掌每次蹬地滋一圈冲击环 + 几粒微粒。
 *
 * 为什么需要（实测口径）：奶龙 Run 的脚行程只有 0.65m/周期，而 12 m/s 下一个周期身体前进
 * 6.7m——脚相对地面 90% 的时间在滑。纯靠动画，观众读到的是「人在飞、腿在原地倒腾」；
 * 加一串贴着地面的落地冲击环，滑步就被读成蹬地，跑步感主要来自这个反馈而不是步幅
 * （步幅受腿长锁死，代码侧无解，只能等建模侧重导 sprint cycle）。
 *
 * 实现口径：
 *   - 池化复用（同 vfxBurst 范式），零分配；每个尘土 = 1 个平放冲击环 + 3 粒微粒，共享一份材质。
 *   - 位置由 animAvatar 的落脚探测给出（脚世界 x/z + 支撑面 y），本模块只管演。
 *   - 随赛道一起向 +z 平流（实体口径 z = worldZ - dist，dist 增大即朝相机方向涌），
 *     速度由调用方按 sim 步长精确给出，尘土才像贴在地面上而不是飘在半空。
 */
import * as THREE from 'three';

/** 单圈寿命（秒）与池容量：1.9Hz 步频 × 2 脚 ≈ 3.9 次/秒、寿命 0.34s → 至少 2 个同时在演，留余量到 12 */
const PUFF_T = 0.34, PUFF_POOL = 12;
/** 冲击环几何（内/外半径）与缩放区间：从小到大炸开。
 *  终档 2.3× ≈ 0.55m 直径（角色 1.45m 高的三分之一强）：实机截图确认这个量级
 *  在 8.4m 机位下既看得见又不抢戏；再大就成卡通特效了。 */
const RING_IN = 0.06, RING_OUT = 0.14, RING_SCALE0 = 0.5, RING_SCALE1 = 2.3;
/** 微粒数量、上抛与后抛初速区间、微粒重力 */
const SPECK_N = 3, SPECK_UP = [0.45, 1.05], SPECK_BACK = [0.3, 1.1], SPECK_G = 6;
/** 尘土色与峰值不透明度（冷白，贴合霓虹夜景；加色混合 + 不写深度，避免在地面上切出硬边）。
 *  0.5 是实机截图定档：0.4 偏淡（用户原话「不明显」），0.65 起在地面上发糊。 */
const PUFF_COLOR = 0xdbeafe, PUFF_OPACITY = 0.5;

export interface FootDust {
  /** 在支撑面上放一圈尘土（x/z 为脚的世界位置，y 为支撑面高度） */
  spawn(x: number, y: number, z: number): void;
  /** @param dt 帧间隔（秒） @param scrollSpeed 赛道滚动速度（m/s），尘土与之同速向 +z 平流 */
  update(dt: number, scrollSpeed: number): void;
  dispose(): void;
}

export function createFootDust(scene: THREE.Scene): FootDust {
  const ringGeo = new THREE.RingGeometry(RING_IN, RING_OUT, 20);
  const speckGeo = new THREE.SphereGeometry(0.032, 6, 5);
  interface Puff { g: THREE.Group; ring: THREE.Mesh; mat: THREE.MeshBasicMaterial; specks: THREE.Mesh[]; vel: THREE.Vector3[]; t: number }
  const pool: Puff[] = [];
  for (let i = 0; i < PUFF_POOL; i++) {
    const mat = new THREE.MeshBasicMaterial({
      color: PUFF_COLOR, transparent: true, opacity: 0, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(ringGeo, mat);
    ring.rotation.x = -Math.PI / 2; // 平铺在支撑面上
    ring.frustumCulled = false;     // 缩放后包围球不更新，关剔除防忽隐忽现
    const g = new THREE.Group();
    g.add(ring);
    g.visible = false;
    const specks: THREE.Mesh[] = [];
    const vel: THREE.Vector3[] = [];
    for (let s = 0; s < SPECK_N; s++) {
      const m = new THREE.Mesh(speckGeo, mat);
      m.frustumCulled = false;
      g.add(m);
      specks.push(m);
      vel.push(new THREE.Vector3());
    }
    scene.add(g);
    pool.push({ g, ring, mat, specks, vel, t: PUFF_T });
  }

  return {
    spawn(x, y, z) {
      const b = pool.find(s => !s.g.visible); // 池满则丢弃：尘土是纯反馈，不缺这一次
      if (!b) return;
      b.t = 0;
      b.g.visible = true;
      b.g.position.set(x, y, z);
      b.ring.scale.setScalar(RING_SCALE0);
      b.mat.opacity = PUFF_OPACITY;
      for (let s = 0; s < SPECK_N; s++) {
        b.specks[s].position.set(0, 0, 0);
        const a = Math.random() * Math.PI * 2;
        b.vel[s].set(
          Math.cos(a) * (0.2 + Math.random() * 0.4),
          SPECK_UP[0] + Math.random() * (SPECK_UP[1] - SPECK_UP[0]),
          Math.sin(a) * (0.2 + Math.random() * 0.4) - (SPECK_BACK[0] + Math.random() * (SPECK_BACK[1] - SPECK_BACK[0])),
        );
      }
    },
    update(dt, scrollSpeed) {
      for (const b of pool) {
        if (!b.g.visible) continue; // 空闲槽位（visible 即「在演」）
        b.t += dt;
        if (b.t >= PUFF_T) { b.g.visible = false; b.mat.opacity = 0; continue; }
        const k = b.t / PUFF_T;
        b.mat.opacity = PUFF_OPACITY * (1 - k) * (1 - k);
        const rs = RING_SCALE0 + (RING_SCALE1 - RING_SCALE0) * k;
        b.ring.scale.set(rs, rs, rs);
        b.g.position.z += scrollSpeed * dt; // 与赛道同速涌向相机，才像贴地
        for (let s = 0; s < SPECK_N; s++) {
          const v = b.vel[s];
          v.y -= SPECK_G * dt;
          b.specks[s].position.addScaledVector(v, dt);
        }
      }
    },
    dispose() {
      for (const b of pool) {
        scene.remove(b.g);
        b.mat.dispose();
      }
      ringGeo.dispose();
      speckGeo.dispose();
    },
  };
}
