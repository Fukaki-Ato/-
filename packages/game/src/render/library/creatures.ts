/**
 * 失重图书馆 · 生物（docs/scenes/library-brief.md §5.1/5.2 + §11.1 步骤 6）：
 *   cranes  纸鹤 3 群 × 40：参数化群飞（抄 stormspire/creatures.ts 口径——群心游移 + 个体相位 +
 *           拍翼，非真 boid，零分配零 O(n²)）；群心锚在书塔带 |x| 6~12、游移 ±4.5（每群路径
 *           反复穿过书塔间缝）；折纸三件套（身 + 双翼实例对摆），翼展 0.8~1.4m，陈纸米 85% +
 *           翼尖蜡封红 15%（实例色一次性落定）；拍翼 1.2s 周期，近/中/远各一群。
 *   whale   墨渊鲸 ×1：160m 级鲸-蛇混合体剪影（12 节脊椎 + 背鳍 ×3 + 头角，禁正脸细节），
 *           半沉墨海只露脊背（体心 y<0，仅背脊越出墨面），体色墨青→墨渊按节渐变（实例色），
 *           体侧 18 枚「书虫萤」烛光琥珀发光斑错落呼吸；椭圆巡游一圈 ~55s（每分钟至少完整
 *           掠过一次），活动带 x 12~46 / z −124~−32（不入桥面正下方）。
 * 每帧重写实例矩阵（鹤 120×3 + 鲸 12+4+18，量小）；确定性 rnd；不读 sim；发光只用烛光琥珀。
 * 调色按 brief §2 本地对表（library/palette.ts 并行件合入前先保 tsc 通过）。
 */
import * as THREE from 'three';
import { LOOP, WRAP_Z, rnd, std } from '../sceneryProps.js';

const PAPER = 0xeadfc2, PAPER_OLD = 0xb3a17f, WAX_RED = 0xa63a2e, INK_TEAL = 0x46536b,
  INK_DEEP = 0x1e1a33, CANDLE = 0xffb65c;
const SCHOOLS = 3, PER = 40, FLAP_W = 6.283 / 1.2; // 拍翼 1.2s 周期

