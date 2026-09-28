/**
 * 矩形 → three 局部裁剪平面组（滚动容器裁剪用）。
 * UI 屏幕系（y 下）矩形 rect 在世界系（overlay 取 worldY = -uiY）内的保内四半空间：
 *   x ∈ [X0, X0+W]，worldY ∈ [-(Y0+H), -Y0]；Plane(n,c) 保留 n·p+c ≥ 0。
 */
import * as THREE from 'three';
import type { Rect } from '../types.js';

export function planesForRect(rect: Rect): THREE.Plane[] {
  return [
    new THREE.Plane(new THREE.Vector3(1, 0, 0), -rect.x),                    // x ≥ X0
    new THREE.Plane(new THREE.Vector3(-1, 0, 0), rect.x + rect.w),           // x ≤ X0+W
    new THREE.Plane(new THREE.Vector3(0, -1, 0), -rect.y),                   // worldY ≤ -Y0（上边）
    new THREE.Plane(new THREE.Vector3(0, 1, 0), rect.y + rect.h),            // worldY ≥ -(Y0+H)（下边）
  ];
}

/** 点在裁剪面组内（全部 distanceToPoint ≥ 0）；测试与调试用 */
export function pointInPlanes(planes: THREE.Plane[], x: number, uiY: number): boolean {
  const p = new THREE.Vector3(x, -uiY, 0);
  return planes.every(pl => pl.distanceToPoint(p) >= 0);
}
