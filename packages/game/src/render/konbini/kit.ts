/**
 * 微缩场景建模基元（render 层，零贴图零宿主 API，纯手写）。
 * 思路：一座「雨夜便利店街角」由几百个小方块组成，逐个建 Mesh 会有几百个 draw call（微信低端机直接卡死）。
 * 这里按三种材质分桶——body（受光，三渲二分段光）/ glow（自发光，不吃光照，霓虹与店内灯光）/
 * glass（半透明玻璃）——每桶把全部小方块**合并成一份几何体**，再用 InstancedMesh 复制摆放，
 * 于是整座街角（含店内全部陈设）只有 3 个 draw call，且 N 家店共用同一份顶点数据（省内存的关键）。
 * 会动的部件（雨丝/水滴/涟漪/门扇/信号灯）另走 Layer：一份几何 + 每帧按 f(i,t) 重写实例矩阵。
 */
import * as THREE from 'three';

export type Bucket = 'body' | 'glow' | 'glass';

/**
 * 实例摆放：ry 绕世界 y（朝向就靠它），s 等比缩放，
 * sway 绕世界 x 的倾角——风动件用它做「整片朝同一方向轻微倒」，比各自乱歪更像被风吹；
 * roll 绕自身 z（欧拉序 YXZ 下即局部滚转），海鸥的翅膀靠它扇动。
 */
export interface Spot { x: number; y: number; z: number; ry: number; s: number; sway?: number; roll?: number }

interface Part { geo: THREE.BufferGeometry; col: THREE.Color }

/** 部件姿态：旋转顺序 X→Z→Y（先自己歪，再立起来，最后转向），最后平移到 (x,y,z)；q 给定四元数时优先用它 */
export interface Pose { rx?: number; ry?: number; rz?: number; q?: THREE.Quaternion }

/** 三渲二分阶渐变图（程序生成 4 档，无素材）：暗面/中间调/亮面/高光各一档，硬边界才有赛璐珞味 */
function toonRamp(): THREE.DataTexture {
  const v = [74, 138, 200, 255];
  const data = new Uint8Array(v.length * 4);
  v.forEach((n, i) => { data[i * 4] = n; data[i * 4 + 1] = n; data[i * 4 + 2] = n; data[i * 4 + 3] = 255; });
  const t = new THREE.DataTexture(data, v.length, 1, THREE.RGBAFormat);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

/**
 * 三种桶材质。
 * body 的 exposure 是「夜景总曝光」旋钮：局内灯光是按白天调的（hemi 1.15 + 主光 1.9），
 * 所以受光体整体乘暗，霓虹与店内灯全走 glow 桶保持常亮 ⇒ 不用动 runnerScene 就能出夜晚。
 */
export function toonMats(exposure = 0.52): Record<Bucket, THREE.Material> {
  return {
    body: new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: toonRamp(), color: new THREE.Color().setScalar(exposure) }),
    // 自发光桶故意不吃雾：夜里 100m 外那家便利店就该是一团亮光的剪影，
    // 跟着雾一起发灰发蓝的话，霓虹层就全白了（fog 只留给受光的建筑与街道）。
    glow: new THREE.MeshBasicMaterial({ vertexColors: true, fog: false }),
    glass: new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide }),
  };
}

/**
 * 地面光池（路灯洒在湿地上的那一圈）：径向衰减在片元里用 smoothstep 连算三次，
 * 不用贴图、也不用分层的同心圆 ⇒ 从亮心到边缘是连续过渡，肉眼找不到台阶（用户点名要「不要有明显分层」）。
 * 顺带按视距淡出：55m 外开始收，95m 完全消失，远处不会满屏白点。
 */
export function poolMat(color: THREE.ColorRepresentation, intensity = 1, near = 55, far = 95): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: {
      uColor: { value: new THREE.Color(color) }, uK: { value: intensity }, uNear: { value: near }, uFar: { value: far },
    },
    vertexShader: [
      'varying vec2 vUv; varying float vD;',
      'void main() {',
      '  vUv = uv;',
      '  vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);',
      '  vD = -mv.z;',
      '  gl_Position = projectionMatrix * mv;',
      '}',
    ].join('\n'),
    fragmentShader: [
      'uniform vec3 uColor; uniform float uK; uniform float uNear; uniform float uFar;',
      'varying vec2 vUv; varying float vD;',
      'void main() {',
      '  float r = length(vUv - 0.5) * 2.0;',
      '  float a = 1.0 - smoothstep(0.0, 1.0, r);',
      '  a = pow(a, 2.2);',                                        // 灯下最亮、向外连续衰减到 0，无同心圆台阶
      '  float k = a * uK * smoothstep(uFar, uNear, vD);',
      '  gl_FragColor = vec4(uColor * k, k);',
      '}',
    ].join('\n'),
  });
}

