/**
 * 主题 IBL 环境贴图（门控契约统一，roadmap M1 共享底座）：用 PMREMGenerator.fromScene 渲一张
 * 微型程序化环境——上空天光、地平光带、下地面色——供金属与湿面反射出天光，
 * 是金币「抛光金视觉锚点」与湿路面反射的高光来源。
 * 配色由主题 config 的 env 字段提供（{ sky, glow, ground }，runTheme 派生）：
 *   stormspire = 冷天光 + 金光带 + 深渊靛；harbor = 晚霞青 + 暖橙光带 + 暗码头；
 * ⚠️ 只供声明了 env 字段的主题接线（runnerScene 挂 scene.environment），其它主题不调；
 * 任何异常返回 null＝无 IBL，调用方按 null 自然降级为纯灯光照明。
 */
import * as THREE from 'three';

/** 主题 env 字段口径：sky=上半球天光色、glow=地平光带色（金属高光方向来源）、ground=下半球地面色 */
export interface EnvSpec {
  sky: string;
  glow: string;
  ground: string;
  /** 天光亮度系数（缺省 0.35＝微弱，不抢主光源） */
  skyDim?: number;
  /** 地平光带亮度系数（缺省 0.12＝极弱） */
  glowDim?: number;
}

/** 微型环境场景：3 块大面片包住原点。亮度用颜色明度压低，面片用 MeshBasicMaterial（不受光、恒定辐射）。 */
function buildEnvScene(spec: EnvSpec): THREE.Scene {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(spec.ground); // 面片没盖住的四周方向 = 地面色，不留纯黑
  const panel = (w: number, h: number, color: string, dim: number, rotX: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(dim) }),
    );
    mesh.rotation.x = rotX;
    mesh.position.set(0, y, z);
    return mesh;
  };
  const sky = panel(160, 160, spec.sky, spec.skyDim ?? 0.35, Math.PI / 2, 45, 0);   // 上：天光（微弱）
  const glow = panel(240, 10, spec.glow, spec.glowDim ?? 0.12, 0, 2, -60);          // 地平：光带（极弱，高光方向来源）
  const ground = panel(160, 160, spec.ground, 1, -Math.PI / 2, -45, 0);             // 下：地面色
  scene.add(sky, glow, ground);
  return scene;
}

/** 渲染主题环境贴图；PMREM/WebGL 任一环节异常都返回 null（调用方兜底，不挂 envMap） */
export function createEnvMap(renderer: THREE.WebGLRenderer, spec: EnvSpec): THREE.Texture | null {
  try {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const src = buildEnvScene(spec);
    const rt = pmrem.fromScene(src, 0.03, 0.1, 120); // 小 sigma：保留光带的方向性，高光才锐
    const tex = rt.texture;
    pmrem.dispose();
    for (const child of src.children) { // 临时场景即用即弃，防几何/材质泄漏
      const mesh = child as THREE.Mesh;
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    return tex;
  } catch {
    return null;
  }
}

/** 按局释放环境贴图（runnerScene 的 dispose 清单调用；容错 null/undefined） */
export function disposeEnvMap(tex: THREE.Texture | null | undefined): void {
  tex?.dispose();
}
