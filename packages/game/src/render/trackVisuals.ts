/**
 * 道路视觉（docs/05 §4 场景元素）：地面、三车道（锥形引导条带，stormspire 另有湿路倒影与水洼粗糙度图）、护栏、流动虚线，以及侧景的天空穹顶。
 * 纯装饰层：只跟随插值距离滚动，不读玩法状态。
 * 侧景完全由真 3D 几何承担（见 sceneryProps.ts，贴图带方案已删）：视差来自相机透视，
 * 地平线由 far 排房屋与棕榈补住，天空由渐变穹顶收尾。
 * 跑道两侧的沙地网格固定，纹理随插值距离向后滚动，与虚线/侧景保持相同世界速度。
 */
import * as THREE from 'three';
import { createSceneryProps } from './sceneryProps.js';
import type { SceneryProps } from './sceneryProps.js';
import { makeRoadRoughnessTexture, ROAD_TILE_M } from './stormspire/roadTex.js';
import { applyWorldBend } from './stormspire/worldBend.js';

/** 虚线滚动回绕的总长与出画阈值（米） */
const DASH_LOOP = 192, DASH_RESET_Z = 10;

/** 地面贴图一块覆盖的世界尺寸（米），用于 repeat */
const GROUND_TILE_M = 6;

export interface TrackColors {
  baseColor: string;
  flashColor: string;
  tint: string;
  groundColor?: string;
  /** 天空穹顶渐变：天顶色 / 地平线色（缺省回退 baseColor） */
  sky?: { zenith?: string; horizon?: string };
}

/** 天空穹顶：竖直渐变（天顶蓝 → 地平线雾色），贴图带顶边渐隐后溶进这里 */
function addSkyDome(scene: THREE.Scene, zenith: string, horizon: string): THREE.ShaderMaterial {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      top: { value: new THREE.Color(zenith) },
      bottom: { value: new THREE.Color(horizon) },
    },
    vertexShader: 'varying float vY; void main(){ vY = normalize(position).y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying float vY; void main(){ float t = clamp(vY * 1.6 + 0.10, 0.0, 1.0); gl_FragColor = vec4(mix(bottom, top, pow(t, 0.85)), 1.0); }',
  });
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(150, 24, 16), mat));
  return mat;
}

/**
 * 程序化地面纹理（细砂粒 + 大小块干湿不匀）：免素材、可平铺，消掉纯色地面的塑料感。
 * ⚠️ 这张图**只管明暗、不管色调**（三通道近等值，冷暖各偏 ≤7%）：它要和主题的 groundColor 相乘。
 * 早先它自带沙色（b×0.66），于是雨夜便利店配的深蓝灰被乘成一地 muddy 色斑（用户 2026-10-13 截图点名）；
 * 色调交回主题配置，这里只留明度起伏（均值仍取 0.86，免得两个主题的亮度一起跳档）。
 * 斑块用整数周期正弦 ⇒ 60×240m 平铺出去不会在接缝处露出格纹。
 */