/** 把同桶全部方块并成一份几何体（position/normal/color + 索引；顶点色已是线性空间值） */
function mergeParts(parts: Part[]): THREE.BufferGeometry | null {
  if (!parts.length) return null;
  let vc = 0, ic = 0;
  for (const q of parts) {
    const n = (q.geo.getAttribute('position') as THREE.BufferAttribute).count;
    vc += n;
    ic += q.geo.index ? q.geo.index.count : n;   // 多面体类（Icosahedron）没有索引，按顺序补一条
  }
  const pos = new Float32Array(vc * 3), nor = new Float32Array(vc * 3), col = new Float32Array(vc * 3);
  const idx = vc > 65535 ? new Uint32Array(ic) : new Uint16Array(ic);
  let vo = 0, io = 0;
  for (const q of parts) {
    const p = q.geo.getAttribute('position') as THREE.BufferAttribute;
    const n = q.geo.getAttribute('normal') as THREE.BufferAttribute;
    (pos as Float32Array).set(p.array as Float32Array, vo * 3);
    (nor as Float32Array).set(n.array as Float32Array, vo * 3);
    for (let i = 0; i < p.count; i++) {
      col[(vo + i) * 3] = q.col.r; col[(vo + i) * 3 + 1] = q.col.g; col[(vo + i) * 3 + 2] = q.col.b;
    }
    if (q.geo.index) for (let i = 0; i < q.geo.index.count; i++) idx[io + i] = q.geo.index.getX(i) + vo;
    else for (let i = 0; i < p.count; i++) idx[io + i] = vo + i;
    // 游标按各自实际写入的量前进：方块 24 顶点却占 36 条索引，两处都按 p.count 走会把后一个部件的索引压花
    vo += p.count; io += q.geo.index ? q.geo.index.count : p.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

/** 一座微缩模型的累积器：建模函数只管往桶里塞方块，最后一次性出几何 */
export class Diorama {
  private parts: Record<Bucket, Part[]> = { body: [], glow: [], glass: [] };

  /** 通用入口：接住任意图元，摆到 (x,y,z) */
  add(b: Bucket, geo: THREE.BufferGeometry, c: THREE.ColorRepresentation, x: number, y: number, z: number, o: Pose = {}): this {
    if (o.q) geo.applyQuaternion(o.q);
    else {
      if (o.rx) geo.rotateX(o.rx);
      if (o.rz) geo.rotateZ(o.rz);
      if (o.ry) geo.rotateY(o.ry);
    }
    geo.translate(x, y, z);
    this.parts[b].push({ geo, col: new THREE.Color(c) });
    return this;
  }

  /** 两点之间的直杆：电线、自行车斜梁、空调铜管、花茎（自己算四元数与中点，调用方只报两端） */
  strut(b: Bucket, ax: number, ay: number, az: number, bx: number, by: number, bz: number,
    r: number, c: THREE.ColorRepresentation, seg = 6): this {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const dir = new THREE.Vector3(dx, dy, dz).divideScalar(len || 1);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    return this.add(b, new THREE.CylinderGeometry(r, r, len, seg), c, (ax + bx) / 2, (ay + by) / 2, (az + bz) / 2, { q });
  }

  /** 方块（本模块 95% 的部件都是它） */
  box(b: Bucket, w: number, h: number, d: number, x: number, y: number, z: number, c: THREE.ColorRepresentation, o: Pose = {}): this {
    return this.add(b, new THREE.BoxGeometry(w, h, d), c, x, y, z, o);
  }

  /** 水平薄板：地面/台面/屋顶/顶棚这类「一片」的东西，厚度固定 0.06 省参数 */
  slab(b: Bucket, w: number, d: number, x: number, y: number, z: number, c: THREE.ColorRepresentation, o: Pose = {}): this {
    return this.box(b, w, 0.06, d, x, y, z, c, o);
  }

  /** 竖直发光片/玻璃（朝 +z 的平面，ry 转向）：橱窗、招牌面、海报、地面反光条 */
  quad(b: Bucket, w: number, h: number, x: number, y: number, z: number, c: THREE.ColorRepresentation, o: Pose = {}): this {
    return this.add(b, new THREE.PlaneGeometry(w, h), c, x, y, z, { rx: o.rx, ry: o.ry, rz: o.rz });
  }

  /** 立着或躺着的圆柱（电线杆/垃圾桶/自行车轮/关东煮锅），rz=π/2 让它躺下 */
  cyl(b: Bucket, rt: number, rb: number, h: number, seg: number, x: number, y: number, z: number, c: THREE.ColorRepresentation, o: Pose = {}): this {
    return this.add(b, new THREE.CylinderGeometry(rt, rb, h, seg), c, x, y, z, o);
  }

  /**
   * 有机团块（树冠、灌木、绣球、花盆里的土）：二十面体细分 0/1 出来是「多面圆丘」，
   * 既不是方块也不是光滑球，正好是三渲二里最耐看的那种叶团；三个半径分开给，能压扁能拉长。
   */
  blob(b: Bucket, rx: number, ry: number, rz: number, x: number, y: number, z: number,
    c: THREE.ColorRepresentation, detail = 1, o: Pose = {}): this {
    const g = new THREE.IcosahedronGeometry(1, detail);
    g.scale(rx, ry, rz);
    return this.add(b, g, c, x, y, z, o);
  }

  /** 尖叶/草叶/花瓣：三棱锥，细腰 + 尖头，歪着插出去就是一簇草 */
  spike(b: Bucket, r: number, h: number, x: number, y: number, z: number, c: THREE.ColorRepresentation, o: Pose = {}): this {
    return this.add(b, new THREE.ConeGeometry(r, h, 3), c, x, y, z, o);
  }

  /**
   * 小椭圆体（花瓣、叶片、花心、草穗这类「十几厘米的东西」）：4×2 段的球只有 15 个顶点，
   * 比二十面体（60 顶点）便宜四倍，而这个尺寸下肉眼分不出差别——花草要密，单价必须先压下来。
   */
  oval(b: Bucket, rx: number, ry: number, rz: number, x: number, y: number, z: number,
    c: THREE.ColorRepresentation, o: Pose = {}): this {
    const g = new THREE.SphereGeometry(1, 4, 2);
    g.scale(rx, ry, rz);
    return this.add(b, g, c, x, y, z, o);
  }

  /** 出几何体（桶是空的就返回 null，调用方跳过该桶） */
  geometry(b: Bucket): THREE.BufferGeometry | null { return mergeParts(this.parts[b]); }

  /** 三个桶各出一个 InstancedMesh ⇒ 一座模型 = 最多 3 个 draw call */
  place(scene: THREE.Scene, mats: Record<Bucket, THREE.Material>, at: Spot[], buckets: Bucket[] = ['body', 'glow', 'glass']): THREE.InstancedMesh[] {
    const out: THREE.InstancedMesh[] = [];
    for (const b of buckets) {
      const geo = this.geometry(b);
      if (geo) out.push(instanceAt(scene, geo, mats[b], at));
    }
    return out;
  }
}

const M4 = new THREE.Matrix4();
const QQ = new THREE.Quaternion();
const VV = new THREE.Vector3();
const SS = new THREE.Vector3();
const EE = new THREE.Euler(0, 0, 0, 'YXZ');

/** 按 Spot 写第 i 个实例矩阵（静态摆放与每帧动画共用） */
export function writeSpot(mesh: THREE.InstancedMesh, i: number, p: Spot): void {
  EE.set(p.sway ?? 0, p.ry, p.roll ?? 0);
  QQ.setFromEuler(EE);
  VV.set(p.x, p.y, p.z);
  SS.set(p.s, p.s, p.s);
  M4.compose(VV, QQ, SS);
  mesh.setMatrixAt(i, M4);
}

/** 静态实例组：一份几何复制 n 份摆好（同一家便利店在两侧重复出现就靠它） */
export function instanceAt(scene: THREE.Scene, geo: THREE.BufferGeometry, mat: THREE.Material, at: Spot[]): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geo, mat, at.length);
  for (let i = 0; i < at.length; i++) writeSpot(mesh, i, at[i]);
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false; // 实例散布在整条跑道上，包围球算不准，逐个交给 GPU 裁
  scene.add(mesh);
  return mesh;
}

