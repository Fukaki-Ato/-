/**
 * 反重力区「世界级事件入口门」（跑酷特殊事件体验升级 B 线）：每个区两道可见拱门——
 * 入口门（startM，青 #59d2ff，语义=即将翻转，发光条脉冲是 flipWarn 60m 预告窗的世界侧回响：
 * 玩家看到门在「加速亮起」就知道要变）+ 出口门（endM，暖琥珀 #ffb454，语义=落地恢复，恒稳光）。
 * 结构 = 双塔柱（路两侧）+ 顶横梁 + 梁下发光条；3 个 InstancedMesh（塔柱 8 / 横梁 4 / 发光条 4
 * 实例 = 最多同时 2 区 4 门；everyM≥400、lengthM≤120 时 138m 窗内不可能超），
 * instanceColor 区分入口青/出口琥珀；窗口外槽位 scale 0 隐藏。每帧零分配：
 * 只写 instance buffer，临时 Matrix4/Color 模块顶层复用；渲染层只读 zones，不反写（worldBend 同款红线）。
 */
import * as THREE from 'three';
import type { Zone } from '@tr/game/core/sim/zones.js';

/** 可见窗（米）：门位里程 worldM ∈ [dist−8, dist+130] 才占槽位（entityLayers 口径 z=dist−worldM，前方为负） */
const WIN_BACK_M = 8, WIN_AHEAD_M = 130;
/** 槽容量：最多同时 2 区 × 2 门 */
const GATE_SLOTS = 4;
/** 门体尺寸（米）：塔柱 0.45×4.8×0.45，立于 x=±(1.5·laneWidth+0.55)；横梁/发光条跨路宽 */
const PILLAR_W = 0.45, PILLAR_H = 4.8, PILLAR_OFF = 0.55, BEAM_H = 0.32, BAR_H = 0.16, BAR_D = 0.06;
/** 发光条配色：入口青（即将翻转）/ 出口暖琥珀（落地恢复） */
const ENTRY_COLOR = 0x59d2ff, EXIT_COLOR = 0xffb454;
/** 发光条强度：入口基础 0.55、距门 ≤60m 线性爬到 1.8、sin(t·6)×0.25 呼吸；出口恒 0.9 稳光 */
const PULSE_WIN_M = 60, PULSE_BASE = 0.55, PULSE_PEAK = 1.8, PULSE_BREATH = 0.25, EXIT_GLOW = 0.9;
/** 塔柱/横梁 instanceColor 亮度：白基色 MeshStandard × 此系数 = 素色深灰金属带门色倾向 */
const STRUCT_DIM = 0.3;

/** 矩阵/颜色临时对象（模块顶层建好复用，update 内零分配） */
const M = new THREE.Matrix4();
const C = new THREE.Color();

export interface ZoneGatesHandle {
  /** dist=玩家插值距离；每帧扫 zones 找 [dist−8, dist+130] 窗内的门位，重排实例矩阵；窗口外槽位 scale 0 隐藏 */
  update(dist: number, t: number, flip: 1 | -1): void;
  dispose(): void;
}

