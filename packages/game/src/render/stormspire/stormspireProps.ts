/**
 * 天穹雷脊 · 侧景道具集总装（scenery = "stormspire"，docs/stormspire-brief.md）。
 * 分层：atmosphere（云海 + 雨）→ islands（浮空岛链 + 附着废墟）→ landmarks（雷脊塔 +
 * 铜环 + 摆链）→ creatures（风暴魟群 + 云渊鲸剪影）→ skyline（远景剪影带 + 信标光柱，
 * 自带 ×0.3 半速视差 / 300m 回收带）。全部 InstancedMesh（约 35 draw call），240m 循环
 * 回收，确定性 rnd，不读 sim。
 * dt 由 t 差分得出（SceneryProps 只传 move/t，接口不动）。
 */
import * as THREE from 'three';
import type { SceneryProps } from '../sceneryProps.js';
import { addInst, std, writeAll, type Inst, type Placement } from '../sceneryProps.js';
import { createAtmosphere } from './atmosphere.js';
import { createIslands } from './islands.js';
import { createStatue } from './statue.js';
import { createBridge } from './bridge.js';
import { createLandmarks } from './landmarks.js';
import { createCreatures } from './creatures.js';
import { createSkyline } from './skyline.js';
import { applyWorldBend, setWorldBend } from './worldBend.js';
import { P } from './palette.js';

export function createStormspireProps(scene: THREE.Scene, ctx?: { crossings?: readonly { kind: string; lane: number; worldZ: number; done?: boolean }[] }): SceneryProps {
  const atmo = createAtmosphere(scene);
  const islands = createIslands(scene);
  const statue = createStatue(scene);
  const bridge = createBridge(scene);
  const landmarks = createLandmarks(scene);
  const creatures = createCreatures(scene);
  const skyline = createSkyline(scene);

  // 云墙：两侧大团压扁球三排纵深，色由深及浅补住地平线以下（cloudShade → cloud）
  const banks: Inst[] = [];
  const bankGeo = new THREE.SphereGeometry(1, 9, 6);
  bankGeo.scale(1, 0.45, 1); // 几何级压扁＝云丘（实例均匀缩放不破坏比例）
  for (const side of [-1, 1] as const) {
    for (let rowI = 0; rowI < 2; rowI++) {
      const items: Placement[] = [];
      const base = 26 + rowI * 16, every = 15 + rowI * 7;
      for (let z = -230 + rowI * 30, i = 0; z < 8; z += every, i++) {
        items.push({
          x: side * (base + (i % 3) * 4), y: -5 - rowI * 2.5, z,
          s: 7 + rowI * 4 + (i % 4), ry: 0,
        });
      }
      const inst = addInst(scene, bankGeo, std(rowI === 0 ? P.cloudShade : P.abyss), items);
      // 压扁成云丘：矩阵 scale 不支持非均匀，直接在几何上压
      banks.push(inst);
    }
  }

  // world-bend 兜底注入（见 worldBend.ts）：std() 工厂已覆盖 Lambert 主色件，但 bridge/landmarks/
  // statue/creatures 里直建的不透明 Basic 金纹（符文条/信标/柱头金饰）不在工厂里，不补注会与
  // 已弯的石体分家。按「不透明网格材质」兜底（透明/加色件 = 光池/光柱/雨雾等光效，天然不随
  // 地面弯，跳过；天空穹顶是 ShaderMaterial、雨是 LineSegments，类型上天然排除）。
  // applyWorldBend 幂等（WeakSet 登记），std/路面件重复到达直接跳过；仅建场跑一次，逐帧零开销。
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || Array.isArray(mesh.material)) return;
    const mat = mesh.material;
    const solid = mat instanceof THREE.MeshBasicMaterial || mat instanceof THREE.MeshLambertMaterial
      || mat instanceof THREE.MeshStandardMaterial;
    if (solid && !mat.transparent) applyWorldBend(mat);
  });

  let lastT = 0, distAcc = 0;
  return {
    update(move: number, t: number) {
      setWorldBend(t); // 假弯道呼吸（~90s 周期，见 worldBend.ts）：仅 stormspire 活跃时驱动，其它主题恒零
      const dt = Math.min(Math.max(t - lastT, 0), 0.1);
      lastT = t; distAcc += move;
      atmo.update(move, t, dt);
      islands.update(move, t);
      statue.update(move, t);
      bridge.update(move);
      landmarks.update(move, t);
      landmarks.syncCrossings?.(ctx?.crossings ?? [], distAcc, 2.2); // M4 crossings 视觉对齐：判定体 z 走
      creatures.update(move, t);
      skyline.update(move, t); // 远景剪影带：视差在自家 update（×0.3），与 banks 同层调用
      for (const inst of banks) {
        for (const p of inst.items) {
          p.z += move * 0.55; // 云墙半速：比岛链远一层视差
          if (p.z > 60) p.z -= 300;
        }
        writeAll(inst);
      }
    },
    dispose() {
      atmo.dispose?.();
      bridge.dispose?.();
      skyline.dispose();
    },
  };
}
