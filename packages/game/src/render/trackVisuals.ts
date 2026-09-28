/**
 * 道路视觉（docs/05 §4 场景元素）：地面、三车道、护栏、流动虚线。
 * 纯装饰层：只跟随插值距离滚动，不读玩法状态。
 */
import * as THREE from 'three';

/** 虚线滚动回绕的总长与出画阈值（米） */
const DASH_LOOP = 192, DASH_RESET_Z = 10;

export interface TrackColors { baseColor: string; flashColor: string; tint: string }

export function createTrackVisuals(scene: THREE.Scene, laneWidth: number, colors: TrackColors) {
  const roadWidth = 3 * laneWidth + 1.2;

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(60, 240),
    new THREE.MeshStandardMaterial({ color: 0x0d1424, roughness: 0.95 })
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
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 240), railMat);
    rail.position.set(side * (roadWidth / 2 + 0.25), 0.34, -100); scene.add(rail);
  }

  // 流动虚线：每车道 16 段，随距离循环滚动，制造速度感
  const dashGeo = new THREE.PlaneGeometry(0.5, 0.07);
  const dashMat = new THREE.MeshBasicMaterial({ color: 0x40598c, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending });
  const dashes: THREE.Mesh[] = [];
  for (const lane of [-1, 0, 1]) for (let i = 0; i < 16; i++) {
    const d = new THREE.Mesh(dashGeo, dashMat);
    d.rotation.x = -Math.PI / 2; d.position.set(lane * laneWidth, 0.014, -190 + i * 12); scene.add(d); dashes.push(d);
  }

  let lastDist = 0;
  return {
    /** 用插值距离推动虚线滚动（与角色同步，不掉帧抖动） */
    update(dist: number) {
      const move = dist - lastDist; lastDist = dist;
      for (const d of dashes) {
        d.position.z += move;
        if (d.position.z > DASH_RESET_Z) d.position.z -= DASH_LOOP;
      }
    },
  };
}
