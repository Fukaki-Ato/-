/**
 * 天穹雷脊 · 雷渡桥面近景层（整改 2026-11-11，细节密度对齐雨夜便利店的近景带）：
 *   parapet  石栏杆：两侧每 2m 一块栏石（12% 缺损、随机歪斜），顶面金符文条常亮；
 *            栏柱灯沿疏密节奏取 z、高三档参差（0.72/1/1.32），灯头正下方路面一枚
 *            熔金光池（64² 径向渐变 + additive，opacity 0.15，随灯走疏密）；
 *   avenue   大道柱廊：|x|=7.6m 三段式柱（基座/柱身/柱头，四态损毁混编），柱身三档
 *            高度错落（0.72/1/1.32，相邻柱档位倾向交错、柱头随档缩放）+ 檐带随档搭接；
 *   gates    横跨石拱门 ×4：双柱 + 横梁（梁下净高 4.5m，跑得过），两座完整两座半塌
 *            （半塌 = 断梁外倒：斜搭矮柱、梢向路外，不横跨路面——旧斜梁扫相机会成整屏斜板）。
 * 排布节奏（2026-11-11 三轮「疏密交替」）：240m 循环切 8 段（每段 30m），奇数段（第 1/3/5/7
 *   段，下标偶）密集（间距 ×0.7）、偶数段开阔（间距 ×1.45）、段内均匀——大道柱/栏柱灯走
 *   rhythmZ，与 islands 的岛行/信标/幡共用同一节奏；各元素类错开 phase，密集段不同类
 *   不叠在同一 z 窗。视觉上「一段废墟密集长廊 ↔ 一段空旷云海视野」交替呼吸。
 * 全部静态件走 LOOP 回收；确定性 rnd；不读 sim。
 */
import * as THREE from 'three';
import { LOOP, WRAP_Z, addInst, rnd, std, writeAll, type Inst, type Placement } from '../sceneryProps.js';
import { P } from './palette.js';

/** 柱类三档高度档位（0.72/1/1.32）：高低错落的统一口径（柱/灯/信标/幡共用） */
export const TIERS = [0.72, 1, 1.32] as const;

/**
 * 三档档位取值：lean=0/1 → 相邻柱档位交错（偶序偏矮档、奇序偏高档，档内 rnd 二选一）；
 * lean=2 → 三档自由取（灯杆/幡杆/信标这类不做相邻交错的件）。
 */
export function tierOf(lean: number, r: number): number {
  if (lean === 0) return r < 0.5 ? TIERS[0] : TIERS[1];
  if (lean === 1) return r < 0.5 ? TIERS[1] : TIERS[2];
  return r < 1 / 3 ? TIERS[0] : r < 2 / 3 ? TIERS[1] : TIERS[2];
}

/**
 * 沿 z 疏密节奏取点（本轮统一排布口径，islands 同用）：240m 循环切 8 段（每段 30m），
 * 奇数段（下标偶）= 密集：间距 ×0.7；偶数段 = 开阔：间距 ×1.45；段内按 round(30/步距)
 * 等分铺点。every=元素类基准间距；phase=类内相位（米，各元素类错开 base 相位）；
 * 结果追加进 out，覆盖一整圈 [-LOOP, WRAP_Z)，调用方再按序号取 rnd 抖动。
 */
export function rhythmZ(every: number, phase: number, out: number[]): void {
  for (let seg = 0; seg < 8; seg++) {
    const n = Math.max(1, Math.round(30 / (every * (seg % 2 === 0 ? 0.7 : 1.45))));
    const step = 30 / n;
    for (let k = 0; k < n; k++) {
      let z = -LOOP + seg * 30 + phase + k * step;
      while (z >= WRAP_Z) z -= LOOP;
      while (z < -LOOP) z += LOOP;
      out.push(z);
    }
  }
}

