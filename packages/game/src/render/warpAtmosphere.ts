import * as THREE from 'three';

const WARP_TINT = new THREE.Color('#1a0b33');
const EDGE_S = 0.6;

/** 在本帧主题/闪电底色上分别叠隧道色；有限时长进出，退出后精确恢复各自底色。 */
export function updateWarpAtmosphere(background: THREE.Color, fog: THREE.Color, k: number, active: boolean, dt: number): number {
  const next = active ? Math.min(1, k + dt / EDGE_S) : Math.max(0, k - dt / EDGE_S);
  background.lerp(WARP_TINT, next * 0.85);
  fog.lerp(WARP_TINT, next * 0.85);
  return next;
}
