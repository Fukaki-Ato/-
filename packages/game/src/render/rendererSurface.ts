import type * as THREE from 'three';
import type { WindowSize } from '@tr/framework/platform/platformAdapter.js';

/** 本局只拥有自行创建的 renderer；共享画布的 renderer 由宿主跨页面保留。 */
export function createRendererSurface(
  size: WindowSize,
  createRenderer: () => THREE.WebGLRenderer,
  sharedRenderer?: THREE.WebGLRenderer,
) {
  const renderer = sharedRenderer ?? createRenderer();
  function resize(next: WindowSize) {
    renderer.setPixelRatio(next.dpr);
    renderer.setSize(next.width, next.height, false);
  }
  resize(size);
  return {
    renderer,
    resize,
    dispose() { if (!sharedRenderer) renderer.dispose(); },
  };
}
