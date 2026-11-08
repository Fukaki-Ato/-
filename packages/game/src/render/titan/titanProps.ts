/**
 * 沉眠泰坦 · 侧景道具集总装（scenery = "titan"，docs/scenes/titan-brief.md §10.1-4）。
 * 分层：bodyKit（尸身体块/椎棘/甲板/峡谷雾墙）→ mist（谷底雾带 + 魂火飘屑）→ relics（箭/石环/
 * 魂火灯/掌残段/断剑）→ ribs（肋拱 ×12）→ skull（颅首 + 420m 睁眼闩锁）→ veils（须发帘）→
 * creatures（渡魂鸦 + 对岸尸影）。全部 InstancedMesh，240m 循环回收，确定性 rnd，不读 sim。
 * 呼吸：远场经 worldBend.setTitanBreath（k² 权重，近场 18m 恒平）+ 各模块内置的近/中场矩阵
 * 梯度（肋 ±0.35 / 颅 ±0.2 / 掌 ±0.1，brief §3.3 梯度表）；amp 由颅首 awakeBoost 联动（醒态 +50%）。
 * dt 由 t 差分得出（SceneryProps 只传 move/t，接口不动）。
 */
import * as THREE from 'three';
import type { SceneryProps } from '../sceneryProps.js';
import { applyWorldBend, setTitanBreath } from '../stormspire/worldBend.js';
import { createBodyKit } from './bodyKit.js';
import { createMist } from './mist.js';
import { createRelics } from './relics.js';
import { createRibs } from './ribs.js';
import { createSkull } from './skull.js';
import { createVeils } from './veils.js';
import { createCreatures } from './creatures.js';

export function createTitanProps(scene: THREE.Scene): SceneryProps {
  const bodyKit = createBodyKit(scene);
  const mist = createMist(scene);
  const relics = createRelics(scene);
  const ribs = createRibs(scene);
  const skull = createSkull(scene);
  const veils = createVeils(scene);
  const creatures = createCreatures(scene);

  // world-bend 兜底注入（同 stormspireProps 口径）：各模块走 std() 工厂的 Lambert 已注入，
  // 这里补直建的不透明 Basic 金饰（魂火/瞳孔/导引纹/灯头）——透明加色件（光晕/雾/飘屑）天然排除。
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || Array.isArray(mesh.material)) return;
    const mat = mesh.material;
    const solid = mat instanceof THREE.MeshBasicMaterial || mat instanceof THREE.MeshLambertMaterial
      || mat instanceof THREE.MeshStandardMaterial;
    if (solid && !mat.transparent) applyWorldBend(mat);
  });

  let moveAccum = 0; // 总里程累计（渲染层）：颅首 420m 睁眼闩锁的输入
  return {
    update(move: number, t: number) {
      moveAccum += move;
      setTitanBreath(t, Math.min(2, Math.max(1, skull.awakeBoost))); // 醒态呼吸 +50%（1→1.5）
      bodyKit.update(move, t);
      mist.update(move, t);
      relics.update(move, t);
      ribs.update(move, t);
      skull.update(move, t, moveAccum);
      veils.update(move, t);
      creatures.update(move, t);
    },
    dispose() {
      // 各模块 dispose 可选（返回类型口径不一），统一容错释放
      for (const m of [bodyKit, mist, relics, ribs, skull, veils, creatures]) {
        (m as { dispose?: () => void }).dispose?.();
      }
    },
  };
}
