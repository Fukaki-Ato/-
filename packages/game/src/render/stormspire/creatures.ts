/**
 * 天穹雷脊 · 生物（docs/stormspire-brief.md §5）：
 *   rays       风暴魟 3 群 × 40：参数化群飞（不是真 boid——零分配零 O(n²)，观感等价），
 *              每群绕自己的游移中心盘旋（鼻向跟随盘旋切线）+ 个体相位错开的正弦摆翼，
 *              路径穿插岛链与塔间；每魟尾后一枚小金点尾迹（第二套 InstancedMesh，
 *              位置=鼻向反方向偏移、随摆翼相位微摆；材质统一 opacity 0.85 逐帧不动）；
 *   leviathan  云渊鲸：12 节球体脊椎 + 背鳍 + 头部短角（复用鳍 mesh，不增 draw call），
 *              只以深渊靛剪影呈现（禁细节，神秘感靠看不清）；体侧 24 枚藤壶金斑贴脊椎
 *              上侧错落横偏，奇偶两组尺寸 sin 互补呼吸；巡游椭圆拉近一档（x 40 / z -85），
 *              每 ~70s 完整一圈，近侧掠过视野边缘。
 * 每帧重写实例矩阵（魟 3×40 + 尾迹 120，鲸 16 + 藤壶 24，量小）；不读 sim。
 */
import * as THREE from 'three';
import { LOOP, WRAP_Z, rnd, std } from '../sceneryProps.js';
import { P } from './palette.js';

const SCHOOLS = 3, PER = 40;