/** 光池贴图：64² 径向渐变，中心亮边缘透明；RGB 恒白乘材质色，明暗走 alpha（同瀑布竖纹分离法） */
function makePoolTexture(): THREE.DataTexture {
  const N = 64;
  const data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const dx = (x + 0.5) / N - 0.5, dy = (y + 0.5) / N - 0.5;
    const a = Math.pow(1 - Math.min(1, Math.sqrt(dx * dx + dy * dy) * 2), 1.8);
    const i = (y * N + x) * 4;
    data[i] = 255; data[i + 1] = 255; data[i + 2] = 255;
    data[i + 3] = 255 * a;
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

export function createBridge(scene: THREE.Scene) {
  const insts: Inst[] = [];
  const stones: Placement[] = [], runes: Placement[] = [], posts: Placement[] = [], tips: Placement[] = [];
  const pools: Placement[] = [];
  const colBase: Placement[] = [], colShaft: Placement[] = [], colCap: Placement[] = [], beams: Placement[] = [];
  const gatePillar: Placement[] = [], gateBeam: Placement[] = [], gateRune: Placement[] = [];

  // ---- 石栏杆 + 符文条（路缘 |x|=4.6，桥读法的最低成本来源）----
  for (const side of [-1, 1] as const) {
    for (let z = -230, i = 0; z < 8; z += 2, i++) {
      if (rnd(i, side * 3 + 1) < 0.12) continue; // 缺口：塌掉的栏石
      stones.push({
        x: side * 4.6, y: 0.3, z,
        s: 0.9 + rnd(i, side * 3 + 4) * 0.3,
        ry: 0, rz: rnd(i, side * 3 + 7) < 0.1 ? 0.08 : 0, // 少量歪斜
      });
    }
    for (let z = -228; z < 8; z += 12) runes.push({ x: side * 4.6, y: 0.58, z: z + 3, s: 1, ry: 0 });
  }

  // ---- 栏柱灯（节奏取 z；高三档参差 0.72/1/1.32，原为等高无参差）；灯头正下方一枚光池 ----
  const lampZs: number[] = [];
  rhythmZ(12, 3.6, lampZs); // phase 3.6：与大道柱（0/5）、幡（6.8）、岛行（8）错开 base 相位
  for (const side of [-1, 1] as const) {
    for (let i = 0; i < lampZs.length; i++) {
      const z = lampZs[i]! + (rnd(i, side * 3 + 21) - 0.5) * 1.6;
      const t = tierOf(2, rnd(i, side * 3 + 23));
      posts.push({ x: side * 4.6, y: 0.45, z, s: t, ry: 0 });
      tips.push({ x: side * 4.6, y: 0.45 + 1.5 * t + 0.14, z, s: 1, ry: 0 }); // 灯头随档顶到杆顶
      pools.push({ x: side * 4.6, y: 0.03, z, s: 1, ry: 0 });
    }
  }

  // ---- 大道柱廊（|x|=7.6，节奏取 z；柱身三档错落 + 相邻柱档位交错 + 四态损毁混编）----
  for (const side of [-1, 1] as const) {
    const zs: number[] = [];
    rhythmZ(16, side < 0 ? 0 : 5, zs);
    let prevFull: { z: number; t: number } | null = null;
    for (let i = 0; i < zs.length; i++) {
      const z = zs[i]! + (rnd(i, side * 5 + 1) - 0.5) * 2.2;
      const st = rnd(i, side * 5 + 2);
      const t = tierOf(i % 2, rnd(i, side * 5 + 8)); // 偶序偏矮档、奇序偏高档 → 相邻柱档位交错
      const base: Placement = { x: side * 7.6, y: 0.25, z, s: 1, ry: 0 };
      colBase.push(base);
      const state = st < 0.6 ? 0 : st < 0.8 ? 1 : st < 0.92 ? 2 : 3; // 完整/断头/只剩基座/倾斜
      if (state !== 2) {
        // 柱身随档缩放：中心 = 基座顶 0.5 + 半高 2.6t（断头柱半高对半，坐回基座不悬空）
        const half = state === 1 ? 0.55 : 1;
        colShaft.push({ ...base, y: 0.5 + 2.6 * t * half, s: t * half, ry: 0, rz: state === 3 ? 0.1 : 0 });
        if (state === 0) colCap.push({ ...base, y: 0.8 + 5.2 * t, s: t, ry: 0 });
        if (state === 0 && prevFull && Math.abs(prevFull.z - z) <= 26) {
          // 檐带搭接两柱柱头（档位不同随差微倾，读作残段斜搭）；开阔段间距 30m 不搭，让视野敞开
          const topA = 1.1 + 5.2 * prevFull.t, topB = 1.1 + 5.2 * t;
          beams.push({
            x: side * 7.6, y: (topA + topB) / 2 - 0.25, z: (prevFull.z + z) / 2,
            s: 1, ry: 0, rx: -Math.atan2(topB - topA, z - prevFull.z),
          });
        }
        prevFull = { z, t };
      } else prevFull = null;
    }
  }

  // ---- 横跨石拱门 ×4（两全两塌）----
  const gateZ = [-52, -102, -152, -202];
  gateZ.forEach((z, gi) => {
    const broken = gi % 2 === 1;
    gatePillar.push({ x: -4.9, y: 2.3, z, s: 1, ry: 0 });
    gatePillar.push({ x: 4.9, y: broken ? 1.1 : 2.3, z, s: broken ? 0.48 : 1, ry: 0 });
    if (!broken) {
      gateBeam.push({ x: 0, y: 5.05, z, s: 1, ry: 0 });
      gateRune.push({ x: 0, y: 4.55, z, s: 1, ry: 0 }); // 梁下净高 4.5m，金符文条示高
    } else {
      // 半塌：断梁外倒——斜搭在矮柱顶（梁底 2.2m 恰落在 s=0.48 矮柱顶），梁梢翘向路缘外、
      // 远端砸进桥面外侧；路面走廊（|x|<3）全程无梁，且梁梢 x≥3.0 只在 5m 外入画——
      // 旧版梁横穿路面 y0.7~4.1，每圈扫过相机位时整屏斜板挡视野（用户截图穿帮①）
      gateBeam.push({ x: 7.6, y: 0.94, z, s: 1, ry: 0, rz: -0.55 });
      // 断梁的另一半：倒在左柱脚外（|x|>路缘、贴地碎段），补齐「半截梁去哪了」的废墟叙事
      gateBeam.push({ x: -6.6, y: 0.1, z: z + 1.4, s: 0.26, ry: 0.6, rz: 0.1 });
    }
  });

  insts.push(addInst(scene, new THREE.BoxGeometry(0.55, 0.5, 0.92), std(P.stone), stones));
  insts.push(addInst(scene, new THREE.BoxGeometry(0.4, 0.08, 2.2), new THREE.MeshBasicMaterial({ color: P.gold }), runes));
  insts.push(addInst(scene, new THREE.CylinderGeometry(0.06, 0.1, 1.5, 6), std(P.stoneDark), posts.map(p => ({ ...p, y: p.y + 0.75 * p.s }))));
  insts.push(addInst(scene, new THREE.OctahedronGeometry(0.14, 0), new THREE.MeshBasicMaterial({ color: P.gold }), tips));
  // 路灯光池：additive 金斑 3.2m 平铺 y=0.03、不写深度，一条 InstancedMesh 扛全部灯位（1 draw call）
  const poolGeo = new THREE.PlaneGeometry(3.2, 3.2);
  poolGeo.rotateX(-Math.PI / 2);
  const poolTex = makePoolTexture();
  const poolMat = new THREE.MeshBasicMaterial({
    color: P.gold, map: poolTex, transparent: true, opacity: 0.15,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  insts.push(addInst(scene, poolGeo, poolMat, pools));
  insts.push(addInst(scene, new THREE.BoxGeometry(1.0, 0.5, 1.0), std(P.stoneDark), colBase.map(p => ({ ...p, y: p.y }))));
  insts.push(addInst(scene, new THREE.CylinderGeometry(0.32, 0.4, 5.2, 8), std(P.stone), colShaft.map(p => ({ ...p, y: p.y }))));
  insts.push(addInst(scene, new THREE.BoxGeometry(1.05, 0.6, 1.05), std(P.stoneDark), colCap.map(p => ({ ...p, y: p.y }))));
  insts.push(addInst(scene, new THREE.BoxGeometry(0.8, 0.5, 6.4), std(P.stone), beams.map(p => ({ ...p, y: p.y }))));
  insts.push(addInst(scene, new THREE.BoxGeometry(1.0, 4.6, 1.0), std(P.stone), gatePillar.map(p => ({ ...p, y: p.y }))));
  insts.push(addInst(scene, new THREE.BoxGeometry(10.8, 0.8, 1.1), std(P.stoneDark), gateBeam.map(p => ({ ...p, y: p.y }))));
  insts.push(addInst(scene, new THREE.BoxGeometry(9.6, 0.1, 0.7), new THREE.MeshBasicMaterial({ color: P.gold }), gateRune.map(p => ({ ...p, y: p.y }))));

  // dispose 清单：本轮新增的光池资源（几何/材质/贴图）挂这里，随主题卸载
  const disposables: { dispose(): void }[] = [poolGeo, poolMat, poolTex];

  return {
    update(move: number) {
      if (move === 0) return;
      for (const inst of insts) {
        for (const p of inst.items) {
          p.z += move;
          if (p.z > WRAP_Z) p.z -= LOOP;
        }
        writeAll(inst);
      }
    },
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}
