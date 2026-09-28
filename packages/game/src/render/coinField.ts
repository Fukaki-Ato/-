/**
 * 金币场（docs/02 §8：全部金币 2 个 drawcall）
 * 双 InstancedMesh（环 + 面）+ 对象池式名额选取。每帧零分配：矩阵与候选缓冲全部复用。
 */
import * as THREE from 'three';
import type { CoinEntity } from '@tr/game/core/sim/trackGen.js';

/** 单帧最多绘制的金币数（超出按「离角色最近优先」取舍） */
const COIN_MAX = 260;
/** 候选收集上限：空中密集金币带会瞬时产生大量候选 */
const COIN_CAND_MAX = 4096;
/** 雾视距：更远的金币不占名额 */
const COIN_FAR_Z = -115, COIN_NEAR_Z = 8;
/** 被吸金币的吸入动画时长（秒）与终点（角色身体前表面外即止） */
const SUCK_T = 0.25, SUCK_END_Z = -0.45;
/** 磁铁期金币整体放大倍数（光圈感增强） */
const MAGNET_COIN_SCALE = 1.25;

export interface CoinFieldArgs {
  coins: CoinEntity[]; t: number; dist: number;
  magnetOn: boolean; playerX: number; playerY: number;
}

export function createCoinField(scene: THREE.Scene, laneWidth: number) {
  const ringGeo = new THREE.TorusGeometry(0.26, 0.085, 10, 22);
  const ringMat = new THREE.MeshStandardMaterial({ color: 0xffcf3f, emissive: 0xffb300, emissiveIntensity: 0.85, metalness: 0.4, roughness: 0.25 });
  const faceGeo = new THREE.CircleGeometry(0.23, 18);
  const faceMat = new THREE.MeshStandardMaterial({ color: 0xe8a921, metalness: 0.5, roughness: 0.4, side: THREE.DoubleSide });
  const ringInst = new THREE.InstancedMesh(ringGeo, ringMat, COIN_MAX);
  const faceInst = new THREE.InstancedMesh(faceGeo, faceMat, COIN_MAX);
  ringInst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  faceInst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(ringInst, faceInst);

  const dummy = new THREE.Object3D(); // 矩阵组装复用，零分配
  const coinCand = new Int32Array(COIN_CAND_MAX);
  const coinKey = new Float32Array(COIN_CAND_MAX);
  const coinIdx = new Int32Array(COIN_MAX);
  const heap: number[] = [];

  /**
   * 名额选取按「离角色最近优先」：cull 用 swap-pop 会打乱数组顺序，
   * 若按数组顺序填满 COIN_MAX 就 break，远处的金币会挤掉脚下要吃的金币（跳跃/飞行段表现为「看不到金币」）。
   */
  function selectVisible(coins: CoinEntity[], dist: number, t: number): number {
    let visN = 0;
    for (let i = 0; i < coins.length && visN < COIN_CAND_MAX; i++) {
      const c = coins[i];
      if (c.taken) {
        const age = t - (c.takenAt ?? -1);
        if (age >= 0 && age <= SUCK_T) { coinCand[visN] = i; coinKey[visN] = dist - c.worldZ; visN++; } // 吸入动画期内保留
      } else {
        const z = dist - c.worldZ;
        if (z >= COIN_FAR_Z && z <= COIN_NEAR_Z) { coinCand[visN] = i; coinKey[visN] = Math.abs(z); visN++; } // 雾外金币不占名额
      }
    }
    if (visN <= COIN_MAX) {
      for (let i = 0; i < visN; i++) coinIdx[i] = coinCand[i];
      return visN;
    }
    // 大顶堆维护「最近 COIN_MAX 枚」：堆顶是名额里最远的一枚，新的更近就换掉它再下沉
    heap.length = 0;
    for (let i = 0; i < COIN_MAX; i++) heap.push(coinCand[i]);
    const siftDown = (start: number) => {
      let p = start;
      for (;;) {
        const l = 2 * p + 1, r = l + 1;
        let m = p;
        if (l < heap.length && coinKey[heap[l]] > coinKey[heap[m]]) m = l;
        if (r < heap.length && coinKey[heap[r]] > coinKey[heap[m]]) m = r;
        if (m === p) break;
        const tmp = heap[m]; heap[m] = heap[p]; heap[p] = tmp; p = m;
      }
    };
    for (let i = (COIN_MAX >> 1) - 1; i >= 0; i--) siftDown(i);
    for (let i = COIN_MAX; i < visN; i++) {
      if (coinKey[i] < coinKey[heap[0]]) { heap[0] = i; siftDown(0); }
    }
    for (let i = 0; i < COIN_MAX; i++) coinIdx[i] = heap[i];
    return COIN_MAX;
  }

  return {
    update(a: CoinFieldArgs) {
      const scale = a.magnetOn ? MAGNET_COIN_SCALE : 1;
      const n = selectVisible(a.coins, a.dist, a.t);
      for (let slot = 0; slot < n; slot++) {
        const c = a.coins[coinIdx[slot]];
        let x = c.lane * laneWidth;
        let z = a.dist - c.worldZ;
        let y = (c.y ?? 0.65) + Math.sin(a.t * 2.9 + c.worldZ * 0.7) * 0.06; // 空中金币带按自身高度绘制
        let sc = scale;
        if (c.taken) { // 吸入动画：向身体收拢并缩小
          const k = (a.t - (c.takenAt ?? 0)) / SUCK_T;
          x += (a.playerX - x) * k;
          z += (SUCK_END_Z - z) * k;
          y += (a.playerY + 0.3 - y) * k;
          sc = scale * (1 - k * 0.7);
        }
        dummy.position.set(x, y, z);
        dummy.rotation.set(0, (a.t * 3.2 + c.worldZ) % (Math.PI * 2), 0);
        dummy.scale.setScalar(sc);
        dummy.updateMatrix();
        ringInst.setMatrixAt(slot, dummy.matrix);
        faceInst.setMatrixAt(slot, dummy.matrix);
      }
      ringInst.count = n; faceInst.count = n;
      ringInst.instanceMatrix.needsUpdate = true; faceInst.instanceMatrix.needsUpdate = true;
    },
  };
}
