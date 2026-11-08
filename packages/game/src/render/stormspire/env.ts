/**
 * 天穹雷脊 IBL 环境贴图（真实实现，替换占位骨架）：用 PMREMGenerator.fromScene 渲一张
 * 微型程序化雷暴环境——上冷天光微弱、地平金光带极弱、下深渊靛——供金属与湿面反射出云海天光，
 * 是金币「抛光金视觉锚点」与湿路面反射的高光来源。
 * ⚠️ 只供 stormspire 主题接线（runnerScene 按 scenery 门控调用并挂 scene.environment），其它主题不调；
 * 任何异常返回 null＝无 IBL，调用方按 null 自然降级为纯灯光照明。
 */
import * as THREE from 'three';
import { FLASH_TINT } from '../lightning.js';
import { P } from './palette.js';

/** 微型环境场景：3 块大面片包住原点。亮度用颜色明度压低（微弱/极弱＝不抢主光源，只给反射定调），
 *  面片用 MeshBasicMaterial（不受光、恒定辐射），PMREM 立方相机从原点拍满 6 面。 */
function buildStormEnvScene(): THREE.Scene {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(P.abyss); // 面片没盖住的四周方向 = 深渊靛，不留纯黑
  const panel = (w: number, h: number, color: number, dim: number, rotX: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(dim) }),
    );
    mesh.rotation.x = rotX;
    mesh.position.set(0, y, z);
    return mesh;
  };
  const sky = panel(160, 160, FLASH_TINT, 0.35, Math.PI / 2, 45, 0);  // 上：冷天光（微弱，与闪电闪色同源）
  const gold = panel(240, 10, P.gold, 0.12, 0, 2, -60);               // 地平：金光带（极弱，金属高光的方向来源）
  const abyss = panel(160, 160, P.abyss, 1, -Math.PI / 2, -45, 0);    // 下：深渊靛
  scene.add(sky, gold, abyss);
  return scene;
}

/** 渲染 stormspire 环境贴图；PMREM/WebGL 任一环节异常都返回 null（调用方兜底，不挂 envMap） */
export function createStormEnvMap(renderer: THREE.WebGLRenderer): THREE.Texture | null {
  try {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const src = buildStormEnvScene();
    const rt = pmrem.fromScene(src, 0.03, 0.1, 120); // 小 sigma：保留金光带的方向性，高光才锐
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
export function disposeStormEnvMap(tex: THREE.Texture | null | undefined): void {
  tex?.dispose();
}
