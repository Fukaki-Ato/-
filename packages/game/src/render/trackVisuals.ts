/**
 * 道路视觉（docs/05 §4 场景元素）：地面、三车道、护栏、流动虚线，以及侧景的天空穹顶。
 * 纯装饰层：只跟随插值距离滚动，不读玩法状态。
 * 侧景完全由真 3D 几何承担（见 sceneryProps.ts，贴图带方案已删）：视差来自相机透视，
 * 地平线由 far 排房屋与棕榈补住，天空由渐变穹顶收尾。
 * 跑道两侧的沙地网格固定，纹理随插值距离向后滚动，与虚线/侧景保持相同世界速度。
 */
import * as THREE from 'three';
import { createSceneryProps } from './sceneryProps.js';
import type { SceneryProps } from './sceneryProps.js';

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
function addSkyDome(scene: THREE.Scene, zenith: string, horizon: string) {
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
}

/** 程序化沙地纹理（值噪声+稀疏草斑）：免素材、可平铺，消掉纯色地面的塑料感 */
function makeGroundTexture(): THREE.DataTexture {
  const N = 128;
  const data = new Uint8Array(N * N * 4);
  const hash = (x: number, y: number) => {
    const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return s - Math.floor(s);
  };
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const grain = 0.62 * hash(x, y) + 0.38 * hash(x >> 2, y >> 2);
    const patch = hash(x / 6 | 0, y / 6 | 0) > 0.9;
    const base = 202 + grain * 36;
    let r = base, g = base * 0.89, b = base * 0.66;
    if (patch) { r *= 0.84; g *= 0.97; b *= 0.74; }
    const i = (y * N + x) * 4;
    data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
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

export function createTrackVisuals(scene: THREE.Scene, laneWidth: number, colors: TrackColors) {
  const roadWidth = 3 * laneWidth + 1.2;
  addSkyDome(scene, colors.sky?.zenith ?? colors.baseColor, colors.sky?.horizon ?? colors.baseColor);

  const groundTex = makeGroundTexture();
  groundTex.repeat.set(60 / GROUND_TILE_M, 240 / GROUND_TILE_M);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(60, 240),
    new THREE.MeshStandardMaterial({ map: groundTex, color: new THREE.Color(colors.groundColor ?? '#E3CFA4'), roughness: 0.95 })
  );
  ground.rotation.x = -Math.PI / 2; ground.position.set(0, -0.02, -100); scene.add(ground);

  const road = new THREE.Mesh(
    new THREE.PlaneGeometry(roadWidth, 240),
    new THREE.MeshStandardMaterial({ color: 0x18233c, roughness: 0.85 })
  );
  road.rotation.x = -Math.PI / 2; road.position.set(0, 0, -100); scene.add(road);

  const lineMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(colors.tint), transparent: true, opacity: 0.85 });
  for (const l of [-1.5, -0.5, 0.5, 1.5]) {
    const line = new THREE.Mesh(new THREE.PlaneGeometry(0.07, 240), lineMat);
    line.rotation.x = -Math.PI / 2; line.position.set(l * laneWidth, 0.012, -100); scene.add(line);
  }

  const railMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(colors.flashColor), transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending });
  for (const side of [-1, 1]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 240), railMat);
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

  // 侧景全部由真 3D 几何承担（近景小件 + 中景房屋/棕榈 + 远景房屋/棕榈），见 sceneryProps
  const props: SceneryProps = createSceneryProps(scene);

  let lastDist = 0;
  return {
    /** 用插值距离推动沙地纹理、虚线与侧景滚动（与角色同步，不掉帧抖动） */
    update(dist: number) {
      const move = dist - lastDist; lastDist = dist;
      // 地面旋转后 UV 的 v 轴朝 -Z；正偏移让草斑向 +Z（角色身后）移动。
      // 每 6m 平铺一轮，按绝对距离取相位：不累积漂移，也不移走地面网格露出边缘。
      groundTex.offset.y = (dist % GROUND_TILE_M) / GROUND_TILE_M;
      for (const d of dashes) {
        d.position.z += move;
        if (d.position.z > DASH_RESET_Z) d.position.z -= DASH_LOOP;
      }
      props.update(move);
    },
  };
}
