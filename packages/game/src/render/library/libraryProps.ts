/**
 * 失重图书馆 · 侧景道具集总装（scenery = "library"，docs/scenes/library-brief.md §11.1 步骤 8）。
 * 分层：atmosphere（墨海条 + 墨雾带 + 书页风暴 + 光尘 + 涟漪 + 翻页光波）→ books（书脊 2000+ 册
 * 三 batch）→ towers（三档书塔四态 + 书岛 + 书山）→ gallery（near 排长桌/灯柱/散书/书栏）→
 * landmarks（万卷塔 + 悬索书梯 + 蜡封拱门 + 反重力书阁）→ creatures（纸鹤 3 群 + 墨渊鲸）。
 * 全部 InstancedMesh，240m 循环回收，确定性 rnd，不读 sim。
 * 世界弯：update 先调 setLibraryBend 驱动假弯道（100m 处横 4m / 纵 2.5m 双正弦相位差，
 * 见 worldBend.ts——仅本文件驱动，其它主题恒零恒等），再依次各模块 update。
 */
import * as THREE from 'three';
import type { SceneryProps } from '../sceneryProps.js';
import { createAtmosphere } from './atmosphere.js';
import { createBooks } from './books.js';
import { createTowers } from './towers.js';
import { createGallery } from './gallery.js';
import { createLandmarks } from './landmarks.js';
import { createCreatures } from './creatures.js';
import { applyWorldBend, setLibraryBend } from '../stormspire/worldBend.js';

/** 单步上限（米）：子模块回收全按「逐帧小步长」写（单条 if 减法，stormspire 同款），
 *  32 是六模块里最小的循环盒（书页风暴远层 zDepth=32；其余 ≥46/68/240）——
 *  ≤32 的子步保证任何步长下「一次 update 调用」后所有实例仍落在各自循环带内。 */
const STEP_MAX = 32;

export function createLibraryProps(scene: THREE.Scene): SceneryProps {
  // 六模块统一按 SceneryProps 口径持有：books/towers/gallery 的 update 只吃 move（少参函数
  // 天然可赋给 (move, t) 签名），landmarks/creatures 无 dispose，dispose?.() 容错跳过。
  const mods: SceneryProps[] = [
    createAtmosphere(scene),
    createBooks(scene),
    createTowers(scene),
    createGallery(scene),
    createLandmarks(scene),
    createCreatures(scene),
  ];

  // world-bend 兜底注入（抄 stormspireProps.ts 口径）：各模块 std() 工厂已覆盖 Lambert 主色件，
  // 但直建的不透明 Basic/Standard（灯笼头/章纹/塔身顶点色等）不在工厂里，不补注会与已弯的
  // 层板分家。按「不透明网格材质」兜底（透明/加色件 = 光池/墨雾/书页光效，天然不随地面弯，
  // 跳过；天空穹顶是 ShaderMaterial、长平面例外件类型上排除）。applyWorldBend 幂等（WeakSet
  // 登记），std/显式注入重复到达直接跳过；仅建场跑一次，逐帧零开销。
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || Array.isArray(mesh.material)) return;
    const mat = mesh.material;
    const solid = mat instanceof THREE.MeshBasicMaterial || mat instanceof THREE.MeshLambertMaterial
      || mat instanceof THREE.MeshStandardMaterial;
    if (solid && !mat.transparent) applyWorldBend(mat);
  });

  return {
    update(move: number, t: number) {
      setLibraryBend(t); // 书城回廊漂移（96s/128s 双正弦，见 worldBend.ts）：仅 library 活跃时驱动
      // 常规逐帧 move ≤ 32 直走；超大步长（重生/传送/测试大 move）切块依次喂入，
      // 让子模块的单条 if 减法回收保持「一步到位」（零分配，循环变量全在栈上）
      if (move <= STEP_MAX) {
        for (const m of mods) m.update(move, t);
        return;
      }
      for (let rest = move; rest > 0;) {
        const chunk = rest > STEP_MAX ? STEP_MAX : rest;
        rest -= chunk;
        for (const m of mods) m.update(chunk, t); // 同一 t 重复喂：动画按终态 t 重写，无累积误差
      }
    },
    dispose() {
      for (const m of mods) m.dispose?.(); // 容错逐模块释放：无 dispose 的模块自然跳过
    },
  };
}