function makeGroundTexture(): THREE.DataTexture {
  const N = 128;
  const data = new Uint8Array(N * N * 4);
  const hash = (x: number, y: number) => {
    const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return s - Math.floor(s);
  };
  const blob = (x: number, y: number, fx: number, fy: number) =>
    Math.sin(((x / N) * fx + hash(fx, fy)) * 6.2832) * Math.cos(((y / N) * fy + hash(fy, fx)) * 6.2832);

  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const grain = 0.62 * hash(x, y) + 0.38 * hash(x >> 2, y >> 2);
    const mottle = blob(x, y, 1, 2) * 0.5 + blob(x, y, 3, 5) * 0.3 + blob(x, y, 7, 11) * 0.2;
    const lum = 0.8 + grain * 0.09 + mottle * 0.07;                          // 均值 0.86，同旧版
    const warm = Math.max(0, mottle), cool = Math.max(0, -mottle);
    const i = (y * N + x) * 4;
    data[i] = Math.min(255, 255 * lum * (1 + warm * 0.05 - cool * 0.02));
    data[i + 1] = Math.min(255, 255 * lum * (1 - (warm + cool) * 0.012));
    data[i + 2] = Math.min(255, 255 * lum * (1 + cool * 0.07 - warm * 0.04));
    data[i + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

/** 车道线锥形剖面（z 从近到远，米）：近端宽 0.09 → -60m 0.055 → -110m 0.035 后保持——
 *  远缩比贴合车道线的真实透视收窄，是"向远方汇聚"的引导线主体（用户点名要强化透视感）。
 *  alpha 近端 0.85（同旧版不透明度）随距离渐弱，z<-130 后收向 0.25 不清零：引导线要一路指进雾里。 */
interface StripPoint { z: number; halfW: number; a: number }
const LINE_PROFILE: readonly StripPoint[] = [
  { z: 8, halfW: 0.045, a: 0.85 },
  { z: -60, halfW: 0.0275, a: 0.62 },
  { z: -110, halfW: 0.0175, a: 0.48 },
  { z: -130, halfW: 0.0175, a: 0.4 },
  { z: -150, halfW: 0.0175, a: 0.25 },
];

/** 剖面取值：z 落在两锚点之间线性插值，越过远端保持末锚（宽度"之后保持"的口径） */
function profileAt(z: number, key: 'halfW' | 'a'): number {
  const P = LINE_PROFILE;
  if (z >= P[0].z) return P[0][key];
  for (let i = 0; i < P.length - 1; i++) {
    if (z >= P[i + 1].z) {
      const t = (P[i].z - z) / (P[i].z - P[i + 1].z);
      return P[i][key] + (P[i + 1][key] - P[i][key]) * t;
    }
  }
  return P[P.length - 1][key];
}

/** 确定性随机（与 makeGroundTexture 的 hash 同族 sin-hash）：同种子恒同值，水洼断续免真随机 */
function detRnd(seed: number): number {
  const s = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** 锥形条带 BufferGeometry：XZ 直铺（y=0 免旋转，Basic 材质不需要法线），控制点连成左右顶点对，
 *  RGBA 顶点色烘死距离渐变（three 对 itemSize=4 的 color attribute 启用顶点 alpha）。
 *  车道主线与湿路倒影共用此配方（倒影只换宽度/alpha 剖面）；构建期一次生成，每帧零更新零分配。 */
function buildTaperedStrip(pts: readonly StripPoint[], color: THREE.Color): THREE.BufferGeometry {
  const n = pts.length;
  const pos = new Float32Array(n * 6), col = new Float32Array(n * 8), idx = new Uint16Array((n - 1) * 6);
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    pos.set([-p.halfW, 0, p.z, p.halfW, 0, p.z], i * 6);
    for (let v = 0; v < 2; v++) col.set([color.r, color.g, color.b, p.a], i * 8 + v * 4);
    if (i < n - 1) idx.set([i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2], i * 6);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 4));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}

/** 假弯道用（仅 stormspire 构建期调用）：把锥形剖面锚点按 ≤stepM 间距线性加密（halfW/a 随 z 内插）。
 *  弯曲是 per-vertex 的：5 锚点里最长一段 68m 会被 GPU 拉成弦线，与加密后的路面在中景脱开
 *  ~0.5m；加密到 6m 段后弦差 <1cm（弦差 ≈ 曲率·段长²/8，见 worldBend.ts 的 k² 曲线口径）。 */
function densifyProfile(pts: readonly StripPoint[], stepM: number): StripPoint[] {
  const out: StripPoint[] = [pts[0]];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i], p1 = pts[i + 1];
    const n = Math.ceil((p0.z - p1.z) / stepM);
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      out.push({ z: p0.z + (p1.z - p0.z) * t, halfW: p0.halfW + (p1.halfW - p0.halfW) * t, a: p0.a + (p1.a - p0.a) * t });
    }
  }
  return out;
}