export function createCreatures(scene: THREE.Scene) {
  // ---- 风暴魟 ----
  // 蝠形：四棱锥压扁 + 绕 z 摆翼（矩阵内 scale 拉宽）
  const rayGeo = new THREE.ConeGeometry(0.5, 1.7, 4);
  rayGeo.rotateX(Math.PI / 2); // 锥尖朝 +Z（鼻向），尾迹金点取鼻向反方向
  const schoolMeshes: THREE.InstancedMesh[] = [];
  const schoolDef = Array.from({ length: SCHOOLS }, (_, j) => ({
    cx: (j % 2 === 0 ? -1 : 1) * (14 + rnd(j, 81) * 8),   // 群心横向
    cy: 2.5 + rnd(j, 83) * 5.5,                            // 群心高度（岛链之间）
    z: -30 - j * 78 - rnd(j, 85) * 12,                     // 群心锚 z（随 LOOP 回收）
    spin: 0.25 + rnd(j, 87) * 0.15,                        // 盘旋角速度
    wob: 0.5 + rnd(j, 89) * 0.3,                           // 群心游移频率
  }));
  const birdR = Array.from({ length: SCHOOLS * PER }, (_, i) => ({
    r: 2 + rnd(i, 91) * 4.5,          // 个体盘旋半径
    a: rnd(i, 93) * 6.283,            // 初始相位
    vy: (rnd(i, 95) - 0.5) * 2.6,     // 高度错层
    flap: 2.4 + rnd(i, 97) * 1.6,     // 摆翼频率
    s: (0.55 + rnd(i, 99) * 0.5) * 1.1, // 体型（+10%，近景读得出轮廓与拍翼）
    d: 0.12 + rnd(i, 101) * 0.06,     // 尾迹金点半径
  }));
  for (let j = 0; j < SCHOOLS; j++) {
    const mesh = new THREE.InstancedMesh(rayGeo, std(P.storm), PER);
    scene.add(mesh);
    schoolMeshes.push(mesh);
  }
  // 尾迹金点：全群共享一套 InstancedMesh（1 个 draw call）；发光只认熔金（加色混合）
  const tails = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 6, 4),
    new THREE.MeshBasicMaterial({ color: P.gold, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending }),
    SCHOOLS * PER);
  tails.frustumCulled = false;
  scene.add(tails);

  // ---- 云渊鲸（剪影 + 微光）----
  const SEG = 12;
  const whale = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6),
    new THREE.MeshLambertMaterial({ color: P.abyss }), SEG);
  scene.add(whale);
  const fins = new THREE.InstancedMesh(new THREE.ConeGeometry(0.5, 2.2, 4), std(P.abyss), 4); // 第 4 枚：头部短角
  scene.add(fins);
  // 体侧藤壶金斑 24 枚：贴脊椎上侧错落横偏；奇偶两组尺寸反相呼吸（只动实例矩阵，材质逐帧不变）
  const BARN = 24;
  const barns = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 6, 4),
    new THREE.MeshBasicMaterial({ color: P.gold, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending }),
    BARN);
  barns.frustumCulled = false;
  scene.add(barns);
  const barnR = Array.from({ length: BARN }, (_, i) => ({
    u: 0.1 + (i / BARN) * 0.78 + (rnd(i, 201) - 0.5) * 0.05, // 脊椎 u 采样点（错落）
    lat: (rnd(i, 203) - 0.5) * 2.4,                          // 横向错偏（体侧散布）
    zj: (rnd(i, 205) - 0.5) * 1.6,                           // 纵向微错
    s: 0.2 + rnd(i, 207) * 0.14,                             // 基础尺寸
  }));

  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), V = new THREE.Vector3(), S = new THREE.Vector3();
  const compose = (mesh: THREE.InstancedMesh, i: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => {
    E.set(rx, ry, rz, 'YXZ'); Q.setFromEuler(E);
    V.set(x, y, z); S.set(sx, sy, sz);
    M.compose(V, Q, S);
    mesh.setMatrixAt(i, M);
  };

  return {
    update(move: number, t: number) {
      // 风暴魟：群心随 LOOP 回收 + 缓慢游移；个体绕群心螺旋（ry=-a 使鼻向贴合切线）
      for (let j = 0; j < SCHOOLS; j++) {
        const sd = schoolDef[j];
        sd.z += move;
        if (sd.z > WRAP_Z) sd.z -= LOOP;
        const cx = sd.cx + Math.sin(t * sd.wob + j * 2.1) * 3.5;
        const cy = sd.cy + Math.sin(t * sd.wob * 0.7 + j) * 1.2;
        for (let k = 0; k < PER; k++) {
          const b = birdR[j * PER + k];
          const a = b.a + t * sd.spin;
          const flap = Math.sin(t * b.flap + b.a * 3.0) * 0.35;
          compose(schoolMeshes[j], k,
            cx + Math.cos(a) * b.r, cy + b.vy + Math.sin(a * 2) * 0.8, sd.z + Math.sin(a) * b.r * 0.7,
            flap * 0.4, -a, flap, b.s, b.s * (0.5 + flap * 0.3), b.s * 1.6);
          // 尾迹金点：沿鼻-尾轴取鼻向反方向偏移 rear（鼻向=(-sin a, cos a)），随拍翼微摆
          const rear = b.s * 1.5 + 0.4 + flap * 0.25;
          compose(tails, j * PER + k,
            cx + Math.cos(a) * b.r + Math.sin(a) * rear,
            cy + b.vy + Math.sin(a * 2) * 0.8 + flap * 0.14,
            sd.z + Math.sin(a) * b.r * 0.7 - Math.cos(a) * rear,
            0, 0, 0, b.d, b.d, b.d);
        }
        schoolMeshes[j].instanceMatrix.needsUpdate = true;
      }
      tails.instanceMatrix.needsUpdate = true;
      // 云渊鲸：大椭圆剪影巡游（拉近一档：x 40..60 / z -130..-40，仍在远雾带，一圈 ~70s）
      const T = t * 0.09;
      const wx = 40 + 20 * Math.sin(T);
      const wz = -85 + 45 * Math.sin(T * 0.63 + 1.2);
      const wy = 6 + Math.sin(T * 0.5) * 3;
      const heading = Math.cos(T * 0.63 + 1.2) > 0 ? 0 : Math.PI;
      for (let k = 0; k < SEG; k++) {
        const u = k / (SEG - 1);
        const seg = Math.sin(u * Math.PI);
        compose(whale, k,
          wx + Math.sin(T * 2 + u * 2.4) * 3 * u,               // 脊椎侧摆（游动波）
          wy + Math.sin(T * 2 - u * 1.8) * 1.4 * u,
          wz + (u - 0.5) * 34,
          0, heading, 0,
          3.4 * seg + 0.7, (2.6 * seg + 0.6) * 0.9, 1.9);
      }
      // 背鳍三枚贴脊背
      for (let f = 0; f < 3; f++) {
        const u = 0.3 + f * 0.2;
        E.set(0, heading, -0.25); Q.setFromEuler(E);
        V.set(wx + Math.sin(T * 2 + u * 2.4) * 3 * u, wy + 2.2 + Math.sin(T * 2 - u * 1.8) * 1.4 * u, wz + (u - 0.5) * 34);
        S.set(1.6 - f * 0.3, 1.6 - f * 0.3, 1.6 - f * 0.3);
        M.compose(V, Q, S);
        fins.setMatrixAt(f, M);
      }
      // 头部短角：锥体剪影一枚（复用鳍 mesh）；rx=-0.6 使角尖后掠（ry 翻转 PI 时 z 分量同步翻转，两航向皆后掠）
      const fwd = heading === 0 ? 1 : -1;          // 前进方向：+Z / -Z
      const hu = fwd > 0 ? 1 : 0;                  // 头端所在 u
      E.set(-0.6, heading, -0.25); Q.setFromEuler(E);
      V.set(
        wx + Math.sin(T * 2 + hu * 2.4) * 3 * hu,
        wy + 0.55 + Math.sin(T * 2 - hu * 1.8) * 1.4 * hu,
        wz + (hu - 0.5) * 34 + fwd * 1.2);
      S.set(0.55, 0.55, 0.55);
      M.compose(V, Q, S);
      fins.setMatrixAt(3, M);
      // 体侧藤壶金斑：每帧按现有脊椎公式取 u 采样定位（上侧 0.95 体高，微离体面避 z 冲突）
      for (let k = 0; k < BARN; k++) {
        const b = barnR[k];
        const seg = Math.sin(b.u * Math.PI);
        const pulse = 0.5 + 0.5 * Math.sin(t * 1.6 + (k % 2) * Math.PI); // 奇偶两组反相呼吸
        const bs = b.s * (0.7 + 0.5 * pulse);
        compose(barns, k,
          wx + Math.sin(T * 2 + b.u * 2.4) * 3 * b.u + b.lat,
          wy + Math.sin(T * 2 - b.u * 1.8) * 1.4 * b.u + (2.6 * seg + 0.6) * 0.95,
          wz + (b.u - 0.5) * 34 + b.zj,
          0, 0, 0, bs, bs, b.s);
      }
      fins.instanceMatrix.needsUpdate = true;
      whale.instanceMatrix.needsUpdate = true;
      barns.instanceMatrix.needsUpdate = true;
    },
  };
}
