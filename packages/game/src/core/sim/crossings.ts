/**
 * 穿越判定层（M4 第五步，雷脊穿环计分 / 泰坦肋拱穿行 / 图书馆书阁共用）：
 * sim 持有 CrossingEntity 列表（trackGen 按 config 出生，与侧景视觉件同 z 对齐），
 * 玩家经过时按「深度窗 + 高度带」判一次穿越 → 推 cross 事件进 drainEvents（计分/连击消费）。
 * 纯逻辑：零 three 依赖、零分配（事件对象按需 push 例外）、同输入恒同输出（回放安全）。
 */

export type CrossingKind = 'ring' | 'rib';

/** 一个穿越体：lane=所在车道（ring 居中可 0）、worldZ=到达距离、yBand=可穿越高度带 [yMin,yMax] */
export interface CrossingEntity {
  kind: CrossingKind;
  lane: number;
  worldZ: number;
  yMin: number;
  yMax: number;
  done?: boolean;
}

/** 穿越判定参数（sim 从 config/game.json runner 段读，缺省=下面 DEFAULTS 的值） */
export interface CrossingParams {
  /** 深度判定半窗（米）：|worldZ - dist| ≤ half 即在本帧深度窗内 */
  halfM: number;
  /** 穿越成功奖励分 */
  scorePer: number;
}

export const CROSSING_DEFAULTS: CrossingParams = { halfM: 1.2, scorePer: 50 };

/**
 * 推进穿越判定：对每个未完成穿越体做一次性判定（深度窗命中 + 玩家高度在带内 ⇒ done + 事件）。
 * 错过（worldZ 落到身后）也置 done 但不计分——「穿环」是走位奖励，不是惩罚项。
 * 返回本次新完成的穿越体数量（sim 据此加分）。events.push 的对象结构即 SimEvent 的 cross 分支。
 */
export function stepCrossings(
  crossings: CrossingEntity[], dist: number, playerY: number, params: CrossingParams,
  events: { type: string; kind?: string; lane?: number; worldZ?: number }[],
): number {
  let hit = 0;
  for (const c of crossings) {
    if (c.done) continue;
    const rel = c.worldZ - dist;
    if (rel < -params.halfM) { c.done = true; continue; } // 已身后：错过，不再判
    if (rel > params.halfM) break; // 列表按 worldZ 升序 ⇒ 后面的还没到，提前收工
    c.done = true;
    if (playerY >= c.yMin && playerY <= c.yMax) {
      hit++;
      events.push({ type: 'cross', kind: c.kind, lane: c.lane, worldZ: c.worldZ });
    }
  }
  return hit;
}

/** 穿越体按 worldZ 升序插入（trackGen 出生时用；列表保持有序 ⇒ stepCrossings 可提前收工） */
export function insertCrossing(list: CrossingEntity[], c: CrossingEntity): void {
  let i = list.length;
  while (i > 0 && list[i - 1]!.worldZ > c.worldZ) i--;
  list.splice(i, 0, c);
}

/** 清理已掠过（done 且落后于回收线）的穿越体：swap-pop，O(1) 摊销（对齐 runnerSim 的实体回收口径） */
export function cullCrossings(list: CrossingEntity[], dist: number, cullBehindM: number): void {
  let i = 0;
  while (i < list.length) {
    const c = list[i]!;
    if (c.done && c.worldZ < dist - cullBehindM) {
      list[i] = list[list.length - 1]!;
      list.pop();
    } else i++;
  }
}

/** trackGen 出生钩子：[from, target) 区间按 everyM 均匀插 ring，返回新的 nextZ（调用方持有游标） */
export function spawnRings(list: CrossingEntity[], target: number, nextZ: number,
  everyM: number, fromM: number, yMin: number, yMax: number): number {
  let z = Math.max(nextZ, fromM);
  while (z < target) {
    insertCrossing(list, { kind: 'ring', lane: 0, worldZ: z, yMin, yMax });
    z += everyM;
  }
  return Math.max(z, fromM);
}