/**
 * 道具 3D 模型加载器（items.json 的 model.prefab/spin → GLB，照 animAvatar 的角色 GLB 模式）。
 * 为什么需要：item_magnet 等 10 个道具早已在 config 里预留了 model.prefab，但仓库里只有
 * 磁铁一个文件，且渲染层从未消费过这两个字段——道具视觉一直是 entityLayers 的贴图箱。
 *
 * 铁律（与角色 GLB 同款）：任何一步失败（无 adapter/extras、拉取失败、解析失败、文件不存在）
 * 都返回 null，调用方保持贴图箱现状——8 个预留路径里 7 个没有文件，绝不能集体报错或空白。
 * 加载是异步的：未就绪前同样返回 null（箱先显示，模型就绪后自然换上，不阻塞开局）。
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { GameContent } from '@tr/game/core/config/configTypes.js';
import type { PlatformAdapter } from '@tr/framework/platform/platformAdapter.js';

export interface PickupModelLoader {
  /** 该道具是否配了 model.prefab（配了但文件缺失也返回 true——加载仍会失败回落） */
  hasPrefab(itemRef: string): boolean;
  /** 取模型（未就绪/失败返回 null）；每帧可调，内部对每个 prefab 只发起一次加载 */
  model(itemRef: string): THREE.Object3D | null;
  /** items.json model.spin：渲染层据此绕 Y 自转 */
  spins(itemRef: string): boolean;
}

/** 夜间可见性补偿强度：资产纯色无 emissive，而贴图箱是自发光地标；给同色弱发光保持可比性 */
const MODEL_EMISSIVE = 0.18;
/** 道具 3D 模型的近距换模窗口（米，z=dist-worldZ，负=前方）：进 35m 换模型、出 40m 回箱——
 *  滞回带保证交换距离附近不来回跳变；远处（最远 -320m）保留发光贴图箱当航标。 */
export const PICKUP_MODEL_NEAR = -35, PICKUP_MODEL_FAR = -40;
/** 模型自转角速度（rad/s，绕 Y）：消费 items.json 的 model.spin；asset 已面朝玩家，不转也成立 */
const PICKUP_SPIN_RAD_S = 0.9;

export function createPickupModelLoader(content: GameContent, adapter?: PlatformAdapter): PickupModelLoader {
  const specs = new Map<string, { prefab: string; spin: boolean }>();
  for (const it of content.items?.items ?? []) {
    const m = it['model'] as { prefab?: unknown; spin?: unknown } | undefined;
    if (m && typeof m.prefab === 'string' && m.prefab.length > 0) {
      specs.set(it.id, { prefab: m.prefab, spin: m.spin === true });
    }
  }
  /** itemRef → 场景（null=已确认不可用：没读入口/拉取失败/解析失败） */
  const loaded = new Map<string, THREE.Object3D | null>();
  const loading = new Set<string>();
  const loader = new GLTFLoader();
  const read = adapter?.extras?.readBinary;

  function startLoad(itemRef: string): void {
    const spec = specs.get(itemRef);
    if (!spec || loading.has(itemRef) || loaded.has(itemRef)) return;
    if (!read) { loaded.set(itemRef, null); return; } // 宿主没注入 readBinary（wx）→ 直接判定不可用
    loading.add(itemRef);
    read(spec.prefab)
      .then(buf => new Promise<THREE.Object3D | null>(resolve => {
        // ArrayBuffer 走 GLTFLoader.parse（与 animAvatar 同路径）；解析失败按不可用处理
        loader.parse(buf, '', gltf => resolve(gltf.scene), () => resolve(null));
      }))
      .then(scene => {
        loading.delete(itemRef);
        if (!scene) { loaded.set(itemRef, null); return; }
        // 一次性补弱 emissive（材质被所有 clone 共享，只改一次）
        scene.traverse(o => {
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh) return;
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          for (const mat of mats) {
            const std = mat as THREE.MeshStandardMaterial;
            if (std && std.emissive && std.color) { std.emissive.copy(std.color); std.emissiveIntensity = MODEL_EMISSIVE; }
          }
        });
        loaded.set(itemRef, scene);
      })
      .catch(() => { loading.delete(itemRef); loaded.set(itemRef, null); });
  }

  return {
    hasPrefab: itemRef => specs.has(itemRef),
    model(itemRef) {
      startLoad(itemRef);
      return loaded.get(itemRef) ?? null;
    },
    spins: itemRef => specs.get(itemRef)?.spin === true,
  };
}

/** 道具 3D 模型槽位池：近距换模 + 滞回 + 自转全在此（entityLayers 只问「占没占上」）。
 *  槽位里的 Object3D 是加载源场景的 clone（几何/材质共享，切换 itemRef 才重建，每帧零分配）。 */
export interface PickupModelSlots {
  /** 每道具每帧调用：在换模窗口内且模型就绪 → 占槽显示并返回 true（调用方跳过贴图箱）；
   *  否则返回 false（调用方走箱）。内部按 worldZ 记滞回（进 -35 / 出 -40）。 */
  show(itemRef: string, worldZ: number, x: number, y: number, z: number, t: number): boolean;
  /** 帧末隐藏未占用的槽（清 item 记忆，下次换道具不串味） */
  hideRest(): void;
}

export function createPickupModelSlots(scene: THREE.Scene, max: number, models: PickupModelLoader): PickupModelSlots {
  const slots: { g: THREE.Group; item: string | null }[] = [];
  for (let i = 0; i < max; i++) {
    const g = new THREE.Group();
    g.visible = false; scene.add(g); slots.push({ g, item: null });
  }
  /** worldZ → 当前是否已换模型（只存 near 状态的键，天然有界） */
  const shown = new Set<number>();
  let used = 0;
  return {
    show(itemRef, worldZ, x, y, z, t) {
      const was = shown.has(worldZ);
      const inWindow = was ? z >= PICKUP_MODEL_FAR : z > PICKUP_MODEL_NEAR;
      if (inWindow) shown.add(worldZ); else shown.delete(worldZ);
      const src = inWindow ? models.model(itemRef) : null;
      if (!src || used >= slots.length) return false;
      const slot = slots[used++];
      if (slot.item !== itemRef) { slot.g.clear(); slot.g.add(src.clone()); slot.item = itemRef; }
      slot.g.visible = true;
      slot.g.position.set(x, y, z);
      slot.g.rotation.y = models.spins(itemRef) ? t * PICKUP_SPIN_RAD_S + worldZ : 0;
      return true;
    },
    hideRest() {
      for (; used < slots.length; used++) { slots[used].g.visible = false; slots[used].item = null; }
      used = 0;
    },
  };
}