export function createZoneGates(scene: THREE.Scene, laneWidth: number, zones: Zone[]): ZoneGatesHandle {
  const spanW = 3 * laneWidth + 2 * PILLAR_OFF; // 柱心距（=路宽量级）；横梁再各包半根柱
  const pillarGeo = new THREE.BoxGeometry(PILLAR_W, PILLAR_H, PILLAR_W);
  const beamGeo = new THREE.BoxGeometry(spanW + PILLAR_W, BEAM_H, PILLAR_W);
  const barGeo = new THREE.BoxGeometry(spanW, BAR_H, BAR_D);
  // 塔柱/横梁：白基色 MeshStandard（instanceColor 即外观色）；发光条：MeshBasic + 加色混合（本仓 burst/speedLines 的
  // 高亮做法，不用 MeshStandard emissive——避免 IBL 依赖），脉冲亮度直接写进 instanceColor（色 × 强度）
  const structMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0.4 });
  const barMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  const pillars = new THREE.InstancedMesh(pillarGeo, structMat, GATE_SLOTS * 2);
  const beams = new THREE.InstancedMesh(beamGeo, structMat, GATE_SLOTS);
  const bars = new THREE.InstancedMesh(barGeo, barMat, GATE_SLOTS);
  for (const mesh of [pillars, beams, bars]) {
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // 矩阵逐帧全量重写，几何包围球不可靠：剔除交给槽位 scale 0（同 coinField/obstacleSkin 惯例，防跳跃顶点整组闪断）
    mesh.frustumCulled = false;
    scene.add(mesh);
  }
  // 开局把 instanceColor 缓冲建满（首帧后 update 不再建对象）：全 0 起步
  for (let i = 0; i < GATE_SLOTS * 2; i++) pillars.setColorAt(i, C.setScalar(0));
  for (let i = 0; i < GATE_SLOTS; i++) { beams.setColorAt(i, C.setScalar(0)); bars.setColorAt(i, C.setScalar(0)); }

  /** 写第 g 槽位的门（worldM=门位里程；exit=true 出口门）：矩阵 + 结构色 + 发光条脉冲色 */
  function putGate(g: number, worldM: number, exit: boolean, dist: number, t: number) {
    const z = dist - worldM; // entityLayers 同款映射：门在前方为负，向 +z 逼近/掠过
    const xEdge = 1.5 * laneWidth + PILLAR_OFF;
    M.makeTranslation(-xEdge, PILLAR_H / 2, z); pillars.setMatrixAt(g * 2, M);
    M.makeTranslation(xEdge, PILLAR_H / 2, z); pillars.setMatrixAt(g * 2 + 1, M);
    M.makeTranslation(0, PILLAR_H - BEAM_H / 2, z); beams.setMatrixAt(g, M);
    M.makeTranslation(0, PILLAR_H - BEAM_H - BAR_H / 2, z); bars.setMatrixAt(g, M);
    const hex = exit ? EXIT_COLOR : ENTRY_COLOR;
    C.setHex(hex).multiplyScalar(STRUCT_DIM); // 塔柱/横梁：门色 × 0.3 = 深灰金属
    pillars.setColorAt(g * 2, C); pillars.setColorAt(g * 2 + 1, C); beams.setColorAt(g, C);
    // 发光条：出口恒稳光；入口 = 基础 0.55 + 60m 窗内线性爬到 1.8 + sin(t·6)×0.25 呼吸（flipWarn 的世界侧回响）
    const a = worldM - dist; // 门在前方多少米（过门后为负）
    const near = !exit && a >= 0 && a <= PULSE_WIN_M ? 1 - a / PULSE_WIN_M : 0;
    const k = exit ? EXIT_GLOW : PULSE_BASE + (PULSE_PEAK - PULSE_BASE) * near + PULSE_BREATH * Math.sin(t * 6);
    C.setHex(hex).multiplyScalar(k);
    bars.setColorAt(g, C);
  }

  /** 隐藏槽位：scale 0（零矩阵，实例退化成不可见点） */
  function hideSlot(mesh: THREE.InstancedMesh, i: number) {
    M.makeScale(0, 0, 0); mesh.setMatrixAt(i, M);
  }

  return {
    update(dist: number, t: number, flip: 1 | -1) {
      // flip 仅为契约对齐（主控统一传参）：拱门是立于路面的世界地标，B-7 倒挂镜像只作用于障碍根组，门不随重力翻
      let g = 0;
      for (const zn of zones) {
        if (zn.endM < dist - WIN_BACK_M) continue; // 整区已在身后窗外（zones 按 startM 升序且互不重叠）
        if (zn.startM > dist + WIN_AHEAD_M) break; // 之后的区只会更远
        // 到此处必有 endM ≥ dist−8 且 startM ≤ dist+130，逐门再卡窗界；槽位按里程序分配，推进时稳定复用
        if (zn.startM >= dist - WIN_BACK_M && g < GATE_SLOTS) putGate(g++, zn.startM, false, dist, t);
        if (zn.endM <= dist + WIN_AHEAD_M && g < GATE_SLOTS) putGate(g++, zn.endM, true, dist, t);
      }
      for (let i = g * 2; i < GATE_SLOTS * 2; i++) hideSlot(pillars, i);
      for (let i = g; i < GATE_SLOTS; i++) { hideSlot(beams, i); hideSlot(bars, i); }
      pillars.instanceMatrix.needsUpdate = true; beams.instanceMatrix.needsUpdate = true; bars.instanceMatrix.needsUpdate = true;
      if (pillars.instanceColor) pillars.instanceColor.needsUpdate = true;
      if (beams.instanceColor) beams.instanceColor.needsUpdate = true;
      if (bars.instanceColor) bars.instanceColor.needsUpdate = true;
    },
    dispose() { // 同 eruption：几何/材质/实例缓冲全释放并移出场景
      for (const [mesh, geo, mat] of [[pillars, pillarGeo, structMat], [beams, beamGeo, structMat], [bars, barGeo, barMat]] as const) {
        scene.remove(mesh); geo.dispose(); mat.dispose(); mesh.dispose();
      }
    },
  };
}