export function createCreatures(scene: THREE.Scene) {
  const TC = new THREE.Color();
  // ---- 纸鹤：折纸三件套（锥身 + 双翼实例对摆，翼根平移到原点绕身轴 rz 拍摆）----
  const bodyGeo = new THREE.ConeGeometry(0.16, 0.7, 4);
  bodyGeo.rotateX(Math.PI / 2); // 锥尖朝 +Z（鼻向）
  const wingGeo = new THREE.BoxGeometry(0.6, 0.03, 0.24);
  wingGeo.translate(0.3, 0, 0); // 翼根在原点：几何翼展 1.2m × s ∈ 0.67~1.17 → 0.8~1.4m
  const bodies = new THREE.InstancedMesh(bodyGeo, std(0xffffff), SCHOOLS * PER);
  const wings = new THREE.InstancedMesh(wingGeo, std(0xffffff), SCHOOLS * PER * 2);
  bodies.frustumCulled = false; wings.frustumCulled = false;
  scene.add(bodies); scene.add(wings);
  const birdR = Array.from({ length: SCHOOLS * PER }, (_, i) => ({
    r: 1.6 + rnd(i, 811) * 3.2,      // 个体盘旋半径
    a: rnd(i, 813) * 6.283,          // 初始相位
    vy: (rnd(i, 815) - 0.5) * 2.6,   // 高度错层
    s: 0.67 + rnd(i, 817) * 0.5,     // 翼展 0.8~1.4m
    red: rnd(i, 819) < 0.15,         // 翼尖蜡封红 15%
    sh: 0.85 + rnd(i, 821) * 0.25,   // 纸面明暗
  }));
  for (let i = 0; i < SCHOOLS * PER; i++) { // 主体陈纸米 / 翼 15% 蜡封红（实例色一次性落定）
    bodies.setColorAt(i, TC.setHex(PAPER).multiplyScalar(birdR[i].sh));
    const wc = birdR[i].red ? WAX_RED : PAPER_OLD;
    wings.setColorAt(i * 2, TC.setHex(wc)); wings.setColorAt(i * 2 + 1, TC.setHex(wc));
  }
  if (bodies.instanceColor) bodies.instanceColor.needsUpdate = true;
  if (wings.instanceColor) wings.instanceColor.needsUpdate = true;
  const schoolDef = Array.from({ length: SCHOOLS }, (_, j) => ({
    cx: (j % 2 === 0 ? -1 : 1) * (6 + rnd(j, 831) * 6), // 群心锚 |x| 6~12（书塔带内）
    cy: 3.5 + rnd(j, 833) * 4.5,                        // 群心高度（层檐之间）
    z: -34 - j * 78 - rnd(j, 835) * 12,                 // 群心锚 z（随 LOOP 回收）
    spin: 0.24 + rnd(j, 837) * 0.16,                    // 盘旋角速度
    wob: 0.45 + rnd(j, 839) * 0.25,                     // 群心游移频率
  }));

  // ---- 墨渊鲸：12 节脊椎 + 背鳍 ×3 + 头角（复用鳍网格），半沉剪影 + 书虫萤斑 ----
  const SEG = 12;
  const whale = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6), std(0xffffff), SEG);
  const fins = new THREE.InstancedMesh(new THREE.ConeGeometry(0.5, 2.4, 4), std(INK_DEEP), 4);
  whale.frustumCulled = false; fins.frustumCulled = false;
  scene.add(whale); scene.add(fins);
  for (let k = 0; k < SEG; k++) { // 体色墨青→墨渊按节渐变（实例色一次性落定）
    whale.setColorAt(k, TC.setHex(INK_TEAL).lerp(new THREE.Color(INK_DEEP), (k / (SEG - 1)) * 0.8));
  }
  if (whale.instanceColor) whale.instanceColor.needsUpdate = true;
  const GLOW = 18;
  const glow = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 6, 4),
    new THREE.MeshBasicMaterial({ color: CANDLE, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending }), GLOW);
  glow.frustumCulled = false; scene.add(glow); // 「书虫萤」共生发光斑（唯一发光色）
  const glowR = Array.from({ length: GLOW }, (_, i) => ({
    u: 0.12 + (i / GLOW) * 0.74 + (rnd(i, 851) - 0.5) * 0.04, // 脊椎 u 采样点（错落）
    lat: (rnd(i, 853) - 0.5) * 2.2,                           // 体侧横偏
    s: 0.28 + rnd(i, 855) * 0.2,                              // 基础尺寸
  }));

  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(0, 0, 0, 'YXZ');
  const V = new THREE.Vector3(), S = new THREE.Vector3();
  const put = (mesh: THREE.InstancedMesh, i: number, x: number, y: number, z: number,
    rx: number, ry: number, rz: number, sx: number, sy: number, sz: number) => {
    E.set(rx, ry, rz); Q.setFromEuler(E); V.set(x, y, z); S.set(sx, sy, sz);
    M.compose(V, Q, S); mesh.setMatrixAt(i, M);
  };

  return {
    update(move: number, t: number) {
      // 纸鹤：群心随 LOOP 回收 + 缓慢游移（路径反复穿塔缝）；个体绕群心盘旋（ry=−a 鼻向贴切线）
      for (let j = 0; j < SCHOOLS; j++) {
        const sd = schoolDef[j];
        sd.z += move; if (sd.z > WRAP_Z) sd.z -= LOOP;
        const cx = sd.cx + Math.sin(t * sd.wob + j * 2.1) * 4.5; // 游移 ±4.5：路径 ≥2 次穿书塔间缝
        const cy = sd.cy + Math.sin(t * sd.wob * 0.7 + j) * 1.2;
        for (let k = 0; k < PER; k++) {
          const b = birdR[j * PER + k], a = b.a + t * sd.spin;
          const flap = Math.sin(t * FLAP_W + b.a * 3.0) * 0.55; // 拍翼 1.2s 周期 + 个体相位
          const x = cx + Math.cos(a) * b.r, y = cy + b.vy + Math.sin(a * 2) * 0.8, z = sd.z + Math.sin(a) * b.r * 0.7;
          put(bodies, j * PER + k, x, y, z, flap * 0.35, -a, 0, b.s, b.s, b.s);
          put(wings, (j * PER + k) * 2, x, y, z, 0, -a, flap, b.s, b.s, b.s);          // 左翼
          put(wings, (j * PER + k) * 2 + 1, x, y, z, 0, -a, Math.PI - flap, b.s, b.s, b.s); // 右翼（π 翻到 −x 侧同相拍）
        }
        bodies.instanceMatrix.needsUpdate = true;
        wings.instanceMatrix.needsUpdate = true;
      }
      // 墨渊鲸：半沉椭圆巡游（一圈 ~55s，每分钟至少完整掠过一次）；只露脊背
      const T = t * 0.114; // 2π/55
      const wx = 29 + 17 * Math.sin(T), wz = -78 + 46 * Math.sin(T * 0.63 + 1.2), wy = -2.4 + Math.sin(T * 0.5) * 1.0;
      const heading = Math.cos(T * 0.63 + 1.2) > 0 ? 0 : Math.PI;
      for (let k = 0; k < SEG; k++) {
        const u = k / (SEG - 1), seg = Math.sin(u * Math.PI);
        put(whale, k, wx + Math.sin(T * 2 + u * 2.4) * 3 * u, wy + Math.sin(T * 2 - u * 1.8) * 1.4 * u,
          wz + (u - 0.5) * 150, 0, heading, 0, 4.6 * seg + 1.2, 3.0 * seg + 0.8, 7.5); // 体心 y<0：脊背微露
      }
      for (let f = 0; f < 3; f++) { // 背鳍三枚贴脊背（半沉后仍是最高读法点）
        const u = 0.3 + f * 0.2, seg = Math.sin(u * Math.PI);
        put(fins, f, wx + Math.sin(T * 2 + u * 2.4) * 3 * u, wy + Math.sin(T * 2 - u * 1.8) * 1.4 * u + (3.0 * seg + 0.8) * 0.92,
          wz + (u - 0.5) * 150, 0.25, heading, 0, 1.5 - f * 0.3, 1.5 - f * 0.3, 1.5 - f * 0.3);
      }
      const fwd = heading === 0 ? 1 : -1, hu = fwd > 0 ? 1 : 0; // 头角：锥体后掠一枚（复用鳍网格不增 draw call）
      put(fins, 3, wx + Math.sin(T * 2 + hu * 2.4) * 3 * hu, wy + 0.4, wz + (hu - 0.5) * 150 + fwd * 3, -0.6, heading, 0, 0.8, 0.8, 0.8);
      for (let k = 0; k < GLOW; k++) { // 书虫萤斑：贴脊背上侧错落，奇偶两组反相呼吸
        const g = glowR[k], seg = Math.sin(g.u * Math.PI);
        const gs = g.s * (0.6 + 0.4 * Math.sin(t * 1.4 + (k % 2) * Math.PI));
        put(glow, k, wx + Math.sin(T * 2 + g.u * 2.4) * 3 * g.u + g.lat,
          wy + Math.sin(T * 2 - g.u * 1.8) * 1.4 * g.u + (3.0 * seg + 0.8) * 0.85,
          wz + (g.u - 0.5) * 150, 0, 0, 0, gs, gs, gs);
      }
      whale.instanceMatrix.needsUpdate = true;
      fins.instanceMatrix.needsUpdate = true;
      glow.instanceMatrix.needsUpdate = true;
    },
  };
}
