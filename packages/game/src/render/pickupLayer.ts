/**
 * 道具表现层（docs/02 §8 对象池，每帧零分配）——从 entityLayers 拆出（该文件撞 300 行上限，
 * 且道具层自带 3D 模型槽位后职责已独立）：只把 sim 的道具数组映射到预建槽位，不做玩法判定。
 *
 * 双轨视觉：近距（35m 内）换 items.json model.prefab 的 3D 模型（磁铁），远距保留发光贴图箱
 * 当航标；模型未就绪/文件缺失/无 extras（wx）一律贴图箱——捞取判定与数值不受任何影响。
 */
import * as THREE from 'three';
import type { PickupEntity } from '@tr/game/core/sim/trackGen.js';
import { PICKUP_CENTER_Y } from '@tr/game/core/sim/collect.js';
import { pickupTileFor } from './pickupTiles.js';
import { createPickupModelSlots, type PickupModelLoader } from './pickupModels.js';

/** 道具箱配色（未列出的道具用白色；正式贴图见 docs/05 §6） */
const PICKUP_COLOR: Record<string, number> = { item_magnet: 0xb48cff, item_boots: 0x43d9a3 };
const PICKUP_MAX = 8;
/** 道具的前后可见深度（米）：超出即不占槽位 */
const PICKUP_NEAR = 8, PICKUP_FAR = -320;

export function createPickupLayer(scene: THREE.Scene, laneWidth: number, models?: PickupModelLoader) {
  const geo = new THREE.BoxGeometry(0.7, 0.7, 0.7);
  const meshes: THREE.Mesh[] = [];
  for (let i = 0; i < PICKUP_MAX; i++) {
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ roughness: 0.35, emissiveIntensity: 0.5 }));
    m.visible = false; scene.add(m); meshes.push(m);
  }
  // 3D 模型槽位（与箱槽位分离：近距道具占模型槽、远的占箱槽）
  const modelSlots = models ? createPickupModelSlots(scene, PICKUP_MAX, models) : null;

  return {
    update(list: PickupEntity[], dist: number, t: number) {
      let bi = 0;
      for (const p of list) {
        if (p.taken) continue;
        const z = dist - p.worldZ;
        if (z < PICKUP_FAR || z > PICKUP_NEAR) continue;
        // 近距换模：占上模型槽就跳过箱（滞回/spin/回退全在 pickupModels 里）
        if (modelSlots && modelSlots.show(p.itemRef, p.worldZ, p.lane * laneWidth, PICKUP_CENTER_Y + Math.sin(t * 2 + p.worldZ) * 0.09, z, t)) continue;
        if (bi >= PICKUP_MAX) continue;
        const m = meshes[bi++];
        m.visible = true;
        const mat = m.material as THREE.MeshStandardMaterial;
        const tile = pickupTileFor(p.itemRef); // 宿主没注入（微信端）⇒ null，退回纯色箱
        if (mat.map !== (tile?.tex ?? null)) { mat.map = tile?.tex ?? null; mat.emissiveMap = tile?.tex ?? null; mat.needsUpdate = true; }
        const col = tile ? tile.bg : PICKUP_COLOR[p.itemRef] ?? 0xffffff;
        mat.color.setHex(tile ? 0xffffff : col); // 有砖图就不叠色（淡底已画在图里）
        mat.emissive.setHex(col);                // 自发光叠砖图本身 ⇒ 夜里箱子自己亮着，徽标才跳得出来
        mat.emissiveIntensity = tile ? 0.9 : 0.55;
        m.position.set(p.lane * laneWidth, PICKUP_CENTER_Y + Math.sin(t * 2 + p.worldZ) * 0.09, z); // 只浮动不自转：徽标得正对玩家
      }
      for (; bi < PICKUP_MAX; bi++) meshes[bi].visible = false;
      modelSlots?.hideRest();
    },
  };
}
