/**
 * 熔炉巨兽 · 侧景道具集总装（scenery = "forgeheart"，docs/scenes/forgeheart-brief.md §13）。
 * 分层：atmosphere（岩浆海双层+潮位 y / 灰烬三层 / 热浪雾带 / 火星泡 / 热流痕）→ islands（蜂巢柱阵
 * / 渣滩阶地 / 烟囱 / 班次石碑 / 熔岩跌水）→ landmarks（火山颈内壁 / 螺旋壁架 / 炉心×2 / 哑阀 / 锻像）
 * → props（断链吊桥 / 引藤链 / 焰髓晶簇 / 渣斗车 / 卡箍微颤）。全部 InstancedMesh，240m 循环回收，
 * 确定性 rnd，不读 sim。潮位：各模块自累积 distAcc 调 tide.ts 纯函数（Phase A 渲染层单源，Phase B 进 sim）。
 * 假弯道：uBendX = 4·sin(t·0.06)、uBendY = 3·tideLevel（§13-6；近场 18m 恒平安全边界同雷脊）。
 */
import * as THREE from 'three';
import type { SceneryProps } from '../sceneryProps.js';
import { applyWorldBend, setForgeheartBend } from '../stormspire/worldBend.js';
import { level } from './tide.js';
import { createAtmosphere } from './atmosphere.js';
import { createIslands } from './islands.js';
import { createLandmarks } from './landmarks.js';
import { createProps } from './props.js';

export function createForgeheartProps(scene: THREE.Scene): SceneryProps {
  const atmo = createAtmosphere(scene);
  const islands = createIslands(scene);
  const landmarks = createLandmarks(scene);
  const props = createProps(scene);

  // world-bend 兜底注入（stormspireProps:56-63 口径）：std() 工厂件已注入，补直建的不透明
  // Basic 炉火橙件（岩浆亮斑/导引纹/晶簇）与 Lambert 石件——透明加色件（灰烬/雾带/火星）天然排除
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || Array.isArray(mesh.material)) return;
    const mat = mesh.material;
    const solid = mat instanceof THREE.MeshBasicMaterial || mat instanceof THREE.MeshLambertMaterial
      || mat instanceof THREE.MeshStandardMaterial;
    if (solid && !mat.transparent) applyWorldBend(mat);
  });

  let distAcc = 0; // 潮位取数：模块内各自也累计，这里供假弯道的 tideLevel
  return {
    update(move: number, t: number) {
      distAcc += move;
      setForgeheartBend(t, level(distAcc)); // §13-6 曲线：uBendX=4·sin(t·0.06)、uBendY=3·tideLevel
      atmo.update(move, t);
      islands.update(move, t);
      landmarks.update(move, t);
      props.update(move, t);
    },
    dispose() {
      // 各模块 dispose 可选（返回类型口径不一），统一容错释放
      for (const m of [atmo, islands, landmarks, props]) {
        (m as { dispose?: () => void }).dispose?.();
      }
    },
  };
}