/**
 * 动画层：每帧把 place(i, t, spot) 的结果写回实例矩阵。
 * 雨丝 300 根、涟漪 40 圈都走这条路——一次 setMatrixAt 是几十纳秒级，比建 300 个 Mesh 便宜三个数量级。
 */
export class Layer {
  readonly mesh: THREE.InstancedMesh;
  private spot: Spot = { x: 0, y: 0, z: 0, ry: 0, s: 1 };

  constructor(scene: THREE.Scene, geo: THREE.BufferGeometry, mat: THREE.Material, n: number,
    private place: (i: number, t: number, out: Spot) => void) {
    this.mesh = instanceAt(scene, geo, mat, Array.from({ length: n }, () => ({ ...this.spot })));
  }

  update(t: number): void {
    for (let i = 0; i < this.mesh.count; i++) {
      this.place(i, t, this.spot);
      writeSpot(this.mesh, i, this.spot);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** 逐实例染色（信号灯三盏、招牌按店错相闪烁用）：材质需支持 instanceColor（Basic/Toon 都行） */
  tint(i: number, c: THREE.Color): void {
    this.mesh.setColorAt(i, c);
  }

  flushColors(): void {
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

/** 确定性伪随机：同一个下标永远同一个数，雨滴不会因为每帧换数而抖（与 sceneryProps 同一手法） */
export const rnd = (i: number, salt: number): number => {
  const s = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return s - Math.floor(s);
};
