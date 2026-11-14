import * as THREE from 'three';
import type { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/** 宿主可提供 GLTF 插件；缺省继续使用 Web 的 GLTFLoader。 */
export type ModelLoaderFactory = () => GLTFLoader;

/** 模型自有资源（clone 共享的几何/材质/纹理各释放一次），包括未挂入场景的迟到模型。 */
export function disposeModel(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>(), skeletons = new Set<THREE.Skeleton>();
  root.traverse(object => {
    const mesh = object as THREE.Mesh;
    if (mesh.geometry) geometries.add(mesh.geometry);
    for (const material of Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : []) {
      materials.add(material);
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
    }
    if ((object as THREE.SkinnedMesh).skeleton) skeletons.add((object as THREE.SkinnedMesh).skeleton);
  });
  for (const texture of textures) texture.dispose();
  for (const material of materials) material.dispose();
  for (const geometry of geometries) geometry.dispose();
  for (const skeleton of skeletons) skeleton.dispose();
  root.removeFromParent();
}
