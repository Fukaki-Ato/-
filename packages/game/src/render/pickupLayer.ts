/**
 * 道具表现层（docs/02 §8 对象池，每帧零分配）——从 entityLayers 拆出（该文件撞 300 行上限，
 * 且道具层自带 3D 模型槽位后职责已独立）：只把 sim 的道具数组映射到预建槽位，不做玩法判定。
 *
 * 双轨视觉：近距（35m 内）换 items.json 的实际3D模型，远距用发光标志箱当航标。
 * WX无贴图注入时有矢量标志；模型未就绪/读取失败不影响捞取判定与数值。
 */
import * as THREE from 'three';
import type { PickupEntity } from '@tr/game/core/sim/trackGen.js';
import { PICKUP_CENTER_Y } from '@tr/game/core/sim/collect.js';
import { pickupTileFor } from './pickupTiles.js';
import { createPickupGlow } from './pickupGlow.js';
import { createPickupModelSlots, type PickupModelLoader } from './pickupModels.js';
import { applyWorldBend } from './stormspire/worldBend.js';
import { createPickupBeaconGeometry, PICKUP_BEACON_COLORS } from './pickupBeacons.js';

const PICKUP_MAX = 8;
/** 道具的前后可见深度（米）：超出即不占槽位 */
const PICKUP_NEAR = 8, PICKUP_FAR = -320;

export function createPickupLayer(scene: THREE.Scene, laneWidth: number, models?: PickupModelLoader) {
  const geo = new THREE.BoxGeometry(0.7, 0.7, 0.7);
  const meshes: THREE.Mesh[] = [];
  const icons: THREE.Mesh[] = [];
  const symbolMaterial = new THREE.MeshBasicMaterial({ color: 0x153e52 });
  applyWorldBend(symbolMaterial);
  const symbols = new Map<string, THREE.BufferGeometry>();
  for (const itemRef of [...Object.keys(PICKUP_BEACON_COLORS), 'item_default']) {
    symbols.set(itemRef, createPickupBeaconGeometry(itemRef));
  }
  for (let i = 0; i < PICKUP_MAX; i++) {
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ roughness: 0.35, emissiveIntensity: 0.5 }));
    // world-bend 注入（幂等）：弯道量全局恒零时=恒等变换，仅雷脊驱动非零——道具箱要与弯带路面同弯，
    // 否则远处分家（见 stormspire/worldBend.ts）。GLB 材质在 pickupModels 加载时同样注入。
    applyWorldBend(m.material as THREE.MeshStandardMaterial);
    const icon = new THREE.Mesh(symbols.get('item_default')!, symbolMaterial);
    icon.position.z = .351; m.add(icon); icons.push(icon);
    m.visible = false; scene.add(m); meshes.push(m);
  }
  // 3D 模型槽位（与箱槽位分离：近距道具占模型槽、远的占箱槽）
  const modelSlots = models ? createPickupModelSlots(scene, PICKUP_MAX, models) : null;
  // 地面光圈：箱与 3D 模型两态都亮（在道具正下方地面上，色随道具徽标主色）
  const glow = createPickupGlow(scene);

  return {
    update(list: PickupEntity[], dist: number, t: number) {
      let bi = 0;
      for (const p of list) {
        if (p.taken) continue;
        const z = dist - p.worldZ;
        if (z < PICKUP_FAR || z > PICKUP_NEAR) continue;
        glow.show(p.lane * laneWidth, z, p.itemRef, p.worldZ, t); // 光圈贴地，随箱/模型一起浮动呼吸
        // 近距换模：占上模型槽就跳过箱（滞回/spin/回退全在 pickupModels 里）
        if (modelSlots && modelSlots.show(p.itemRef, p.worldZ, p.lane * laneWidth, PICKUP_CENTER_Y + Math.sin(t * 2 + p.worldZ) * 0.09, z, t)) continue;
        if (bi >= PICKUP_MAX) continue;
        const m = meshes[bi++];
        m.visible = true;
        const mat = m.material as THREE.MeshStandardMaterial;
        const tile = pickupTileFor(p.itemRef); // 没有贴图注入时使用同色箱+几何标志。
        if (mat.map !== (tile?.tex ?? null)) { mat.map = tile?.tex ?? null; mat.emissiveMap = tile?.tex ?? null; mat.needsUpdate = true; }
        const col = tile ? tile.bg : PICKUP_BEACON_COLORS[p.itemRef] ?? 0xffffff;
        icons[bi - 1].visible = !tile;
        icons[bi - 1].geometry = symbols.get(p.itemRef) ?? symbols.get('item_default')!;
        mat.color.setHex(tile ? 0xffffff : col); // 有砖图就不叠色（淡底已画在图里）
        mat.emissive.setHex(col);                // 自发光叠砖图本身 ⇒ 夜里箱子自己亮着，徽标才跳得出来
        mat.emissiveIntensity = tile ? 0.9 : 0.55;
        m.position.set(p.lane * laneWidth, PICKUP_CENTER_Y + Math.sin(t * 2 + p.worldZ) * 0.09, z); // 只浮动不自转：徽标得正对玩家
      }
      for (; bi < PICKUP_MAX; bi++) meshes[bi].visible = false;
      modelSlots?.hideRest();
      glow.hideRest();
    },
    dispose() {
      modelSlots?.dispose();
      glow.dispose();
      for (const mesh of meshes) { scene.remove(mesh); (mesh.material as THREE.Material).dispose(); }
      geo.dispose(); symbolMaterial.dispose();
      for (const geometry of symbols.values()) geometry.dispose();
    },
  };
}