export function createTrackVisuals(scene: THREE.Scene, laneWidth: number, colors: TrackColors,
  /** 主题 config 的 scenery 字段：选哪一套跑道侧景道具（缺省 seaside，未登记的 id 两侧为空） */
  scenery: string = 'seaside',
  /** M1 门控契约：features.wetRoad=湿路系统总闸（车道线倒影 + 路面水洼 roughnessMap），由 theme.features 派生 */
  features?: { wetRoad?: boolean },
) {
  const roadWidth = 3 * laneWidth + 1.2;
  // 假弯道（渲染层 world-bend，见 stormspire/worldBend.ts 与 titan 呼吸远场）：stormspire/titan 注入弯道材质，
  // 并把长面片按纵深加密分段（其余主题几何/着色路径与旧版一致，零 shader 开销）
  const deep = scenery === 'stormspire' || scenery === 'titan';
  const wet = features?.wetRoad ?? false;
  const zenith = colors.sky?.zenith ?? colors.baseColor;
  const horizon = colors.sky?.horizon ?? colors.baseColor;
  const skyDome = addSkyDome(scene, zenith, horizon);
  const zenithBase = new THREE.Color(zenith);
  const horizonBase = new THREE.Color(horizon);

  const groundTex = makeGroundTexture();
  groundTex.repeat.set(60 / GROUND_TILE_M, 240 / GROUND_TILE_M);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(60, 240, 1, deep ? 48 : 1),
    new THREE.MeshStandardMaterial({ map: groundTex, color: new THREE.Color(colors.groundColor ?? '#E3CFA4'), roughness: 0.95 })
  );
  ground.rotation.x = -Math.PI / 2; ground.position.set(0, -0.02, -100); scene.add(ground);

  const roadMat = new THREE.MeshStandardMaterial({ color: 0x18233c, roughness: 0.85 });
  // 湿路水洼（theme.features.wetRoad 总闸；其它主题不建图，road 材质与旧版完全一致）：程序化粗糙度图 + envMap 强度预留。
  // roughnessMap 与 material.roughness 相乘 ⇒ 挂图时基线调 1.0，绝对粗糙度全部由图承载（基底 0.92 / 水洼 0.15，见 roadTex.ts）。
  // envMapIntensity 0.6：envMap 本体由 runnerScene 接进 scene.environment，这里只留强度（metalness 保持 0）。
  let roadRoughTex: THREE.DataTexture | null = null;
  if (wet) {
    roadRoughTex = makeRoadRoughnessTexture(roadWidth);
    roadMat.roughnessMap = roadRoughTex;
    roadMat.roughness = 1;
    roadMat.envMapIntensity = 0.6;
  }
  const road = new THREE.Mesh(new THREE.PlaneGeometry(roadWidth, 240, 1, deep ? 48 : 1), roadMat);
  road.rotation.x = -Math.PI / 2; road.position.set(0, 0, -100); scene.add(road);

  // 车道线：锥形条带 + 顶点色距离渐变（口径见 LINE_PROFILE 注释），4 条共享同一份几何/材质。
  // fog 关闭：开雾会把远端金线融成与雾后路面同色（=隐形），"指进雾里"的残 alpha 0.25 就失去意义。
  const laneOffsets = [-1.5, -0.5, 0.5, 1.5];
  const tintCol = new THREE.Color(colors.tint);
  const lineGeo = buildTaperedStrip(deep ? densifyProfile(LINE_PROFILE, 6) : LINE_PROFILE, tintCol);
  const lineMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, fog: false, side: THREE.DoubleSide });
  for (const l of laneOffsets) {
    const line = new THREE.Mesh(lineGeo, lineMat);
    line.position.set(l * laneWidth, 0.012, 0); scene.add(line);
  }

  // 湿路面假倒影（theme.features.wetRoad 总闸；其它主题不进此分支，零新增对象）：主线同配方条带摊在路面上。
  // y=0.004：主线 0.012 的镜像下移位再抬 2mm——在路面（y=0）之上不被遮挡，又低于虚线 0.014；
  // 宽 ×2.2（湿面漫射把光带摊宽）、加色混合、峰值 alpha 0.14、depthWrite 关（加色不拦截后方排序）。
  // 沿 z 确定性正弦揉出 2~3 段明暗断续（像水洼把倒影揉碎），且在条带 0.55 长度处即完全隐没——
  // 比主线（残 0.25 一路到 -150m）消失得更快，透视感更强。颜色用主题 vfxTint，不出调色板。
  if (wet) {
    const reflMat = new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, fog: false, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    applyWorldBend(reflMat); // 倒影条带与主线同弯（4m 步进已够密，弦差 ~4mm）
    const nearZ = LINE_PROFILE[0].z, farZ = LINE_PROFILE[LINE_PROFILE.length - 1].z;
    const fadeSpan = (nearZ - farZ) * 0.55; // ≈87m：倒影在此完全归零（比主线渐隐快近一倍）
    for (let i = 0; i < laneOffsets.length; i++) {
      // 每条线独立相位/微差频率（确定性 sin-hash）：正弦周期 30~40m ⇒ 全程 2~3 段明暗断续
      const freq = 0.16 + detRnd(i * 7 + 1) * 0.05, phase = detRnd(i * 7 + 2) * 6.283;
      const pts: StripPoint[] = [];
      for (let z = nearZ; z >= nearZ - fadeSpan; z -= 4) {
        const puddle = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(z * freq + phase)); // 明 1.0 / 暗 0.35
        pts.push({ z, halfW: profileAt(z, 'halfW') * 2.2, a: 0.14 * (1 - (nearZ - z) / fadeSpan) * puddle });
      }
      pts.push({ z: nearZ - fadeSpan, halfW: profileAt(nearZ - fadeSpan, 'halfW') * 2.2, a: 0 }); // 末端精确收零
      const refl = new THREE.Mesh(buildTaperedStrip(pts, tintCol), reflMat);
      refl.position.set(laneOffsets[i] * laneWidth, 0.004, 0); scene.add(refl);
    }
  }

  const railMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(colors.flashColor), transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending });
  for (const side of [-1, 1]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 240, 1, 1, deep ? 48 : 1), railMat);
    m.position.set(side * (roadWidth / 2 + 0.25), 0.34, -100); scene.add(m);
  }

  // 流动虚线：每车道 16 段，随距离循环滚动，制造速度感
  const dashGeo = new THREE.PlaneGeometry(0.5, 0.07);
  const dashMat = new THREE.MeshBasicMaterial({ color: 0x40598c, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending });
  const dashes: THREE.Mesh[] = [];
  for (const lane of [-1, 0, 1]) for (let i = 0; i < 16; i++) {
    const d = new THREE.Mesh(dashGeo, dashMat);
    d.rotation.x = -Math.PI / 2; d.position.set(lane * laneWidth, 0.014, -190 + i * 12); scene.add(d); dashes.push(d);
  }

  // 雷脊假弯道：地面/路面/车道线/虚线/护栏全部注入（倒影条带已在其分支注入）——这是「弯带」的
  // 内层；金币/障碍/侧景按同一 f(z) 在外层同弯，同 z 同偏移，谁也不跟谁分家（安全边界见
  // worldBend.ts：玩家前方 18m 内 k=0 恒直，判定区所见即判定）。天空穹顶/雨/闪电/角色不注入。
  if (deep) {
    applyWorldBend(ground.material as THREE.Material);
    applyWorldBend(roadMat);
    applyWorldBend(lineMat);
    applyWorldBend(railMat);
    applyWorldBend(dashMat);
  }

  // 侧景全部由真 3D 几何承担（近景小件 + 中景房屋/棕榈 + 远景房屋/棕榈），道具集由主题 scenery 选定
  const props: SceneryProps = createSceneryProps(scene, scenery);

  let lastDist = 0, disposed = false;
  return {
    setFlash(flash: number, tint: THREE.Color) {
      const amount = 0.85 * flash;
      (skyDome.uniforms['top'].value as THREE.Color).copy(zenithBase).lerp(tint, amount);
      (skyDome.uniforms['bottom'].value as THREE.Color).copy(horizonBase).lerp(tint, amount);
    },
    /** 用插值距离推动沙地纹理、虚线与侧景滚动（与角色同步，不掉帧抖动）；t 给侧景里那些按秒动的动件 */
    update(dist: number, t: number = 0) {
      const move = dist - lastDist; lastDist = dist;
      // 地面旋转后 UV 的 v 轴朝 -Z；正偏移让草斑向 +Z（角色身后）移动。
      // 每 6m 平铺一轮，按绝对距离取相位：不累积漂移，也不移走地面网格露出边缘。
      groundTex.offset.y = (dist % GROUND_TILE_M) / GROUND_TILE_M;
      if (roadRoughTex) roadRoughTex.offset.y = (dist % ROAD_TILE_M) / ROAD_TILE_M; // 水洼随路面向 +Z 滚动（同地面相位公式）
      for (const d of dashes) {
        d.position.z += move;
        if (d.position.z > DASH_RESET_Z) d.position.z -= DASH_LOOP;
      }
      props.update(move, t);
    },
    /** 本 track 持有的草地/水洼纹理与侧景道具纹理按局释放；几何/材质由 runnerScene 统一清理。 */
    dispose() {
      if (disposed) return;
      disposed = true;
      groundTex.dispose();
      roadRoughTex?.dispose(); // stormspire 水洼粗糙度图进 dispose 清单
      props.dispose?.();
    },
  };
}
